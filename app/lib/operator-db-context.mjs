import { AsyncLocalStorage } from 'node:async_hooks';

const SHA256 = /^[a-f0-9]{64}$/;
const storage = new AsyncLocalStorage();

export const OPERATOR_DATABASE_CONTEXT = Symbol('operator-database-context');

function tokenFromActor(actor) {
  const value = actor?.[OPERATOR_DATABASE_CONTEXT];
  return typeof value === 'string' && SHA256.test(value) ? value : null;
}

export function actorWithOperatorDatabaseContext(actor, tokenSha256) {
  if (!actor || typeof actor !== 'object' || !SHA256.test(tokenSha256)) {
    throw new TypeError('A valid actor and operator database context are required.');
  }
  const bound = { ...actor };
  Object.defineProperty(bound, OPERATOR_DATABASE_CONTEXT, {
    value: tokenSha256,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  return Object.freeze(bound);
}

export function runWithOperatorDatabaseContext(actor, work) {
  if (typeof work !== 'function') throw new TypeError('Database context work is required.');
  const tokenSha256 = tokenFromActor(actor);
  return tokenSha256 ? storage.run(tokenSha256, work) : work();
}

export function wrapOperatorService(service) {
  if (!service || typeof service !== 'object') {
    throw new TypeError('An operator service is required.');
  }
  const wrapped = {};
  for (const property of Reflect.ownKeys(service)) {
    const descriptor = Object.getOwnPropertyDescriptor(service, property);
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') {
      Object.defineProperty(wrapped, property, descriptor);
      continue;
    }
    const method = descriptor.value;
    Object.defineProperty(wrapped, property, {
      ...descriptor,
      value: (...args) => runWithOperatorDatabaseContext(
        args[0],
        () => method.apply(service, args),
      ),
    });
  }
  return wrapped;
}

export function createOperatorContextPool(pool) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }

  async function establish(client, tokenSha256) {
    await client.query('SELECT identity.establish_operator_context($1)', [tokenSha256]);
  }

  return {
    async query(sql, parameters = []) {
      const tokenSha256 = storage.getStore();
      if (!tokenSha256) return pool.query(sql, parameters);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await establish(client, tokenSha256);
        const result = await client.query(sql, parameters);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async connect() {
      const client = await pool.connect();
      const tokenSha256 = storage.getStore();
      let transactionStarted = false;
      return {
        async query(sql, parameters = []) {
          const normalized = typeof sql === 'string' ? sql.trim().toUpperCase() : '';
          if (normalized === 'BEGIN') {
            const result = await client.query(sql, parameters);
            transactionStarted = true;
            if (tokenSha256) await establish(client, tokenSha256);
            return result;
          }
          if (tokenSha256 && !transactionStarted) {
            throw new Error('operator_database_transaction_required');
          }
          return client.query(sql, parameters);
        },
        release() {
          client.release();
        },
      };
    },

    async end() {
      return pool.end();
    },
  };
}
