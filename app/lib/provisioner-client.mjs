import http from 'node:http';

export class ProvisionerClientError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'ProvisionerClientError';
    this.code = code;
    this.status = status;
  }
}

export function createProvisionerClient({
  socketPath = '/run/oam-provisioner/provisioner.sock',
  timeoutMs = 75_000,
  maxResponseBytes = 131_072,
} = {}) {
  if (typeof socketPath !== 'string' || !socketPath.startsWith('/')) {
    throw new TypeError('An absolute provisioner socket path is required.');
  }

  function requestJson(requestPath, input, expectedField, rejectedMessage) {
    const body = JSON.stringify(input);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
          if (settled) return;
          settled = true;
          if (error) reject(error);
          else resolve(value);
      };
      const request = http.request({
          socketPath,
          path: requestPath,
          method: 'POST',
          headers: {
            'content-length': Buffer.byteLength(body),
            'content-type': 'application/json',
          },
          timeout: timeoutMs,
        }, (response) => {
          const chunks = [];
          let size = 0;
          response.on('data', (chunk) => {
            size += chunk.length;
            if (size <= maxResponseBytes) chunks.push(chunk);
          });
          response.on('end', () => {
            if (size > maxResponseBytes) {
              finish(new ProvisionerClientError(
                'provisioner_response_too_large',
                'Provisioner response exceeded its bound.',
              ));
              return;
            }
            let payload;
            try {
              payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } catch {
              finish(new ProvisionerClientError(
                'provisioner_invalid_response',
                'Provisioner returned invalid JSON.',
              ));
              return;
            }
            if (response.statusCode !== 200 || !payload?.[expectedField]) {
              const code = typeof payload?.error?.code === 'string'
                ? payload.error.code
                : 'provisioner_rejected';
              finish(new ProvisionerClientError(code, rejectedMessage));
              return;
            }
            finish(null, payload);
          });
      });
      request.on('timeout', () => request.destroy(new Error('provisioner_timeout')));
      request.on('error', (error) => finish(new ProvisionerClientError(
          error?.message === 'provisioner_timeout' ? 'provisioner_timeout' : 'provisioner_unavailable',
          'Provisioner is unavailable.',
      )));
      request.end(body);
    });
  }

  return Object.freeze({
    async execute(plan) {
      return requestJson(
        '/v1/jobs',
        plan,
        'record',
        'Provisioner rejected the confirmed plan.',
      );
    },

    async seal(input) {
      const payload = await requestJson(
        '/v1/quarantine/seal',
        input,
        'seal',
        'Provisioner rejected the quarantine seal request.',
      );
      return payload.seal;
    },
  });
}
