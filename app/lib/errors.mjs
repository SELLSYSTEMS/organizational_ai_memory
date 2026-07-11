export class HttpError extends Error {
  constructor(status, code, message, options = {}) {
    super(message, options);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.headers = options.headers || {};
  }
}

export function publicCorpusUnavailableError() {
  return new HttpError(
    503,
    'public_corpus_unavailable',
    'The public demo corpus is not available.',
  );
}
