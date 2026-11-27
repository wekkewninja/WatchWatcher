import type { HttpResponseInit, InvocationContext } from '@azure/functions';
import { ZodError } from 'zod';
import type { ErrorCode } from '../../../shared/types/api';
import { logger } from '../logger';
import { AppError } from './AppError';
import { RateLimitError } from './errorTypes';

export function handleError(error: unknown, context: InvocationContext): HttpResponseInit {
  if (error instanceof AppError) {
    logger.warn({ err: error, code: error.code, invocationId: context.invocationId }, error.message);
    return { status: error.statusCode, ...(error instanceof RateLimitError ? { headers: { 'Retry-After': String(error.retryAfter) } } : {}), jsonBody: { error: { code: error.code, message: error.message, details: error.details } } };
  }
  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }));
    return { status: 422, jsonBody: { error: { code: 'VALIDATION_ERROR' satisfies ErrorCode, message: 'Request validation failed', details } } };
  }
  const message = error instanceof Error ? error.message : String(error);
  logger.error({ err: error, invocationId: context.invocationId }, 'Unhandled request error');
  const environment = (process.env.AZURE_FUNCTIONS_ENVIRONMENT ?? process.env.NODE_ENV ?? 'Production').toLowerCase();
  const isProduction = environment !== 'development' && environment !== 'test';
  return {
    status: 500,
    jsonBody: {
      error: {
        code: 'INTERNAL_ERROR' satisfies ErrorCode,
        message: isProduction ? 'An internal error occurred' : message,
      },
    },
  };
}
