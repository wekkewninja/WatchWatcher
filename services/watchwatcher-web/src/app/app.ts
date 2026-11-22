import { Component, signal } from '@angular/core';
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

  constructor(readonly auth: AuthStateService, private readonly router: Router) {
    const savedTheme = localStorage.getItem('app-theme');
    const colorScheme = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const prefersDark = colorScheme?.matches ?? false;
    this.applyTheme(savedTheme === 'dark' || (savedTheme !== 'light' && prefersDark));
    colorScheme?.addEventListener('change', (event) => {
      if (localStorage.getItem('app-theme') === 'system' || !localStorage.getItem('app-theme')) this.applyTheme(event.matches);
    });
  }

  toggleTheme(): void {
    localStorage.setItem('app-theme', this.darkMode() ? 'light' : 'dark');
    this.applyTheme(!this.darkMode());
  }

  async signOut(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }

  private applyTheme(dark: boolean): void {
    this.darkMode.set(dark);
    document.documentElement.dataset['theme'] = dark ? 'dark' : 'light';
  }
}
