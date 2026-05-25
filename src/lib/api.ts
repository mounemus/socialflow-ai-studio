import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError } from './errors';
import { logger } from './logger';

/**
 * Wrap a Next.js route handler with consistent error → JSON mapping.
 * Usage:
 *   export const GET = handle(async (req) => { ... return ok(data); });
 */

export type ApiHandler = (req: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

export function handle(handler: ApiHandler): ApiHandler {
  return async (req, context) => {
    try {
      return await handler(req, context);
    } catch (err) {
      if (err instanceof ZodError) {
        return NextResponse.json(
          { error: 'VALIDATION_ERROR', message: 'Invalid input', issues: err.issues },
          { status: 422 },
        );
      }
      if (err instanceof AppError) {
        return NextResponse.json(
          { error: err.code, message: err.message },
          { status: err.statusCode },
        );
      }
      logger.error('Unhandled API error', { error: (err as Error).message, stack: (err as Error).stack });
      return NextResponse.json(
        { error: 'INTERNAL_ERROR', message: 'Internal server error' },
        { status: 500 },
      );
    }
  };
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

export function created<T>(data: T) {
  return NextResponse.json({ data }, { status: 201 });
}
