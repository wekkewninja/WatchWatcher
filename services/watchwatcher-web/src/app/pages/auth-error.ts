import { LocaleService } from '../core/locale.service';

export function responseStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

export function authenticationErrorMessage(error: unknown, operation: 'Sign-in' | 'Account creation', locales = new LocaleService()): string {
  const status = responseStatus(error);
  if (status === 401) return locales.translate('auth.error.invalidCredentials');
  if (status === 409 && operation === 'Account creation') return locales.translate('auth.error.accountExists');
  if (status === 429) {
    const retryAfter = typeof error === 'object' && error !== null && 'retryAfterSeconds' in error ? error.retryAfterSeconds : undefined;
    const minutes = typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter / 60) : undefined;
    const wait = minutes === undefined ? locales.translate('auth.error.waitMoment') : minutes === 1 ? locales.translate('auth.error.waitOneMinute') : locales.translate('auth.error.waitMinutes', { count: minutes });
    return locales.translate('auth.error.rateLimit', { operation: operation.toLowerCase(), wait });
  }
  if (status !== undefined && status >= 500) return locales.translate('auth.error.operationUnavailable', { operation });
  if (error instanceof TypeError) return locales.translate('auth.error.connection');
  return error instanceof Error ? error.message : locales.translate('auth.error.operationFailed', { operation });
}