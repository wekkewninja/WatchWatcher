export function responseStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

export function authenticationErrorMessage(error: unknown, operation: 'Sign-in' | 'Account creation'): string {
  const status = responseStatus(error);
  if (status === 401) return 'Email or password is incorrect.';
  if (status === 409 && operation === 'Account creation') return 'An account may already exist for this email. Try signing in.';
  if (status === 429) return `Too many ${operation.toLowerCase()} attempts. Wait a moment and try again.`;
  if (status !== undefined && status >= 500) return `${operation} is temporarily unavailable. Please try again shortly.`;
  if (error instanceof TypeError) return 'Unable to reach WatchWatcher. Check your connection and try again.';
  return error instanceof Error ? error.message : `${operation} failed. Please try again.`;
}