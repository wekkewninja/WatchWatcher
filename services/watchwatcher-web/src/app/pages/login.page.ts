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
    <main class="auth-page"><mat-card class="auth-card"><div class="auth-mark"><mat-icon>sailing</mat-icon></div><span class="eyebrow">WatchWatcher · RYA / ASA</span><h1>Welcome back</h1><p>Your study record stays on this device when you are offline.</p>
      <form (ngSubmit)="submit()"><mat-form-field appearance="outline"><mat-label>Email</mat-label><input matInput type="email" name="email" [(ngModel)]="email" required email autocomplete="email"></mat-form-field><mat-form-field appearance="outline"><mat-label>Password</mat-label><input matInput type="password" name="password" [(ngModel)]="password" required minlength="8" autocomplete="current-password"></mat-form-field>
        @if (error()) { <p class="inline-error" role="alert">{{ error() }}</p> }
        <button mat-flat-button type="submit" [disabled]="busy() || !email || password.length < 8"><mat-icon>login</mat-icon> Sign in</button>
      </form>
      <div class="auth-divider"><span>New to WatchWatcher?</span></div><a mat-stroked-button routerLink="/create-account"><mat-icon>person_add</mat-icon> Create account</a>
    </mat-card></main>
  `,
})
export class LoginPage {
  email = '';
  password = '';
  readonly busy = signal(false);
  readonly error = signal('');
  constructor(private readonly auth: AuthStateService, private readonly router: Router) {}

  async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try { await this.auth.login(this.email, this.password); await this.router.navigateByUrl('/'); }
    catch (error) { this.error.set(error instanceof Error ? error.message : 'Sign-in failed.'); }
    finally { this.busy.set(false); }
  }
}
