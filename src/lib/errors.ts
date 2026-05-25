/**
 * Typed application errors. All API routes catch these and return clean JSON.
 */

export class AppError extends Error {
  statusCode: number;
  code: string;
  constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class ValidationError extends AppError {
  details?: unknown;
  constructor(message = 'Validation error', details?: unknown) {
    super(message, 422, 'VALIDATION_ERROR');
    this.details = details;
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Rate limit exceeded') {
    super(message, 429, 'RATE_LIMIT');
  }
}

export class ExternalApiError extends AppError {
  provider: string;
  constructor(provider: string, message: string, statusCode = 502) {
    super(`[${provider}] ${message}`, statusCode, 'EXTERNAL_API_ERROR');
    this.provider = provider;
  }
}
