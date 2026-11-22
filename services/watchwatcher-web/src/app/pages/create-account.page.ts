import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { AuthStateService } from '../core/auth-state.service';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule, MatInputModule],
  template: `
    <main class="auth-page"><mat-card class="auth-card"><div class="auth-mark"><mat-icon>person_add</mat-icon></div><span class="eyebrow">A local study record, with optional sync</span><h1>Create account</h1><p>Set up sign-in for cloud progress and online evaluation. Offline study remains available either way.</p>
      <form (ngSubmit)="submit()"><mat-form-field appearance="outline"><mat-label>Name</mat-label><input matInput name="name" [(ngModel)]="name" required minlength="2" autocomplete="name"></mat-form-field><mat-form-field appearance="outline"><mat-label>Email</mat-label><input matInput type="email" name="email" [(ngModel)]="email" required email autocomplete="email"></mat-form-field><mat-form-field appearance="outline"><mat-label>Password</mat-label><input matInput type="password" name="password" [(ngModel)]="password" required minlength="10" autocomplete="new-password"><mat-hint>Use at least 10 characters.</mat-hint></mat-form-field><mat-form-field appearance="outline"><mat-label>Confirm password</mat-label><input matInput type="password" name="confirmPassword" [(ngModel)]="confirmPassword" required autocomplete="new-password"><mat-error>Passwords must match.</mat-error></mat-form-field>
        @if (error()) { <p class="inline-error" role="alert">{{ error() }}</p> }
        <button mat-flat-button type="submit" [disabled]="busy() || name.trim().length < 2 || !email || password.length < 10 || password !== confirmPassword"><mat-icon>person_add</mat-icon> Create account</button>
      </form>
      <a mat-button routerLink="/login"><mat-icon>arrow_back</mat-icon> Back to sign in</a>
    </mat-card></main>
  `,
})
export class CreateAccountPage {
  name = '';
  email = '';
  password = '';
  confirmPassword = '';
  readonly busy = signal(false);
  readonly error = signal('');
  constructor(private readonly auth: AuthStateService, private readonly router: Router) {}

  async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try { await this.auth.createAccount(this.name.trim(), this.email, this.password); await this.router.navigateByUrl('/'); }
    catch (error) { this.error.set(error instanceof Error ? error.message : 'Account creation failed.'); }
    finally { this.busy.set(false); }
  }
}
