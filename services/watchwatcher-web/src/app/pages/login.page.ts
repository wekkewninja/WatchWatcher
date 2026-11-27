import { Component, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { AuthStateService } from '../core/auth-state.service';
import { GoogleSignInButtonComponent, type GoogleCredentialEvent } from '../shared/google-sign-in-button.component';
import { authenticationErrorMessage, responseStatus } from './auth-error';
import { hasMinimumPasswordCharacters, isPasswordWithinLimits, PASSWORD_LIMIT_MESSAGE } from '../../../../shared/schemas/password';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule, MatInputModule, GoogleSignInButtonComponent],
  template: `
    <main class="auth-page"><mat-card class="auth-card"><div class="auth-mark"><mat-icon>sailing</mat-icon></div><span class="eyebrow">WatchWatcher · RYA / ASA</span><h1>Welcome back</h1><p>Your study record stays on this device when you are offline.</p>
      <form (ngSubmit)="submit()"><mat-form-field appearance="outline"><mat-label>Email</mat-label><input matInput type="email" name="email" [(ngModel)]="email" required email autocomplete="email"></mat-form-field><mat-form-field appearance="outline"><mat-label>Password</mat-label><input matInput type="password" name="password" [(ngModel)]="password" required autocomplete="current-password"><mat-hint>At least 8 Unicode code points.</mat-hint></mat-form-field>
        @if (!passwordWithinLimits(password)) { <p class="inline-error" role="alert">{{ passwordLimitMessage }}</p> }
        @if (error()) { <p class="inline-error" role="alert">{{ error() }}</p> }
        <button mat-flat-button type="submit" [disabled]="busy() || !email || !passwordMinimum(password, 8) || !passwordWithinLimits(password)"><mat-icon>login</mat-icon> Sign in</button>
      </form>
      @if (googleLink(); as link) {
        <section class="google-link-confirmation" aria-label="Confirm Google account linking">
          <p>This Google account matches an existing WatchWatcher email. Enter that account's password to explicitly link Google.</p>
          <form (ngSubmit)="confirmGoogleLink()">
            <mat-form-field appearance="outline"><mat-label>Existing account password</mat-label><input matInput type="password" name="googleLinkPassword" [(ngModel)]="googleLinkPassword" required autocomplete="current-password"><mat-hint>At least 8 Unicode code points.</mat-hint></mat-form-field>
            @if (!passwordWithinLimits(googleLinkPassword)) { <p class="inline-error" role="alert">{{ passwordLimitMessage }}</p> }
            <label class="google-link-consent"><input type="checkbox" name="googleLinkConfirmed" [(ngModel)]="googleLinkConfirmed"> I confirm linking this Google account to my existing WatchWatcher account.</label>
            @if (error()) { <p class="inline-error" role="alert">{{ error() }}</p> }
            <button mat-flat-button type="submit" [disabled]="busy() || !googleLinkConfirmed || !passwordMinimum(googleLinkPassword, 8) || !passwordWithinLimits(googleLinkPassword)"><mat-icon>link</mat-icon> Confirm and link</button>
            <button mat-button type="button" (click)="cancelGoogleLink()" [disabled]="busy()">Cancel</button>
          </form>
        </section>
      } @else {
        <div class="auth-divider"><span>Or continue with</span></div>
        <ww-google-sign-in-button (signedIn)="handleGoogleCredential($event)" />
      }
      <div class="auth-divider"><span>New to WatchWatcher?</span></div><a mat-stroked-button routerLink="/create-account"><mat-icon>person_add</mat-icon> Create account</a>
      <button mat-button type="button" (click)="practiceAsGuest()">Practice COLREGs as a guest</button>
    </mat-card></main>
  `,
})
export class LoginPage {
  readonly passwordWithinLimits = isPasswordWithinLimits;
  readonly passwordMinimum = hasMinimumPasswordCharacters;
  readonly passwordLimitMessage = PASSWORD_LIMIT_MESSAGE;
  @ViewChild(GoogleSignInButtonComponent) private googleButton?: GoogleSignInButtonComponent;
  email = '';
  password = '';
  readonly busy = signal(false);
  readonly error = signal('');
  readonly googleLink = signal<GoogleCredentialEvent | null>(null);
  googleLinkPassword = '';
  googleLinkConfirmed = false;
  constructor(private readonly auth: AuthStateService, private readonly router: Router) {}

  async practiceAsGuest(): Promise<void> {
    this.error.set('');
    this.cancelGoogleLink();
    this.password = '';
    try {
      const logout = this.auth.logout();
      const generation = this.auth.accountGeneration;
      await logout;
      if (this.auth.accountGeneration !== generation || this.auth.user()) throw new Error('Account changed while entering guest practice. Please try again.');
      if (!await this.router.navigateByUrl('/examiner')) throw new Error('Could not open guest practice. Please try again.');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not enter guest practice. Please try again.');
    }
  }

  async submit(): Promise<void> {
    if (!isPasswordWithinLimits(this.password)) { this.error.set(PASSWORD_LIMIT_MESSAGE); return; }
    if (!hasMinimumPasswordCharacters(this.password, 8)) { this.error.set('Password must contain at least 8 Unicode code points.'); return; }
    this.busy.set(true);
    this.error.set('');
    try { await this.auth.login(this.email, this.password); await this.router.navigateByUrl('/'); }
    catch (error) {
      if (responseStatus(error) === 401) this.password = '';
      this.error.set(authenticationErrorMessage(error, 'Sign-in'));
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
      this.error.set(error instanceof Error ? error.message : 'Google sign-in failed.');
      this.googleButton?.refresh();
    }
    finally { this.busy.set(false); }
  }

  async confirmGoogleLink(): Promise<void> {
    const pending = this.googleLink();
    if (!pending || !this.googleLinkConfirmed) return;
    if (!isPasswordWithinLimits(this.googleLinkPassword)) { this.error.set(PASSWORD_LIMIT_MESSAGE); return; }
    if (!hasMinimumPasswordCharacters(this.googleLinkPassword, 8)) { this.error.set('Password must contain at least 8 Unicode code points.'); return; }
    this.busy.set(true);
    this.error.set('');
    try {
      const result = await this.auth.loginWithGoogle({
        credential: pending.credential,
        challengeId: pending.challengeId,
        linkExisting: { confirmed: true, password: this.googleLinkPassword },
      });
      if (result.kind === 'link-required') throw new Error('Confirm the account link to continue.');
      this.googleLink.set(null);
      this.googleLinkPassword = '';
      await this.router.navigateByUrl('/');
    } catch (error) { this.error.set(error instanceof Error ? error.message : 'Google account linking failed.'); }
    finally { this.busy.set(false); }
  }

  cancelGoogleLink(): void {
    this.googleLink.set(null);
    this.googleLinkPassword = '';
    this.googleLinkConfirmed = false;
    this.error.set('');
  }
}
