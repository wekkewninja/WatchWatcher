import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { AuthStateService } from './core/auth-state.service';

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');

@Component({ template: '<p>Private loaded account data</p>' })
class LoadedAccountPage {}

@Component({ template: '<p>Sign-in page</p>' })
class TestLoginPage {}

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    })
      .compileComponents();
  });

  afterEach(() => {
    localStorage.removeItem('app-theme');
    if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia);
    else Reflect.deleteProperty(window, 'matchMedia');
    vi.restoreAllMocks();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the WatchWatcher brand', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.brand-lockup')?.textContent).toContain('WatchWatcher');
  });

  it('shows an unresolved deletion after reload without claiming local data was erased', async () => {
    localStorage.setItem('watchwatcher-deletion-intent:account-a', 'pending');
    localStorage.setItem('watchwatcher-signed-out', 'true');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('deletion outcome for account account-a is unconfirmed');
    expect(text).toContain('Local data has been kept');
    expect(text).toContain('Without its valid session');
    localStorage.removeItem('watchwatcher-deletion-intent:account-a');
    localStorage.removeItem('watchwatcher-signed-out');
  });

  it('offers receipt confirmation and displays failure without claiming deletion', async () => {
    localStorage.setItem('watchwatcher-deletion-intent:receipt-ui:one', 'pending');
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    const fixture = TestBed.createComponent(App);
    const auth = TestBed.inject(AuthStateService);
    auth.deletionRetryOwner.set('receipt-ui');
    const check = vi.spyOn(auth, 'confirmUnresolvedDeletion').mockImplementation(async () => { auth.deletionRetryError.set('Deletion could not be confirmed. Server data may still exist.'); });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('lost on reload or sign-out');
    [...element.querySelectorAll('button')].find((button) => button.textContent?.includes('Check deletion receipt'))!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(check).toHaveBeenCalledWith('receipt-ui');
    expect(element.textContent).toContain('Deletion could not be confirmed');
    expect(element.textContent).not.toContain('Account deleted,');
    localStorage.removeItem('watchwatcher-deletion-intent:receipt-ui:one');
    sessionStorage.removeItem('watchwatcher-signed-out');
  });

  it('requires a separate confirmation for local erase and describes server and device limits', async () => {
    localStorage.setItem('watchwatcher-deletion-intent:ui-owner:one', 'pending');
    localStorage.setItem('watchwatcher-signed-out', 'true');
    const fixture = TestBed.createComponent(App);
    const auth = TestBed.inject(AuthStateService);
    const erase = vi.spyOn(auth, 'eraseUnresolvedLocalData').mockResolvedValue();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Server data could still exist');
    expect(element.textContent).toContain('Other devices must be handled separately');
    const button = [...element.querySelectorAll('button')].find((item) => item.textContent?.includes('Erase local data'))!;
    button.click();
    fixture.detectChanges();
    const confirm = [...element.querySelectorAll('button')].find((item) => item.textContent?.includes('Confirm local erase'))!;
    expect(confirm.disabled).toBe(true);
    expect(erase).not.toHaveBeenCalled();
    const checkbox = element.querySelector('fieldset input') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(confirm.disabled).toBe(false);
    confirm.click();
    await fixture.whenStable();
    expect(erase).toHaveBeenCalledExactlyOnceWith('ui-owner');
    localStorage.removeItem('watchwatcher-deletion-intent:ui-owner:one');
    localStorage.removeItem('watchwatcher-signed-out');
  });

  it('explains recovery after local-only cleanup without claiming server deletion', () => {
    localStorage.setItem('watchwatcher-deletion-intent:ui-recovery:one', 'pending');
    localStorage.setItem('watchwatcher-local-cleanup:ui-recovery', 'done');
    localStorage.setItem('watchwatcher-signed-out', 'true');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('separate browser profile');
    expect(text).toContain('server data may return');
    expect(text).toContain('outstanding deletion could still complete');
    expect(text).not.toContain('Account deleted,');
    localStorage.removeItem('watchwatcher-deletion-intent:ui-recovery:one');
    localStorage.removeItem('watchwatcher-local-cleanup:ui-recovery');
    localStorage.removeItem('watchwatcher-signed-out');
  });

  it('navigates to login after signing out', async () => {
    const fixture = TestBed.createComponent(App);
    const auth = TestBed.inject(AuthStateService);
    const router = TestBed.inject(Router);
    vi.spyOn(auth, 'logout').mockResolvedValue();
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    await fixture.componentInstance.signOut();

    expect(navigate).toHaveBeenCalledWith('/login');
  });

  it.each([false, true])('removes a loaded account view after deletion, even after an account switch: %s', async (switchAccount) => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([
        { path: 'account', component: LoadedAccountPage },
        { path: 'login', component: TestLoginPage },
      ])],
    }).compileComponents();
    const fixture = TestBed.createComponent(App);
    const auth = TestBed.inject(AuthStateService);
    auth.user.set({ id: 'loaded-view-owner', name: 'Sailor', email: 'sailor@example.test' });
    const router = TestBed.inject(Router);
    fixture.detectChanges();
    await router.navigateByUrl('/account');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Private loaded account data');
    if (switchAccount) auth.user.set({ id: 'different-view-owner', name: 'Other', email: 'other@example.test' });
    const key = 'watchwatcher-deleted:loaded-view-owner';
    localStorage.setItem(key, 'pending');
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: 'pending' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Private loaded account data');
    expect(auth.user()?.id ?? null).toBe(switchAccount ? 'different-view-owner' : null);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(router.url).toBe('/login');
    localStorage.removeItem(key);
  });

  it('warns when confirmed deletion verification and local cleanup cannot be persisted', () => {
    const fixture = TestBed.createComponent(App);
    const auth = TestBed.inject(AuthStateService);
    auth.deletionVerificationUnavailable.set(['affected-account']);
    auth.cleanupPending.set(true);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('could not persist that verification or erase its local data');
    expect(text).toContain('local cleanup or its completion could not be verified');
  });

  it('announces unconfirmed logout to assistive technology', () => {
    const fixture = TestBed.createComponent(App);
    TestBed.inject(AuthStateService).logoutWarning.set(true);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent).toContain('server sign-out could not be confirmed');
  });

  it('prompts a local-only learner to sign in for cloud sync', () => {
    const fixture = TestBed.createComponent(App);
    const auth = TestBed.inject(AuthStateService);
    auth.user.set({ id: 'local-user', name: 'Sailor', email: 'sailor@example.test' });
    auth.cloudAuth.set('local');
    fixture.detectChanges();
    const alert = (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Progress remains on this device for Sailor');
    expect(alert?.textContent).toContain('Sign in to sync');
    expect(alert?.querySelector('a')?.getAttribute('href')).toBe('/login');
  });

  it('follows system theme changes unless the user has chosen an explicit theme', () => {
    let onChange: ((event: MediaQueryListEvent) => void) | undefined;
    const media = {
      matches: true,
      addEventListener: (_type: 'change', listener: (event: MediaQueryListEvent) => void) => { onChange = listener; },
    };
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => media });
    localStorage.setItem('app-theme', 'system');
    const app = TestBed.createComponent(App).componentInstance;

    expect(app.darkMode()).toBe(true);
    expect(document.documentElement.dataset['theme']).toBe('dark');
    onChange?.({ matches: false } as MediaQueryListEvent);
    expect(app.darkMode()).toBe(false);
    expect(document.documentElement.dataset['theme']).toBe('light');

    localStorage.setItem('app-theme', 'light');
    onChange?.({ matches: true } as MediaQueryListEvent);
    expect(app.darkMode()).toBe(false);
  });

  it('persists explicit theme toggles and tolerates browsers without matchMedia', () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: undefined });
    localStorage.setItem('app-theme', 'dark');
    const app = TestBed.createComponent(App).componentInstance;

    expect(app.darkMode()).toBe(true);
    app.toggleTheme();
    expect(app.darkMode()).toBe(false);
    expect(localStorage.getItem('app-theme')).toBe('light');
    app.toggleTheme();
    expect(app.darkMode()).toBe(true);
    expect(localStorage.getItem('app-theme')).toBe('dark');
  });
});
