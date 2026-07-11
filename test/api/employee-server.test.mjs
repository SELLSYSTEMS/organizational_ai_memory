import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmployeeServer, readEmployeeConfig } from '../../app/employee-server.mjs';

test('employee server has a dedicated loopback binding and bounded session lifetime', () => {
  const config = readEmployeeConfig({ PORT: '8100' });
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3020);
  assert.equal(config.sessionTtlMs, 1_800_000);
  assert.equal(readEmployeeConfig({ OAM_EMPLOYEE_PORT: '3042' }).port, 3042);
  assert.throws(() => readEmployeeConfig({ OAM_EMPLOYEE_PORT: '3042junk' }), /port/);
  assert.throws(() => readEmployeeConfig({ OAM_EMPLOYEE_HOST: '0.0.0.0' }), /loopback/);
  assert.throws(() => readEmployeeConfig({ OAM_EMPLOYEE_SESSION_TTL_MS: '10' }), /ttl/);
  assert.throws(
    () => readEmployeeConfig({ OAM_EMPLOYEE_SESSION_TTL_MS: '1800000junk' }),
    /ttl/,
  );
});

test('employee server validates final test overrides before opening PostgreSQL', async () => {
  await assert.rejects(
    createEmployeeServer({ env: {}, config: { host: '0.0.0.0' } }),
    /loopback/,
  );
  await assert.rejects(
    createEmployeeServer({ env: {}, config: { sessionTtlMs: 10 } }),
    /ttl/,
  );
  await assert.rejects(
    createEmployeeServer({ env: {}, config: { allowedOrigin: 'http://memory.example' } }),
    /origin/,
  );
  await assert.rejects(
    createEmployeeServer({
      env: {
        OAM_EMPLOYEE_ALLOWED_HOST: 'memory.example',
        OAM_EMPLOYEE_ALLOWED_ORIGIN: 'https://memory.example',
      },
      config: { allowedHost: null, allowedOrigin: null },
    }),
    /override_denied/,
  );
});
