import { Injectable, signal } from '@angular/core';
import { api } from '../../api';
import type { AccountReauthentication, GoogleSignInInput, GoogleSignInResult } from '../../api/types';
import type { Learner } from '../domain-types';
import { deletionMarkerKey, StorageRepository } from './storage-repository.service';

const deletionIntentPrefix = 'watchwatcher-deletion-intent:';

@Injectable({ providedIn: 'root' })
export class AuthStateService {
  readonly user = signal<Learner | null>(null);
  readonly ready = signal(false);
  readonly initialization: Promise<void>;
  private generation = 0;
  private readonly storage = new StorageRepository();
  private readonly pendingOwners = new Set<string>();
  private readonly deletedOwners = new Set<string>();
  readonly cleanupPending = signal(false);
  readonly unresolvedDeletions = signal<string[]>([]);

  get accountGeneration(): number { return this.generation; }

  constructor() {
    this.updateUnresolvedDeletions();
    void this.retryLocalCleanup();
    const generation = this.generation;
    this.initialization = localStorage.getItem('watchwatcher-signed-out') !== 'true'
      ? api.getCurrentUser().then((user) => {
        if (generation === this.generation && (!user || !this.isDeleted(user.id))) this.user.set(user);
      }).catch(() => {
        if (generation === this.generation) this.user.set(null);
      })
      : Promise.resolve();
    void this.initialization.finally(() => this.ready.set(true));
  }

  async deleteAccount(accountId: string, generation: number, reauthentication: AccountReauthentication): Promise<boolean> {
    if (generation !== this.generation || this.user()?.id !== accountId) throw new Error('Account changed. Review the account before deleting.');
    const account = this.user();
    const intentKey = `${deletionIntentPrefix}${accountId}`;
    let unresolvedEarlier: boolean;
    try {
      unresolvedEarlier = localStorage.getItem(intentKey) === 'pending';
      localStorage.setItem(intentKey, 'pending');
    }
    catch { throw new Error('Deletion cannot start because this device cannot save a recovery notice.'); }
    this.updateUnresolvedDeletions();
    try {
      await api.deleteAccount(accountId, reauthentication);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'status' in error
        && (error.status === 429 || error.status === 422 || error.status === 401
          || (error.status === 403 && 'code' in error && error.code === 'REAUTHENTICATION_FAILED'))) {
        if (!unresolvedEarlier) try { localStorage.removeItem(intentKey); } catch { }
        this.updateUnresolvedDeletions();
      }
      if (typeof error === 'object' && error !== null && 'status' in error && error.status === 401 && this.user() === account) {
        if (generation === this.generation) ++this.generation;
        this.user.set(null);
        try { localStorage.setItem('watchwatcher-signed-out', 'true'); } catch { }
      }
      throw error;
    }
    this.deletedOwners.add(accountId);
    const current = this.user()?.id === accountId;
    if (current) {
      if (generation === this.generation) ++this.generation;
      this.user.set(null);
      try { localStorage.setItem('watchwatcher-signed-out', 'true'); } catch { }
    }
    this.pendingOwners.add(accountId);
    try {
      localStorage.setItem(deletionMarkerKey(accountId), 'pending');
      localStorage.removeItem(intentKey);
    } catch { }
    this.updateUnresolvedDeletions();
    this.cleanupPending.set(true);
    void this.finishLocalCleanup(accountId);
    return current;
  }

  private updateUnresolvedDeletions(): void {
    try {
      this.unresolvedDeletions.set(Object.keys(localStorage)
        .filter((key) => key.startsWith(deletionIntentPrefix) && localStorage.getItem(key) === 'pending')
        .map((key) => key.slice(deletionIntentPrefix.length)));
    } catch { }
  }

  private async finishLocalCleanup(accountId: string): Promise<void> {
    try {
      await this.storage.deleteAccountProgress(accountId);
      try {
        localStorage.setItem(deletionMarkerKey(accountId), 'done');
        localStorage.removeItem(`${deletionIntentPrefix}${accountId}`);
      } catch { }
      this.updateUnresolvedDeletions();
      this.pendingOwners.delete(accountId);
      this.updateCleanupPending();
    } catch { this.cleanupPending.set(true); }
  }

  async retryLocalCleanup(): Promise<void> {
    try {
      Object.keys(localStorage).filter((key) => key.startsWith('watchwatcher-deleted:') && localStorage.getItem(key) === 'pending')
        .forEach((key) => this.pendingOwners.add(key.slice('watchwatcher-deleted:'.length)));
    } catch { this.cleanupPending.set(true); }
    this.updateCleanupPending();
    await Promise.all([...this.pendingOwners].map((ownerId) => this.finishLocalCleanup(ownerId)));
  }

  private updateCleanupPending(): void {
    try {
      this.cleanupPending.set(this.pendingOwners.size > 0 || Object.keys(localStorage).some((key) => key.startsWith('watchwatcher-deleted:') && localStorage.getItem(key) === 'pending'));
    } catch { this.cleanupPending.set(true); }
  }

  private isDeleted(accountId: string): boolean {
    return this.deletedOwners.has(accountId) || Boolean(localStorage.getItem(deletionMarkerKey(accountId)));
  }

  async login(email: string, password: string): Promise<void> {
    const generation = ++this.generation;
    const user = await api.login({ email, password });
    if (generation !== this.generation) throw new Error('Sign-in was superseded by another account change.');
    if (this.isDeleted(user.id)) throw new Error('This account has been deleted.');
    localStorage.removeItem('watchwatcher-signed-out');
    this.user.set(user);
  }

  async createAccount(name: string, email: string, password: string): Promise<void> {
    const generation = ++this.generation;
    const user = await api.createAccount({ name, email, password });
    if (generation !== this.generation) throw new Error('Sign-in was superseded by another account change.');
    if (this.isDeleted(user.id)) throw new Error('This account has been deleted.');
    localStorage.removeItem('watchwatcher-signed-out');
    this.user.set(user);
  }

  async loginWithGoogle(input: GoogleSignInInput): Promise<GoogleSignInResult> {
    const generation = ++this.generation;
    const result = await api.googleSignIn(input);
    if (generation !== this.generation) throw new Error('Sign-in was superseded by another account change.');
    if (result.kind === 'authenticated') {
      if (this.isDeleted(result.user.id)) throw new Error('This account has been deleted.');
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
