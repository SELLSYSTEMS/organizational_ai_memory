import assert from 'node:assert/strict';
import test from 'node:test';
import { readServerConfig } from '../../app/lib/config.mjs';

test('server ignores generic PORT and defaults to the dedicated local binding', () => {
  const config = readServerConfig({ PORT: '8100' });

  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3000);
});

test('server accepts a valid dedicated OAM_PORT override', () => {
  assert.equal(readServerConfig({ OAM_PORT: '3017', PORT: '8100' }).port, 3017);
  assert.equal(readServerConfig({ OAM_PORT: 'not-a-port' }).port, 3000);
});

test('task recommendation keys have a dedicated bounded length limit', () => {
  assert.equal(readServerConfig({}).taskKeyCharacters, 80);
  assert.equal(readServerConfig({ OAM_MAX_TASK_KEY_CHARACTERS: '120' }).taskKeyCharacters, 120);
  assert.equal(readServerConfig({ OAM_MAX_TASK_KEY_CHARACTERS: '1000' }).taskKeyCharacters, 80);
});

test('Codex assist is opt-in and has a low dedicated generation limit', () => {
  const defaults = readServerConfig({});
  const enabled = readServerConfig({
    OAM_CODEX_ASSIST_ENABLED: 'true',
    OAM_PUBLIC_GENERATIONS_PER_MINUTE: '8',
    OAM_CODEX_SOCKET_PATH: '/tmp/test-assist.sock',
  });

  assert.equal(defaults.codexAssistEnabled, false);
  assert.equal(defaults.publicGenerationsPerMinute, 6);
  assert.equal(enabled.codexAssistEnabled, true);
  assert.equal(enabled.publicGenerationsPerMinute, 8);
  assert.equal(enabled.codexSocketPath, '/tmp/test-assist.sock');
  assert.equal(readServerConfig({ OAM_PUBLIC_GENERATIONS_PER_MINUTE: '100' }).publicGenerationsPerMinute, 6);
});
