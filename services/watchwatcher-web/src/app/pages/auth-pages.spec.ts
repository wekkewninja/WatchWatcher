import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthStateService } from '../core/auth-state.service';
import { CreateAccountPage } from './create-account.page';
import { LoginPage } from './login.page';
import { AccountPage } from './account.page';
import { PASSWORD_LIMIT_MESSAGE } from '../../../../shared/schemas/password';

const googleCredential = { credential: 'google-credential', challengeId: 'challenge-1' };
const authenticated = { kind: 'authenticated', user: { id: 'user-1', name: 'Sailor', email: 'sailor@example.com' } };
const auth = {
  login: vi.fn(),
  createAccount: vi.fn(),
  loginWithGoogle: vi.fn(),
  logout: vi.fn(),
  accountGeneration: 1,
  user: signal<{ id: string } | null>(null),
};
const router = { navigateByUrl: vi.fn() };

beforeEach(() => {
  vi.resetAllMocks();
  auth.login.mockResolvedValue(undefined);
  auth.createAccount.mockResolvedValue(undefined);
  auth.loginWithGoogle.mockResolvedValue(authenticated);
  auth.logout.mockResolvedValue(undefined);
  auth.accountGeneration = 1;
  auth.user.set(null);
  router.navigateByUrl.mockResolvedValue(true);
});

describe('LoginPage', () => {
  it('signs out before navigating to guest practice', async () => {
    const page = new LoginPage(auth as unknown as AuthStateService, router as unknown as Router);
    let finish!: () => void;
    auth.logout.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const entering = page.practiceAsGuest();
    expect(auth.logout).toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    finish();
    await entering;
    expect(router.navigateByUrl).toHaveBeenCalledWith('/examiner');
  });

  it('does not navigate if the account changes during guest transition', async () => {
    const page = new LoginPage(auth as unknown as AuthStateService, router as unknown as Router);
    let finish!: () => void;
    auth.logout.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const entering = page.practiceAsGuest();
    auth.accountGeneration++;
    auth.user.set({ id: 'new-account' });
    finish();
    await entering;
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(page.error()).toContain('Account changed');
  });

  it('reports a canceled guest navigation', async () => {
    const page = new LoginPage(auth as unknown as AuthStateService, router as unknown as Router);
    router.navigateByUrl.mockResolvedValue(false);
    await page.practiceAsGuest();
    expect(page.error()).toContain('Could not open guest practice');
  });
  it('enforces the Unicode code-point minimum in the rendered form and submit handler', async () => {
    await TestBed.configureTestingModule({ imports: [LoginPage], providers: [
      { provide: AuthStateService, useValue: auth }, provideRouter([]),
    ] }).compileComponents();
    const fixture = TestBed.createComponent(LoginPage);
    const page = fixture.componentInstance;
    page.googleLink.set(googleCredential);
    page.googleLinkConfirmed = true;
    page.googleLinkPassword = '\u{1f6a2}'.repeat(7);
    page.email = 'sailor@example.com';
    page.password = '\u{1f6a2}'.repeat(7);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('form button[type="submit"]') as HTMLButtonElement;
    const linkButton = fixture.nativeElement.querySelector('.google-link-confirmation button[type="submit"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(linkButton.disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('At least 8 Unicode code points.');
    await page.submit();
    expect(auth.login).not.toHaveBeenCalled();
    expect(page.error()).toContain('at least 8 Unicode code points');
    page.password += '\u{1f6a2}';
    page.googleLinkPassword += '\u{1f6a2}';
    fixture.detectChanges();
    expect(button.disabled).toBe(false);
    expect(linkButton.disabled).toBe(false);
    await page.submit();
    expect(auth.login).toHaveBeenCalledWith(page.email, page.password);
    TestBed.resetTestingModule();
  });
  it('rejects oversized login passwords before calling the API', async () => {
    const page = new LoginPage(auth as unknown as AuthStateService, router as unknown as Router);
    page.password = 'a'.repeat(1025);
    await page.submit();
    expect(page.error()).toBe(PASSWORD_LIMIT_MESSAGE);
    expect(auth.login).not.toHaveBeenCalled();
  });
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
    page.email = 'sailor@example.com';
    page.password = 'wrong-password';
    auth.login.mockRejectedValue(Object.assign(new Error('internal auth detail'), { status: 401 }));
    await page.submit();
    expect(page.error()).toBe('Email or password is incorrect.');
    expect(page.email).toBe('sailor@example.com');
    expect(page.password).toBe('');
    expect(page.busy()).toBe(false);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('shows actionable network, rate-limit, and server feedback without internal details', async () => {
    const page = new LoginPage(auth as unknown as AuthStateService, router as unknown as Router);
    page.password = 'password123';
    auth.login.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await page.submit();
    expect(page.error()).toBe('Unable to reach WatchWatcher. Check your connection and try again.');

    auth.login.mockRejectedValueOnce(Object.assign(new Error('internal rate detail'), { status: 429 }));
    await page.submit();
    expect(page.error()).toBe('Too many sign-in attempts. Wait a moment and try again.');

    auth.login.mockRejectedValueOnce(Object.assign(new Error('limited'), { status: 429, retryAfterSeconds: 73 }));
    await page.submit();
    expect(page.error()).toBe('Too many sign-in attempts. Wait 2 minutes and try again.');

    auth.login.mockRejectedValueOnce(Object.assign(new Error('internal server detail'), { status: 500 }));
    await page.submit();
    expect(page.error()).toBe('Sign-in is temporarily unavailable. Please try again shortly.');
    expect(page.busy()).toBe(false);
  });

  it('renders service failures as visible accessible alerts in the sign-in form', async () => {
    await TestBed.configureTestingModule({ imports: [LoginPage], providers: [
      { provide: AuthStateService, useValue: auth }, provideRouter([]),
    ] }).compileComponents();
    const fixture = TestBed.createComponent(LoginPage);
    const page = fixture.componentInstance;
    page.email = 'sailor@example.com';
    page.password = 'valid-password';
    page.googleLink.set(googleCredential);
    auth.login.mockRejectedValueOnce(Object.assign(new Error('internal detail'), { status: 503 }));

    await page.submit();
    fixture.detectChanges();

    const alert = fixture.nativeElement.querySelector('form p[role="alert"]') as HTMLElement;
    expect(alert.textContent).toBe('Sign-in is temporarily unavailable. Please try again shortly.');
    expect(alert.classList.contains('visible-error')).toBe(true);
    expect(getComputedStyle(alert).display).not.toBe('none');
    expect(page.email).toBe('sailor@example.com');
    expect(page.password).toBe('valid-password');
    expect(page.busy()).toBe(false);
    TestBed.resetTestingModule();
  });
});

describe('CreateAccountPage', () => {
  it('renders duplicate-email feedback as a visible accessible alert and preserves form fields', async () => {
    await TestBed.configureTestingModule({ imports: [CreateAccountPage], providers: [
      { provide: AuthStateService, useValue: auth }, provideRouter([]),
    ] }).compileComponents();
    const fixture = TestBed.createComponent(CreateAccountPage);
    const page = fixture.componentInstance;
    page.name = 'Sailor';
    page.email = 'sailor@example.com';
    page.password = 'valid-password';
    page.confirmPassword = page.password;
    page.googleLink.set(googleCredential);
    auth.createAccount.mockRejectedValueOnce(Object.assign(new Error('internal conflict detail'), { status: 409 }));

    await page.submit();
    fixture.detectChanges();

    const alert = fixture.nativeElement.querySelector('form p[role="alert"]') as HTMLElement;
    expect(alert.textContent).toBe('An account may already exist for this email. Try signing in.');
    expect(alert.classList.contains('visible-error')).toBe(true);
    expect(getComputedStyle(alert).display).not.toBe('none');
    expect(page.name).toBe('Sailor');
    expect(page.email).toBe('sailor@example.com');
    expect(page.password).toBe('valid-password');
    expect(page.busy()).toBe(false);
    TestBed.resetTestingModule();
  });

  it('enforces the Unicode code-point minimum in the rendered form and submit handler', async () => {
    await TestBed.configureTestingModule({ imports: [CreateAccountPage], providers: [
      { provide: AuthStateService, useValue: auth }, provideRouter([]),
    ] }).compileComponents();
    const fixture = TestBed.createComponent(CreateAccountPage);
    const page = fixture.componentInstance;
    page.googleLink.set(googleCredential);
    page.googleLinkConfirmed = true;
    page.googleLinkPassword = '\u{1f6a2}'.repeat(7);
    page.name = 'Sailor';
    page.email = 'sailor@example.com';
    page.password = '\u{1f6a2}'.repeat(9);
    page.confirmPassword = page.password;
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('form button[type="submit"]') as HTMLButtonElement;
    const linkButton = fixture.nativeElement.querySelector('.google-link-confirmation button[type="submit"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(linkButton.disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('10 to 1,024 Unicode code points.');
    await page.submit();
    expect(auth.createAccount).not.toHaveBeenCalled();
    page.password += '\u{1f6a2}';
    page.googleLinkPassword += '\u{1f6a2}';
    page.confirmPassword = page.password;
    fixture.detectChanges();
    expect(button.disabled).toBe(false);
    expect(linkButton.disabled).toBe(false);
    await page.submit();
    expect(auth.createAccount).toHaveBeenCalledWith(page.name, page.email, page.password);
    TestBed.resetTestingModule();
  });
  it('accepts long Unicode passwords and rejects passwords above the shared limit', async () => {
    const page = new CreateAccountPage(auth as unknown as AuthStateService, router as unknown as Router);
    page.password = '\u{1f6a2}'.repeat(256);
    await page.submit();
    expect(auth.createAccount).toHaveBeenCalledWith('', '', page.password);
    page.password = '\u{1f6a2}'.repeat(1025);
    await page.submit();
    expect(page.error()).toBe(PASSWORD_LIMIT_MESSAGE);
    expect(auth.createAccount).toHaveBeenCalledTimes(1);
  });

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
    page.password = 'password123';
    auth.createAccount.mockRejectedValue(new Error('Account already exists'));
    await page.submit();
    expect(page.error()).toBe('Account already exists');
    expect(page.busy()).toBe(false);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('gives actionable duplicate-email and network feedback after registration failures', async () => {
    const page = new CreateAccountPage(auth as unknown as AuthStateService, router as unknown as Router);
    page.password = 'password123';
    auth.createAccount.mockRejectedValueOnce(Object.assign(new Error('internal conflict detail'), { status: 409 }));
    await page.submit();
    expect(page.error()).toBe('An account may already exist for this email. Try signing in.');
    expect(page.busy()).toBe(false);

    auth.createAccount.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await page.submit();
    expect(page.error()).toBe('Unable to reach WatchWatcher. Check your connection and try again.');
    expect(page.busy()).toBe(false);
  });
});

describe.each([
  ['login', () => new LoginPage(auth as unknown as AuthStateService, router as unknown as Router)],
  ['registration', () => new CreateAccountPage(auth as unknown as AuthStateService, router as unknown as Router)],
] as const)('%s Google sign-in', (_label, createPage) => {
  it('requires eight Unicode code points before linking', async () => {
    const page = createPage();
    page.googleLink.set(googleCredential);
    page.googleLinkConfirmed = true;
    page.googleLinkPassword = '\u{1f6a2}'.repeat(7);
    await page.confirmGoogleLink();
    expect(page.error()).toContain('at least 8 Unicode code points');
    expect(auth.loginWithGoogle).not.toHaveBeenCalled();
    page.googleLinkPassword += '\u{1f6a2}';
    await page.confirmGoogleLink();
    expect(auth.loginWithGoogle).toHaveBeenCalledWith({ ...googleCredential, linkExisting: { confirmed: true, password: '\u{1f6a2}'.repeat(8) } });
  });
  it('rejects oversized linking passwords before calling the API', async () => {
    const page = createPage();
    page.googleLink.set(googleCredential);
    page.googleLinkConfirmed = true;
    page.googleLinkPassword = 'a'.repeat(1025);
    await page.confirmGoogleLink();
    expect(page.error()).toBe(PASSWORD_LIMIT_MESSAGE);
    expect(auth.loginWithGoogle).not.toHaveBeenCalled();
  });
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

describe('AccountPage', () => {
  const account = { id: 'user-1', name: 'Sailor', email: 'sailor@example.com' };
  const accountAuth = { user: signal<typeof account | null>(account), accountGeneration: 4, deleteAccount: vi.fn() };

  beforeEach(() => {
    accountAuth.user.set(account);
    accountAuth.accountGeneration = 4;
    accountAuth.deleteAccount.mockReset();
    router.navigateByUrl.mockClear();
  });

  it('rejects oversized deletion passwords before calling the API', async () => {
    const page = new AccountPage(accountAuth as unknown as AuthStateService, router as unknown as Router);
    page.password = 'a'.repeat(1025);
    await page.submitPassword();
    expect(page.error()).toBe(PASSWORD_LIMIT_MESSAGE);
    expect(accountAuth.deleteAccount).not.toHaveBeenCalled();
  });

  it('displays the account and irreversible and offline-device warnings', async () => {
    await TestBed.configureTestingModule({ imports: [AccountPage], providers: [
      { provide: AuthStateService, useValue: accountAuth },
      { provide: Router, useValue: router },
    ] }).compileComponents();
    const fixture = TestBed.createComponent(AccountPage);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain(account.email);
    expect(text).toContain('irreversible');
    expect(text).toContain('other offline devices cannot be remotely erased');
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(true);
    TestBed.resetTestingModule();
  });

  it('requires confirmation and connectivity before sending credentials', async () => {
    const page = new AccountPage(accountAuth as unknown as AuthStateService, router as unknown as Router);
    page.password = 'fresh-password';
    await page.submitPassword();
    expect(accountAuth.deleteAccount).not.toHaveBeenCalled();
    page.confirmed = true;
    page.confirmation = 'DELETE';
    page.password = 'fresh-password';
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await page.submitPassword();
    expect(page.error()).toContain('Connect to the internet');
    expect(accountAuth.deleteAccount).not.toHaveBeenCalled();
    online.mockRestore();
  });

  it('submits fresh password or Google credentials and navigates only for the deleted session', async () => {
    const page = new AccountPage(accountAuth as unknown as AuthStateService, router as unknown as Router);
    page.confirmed = true;
    page.confirmation = 'DELETE';
    page.password = 'fresh-password';
    accountAuth.deleteAccount.mockImplementationOnce(async () => { accountAuth.user.set(null); accountAuth.accountGeneration++; return true; });
    await page.submitPassword();
    expect(accountAuth.deleteAccount).toHaveBeenCalledWith(account.id, 4, { type: 'password', password: 'fresh-password' });
    expect(page.password).toBe('');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');

    accountAuth.user.set(account);
    accountAuth.accountGeneration = 4;
    router.navigateByUrl.mockClear();
    accountAuth.deleteAccount.mockResolvedValueOnce(false);
    await page.submitGoogle(googleCredential);
    expect(accountAuth.deleteAccount).toHaveBeenLastCalledWith(account.id, 4, { type: 'google', ...googleCredential });
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('reports failed reauthentication without navigating', async () => {
    const page = new AccountPage(accountAuth as unknown as AuthStateService, router as unknown as Router);
    page.confirmed = true;
    page.confirmation = 'DELETE';
    page.password = 'incorrect';
    accountAuth.deleteAccount.mockRejectedValueOnce(Object.assign(new Error('Reauthentication failed'), { status: 403, code: 'REAUTHENTICATION_FAILED' }));
    await page.submitPassword();
    expect(page.error()).toContain('Identity confirmation failed');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('reports a server failure as an unconfirmed deletion outcome', async () => {
    const page = new AccountPage(accountAuth as unknown as AuthStateService, router as unknown as Router);
    page.confirmed = true;
    page.confirmation = 'DELETE';
    page.password = 'fresh-password';
    accountAuth.deleteAccount.mockRejectedValueOnce(Object.assign(new Error('Unavailable'), { status: 503 }));
    await page.submitPassword();
    expect(page.error()).toContain('outcome is unconfirmed');
    expect(page.error()).toContain('Server data may still exist');
    expect(page.password).toBe('');
  });
});