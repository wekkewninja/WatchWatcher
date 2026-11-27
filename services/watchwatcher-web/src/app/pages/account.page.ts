import { Component, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { AccountReauthentication } from '../../api/types';
import { AuthStateService } from '../core/auth-state.service';
import { LocaleService, TranslationPipe } from '../core/locale.service';
import type { Learner } from '../domain-types';
import { GoogleSignInButtonComponent, type GoogleCredentialEvent } from '../shared/google-sign-in-button.component';
import { responseStatus } from './auth-error';
import { isPasswordWithinLimits } from '../../../../shared/schemas/password';

@Component({
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, GoogleSignInButtonComponent, TranslationPipe],
  template: `
    <main class="auth-page"><mat-card class="auth-card">
      <h1>{{ 'account.heading' | t }}</h1>
      @if (account; as user) {
        <p>{{ user.name }}<br>{{ user.email }}</p>
        <h2>{{ 'account.delete.heading' | t }}</h2>
        <p>{{ 'account.delete.irreversibleDescription' | t }}</p>
        <p>{{ 'account.delete.offlineDescription' | t }}</p>
        <p>{{ 'account.delete.identityDescription' | t }}</p>
        <form (ngSubmit)="submitPassword()">
          <label><input type="checkbox" name="confirmed" [(ngModel)]="confirmed"> {{ 'account.delete.confirmation' | t }}</label>
          <mat-form-field appearance="outline"><mat-label>{{ 'account.delete.typeDelete' | t }}</mat-label><input matInput name="confirmation" [(ngModel)]="confirmation" autocomplete="off"></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>{{ 'account.delete.currentPassword' | t }}</mat-label><input matInput type="password" name="password" [(ngModel)]="password" autocomplete="current-password"></mat-form-field>
          @if (!passwordWithinLimits(password)) { <p class="inline-error" role="alert">{{ 'auth.password.limit' | t }}</p> }
          @if (error()) { <p class="inline-error" role="alert">{{ error() }}</p> }
          <button mat-flat-button type="submit" [disabled]="busy() || !confirmed || confirmation !== 'DELETE' || !password">{{ 'account.delete.withPassword' | t }}</button>
        </form>
        @if (confirmed && confirmation === 'DELETE' && !busy()) {
          <p>{{ 'account.delete.orGoogle' | t }}</p>
          <ww-google-sign-in-button (signedIn)="submitGoogle($event)" />
        }
      }
    </mat-card></main>
  `,
})
export class AccountPage {
  readonly passwordWithinLimits = isPasswordWithinLimits;
  @ViewChild(GoogleSignInButtonComponent) private googleButton?: GoogleSignInButtonComponent;
  readonly account: Learner | null;
  readonly generation: number;
  readonly busy = signal(false);
  readonly error = signal('');
  confirmed = false;
  confirmation = '';
  password = '';

  constructor(private readonly auth: AuthStateService, private readonly router: Router, private readonly locales: LocaleService = new LocaleService()) {
    this.account = auth.user();
    this.generation = auth.accountGeneration;
  }

  async submitPassword(): Promise<void> {
    if (!this.password) return;
    if (!isPasswordWithinLimits(this.password)) { this.error.set(this.locales.translate('auth.password.limit')); return; }
    await this.delete({ type: 'password', password: this.password });
    this.password = '';
  }

  async submitGoogle(event: GoogleCredentialEvent): Promise<void> {
    await this.delete({ type: 'google', ...event });
    this.googleButton?.refresh();
  }

  private async delete(reauthentication: AccountReauthentication): Promise<void> {
    if (this.busy() || !this.account || !this.confirmed || this.confirmation !== 'DELETE') return;
    if (!navigator.onLine) { this.error.set(this.locales.translate('account.delete.offlineError')); return; }
    this.busy.set(true);
    this.error.set('');
    try {
      const signedOut = await this.auth.deleteAccount(this.account.id, this.generation, reauthentication);
      if (signedOut && !this.auth.user() && this.auth.accountGeneration === this.generation + 1) await this.router.navigateByUrl('/login');
    } catch (error) {
      const status = responseStatus(error);
      this.error.set(status === 403 ? this.locales.translate('account.delete.identityError')
        : status === 401 ? this.locales.translate('account.delete.sessionExpiredError')
        : status === 429 ? this.locales.translate('account.delete.rateLimitError')
        : error instanceof TypeError ? this.locales.translate('account.delete.unknownOutcomeError')
        : status !== undefined && status >= 500 ? this.locales.translate('account.delete.serverOutcomeError')
        : error instanceof Error ? error.message : this.locales.translate('account.delete.failedError'));
    } finally { this.busy.set(false); }
  }
}