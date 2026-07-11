import { AsyncLocalStorage } from 'node:async_hooks';

const SHA256 = /^[a-f0-9]{64}$/;
const storage = new AsyncLocalStorage();

export const EMPLOYEE_DATABASE_CONTEXT = Symbol('employee-database-context');

function tokenFromActor(actor) {
  const value = actor?.[EMPLOYEE_DATABASE_CONTEXT];
  return typeof value === 'string' && SHA256.test(value) ? value : null;
}

export function actorWithEmployeeDatabaseContext(actor, tokenSha256) {
  if (!actor || typeof actor !== 'object' || !SHA256.test(tokenSha256)) {
    throw new TypeError('A valid actor and employee database context are required.');
  }
  const bound = { ...actor };
  Object.defineProperty(bound, EMPLOYEE_DATABASE_CONTEXT, {
    value: tokenSha256,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  return Object.freeze(bound);
}

export function runWithEmployeeDatabaseContext(actor, work) {
  if (typeof work !== 'function') throw new TypeError('Database context work is required.');
  const tokenSha256 = tokenFromActor(actor);
  if (!tokenSha256) throw new Error('employee_database_context_required');
  return storage.run(tokenSha256, work);
}

export function wrapEmployeeService(service) {
  if (!service || typeof service !== 'object') throw new TypeError('An employee service is required.');
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
      value: (...args) => runWithEmployeeDatabaseContext(
        args[0],
        () => method.apply(service, args),
      ),
    });
  }
  return wrapped;
}

export function createEmployeeContextPool(pool) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }

  async function establish(client, tokenSha256) {
    await client.query('SELECT identity.establish_employee_context($1)', [tokenSha256]);
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
          const raw = typeof sql === 'string' ? sql.trim() : '';
          const statement = raw.endsWith(';') ? raw.slice(0, -1).trimEnd() : raw;
          const normalized = statement.toUpperCase();
          if (tokenSha256 && statement.includes(';')) {
            throw new Error('employee_database_multi_statement_denied');
          }
          const begins = normalized === 'BEGIN' || normalized === 'START TRANSACTION';
          const ends = ['COMMIT', 'END', 'ROLLBACK'].includes(normalized);
          if (tokenSha256
              && /^(?:BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK)\b/.test(normalized)
              && !begins && !ends) {
            throw new Error('employee_database_transaction_command_denied');
          }
          if (begins) {
            const result = await client.query(sql, parameters);
            transactionStarted = true;
            if (tokenSha256) {
              try {
                await establish(client, tokenSha256);
              } catch (error) {
                await client.query('ROLLBACK').catch(() => {});
                transactionStarted = false;
                throw error;
              }
            }
            return result;
          }
          if (tokenSha256 && !transactionStarted) {
            throw new Error('employee_database_transaction_required');
          }
          const result = await client.query(sql, parameters);
          if (ends) {
            transactionStarted = false;
          }
          return result;
        },
        release() {
          const abandonedTransaction = transactionStarted;
          transactionStarted = false;
          client.release(abandonedTransaction
            ? new Error('employee_database_transaction_abandoned')
            : undefined);
        },
      };
    },

    async end() {
      return pool.end();
    },
  };
}
