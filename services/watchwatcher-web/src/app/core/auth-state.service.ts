import { Injectable, signal } from '@angular/core';
import { api } from '../../api';
import type { GoogleSignInInput, GoogleSignInResult } from '../../api/types';
import type { Learner } from '../domain-types';

@Injectable({ providedIn: 'root' })
export class AuthStateService {
  readonly user = signal<Learner | null>(null);
  readonly ready = signal(false);
  readonly initialization: Promise<void>;
  private generation = 0;

  get accountGeneration(): number { return this.generation; }

  constructor() {
    const generation = this.generation;
    this.initialization = localStorage.getItem('watchwatcher-signed-out') !== 'true'
      ? api.getCurrentUser().then((user) => {
        if (generation === this.generation) this.user.set(user);
      }).catch(() => {
        if (generation === this.generation) this.user.set(null);
      })
      : Promise.resolve();
    void this.initialization.finally(() => this.ready.set(true));
  }

  async login(email: string, password: string): Promise<void> {
    const generation = ++this.generation;
    const user = await api.login({ email, password });
    if (generation !== this.generation) throw new Error('Sign-in was superseded by another account change.');
    localStorage.removeItem('watchwatcher-signed-out');
    this.user.set(user);
  }

  async createAccount(name: string, email: string, password: string): Promise<void> {
    const generation = ++this.generation;
    const user = await api.createAccount({ name, email, password });
    if (generation !== this.generation) throw new Error('Sign-in was superseded by another account change.');
    localStorage.removeItem('watchwatcher-signed-out');
    this.user.set(user);
  }

  async loginWithGoogle(input: GoogleSignInInput): Promise<GoogleSignInResult> {
    const generation = ++this.generation;
    const result = await api.googleSignIn(input);
    if (generation !== this.generation) throw new Error('Sign-in was superseded by another account change.');
    if (result.kind === 'authenticated') {
      localStorage.removeItem('watchwatcher-signed-out');
      this.user.set(result.user);
    }
    return result;
  }

  async logout(): Promise<void> {
    ++this.generation;
    const logout = api.logout();
    localStorage.setItem('watchwatcher-signed-out', 'true');
    this.user.set(null);
    await logout;
  }
}
