import { AfterViewInit, Component, DestroyRef, ElementRef, inject, output, signal, viewChild } from '@angular/core';
import { api } from '../../api';
import type { GoogleAuthChallenge } from '../../api/types';
import { AuthStateService } from '../core/auth-state.service';

interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleIdentityApi {
  accounts: {
    id: {
      initialize(options: {
        client_id: string;
        nonce: string;
        callback: (response: GoogleCredentialResponse) => void;
        auto_select: false;
      }): void;
      renderButton(element: HTMLElement, options: { theme: 'outline'; size: 'large'; text: 'continue_with'; shape: 'rectangular'; width: number }): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityApi;
  }
}

export interface GoogleCredentialEvent {
  credential: string;
  challengeId: string;
}

@Component({
  selector: 'ww-google-sign-in-button',
  standalone: true,
  template: `
    <div class="google-sign-in">
      <div #buttonHost class="google-sign-in-button"></div>
      @if (loading()) { <small role="status">Preparing secure Google sign-in…</small> }
      @if (error()) { <small class="inline-error" role="alert">{{ error() }}</small> }
      @if (error()) { <button class="google-sign-in-retry" type="button" (click)="refresh()">Retry Google sign-in</button> }
    </div>
  `,
  styles: [`
    .google-sign-in { display: grid; justify-items: center; gap: 7px; width: 100%; margin-top: 12px; }
    .google-sign-in-button { min-width: 200px; min-height: 40px; }
    .google-sign-in small { color: var(--muted); font-size: 11px; }
    .google-sign-in .inline-error { color: var(--danger, #a3261d); }
    .google-sign-in-retry { border: 0; background: transparent; color: var(--brand-primary); cursor: pointer; font: inherit; font-size: 12px; text-decoration: underline; }
  `],
})
export class GoogleSignInButtonComponent implements AfterViewInit {
  readonly signedIn = output<GoogleCredentialEvent>();
  readonly loading = signal(true);
  readonly error = signal('');
  private readonly auth = inject(AuthStateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly buttonHost = viewChild.required<ElementRef<HTMLElement>>('buttonHost');
  private challenge: GoogleAuthChallenge | null = null;
  private preparation = 0;

  ngAfterViewInit(): void { void this.prepareButton(); }

  refresh(): void { void this.prepareButton(); }

  private async prepareButton(): Promise<void> {
    const generation = this.auth.accountGeneration;
    const preparation = ++this.preparation;
    this.challenge = null;
    this.loading.set(true);
    this.error.set('');
    try {
      const clientId = await api.getGoogleClientId();
      const challenge = await api.createGoogleChallenge();
      const google = await this.loadGoogleIdentity();
      if (this.destroyRef.destroyed || preparation !== this.preparation) return;
      if (generation !== this.auth.accountGeneration) {
        this.error.set('Account changed. Retry Google sign-in.');
        return;
      }
      this.challenge = challenge;
      const host = this.buttonHost().nativeElement;
      host.replaceChildren();
      google.accounts.id.initialize({
        client_id: clientId,
        nonce: challenge.nonce,
        auto_select: false,
        callback: (response) => {
          if (this.destroyRef.destroyed) return;
          if (preparation !== this.preparation) return;
          if (generation !== this.auth.accountGeneration) {
            this.challenge = null;
            this.error.set('Account changed. Retry Google sign-in.');
            return;
          }
          const currentChallenge = this.challenge;
          this.challenge = null;
          if (!response.credential || !currentChallenge) {
            this.error.set('Google did not return a sign-in credential. Try again.');
            return;
          }
          this.signedIn.emit({ credential: response.credential, challengeId: currentChallenge.challengeId });
        },
      });
      google.accounts.id.renderButton(host, {
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        width: Math.max(200, Math.min(320, host.clientWidth || 320)),
      });
    } catch (error) {
      if (preparation === this.preparation && !this.destroyRef.destroyed) this.error.set(error instanceof Error ? error.message : 'Google sign-in is unavailable.');
    } finally { if (preparation === this.preparation && !this.destroyRef.destroyed) this.loading.set(false); }
  }

  private async loadGoogleIdentity(): Promise<GoogleIdentityApi> {
    if (window.google) return window.google;
    await new Promise<void>((resolve, reject) => {
      const existing = document.getElementById('google-identity-services') as HTMLScriptElement | null;
      const script = existing ?? document.createElement('script');
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Google sign-in could not be loaded.'));
      if (!existing) {
        script.id = 'google-identity-services';
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
    });
    if (!window.google) throw new Error('Google sign-in did not initialize.');
    return window.google;
  }
}