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
import { authenticationErrorMessage } from './auth-error';
import { hasMinimumPasswordCharacters, isPasswordWithinLimits } from '../../../../shared/schemas/password';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule, MatInputModule, GoogleSignInButtonComponent, TranslationPipe],
  template: `
    <main class="auth-page"><mat-card class="auth-card"><div class="auth-mark"><mat-icon>person_add</mat-icon></div><span class="eyebrow">{{ 'auth.create.eyebrow' | t }}</span><h1>{{ 'auth.create.heading' | t }}</h1><p>{{ 'auth.create.description' | t }}</p>
      <form (ngSubmit)="submit()"><mat-form-field appearance="outline"><mat-label>{{ 'auth.create.name' | t }}</mat-label><input matInput name="name" [(ngModel)]="name" required minlength="2" autocomplete="name"></mat-form-field><mat-form-field appearance="outline"><mat-label>{{ 'auth.create.email' | t }}</mat-label><input matInput type="email" name="email" [(ngModel)]="email" required email autocomplete="email"></mat-form-field><mat-form-field appearance="outline"><mat-label>{{ 'auth.create.password' | t }}</mat-label><input matInput type="password" name="password" [(ngModel)]="password" required autocomplete="new-password"><mat-hint>{{ 'auth.create.passwordHint' | t }}</mat-hint></mat-form-field><mat-form-field appearance="outline"><mat-label>{{ 'auth.create.confirmPassword' | t }}</mat-label><input matInput type="password" name="confirmPassword" [(ngModel)]="confirmPassword" required autocomplete="new-password"><mat-error>{{ 'auth.create.passwordsMustMatch' | t }}</mat-error></mat-form-field>
        @if (!passwordWithinLimits(password)) { <p class="inline-error" role="alert">{{ 'auth.password.limit' | t }}</p> }
        @if (error()) { <p class="inline-error" role="alert">{{ error() }}</p> }
        <button mat-flat-button type="submit" [disabled]="busy() || name.trim().length < 2 || !email || !passwordMinimum(password, 10) || !passwordWithinLimits(password) || password !== confirmPassword"><mat-icon>person_add</mat-icon> {{ 'auth.create.submit' | t }}</button>
      </form>
      @if (googleLink(); as link) {
        <section class="google-link-confirmation" [attr.aria-label]="'auth.create.googleLinkLabel' | t">
          <p>{{ 'auth.create.googleLinkDescription' | t }}</p>
          <form (ngSubmit)="confirmGoogleLink()">
            <mat-form-field appearance="outline"><mat-label>{{ 'auth.create.existingPassword' | t }}</mat-label><input matInput type="password" name="googleLinkPassword" [(ngModel)]="googleLinkPassword" required autocomplete="current-password"><mat-hint>{{ 'auth.create.passwordHint8' | t }}</mat-hint></mat-form-field>
            @if (!passwordWithinLimits(googleLinkPassword)) { <p class="inline-error" role="alert">{{ 'auth.password.limit' | t }}</p> }
            <label class="google-link-consent"><input type="checkbox" name="googleLinkConfirmed" [(ngModel)]="googleLinkConfirmed"> {{ 'auth.create.googleLinkConsent' | t }}</label>
            @if (error()) { <p class="inline-error" role="alert">{{ error() }}</p> }
            <button mat-flat-button type="submit" [disabled]="busy() || !googleLinkConfirmed || !passwordMinimum(googleLinkPassword, 8) || !passwordWithinLimits(googleLinkPassword)"><mat-icon>link</mat-icon> {{ 'auth.create.confirmLink' | t }}</button>
            <button mat-button type="button" (click)="cancelGoogleLink()" [disabled]="busy()">{{ 'auth.create.cancel' | t }}</button>
          </form>
        </section>
      } @else {
        <div class="auth-divider"><span>{{ 'auth.create.orCreateWith' | t }}</span></div>
        <ww-google-sign-in-button (signedIn)="handleGoogleCredential($event)" />
      }
      <a mat-button routerLink="/login"><mat-icon>arrow_back</mat-icon> {{ 'auth.create.backToSignIn' | t }}</a>
    </mat-card></main>
  `,
})
export class CreateAccountPage {
  readonly passwordWithinLimits = isPasswordWithinLimits;
  readonly passwordMinimum = hasMinimumPasswordCharacters;
  @ViewChild(GoogleSignInButtonComponent) private googleButton?: GoogleSignInButtonComponent;
  name = '';
  email = '';
  password = '';
  confirmPassword = '';
  readonly busy = signal(false);
  readonly error = signal('');
  readonly googleLink = signal<GoogleCredentialEvent | null>(null);
  googleLinkPassword = '';
  googleLinkConfirmed = false;
  constructor(private readonly auth: AuthStateService, private readonly router: Router, private readonly locales: LocaleService = new LocaleService()) {}

  async submit(): Promise<void> {
    if (!isPasswordWithinLimits(this.password)) {
      this.error.set(this.locales.translate('auth.password.limit'));
      return;
    }
    if (!hasMinimumPasswordCharacters(this.password, 10)) { this.error.set(this.locales.translate('auth.password.minimum10')); return; }
    this.busy.set(true);
    this.error.set('');
    try { await this.auth.createAccount(this.name.trim(), this.email, this.password); await this.router.navigateByUrl('/'); }
    catch (error) { this.error.set(authenticationErrorMessage(error, 'Account creation', this.locales)); }
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
      this.error.set(error instanceof Error ? error.message : this.locales.translate('auth.create.googleFailed'));
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
      if (result.kind === 'link-required') throw new Error(this.locales.translate('auth.create.confirmLinkError'));
      this.googleLink.set(null);
      this.googleLinkPassword = '';
      await this.router.navigateByUrl('/');
    } catch (error) { this.error.set(error instanceof Error ? error.message : this.locales.translate('auth.create.linkFailed')); }
    finally { this.busy.set(false); }
  }

  cancelGoogleLink(): void {
    this.googleLink.set(null);
    this.googleLinkPassword = '';
    this.googleLinkConfirmed = false;
    this.error.set('');
  }
}
