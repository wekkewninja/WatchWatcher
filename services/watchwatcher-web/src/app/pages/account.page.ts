import { Component, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { AccountReauthentication } from '../../api/types';
import { AuthStateService } from '../core/auth-state.service';
import type { Learner } from '../domain-types';
import { GoogleSignInButtonComponent, type GoogleCredentialEvent } from '../shared/google-sign-in-button.component';
import { responseStatus } from './auth-error';
import { isPasswordWithinLimits, PASSWORD_LIMIT_MESSAGE } from '../../../../shared/schemas/password';

@Component({
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, GoogleSignInButtonComponent],
  template: `
    <main class="auth-page"><mat-card class="auth-card">
      <h1>Account settings</h1>
      @if (account; as user) {
        <p>{{ user.name }}<br>{{ user.email }}</p>
        <h2>Delete account</h2>
        <p>Deleting your account and its stored progress is irreversible. Your account data is retained until you delete it.</p>
        <p>Local data on other offline devices cannot be remotely erased. Clear that data on each device separately.</p>
        <p>You must be online and confirm your identity to delete this account.</p>
        <form (ngSubmit)="submitPassword()">
          <label><input type="checkbox" name="confirmed" [(ngModel)]="confirmed"> I understand this deletion is irreversible.</label>
          <mat-form-field appearance="outline"><mat-label>Type DELETE to confirm</mat-label><input matInput name="confirmation" [(ngModel)]="confirmation" autocomplete="off"></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>Current password</mat-label><input matInput type="password" name="password" [(ngModel)]="password" autocomplete="current-password"></mat-form-field>
          @if (!passwordWithinLimits(password)) { <p class="inline-error" role="alert">{{ passwordLimitMessage }}</p> }
          @if (error()) { <p class="inline-error" role="alert">{{ error() }}</p> }
          <button mat-flat-button type="submit" [disabled]="busy() || !confirmed || confirmation !== 'DELETE' || !password">Delete account with password</button>
        </form>
        @if (confirmed && confirmation === 'DELETE' && !busy()) {
          <p>Or confirm with a fresh Google sign-in:</p>
          <ww-google-sign-in-button (signedIn)="submitGoogle($event)" />
        }
      }
    </mat-card></main>
  `,
})
export class AccountPage {
  readonly passwordWithinLimits = isPasswordWithinLimits;
  readonly passwordLimitMessage = PASSWORD_LIMIT_MESSAGE;
  @ViewChild(GoogleSignInButtonComponent) private googleButton?: GoogleSignInButtonComponent;
  readonly account: Learner | null;
  readonly generation: number;
  readonly busy = signal(false);
  readonly error = signal('');
  confirmed = false;
  confirmation = '';
  password = '';

  constructor(private readonly auth: AuthStateService, private readonly router: Router) {
    this.account = auth.user();
    this.generation = auth.accountGeneration;
  }

  async submitPassword(): Promise<void> {
    if (!this.password) return;
    if (!isPasswordWithinLimits(this.password)) { this.error.set(PASSWORD_LIMIT_MESSAGE); return; }
    await this.delete({ type: 'password', password: this.password });
    this.password = '';
  }

  async submitGoogle(event: GoogleCredentialEvent): Promise<void> {
    await this.delete({ type: 'google', ...event });
    this.googleButton?.refresh();
  }

  private async delete(reauthentication: AccountReauthentication): Promise<void> {
    if (this.busy() || !this.account || !this.confirmed || this.confirmation !== 'DELETE') return;
    if (!navigator.onLine) { this.error.set('Connect to the internet to delete your account.'); return; }
    this.busy.set(true);
    this.error.set('');
    try {
      const signedOut = await this.auth.deleteAccount(this.account.id, this.generation, reauthentication);
      if (signedOut && !this.auth.user() && this.auth.accountGeneration === this.generation + 1) await this.router.navigateByUrl('/login');
    } catch (error) {
      const status = responseStatus(error);
      this.error.set(status === 403 ? 'Identity confirmation failed. Check your credentials and try again.'
        : status === 401 ? 'Your session has expired. Sign in again to continue.'
        : status === 429 ? 'Too many attempts. Wait a moment and try again.'
        : error instanceof TypeError ? 'The deletion outcome is unconfirmed. Check your connection and retry.'
        : status !== undefined && status >= 500 ? 'The deletion outcome is unconfirmed. Server data may still exist; check the deletion notice.'
        : error instanceof Error ? error.message : 'Account deletion failed. Please try again.');
    } finally { this.busy.set(false); }
  }
}