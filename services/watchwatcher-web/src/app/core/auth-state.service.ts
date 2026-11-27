import { Injectable, signal } from '@angular/core';
import { api } from '../../api';
import { canConfirmDeletion, confirmDeletionReceipt, getAuthenticatedAccountId, logoutAccountSession } from '../../api/client';
import type { AccountReauthentication, GoogleSignInInput, GoogleSignInResult } from '../../api/types';
import type { Learner } from '../domain-types';
import { deletionMarkerKey, localCleanupKey, StorageRepository } from './storage-repository.service';
import { LocaleService } from './locale.service';

const deletionIntentPrefix = 'watchwatcher-deletion-intent:';
const localIdentityKey = 'watchwatcher-local-identity';
const logoutWarningKey = 'watchwatcher-logout-warning-until';
const logoutAttemptPrefix = 'watchwatcher-logout-attempt:';

@Injectable({ providedIn: 'root' })
export class AuthStateService {
  readonly user = signal<Learner | null>(null);
  readonly cloudAuth = signal<'signed-out' | 'local' | 'authenticated'>('signed-out');
  readonly ready = signal(false);
  readonly initialization: Promise<void>;
  private generation = 0;
  private readonly storage = new StorageRepository();
  private readonly pendingOwners = new Set<string>();
  private readonly deletedOwners = new Set<string>();
  readonly cleanupPending = signal(false);
  readonly unresolvedDeletions = signal<string[]>([]);
  readonly localCleanupStates = signal<Record<string, string>>({});
  readonly localCleanupErrors = signal<Record<string, string>>({});
  readonly deletionNoticeUnavailable = signal(false);
  readonly deletionVerificationUnavailable = signal<string[]>([]);
  readonly deletionRetryOwner = signal<string | null>(null);
  readonly deletionRetryError = signal('');
  readonly accountViewInvalidated = signal(false);
  private readonly localCleanupRunning = new Set<string>();
  readonly logoutWarning = signal(false);
  readonly logoutWarningStorageUnavailable = signal(false);

  get accountGeneration(): number { return this.generation; }

  constructor(private readonly locales: LocaleService = new LocaleService()) {
    window.addEventListener('watchwatcher-deletion-retry-changed', () => {
      const owner = this.unresolvedDeletions().find((accountId) => canConfirmDeletion(accountId));
      this.deletionRetryOwner.set(owner ?? null);
    });
    try {
      const saved = JSON.parse(sessionStorage.getItem(localIdentityKey) ?? 'null') as Learner | null;
      if (sessionStorage.getItem('watchwatcher-signed-out') !== 'true' && saved && typeof saved.id === 'string' && typeof saved.name === 'string' && typeof saved.email === 'string' && !this.isDeleted(saved.id)) {
        this.user.set(saved);
        this.cloudAuth.set('local');
      }
    } catch { }
    this.refreshLogoutWarning();
    window.addEventListener('watchwatcher-session-expired', (event) => {
      if (this.user()?.id !== (event as CustomEvent<string | null>).detail) return;
      this.cloudAuth.set('local');
    });
    this.updateUnresolvedDeletions();
    window.addEventListener('storage', (event) => {
      if (!event.key || event.key.startsWith(deletionIntentPrefix) || event.key.startsWith('watchwatcher-local-cleanup:') || event.key.startsWith('watchwatcher-deleted:')) {
        this.updateUnresolvedDeletions();
        try {
          if (event.key?.startsWith('watchwatcher-local-cleanup:') && event.newValue) {
            this.clearLocalAccountSession(event.key.slice('watchwatcher-local-cleanup:'.length));
          }
          if (event.key?.startsWith('watchwatcher-deleted:') && event.newValue) {
            const accountId = event.key.slice('watchwatcher-deleted:'.length);
            this.deletedOwners.add(accountId);
            this.clearLocalAccountSession(accountId);
          }
          const ownerId = this.user()?.id;
          if (ownerId && (localStorage.getItem(localCleanupKey(ownerId)) || localStorage.getItem(deletionMarkerKey(ownerId)))) this.clearLocalAccountSession(ownerId);
        } catch { }
      }
    });
    void this.retryLocalCleanup();
    const generation = this.generation;
    let canRestore = false;
    try { canRestore = sessionStorage.getItem('watchwatcher-signed-out') !== 'true'; }
    catch { this.deletionNoticeUnavailable.set(true); }
    this.initialization = canRestore
      ? api.getCurrentUser().then((user) => {
        if (generation === this.generation && user && !this.isDeleted(user.id)) this.setAuthenticatedUser(user);
      }).catch(() => {
        if (generation === this.generation && this.user()) this.cloudAuth.set('local');
      })
      : Promise.resolve();
    void this.initialization.finally(() => this.ready.set(true));
  }

  async deleteAccount(accountId: string, generation: number, reauthentication: AccountReauthentication): Promise<boolean> {
    if (generation !== this.generation || this.user()?.id !== accountId) throw new Error(this.locales.translate('auth.state.accountChanged'));
    if (this.cloudAuth() === 'local') throw new Error(this.locales.translate('auth.state.signInAgainToDelete'));
    const account = this.user();
    const intentKey = `${deletionIntentPrefix}${accountId}:${crypto.randomUUID()}`;
    try {
      localStorage.setItem(intentKey, 'pending');
    }
    catch { throw new Error(this.locales.translate('auth.state.cannotSaveDeletionNotice')); }
    this.updateUnresolvedDeletions();
    try {
      await api.deleteAccount(accountId, reauthentication);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'status' in error
        && (error.status === 429 || error.status === 422 || error.status === 401
          || (error.status === 403 && 'code' in error && error.code === 'REAUTHENTICATION_FAILED'))) {
        try { if (!localStorage.getItem(localCleanupKey(accountId))) localStorage.removeItem(intentKey); } catch { }
        this.updateUnresolvedDeletions();
      }
      if (typeof error === 'object' && error !== null && 'status' in error && error.status === 401 && this.user() === account) {
        this.cloudAuth.set('local');
      }
      throw error;
    }
    return this.finishConfirmedDeletion(accountId, generation);
  }

  async confirmUnresolvedDeletion(accountId: string): Promise<void> {
    this.deletionRetryError.set('');
    try {
      await confirmDeletionReceipt(accountId);
      this.finishConfirmedDeletion(accountId, this.generation);
    } catch (error) {
      this.deletionRetryError.set(error instanceof Error ? error.message : this.locales.translate('auth.state.deletionUnconfirmed'));
    }
  }

  private finishConfirmedDeletion(accountId: string, generation: number): boolean {
    this.deletedOwners.add(accountId);
    window.dispatchEvent(new CustomEvent('watchwatcher-account-invalidated', { detail: accountId }));
    const current = this.user()?.id === accountId;
    if (current) {
      if (generation === this.generation) ++this.generation;
      this.user.set(null);
      this.cloudAuth.set('signed-out');
      this.accountViewInvalidated.set(true);
      try { sessionStorage.removeItem(localIdentityKey); } catch { }
      try { sessionStorage.setItem('watchwatcher-signed-out', 'true'); } catch { }
    }
    this.pendingOwners.add(accountId);
    try {
      localStorage.setItem(deletionMarkerKey(accountId), 'pending');
      this.clearDeletionIntents(accountId);
    } catch { }
    this.updateUnresolvedDeletions();
    this.cleanupPending.set(true);
    void this.finishLocalCleanup(accountId);
    return current;
  }

  private updateUnresolvedDeletions(): void {
    try {
      const owners = [...new Set(Object.keys(localStorage)
        .filter((key) => key.startsWith(deletionIntentPrefix) && localStorage.getItem(key) === 'pending')
        .map((key) => key.slice(deletionIntentPrefix.length).split(':')[0]))];
      this.unresolvedDeletions.set(owners);
      this.localCleanupStates.set(Object.fromEntries(owners.map((ownerId) => [ownerId, localStorage.getItem(localCleanupKey(ownerId)) ?? ''])));
      this.deletionNoticeUnavailable.set(false);
    } catch { this.deletionNoticeUnavailable.set(true); }
  }

  async eraseUnresolvedLocalData(accountId: string): Promise<void> {
    if (this.localCleanupRunning.has(accountId)) return;
    this.localCleanupRunning.add(accountId);
    this.localCleanupErrors.update((errors) => ({ ...errors, [accountId]: '' }));
    try {
      this.updateUnresolvedDeletions();
      if (!accountId || accountId === 'guest' || !this.unresolvedDeletions().includes(accountId)) throw new Error(this.locales.translate('auth.state.noUnresolvedDeletion'));
      if (localStorage.getItem(localCleanupKey(accountId)) === 'done') return;
      localStorage.setItem(localCleanupKey(accountId), 'pending');
      this.updateUnresolvedDeletions();
      this.clearLocalAccountSession(accountId);
      await this.storage.deleteAccountProgress(accountId, true);
      localStorage.setItem(localCleanupKey(accountId), 'done');
      this.updateUnresolvedDeletions();
    } catch {
      this.localCleanupErrors.update((errors) => ({ ...errors, [accountId]: this.locales.translate('auth.state.localCleanupFailed') }));
    } finally {
      this.localCleanupRunning.delete(accountId);
    }
  }

  private clearLocalAccountSession(accountId: string): void {
    window.dispatchEvent(new CustomEvent('watchwatcher-account-invalidated', { detail: accountId }));
    try {
      const saved = JSON.parse(sessionStorage.getItem(localIdentityKey) ?? 'null') as Learner | null;
      if (saved?.id === accountId) sessionStorage.removeItem(localIdentityKey);
    } catch { }
    if (this.user()?.id === accountId) {
      this.user.set(null);
      this.cloudAuth.set('signed-out');
      this.accountViewInvalidated.set(true);
      try { sessionStorage.setItem('watchwatcher-signed-out', 'true'); } catch { }
    }
    if (getAuthenticatedAccountId() !== accountId) {
      void logoutAccountSession(accountId);
      return;
    }
    const attemptKey = `${logoutAttemptPrefix}${crypto.randomUUID()}`;
    let stored = true;
    try { localStorage.setItem(attemptKey, String(Date.now() + 20 * 60 * 1000)); }
    catch { stored = false; this.logoutWarningStorageUnavailable.set(true); }
    this.refreshLogoutWarning();
    if (!stored) this.logoutWarning.set(true);
    void logoutAccountSession(accountId).then(() => {
      try { localStorage.removeItem(attemptKey); } catch { }
      this.refreshLogoutWarning();
    }).catch(() => {
      const until = Date.now() + 20 * 60 * 1000;
      try { localStorage.setItem(logoutWarningKey, String(Math.max(until, Number(localStorage.getItem(logoutWarningKey)) || 0))); }
      catch { this.logoutWarningStorageUnavailable.set(true); }
      this.logoutWarning.set(true);
    });
  }

  private clearDeletionIntents(accountId: string): void {
    const prefix = `${deletionIntentPrefix}${accountId}`;
    for (const key of Object.keys(localStorage)) {
      if (key === prefix || key.startsWith(`${prefix}:`)) localStorage.removeItem(key);
    }
  }

  private async finishLocalCleanup(accountId: string): Promise<void> {
    try {
      await this.storage.deleteAccountProgress(accountId);
    } catch {
      this.cleanupPending.set(true);
      let verified = false;
      try { verified = Boolean(localStorage.getItem(deletionMarkerKey(accountId))); } catch { }
      if (!verified) this.deletionVerificationUnavailable.update((owners) => [...new Set([...owners, accountId])]);
      return;
    }
    this.deletionVerificationUnavailable.update((owners) => owners.filter((owner) => owner !== accountId));
    try {
      localStorage.setItem(deletionMarkerKey(accountId), 'done');
      this.clearDeletionIntents(accountId);
      this.pendingOwners.delete(accountId);
      this.updateCleanupPending();
    } catch {
      this.cleanupPending.set(true);
    }
    this.updateUnresolvedDeletions();
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
    return this.deletedOwners.has(accountId) || Boolean(localStorage.getItem(deletionMarkerKey(accountId)) || localStorage.getItem(localCleanupKey(accountId)));
  }

  async login(email: string, password: string): Promise<void> {
    const generation = ++this.generation;
    const user = await api.login({ email, password });
    if (generation !== this.generation) throw new Error(this.locales.translate('auth.state.signInSuperseded'));
    if (this.isDeleted(user.id)) throw new Error(this.locales.translate('auth.state.accountDeleted'));
    sessionStorage.removeItem('watchwatcher-signed-out');
    this.setAuthenticatedUser(user);
  }

  async createAccount(name: string, email: string, password: string): Promise<void> {
    const generation = ++this.generation;
    const user = await api.createAccount({ name, email, password });
    if (generation !== this.generation) throw new Error(this.locales.translate('auth.state.signInSuperseded'));
    if (this.isDeleted(user.id)) throw new Error(this.locales.translate('auth.state.accountDeleted'));
    sessionStorage.removeItem('watchwatcher-signed-out');
    this.setAuthenticatedUser(user);
  }

  async loginWithGoogle(input: GoogleSignInInput): Promise<GoogleSignInResult> {
    const generation = ++this.generation;
    const result = await api.googleSignIn(input);
    if (generation !== this.generation) throw new Error(this.locales.translate('auth.state.signInSuperseded'));
    if (result.kind === 'authenticated') {
      if (this.isDeleted(result.user.id)) throw new Error(this.locales.translate('auth.state.accountDeleted'));
      sessionStorage.removeItem('watchwatcher-signed-out');
      this.setAuthenticatedUser(result.user);
    }
    return result;
  }

  async logout(): Promise<void> {
    ++this.generation;
    const attemptKey = `${logoutAttemptPrefix}${crypto.randomUUID()}`;
    if (getAuthenticatedAccountId()) {
      let stored = true;
      try { localStorage.setItem(attemptKey, String(Date.now() + 20 * 60 * 1000)); }
      catch { stored = false; this.logoutWarningStorageUnavailable.set(true); }
      this.refreshLogoutWarning();
      if (!stored) this.logoutWarning.set(true);
    }
    const logout = api.logout();
    this.user.set(null);
    this.cloudAuth.set('signed-out');
    try { sessionStorage.removeItem(localIdentityKey); } catch { }
    try { sessionStorage.setItem('watchwatcher-signed-out', 'true'); } catch { }
    try {
      await logout;
      try { localStorage.removeItem(attemptKey); } catch { }
      this.refreshLogoutWarning();
    }
    catch {
      const until = Date.now() + 20 * 60 * 1000;
      try { localStorage.setItem(logoutWarningKey, String(Math.max(until, Number(localStorage.getItem(logoutWarningKey)) || 0))); }
      catch { this.logoutWarningStorageUnavailable.set(true); }
      this.logoutWarning.set(true);
    }
  }

  private setAuthenticatedUser(user: Learner): void {
    this.user.set(user);
    this.cloudAuth.set('authenticated');
    try { sessionStorage.setItem(localIdentityKey, JSON.stringify(user)); } catch { }
  }

  private refreshLogoutWarning(): void {
    try {
      const active = Number(localStorage.getItem(logoutWarningKey)) > Date.now() || Object.keys(localStorage)
        .some((key) => key.startsWith(logoutAttemptPrefix) && Number(localStorage.getItem(key)) > Date.now());
      this.logoutWarning.set(active);
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(logoutAttemptPrefix) && Number(localStorage.getItem(key)) <= Date.now()) localStorage.removeItem(key);
      }
    } catch { }
  }
}
