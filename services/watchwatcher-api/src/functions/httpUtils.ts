import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { handleError } from '../errors/errorHandler';
import { logger } from '../logger';

export async function runHttp(
  request: HttpRequest,
  context: InvocationContext,
  action: () => Promise<HttpResponseInit>,
): Promise<HttpResponseInit> {
  const startedAt = Date.now();
  try {
    const response = await action();
    logger.info({ method: request.method, path: new URL(request.url).pathname, status: response.status ?? 200, durationMs: Date.now() - startedAt, invocationId: context.invocationId }, 'HTTP request completed');
    return response;
  } catch (error) {
    const path = new URL(request.url).pathname;
    const sensitive = /(?:^|\/)auth(?:\/|$)/.test(path) || /(?:^|\/)account\/?$/.test(path);
    const response = handleError(error, context, sensitive);
    logger.info({ method: request.method, path: new URL(request.url).pathname, status: response.status, durationMs: Date.now() - startedAt, invocationId: context.invocationId }, 'HTTP request failed');
    return response;
  }
}

export function bearerHeader(request: HttpRequest): string | undefined {
  return request.headers.get('authorization') ?? undefined;
}
