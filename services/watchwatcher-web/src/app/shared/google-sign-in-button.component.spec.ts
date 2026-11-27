import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { AuthStateService } from '../core/auth-state.service';
import { GoogleSignInButtonComponent } from './google-sign-in-button.component';

describe('GoogleSignInButtonComponent', () => {
  let credentialCallback: ((response: { credential?: string }) => void) | undefined;
  let renderButton: NonNullable<Window['google']>['accounts']['id']['renderButton'];

  beforeEach(async () => {
    vi.spyOn(api, 'getGoogleClientId').mockResolvedValue('public-google-client-id');
    vi.spyOn(api, 'createGoogleChallenge').mockResolvedValue({
      challengeId: '4a3eea85-72f6-4f90-a045-cf8fc2d83ff4',
      nonce: 'one-time-server-nonce',
      expiresAt: '2026-11-22T13:00:00.000Z',
    });
    renderButton = vi.fn<NonNullable<Window['google']>['accounts']['id']['renderButton']>();
    window.google = {
      accounts: {
        id: {
          initialize: (options) => { credentialCallback = options.callback; },
          renderButton,
        },
      },
    };
    await TestBed.configureTestingModule({ imports: [GoogleSignInButtonComponent] }).compileComponents();
  });

  afterEach(() => {
    delete window.google;
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('initializes GIS with the API nonce and emits the credential with its challenge ID', async () => {
    const fixture = TestBed.createComponent(GoogleSignInButtonComponent);
    const received: Array<{ credential: string; challengeId: string }> = [];
    fixture.componentInstance.signedIn.subscribe((event) => received.push(event));
    fixture.detectChanges();
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalledOnce());

    expect(api.getGoogleClientId).toHaveBeenCalledOnce();
    expect(api.createGoogleChallenge).toHaveBeenCalledOnce();
    expect(fixture.componentInstance.error()).toBe('');
    expect(credentialCallback).toBeDefined();
    credentialCallback?.({ credential: 'signed-id-token' });

    expect(received).toEqual([{ credential: 'signed-id-token', challengeId: '4a3eea85-72f6-4f90-a045-cf8fc2d83ff4' }]);
  });

  it('rejects credentials returned after logout', async () => {
    const fixture = TestBed.createComponent(GoogleSignInButtonComponent);
    const received = vi.fn();
    fixture.componentInstance.signedIn.subscribe(received);
    fixture.detectChanges();
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalledOnce());

    await TestBed.inject(AuthStateService).logout();
    credentialCallback?.({ credential: 'signed-id-token' });

    expect(received).not.toHaveBeenCalled();
    expect(fixture.componentInstance.error()).toBe('Account changed. Retry Google sign-in.');
  });

  it('offers retry when password login starts during button preparation', async () => {
    let finishChallenge!: (challenge: { challengeId: string; nonce: string; expiresAt: string }) => void;
    vi.mocked(api.createGoogleChallenge).mockReturnValueOnce(new Promise((resolve) => { finishChallenge = resolve; }));
    vi.spyOn(api, 'login').mockRejectedValueOnce(new Error('Invalid credentials'));
    const fixture = TestBed.createComponent(GoogleSignInButtonComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(finishChallenge).toBeDefined());
    await expect(TestBed.inject(AuthStateService).login('a@example.test', 'wrong')).rejects.toThrow();
    finishChallenge({ challengeId: 'challenge', nonce: 'nonce', expiresAt: '2026-11-22T13:00:00.000Z' });
    await vi.waitFor(() => expect(fixture.componentInstance.error()).toBe('Account changed. Retry Google sign-in.'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Retry Google sign-in');
    expect(renderButton).not.toHaveBeenCalled();
  });

  it('ignores a superseded Google callback after refreshing the challenge', async () => {
    const fixture = TestBed.createComponent(GoogleSignInButtonComponent);
    const received = vi.fn();
    fixture.componentInstance.signedIn.subscribe(received);
    fixture.detectChanges();
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalledOnce());
    const oldCallback = credentialCallback;
    vi.mocked(api.createGoogleChallenge).mockResolvedValueOnce({ challengeId: 'new-challenge', nonce: 'new-nonce', expiresAt: '2026-11-22T13:00:00.000Z' });
    fixture.componentInstance.refresh();
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalledTimes(2));
    oldCallback?.({ credential: 'stale' });
    expect(received).not.toHaveBeenCalled();
    credentialCallback?.({ credential: 'fresh' });
    expect(received).toHaveBeenCalledWith({ credential: 'fresh', challengeId: 'new-challenge' });
  });
});