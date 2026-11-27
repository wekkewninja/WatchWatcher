import { describe, expect, it } from 'vitest';
import { authGuard } from './core/auth.guard';
import { routes } from './app.routes';

describe('application routes', () => {
  it('keeps sign-in routes public and protects account study routes', () => {
    expect(routes.filter((route) => route.canActivate?.includes(authGuard)).map((route) => route.path)).toEqual([
      'account', '', 'exam', 'syllabus', 'learn/:contentId',
    ]);
    expect(routes.filter((route) => route.path === 'examiner' || route.path === 'colregs' || route.path === 'colregs/:ruleId')
      .every((route) => !route.canActivate?.includes(authGuard))).toBe(true);
    expect(routes.filter((route) => route.path === 'login' || route.path === 'create-account')
      .every((route) => !route.canActivate?.includes(authGuard))).toBe(true);
    expect(routes.find((route) => route.path === '**')?.redirectTo).toBe('');
  });

  it('resolves every configured lazy page component', async () => {
    const lazyRoutes = routes.filter((route) => typeof route.loadComponent === 'function');
    const components = await Promise.all(lazyRoutes.map((route) => route.loadComponent!()));

    expect(lazyRoutes).toHaveLength(10);
    expect(components.every(Boolean)).toBe(true);
  });
});