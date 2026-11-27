import { Component, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { AuthStateService } from '../core/auth-state.service';
import { LocaleService, TranslationPipe } from '../core/locale.service';
import { GoogleSignInButtonComponent, type GoogleCredentialEvent } from '../shared/google-sign-in-button.component';
import { authenticationErrorMessage, responseStatus } from './auth-error';
import { hasMinimumPasswordCharacters, isPasswordWithinLimits } from '../../../../shared/schemas/password';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule, MatInputModule, GoogleSignInButtonComponent, TranslationPipe],
  template: `
    <main class="auth-page"><mat-card class="auth-card"><div class="auth-mark"><mat-icon>sailing</mat-icon></div><span class="eyebrow">{{ 'auth.login.eyebrow' | t }}</span><h1>{{ 'auth.login.heading' | t }}</h1><p>{{ 'auth.login.offlineDescription' | t }}</p>
      <form (ngSubmit)="submit()"><mat-form-field appearance="outline"><mat-label>{{ 'auth.login.email' | t }}</mat-label><input matInput type="email" name="email" [(ngModel)]="email" required email autocomplete="email"></mat-form-field><mat-form-field appearance="outline"><mat-label>{{ 'auth.login.password' | t }}</mat-label><input matInput type="password" name="password" [(ngModel)]="password" required autocomplete="current-password"><mat-hint>{{ 'auth.login.passwordHint' | t }}</mat-hint></mat-form-field>
        @if (!passwordWithinLimits(password)) { <p class="inline-error" role="alert">{{ 'auth.password.limit' | t }}</p> }
        @if (error()) { <p class="inline-error" role="alert">{{ error() }}</p> }
        <button mat-flat-button type="submit" [disabled]="busy() || !email || !passwordMinimum(password, 8) || !passwordWithinLimits(password)"><mat-icon>login</mat-icon> {{ 'auth.login.submit' | t }}</button>
      </form>
      @if (googleLink(); as link) {
        <section class="google-link-confirmation" [attr.aria-label]="'auth.login.googleLinkLabel' | t">
          <p>{{ 'auth.login.googleLinkDescription' | t }}</p>
          <form (ngSubmit)="confirmGoogleLink()">
            <mat-form-field appearance="outline"><mat-label>{{ 'auth.login.existingPassword' | t }}</mat-label><input matInput type="password" name="googleLinkPassword" [(ngModel)]="googleLinkPassword" required autocomplete="current-password"><mat-hint>{{ 'auth.login.passwordHint' | t }}</mat-hint></mat-form-field>
            @if (!passwordWithinLimits(googleLinkPassword)) { <p class="inline-error" role="alert">{{ 'auth.password.limit' | t }}</p> }
            <label class="google-link-consent"><input type="checkbox" name="googleLinkConfirmed" [(ngModel)]="googleLinkConfirmed"> {{ 'auth.login.googleLinkConsent' | t }}</label>
            @if (error()) { <p class="inline-error" role="alert">{{ error() }}</p> }
            <button mat-flat-button type="submit" [disabled]="busy() || !googleLinkConfirmed || !passwordMinimum(googleLinkPassword, 8) || !passwordWithinLimits(googleLinkPassword)"><mat-icon>link</mat-icon> {{ 'auth.login.confirmLink' | t }}</button>
            <button mat-button type="button" (click)="cancelGoogleLink()" [disabled]="busy()">{{ 'auth.login.cancel' | t }}</button>
          </form>
        </section>
      } @else {
        <div class="auth-divider"><span>{{ 'auth.login.orContinueWith' | t }}</span></div>
        <ww-google-sign-in-button (signedIn)="handleGoogleCredential($event)" />
      }
      <div class="auth-divider"><span>{{ 'auth.login.newToWatchWatcher' | t }}</span></div><a mat-stroked-button routerLink="/create-account"><mat-icon>person_add</mat-icon> {{ 'auth.login.createAccount' | t }}</a>
      <button mat-button type="button" (click)="practiceAsGuest()">{{ 'auth.login.guestPractice' | t }}</button>
    </mat-card></main>
  `,
})
export class LoginPage {
  readonly passwordWithinLimits = isPasswordWithinLimits;
  readonly passwordMinimum = hasMinimumPasswordCharacters;
  @ViewChild(GoogleSignInButtonComponent) private googleButton?: GoogleSignInButtonComponent;
  email = '';
  password = '';
  readonly busy = signal(false);
  readonly error = signal('');
  readonly googleLink = signal<GoogleCredentialEvent | null>(null);
  googleLinkPassword = '';
  googleLinkConfirmed = false;
  constructor(private readonly auth: AuthStateService, private readonly router: Router, private readonly locales: LocaleService = new LocaleService()) {}

  async practiceAsGuest(): Promise<void> {
    this.error.set('');
    this.cancelGoogleLink();
    this.password = '';
    try {
      const logout = this.auth.logout();
      const generation = this.auth.accountGeneration;
      await logout;
      if (this.auth.accountGeneration !== generation || this.auth.user()) throw new Error(this.locales.translate('auth.login.guestAccountChanged'));
      if (!await this.router.navigateByUrl('/examiner')) throw new Error(this.locales.translate('auth.login.guestNavigationFailed'));
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : this.locales.translate('auth.login.guestPracticeFailed'));
    }
  }

  async submit(): Promise<void> {
    if (!isPasswordWithinLimits(this.password)) { this.error.set(this.locales.translate('auth.password.limit')); return; }
    if (!hasMinimumPasswordCharacters(this.password, 8)) { this.error.set(this.locales.translate('auth.password.minimum8')); return; }
    this.busy.set(true);
    this.error.set('');
    try { await this.auth.login(this.email, this.password); await this.router.navigateByUrl('/'); }
    catch (error) {
      if (responseStatus(error) === 401) this.password = '';
      this.error.set(authenticationErrorMessage(error, 'Sign-in', this.locales));
    }
    finally { this.busy.set(false); }
  }

  async handleGoogleCredential(event: GoogleCredentialEvent): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const result = await this.auth.loginWithGoogle(event);
      if (result.kind === 'link-required') {
        this.googleLink.set(event);
        return;
      }
      await this.router.navigateByUrl('/');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : this.locales.translate('auth.login.googleFailed'));
      this.googleButton?.refresh();
    }
    finally { this.busy.set(false); }
  }

  async confirmGoogleLink(): Promise<void> {
    const pending = this.googleLink();
    if (!pending || !this.googleLinkConfirmed) return;
    if (!isPasswordWithinLimits(this.googleLinkPassword)) { this.error.set(this.locales.translate('auth.password.limit')); return; }
    if (!hasMinimumPasswordCharacters(this.googleLinkPassword, 8)) { this.error.set(this.locales.translate('auth.password.minimum8')); return; }
    this.busy.set(true);
    this.error.set('');
    try {
      const result = await this.auth.loginWithGoogle({
        credential: pending.credential,
        challengeId: pending.challengeId,
        linkExisting: { confirmed: true, password: this.googleLinkPassword },
      });
      if (result.kind === 'link-required') throw new Error(this.locales.translate('auth.login.confirmLinkError'));
      this.googleLink.set(null);
      this.googleLinkPassword = '';
      await this.router.navigateByUrl('/');
    } catch (error) { this.error.set(error instanceof Error ? error.message : this.locales.translate('auth.login.linkFailed')); }
    finally { this.busy.set(false); }
  }

  cancelGoogleLink(): void {
    this.googleLink.set(null);
    this.googleLinkPassword = '';
    this.googleLinkConfirmed = false;
    this.error.set('');
  }
}
