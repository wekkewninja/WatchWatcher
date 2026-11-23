import type { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthStateService } from '../core/auth-state.service';
import { CreateAccountPage } from './create-account.page';
import { LoginPage } from './login.page';

const googleCredential = { credential: 'google-credential', challengeId: 'challenge-1' };
const authenticated = { kind: 'authenticated', user: { id: 'user-1', name: 'Sailor', email: 'sailor@example.com' } };
const auth = {
  login: vi.fn(),
  createAccount: vi.fn(),
  loginWithGoogle: vi.fn(),
};
const router = { navigateByUrl: vi.fn() };

beforeEach(() => {
  vi.resetAllMocks();
  auth.login.mockResolvedValue(undefined);
  auth.createAccount.mockResolvedValue(undefined);
  auth.loginWithGoogle.mockResolvedValue(authenticated);
  router.navigateByUrl.mockResolvedValue(true);
});

describe('LoginPage', () => {
  it('signs in with the entered credentials and navigates to the study desk', async () => {
    const page = new LoginPage(auth as unknown as AuthStateService, router as unknown as Router);
    page.email = 'sailor@example.com';
    page.password = 'password123';
    await page.submit();
    expect(auth.login).toHaveBeenCalledWith(page.email, page.password);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
    expect(page.busy()).toBe(false);
    expect(page.error()).toBe('');
  });

  it('reports a sign-in failure and restores the busy state', async () => {
    const page = new LoginPage(auth as unknown as AuthStateService, router as unknown as Router);
    auth.login.mockRejectedValue(new Error('Invalid credentials'));
    await page.submit();
    expect(page.error()).toBe('Invalid credentials');
    expect(page.busy()).toBe(false);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });
});

describe('CreateAccountPage', () => {
  it('trims the name and creates an account', async () => {
    const page = new CreateAccountPage(auth as unknown as AuthStateService, router as unknown as Router);
    page.name = '  Sailor  ';
    page.email = 'sailor@example.com';
    page.password = 'password123';
    await page.submit();
    expect(auth.createAccount).toHaveBeenCalledWith('Sailor', page.email, page.password);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
    expect(page.busy()).toBe(false);
  });

  it('reports account creation failures without navigating', async () => {
    const page = new CreateAccountPage(auth as unknown as AuthStateService, router as unknown as Router);
    auth.createAccount.mockRejectedValue(new Error('Account already exists'));
    await page.submit();
    expect(page.error()).toBe('Account already exists');
    expect(page.busy()).toBe(false);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });
});

describe.each([
  ['login', () => new LoginPage(auth as unknown as AuthStateService, router as unknown as Router)],
  ['registration', () => new CreateAccountPage(auth as unknown as AuthStateService, router as unknown as Router)],
] as const)('%s Google sign-in', (_label, createPage) => {
  it('navigates when the Google account is already authenticated', async () => {
    const page = createPage();
    await page.handleGoogleCredential(googleCredential);
    expect(auth.loginWithGoogle).toHaveBeenCalledWith(googleCredential);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
    expect(page.busy()).toBe(false);
  });

  it('requires explicit consent and password before linking an existing account', async () => {
    const page = createPage();
    auth.loginWithGoogle.mockResolvedValueOnce({ kind: 'link-required' });
    await page.handleGoogleCredential(googleCredential);
    expect(page.googleLink()).toEqual(googleCredential);
    await page.confirmGoogleLink();
    expect(auth.loginWithGoogle).toHaveBeenCalledTimes(1);
    page.googleLinkConfirmed = true;
    page.googleLinkPassword = 'password123';
    await page.confirmGoogleLink();
    expect(auth.loginWithGoogle).toHaveBeenLastCalledWith({ ...googleCredential, linkExisting: { confirmed: true, password: 'password123' } });
    expect(page.googleLink()).toBeNull();
    expect(page.googleLinkPassword).toBe('');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('preserves the link request and displays failures', async () => {
    const page = createPage();
    auth.loginWithGoogle.mockResolvedValueOnce({ kind: 'link-required' });
    await page.handleGoogleCredential(googleCredential);
    page.googleLinkConfirmed = true;
    page.googleLinkPassword = 'password123';
    auth.loginWithGoogle.mockRejectedValueOnce(new Error('Incorrect password'));
    await page.confirmGoogleLink();
    expect(page.error()).toBe('Incorrect password');
    expect(page.googleLink()).toEqual(googleCredential);
    expect(page.busy()).toBe(false);
    page.cancelGoogleLink();
    expect(page.googleLink()).toBeNull();
    expect(page.googleLinkConfirmed).toBe(false);
    expect(page.googleLinkPassword).toBe('');
    expect(page.error()).toBe('');
  });

  it('reports initial Google sign-in failures', async () => {
    const page = createPage();
    auth.loginWithGoogle.mockRejectedValueOnce(new Error('Google unavailable'));
    await page.handleGoogleCredential(googleCredential);
    expect(page.error()).toBe('Google unavailable');
    expect(page.busy()).toBe(false);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });
});