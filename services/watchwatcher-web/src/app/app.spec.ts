import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { AuthStateService } from './core/auth-state.service';

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');

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

  it('navigates to login after signing out', async () => {
    const fixture = TestBed.createComponent(App);
    const auth = TestBed.inject(AuthStateService);
    const router = TestBed.inject(Router);
    vi.spyOn(auth, 'logout').mockResolvedValue();
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    await fixture.componentInstance.signOut();

    expect(navigate).toHaveBeenCalledWith('/login');
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
