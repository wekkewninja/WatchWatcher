import { Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { AuthStateService } from './core/auth-state.service';

@Component({
  imports: [RouterLink, RouterLinkActive, RouterOutlet, MatButtonModule, MatIconModule, MatToolbarModule],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  readonly darkMode = signal(false);
  readonly cleanupConfirmation = signal<string | null>(null);
  readonly cleanupConfirmed = signal(false);
  readonly cleanupBusy = signal<string | null>(null);
  private activeViewOwner: string | null = null;

  constructor(readonly auth: AuthStateService, private readonly router: Router) {
    const invalidated = (event: Event) => {
      if (this.activeViewOwner && this.activeViewOwner === (event as CustomEvent<string>).detail) {
        this.auth.accountViewInvalidated.set(true);
      }
    };
    window.addEventListener('watchwatcher-account-invalidated', invalidated);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('watchwatcher-account-invalidated', invalidated));
    effect(() => {
      if (this.auth.accountViewInvalidated()) {
        void this.router.navigateByUrl('/login').finally(() => this.auth.accountViewInvalidated.set(false));
      }
    });
    let savedTheme: string | null = null;
    try { savedTheme = localStorage.getItem('app-theme'); } catch { }
    const colorScheme = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const prefersDark = colorScheme?.matches ?? false;
    this.applyTheme(savedTheme === 'dark' || (savedTheme !== 'light' && prefersDark));
    colorScheme?.addEventListener('change', (event) => {
      try { if (localStorage.getItem('app-theme') === 'system' || !localStorage.getItem('app-theme')) this.applyTheme(event.matches); } catch { }
    });
  }

  captureViewOwner(): void {
    this.activeViewOwner = this.auth.user()?.id ?? null;
  }

  toggleTheme(): void {
    localStorage.setItem('app-theme', this.darkMode() ? 'light' : 'dark');
    this.applyTheme(!this.darkMode());
  }

  async signOut(): Promise<void> {
    const logout = this.auth.logout();
    await this.router.navigateByUrl('/login');
    await logout;
  }

  confirmCleanup(ownerId: string): void {
    this.cleanupConfirmed.set(false);
    this.cleanupConfirmation.set(ownerId);
  }

  async eraseLocalData(ownerId: string): Promise<void> {
    if (this.cleanupConfirmation() !== ownerId || !this.cleanupConfirmed() || this.cleanupBusy()) return;
    this.cleanupBusy.set(ownerId);
    try { await this.auth.eraseUnresolvedLocalData(ownerId); }
    finally {
      this.cleanupBusy.set(null);
      this.cleanupConfirmation.set(null);
      this.cleanupConfirmed.set(false);
    }
  }

  private applyTheme(dark: boolean): void {
    this.darkMode.set(dark);
    document.documentElement.dataset['theme'] = dark ? 'dark' : 'light';
  }
}
