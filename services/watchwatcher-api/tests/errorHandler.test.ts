import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const logger = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));
vi.mock('../src/logger', () => ({ logger }));

import { handleError } from '../src/errors/errorHandler';
import { AppError } from '../src/errors/AppError';
import type { InvocationContext } from '@azure/functions';

const context = { invocationId: 'security-test' } as InvocationContext;

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe('production error responses', () => {
  it('redacts Error and non-Error details in Azure Production', () => {
    vi.stubEnv('AZURE_FUNCTIONS_ENVIRONMENT', 'Production');
    vi.stubEnv('NODE_ENV', 'development');

    expect(handleError(new Error('database connection detail'), context)).toMatchObject({
      status: 500,
      jsonBody: { error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred' } },
    });
    expect(handleError('private internal detail', context)).toMatchObject({
      status: 500,
      jsonBody: { error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred' } },
    });
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it('preserves typed application errors and logs them as warnings', () => {
    const error = new AppError(409, 'CONFLICT', 'Progress changed on the server.', { revision: 3 });

    expect(handleError(error, context)).toEqual({
      status: 409,
      jsonBody: { error: { code: 'CONFLICT', message: 'Progress changed on the server.', details: { revision: 3 } } },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CONFLICT', invocationId: 'security-test' }),
      'Progress changed on the server.',
    );
  });

  it('returns structured field details for schema validation errors', () => {
    const parsed = z.object({ email: z.string().email() }).safeParse({ email: 'not-an-email' });
    if (parsed.success) throw new Error('Expected invalid email input to fail validation.');

    expect(handleError(parsed.error, context)).toMatchObject({
      status: 422,
      jsonBody: { error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: [{ field: 'email' }] } },
    });
  });
});