import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { requestBrokerPersonalContext } from '../../app/agent-runtime.mjs';

test('physical agent personal-context proof validates citation hashes without exposing its token', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oam-agent-personal-'));
  const socketPath = path.join(root, 'broker.sock');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let receivedAuthorization = '';
  const server = http.createServer((request, response) => {
    receivedAuthorization = String(request.headers.authorization || '');
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString('utf8')), { query: 'handoff' });
      assert.equal(request.headers['x-oam-principal'], 'agent:personal_memory');
      const body = JSON.stringify({
        schema_version: 1,
        authorization: 'allowed',
        items: [{
          source_type: 'memory',
          id: '00000000-0000-4000-8000-000000000001',
          revision: 2,
          content_sha256: 'a'.repeat(64),
          citation: {
            source_type: 'memory',
            source_id: '00000000-0000-4000-8000-000000000001',
            memory_id: '00000000-0000-4000-8000-000000000001',
            revision: 2,
            content_sha256: 'a'.repeat(64),
          },
        }, {
          source_type: 'profile',
          id: '00000000-0000-4000-8000-000000000003',
          revision: 4,
          content_sha256: 'b'.repeat(64),
          citation: {
            source_type: 'profile',
            source_id: '00000000-0000-4000-8000-000000000003',
            profile_id: '00000000-0000-4000-8000-000000000003',
            revision: 4,
            content_sha256: 'b'.repeat(64),
          },
        }],
        citations: [{
          source_type: 'memory',
          source_id: '00000000-0000-4000-8000-000000000001',
          memory_id: '00000000-0000-4000-8000-000000000001',
          revision: 2,
          content_sha256: 'a'.repeat(64),
        }, {
          source_type: 'profile',
          source_id: '00000000-0000-4000-8000-000000000003',
          profile_id: '00000000-0000-4000-8000-000000000003',
          revision: 4,
          content_sha256: 'b'.repeat(64),
        }],
        audit_event_key: '00000000-0000-4000-8000-000000000002',
      });
      response.writeHead(200, {
        'content-length': Buffer.byteLength(body),
        'content-type': 'application/json',
      });
      response.end(body);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await requestBrokerPersonalContext({
    socketPath,
    token: 'T'.repeat(43),
    principalKey: 'agent:personal_memory',
    query: 'handoff',
  });

  assert.equal(result.passed, true);
  assert.equal(result.matched_count, 2);
  assert.equal(result.citation_count, 2);
  assert.deepEqual(result.citation_digests, [{
    source_type: 'memory',
    source_id: '00000000-0000-4000-8000-000000000001',
    revision: 2,
    content_sha256: 'a'.repeat(64),
  }, {
    source_type: 'profile',
    source_id: '00000000-0000-4000-8000-000000000003',
    revision: 4,
    content_sha256: 'b'.repeat(64),
  }]);
  assert.equal(receivedAuthorization, `Bearer ${'T'.repeat(43)}`);
  assert.equal(JSON.stringify(result).includes('T'.repeat(43)), false);
});
