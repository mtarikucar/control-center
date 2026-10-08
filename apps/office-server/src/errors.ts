export class ValidationError extends Error {
  readonly status = 400;
}
export class UnauthorizedError extends Error {
  readonly status = 401;
}
export class ForbiddenError extends Error {
  readonly status = 403;
  /** Machine-readable reason the page can act on (e.g. fetch a fresh nonce and try again). */
  readonly code: string | undefined;
  constructor(message?: string, code?: string) {
    super(message);
    this.code = code;
  }
}
export class NotFoundError extends Error {
  readonly status = 404;
}
export class ConflictError extends Error {
  readonly status = 409;
}
export class UnsupportedMediaTypeError extends Error {
  readonly status = 415;
}

export function statusOf(err: unknown): number {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : 500;
}
