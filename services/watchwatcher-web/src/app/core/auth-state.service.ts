import { Injectable, signal } from '@angular/core';
import { api } from '../../api';
import type { Learner } from '../domain-types';

@Injectable({ providedIn: 'root' })
export class AuthStateService {
  readonly user = signal<Learner | null>(null);
  readonly ready = signal(false);
  readonly initialization: Promise<void>;

  constructor() {
    this.initialization = localStorage.getItem('watchwatcher-signed-out') !== 'true'
      ? api.getCurrentUser().then((user) => this.user.set(user)).catch(() => this.user.set(null))
      : Promise.resolve();
    void this.initialization.finally(() => this.ready.set(true));
  }

  async login(email: string, password: string): Promise<void> {
    const user = await api.login({ email, password });
    localStorage.removeItem('watchwatcher-signed-out');
    this.user.set(user);
  }

  async createAccount(name: string, email: string, password: string): Promise<void> {
    const user = await api.createAccount({ name, email, password });
    localStorage.removeItem('watchwatcher-signed-out');
    this.user.set(user);
  }

  async logout(): Promise<void> {
    await api.logout();
    localStorage.setItem('watchwatcher-signed-out', 'true');
    this.user.set(null);
  }
}
