import type { HttpRequest } from '@azure/functions';
import type { ZodType } from 'zod';
import { ValidationError } from '../errors/errorTypes';

export async function validateBody<T>(request: HttpRequest, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try { body = await request.json(); }
  catch { throw new ValidationError('Request body must be valid JSON'); }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError('Request validation failed', result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    })));
  }
  return result.data;
}
