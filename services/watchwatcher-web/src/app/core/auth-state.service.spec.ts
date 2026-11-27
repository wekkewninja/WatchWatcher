import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { canConfirmDeletion } from '../../api/client';
import type { Learner } from '../domain-types';
import { AuthStateService } from './auth-state.service';
import { StorageRepository } from './storage-repository.service';

const sailor: Learner = { id: 'sailor-1', name: 'Sailor', email: 'sailor@example.test' };
const sessionResponse = () => ({ accountId: sailor.id, session: 'session-token', user: sailor });
const fetchResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('AuthStateService', () => {
  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await api.logout();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await api.logout();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('restores a current user on startup and marks initialization ready', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(fetchResponse(sessionResponse()))
      .mockResolvedValueOnce(fetchResponse({ user: sailor }));
    vi.stubGlobal('fetch', fetchMock);
    await api.login({ email: sailor.email, password: 'password' });
    const auth = new AuthStateService();

    await auth.initialization;
    await vi.waitFor(() => expect(auth.ready()).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.user()).toEqual(sailor);
  });

  it('does not restore a session after an explicit signed-out choice', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    const auth = new AuthStateService();

    await auth.initialization;
    await vi.waitFor(() => expect(auth.ready()).toBe(true));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(auth.user()).toBeNull();
  });

  it('clears stale user state when session restoration fails', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(fetchResponse(sessionResponse()))
      .mockResolvedValueOnce(fetchResponse({ error: { code: 'UNAUTHORIZED', message: 'Session expired.' } }, 401));
    vi.stubGlobal('fetch', fetchMock);
    await api.login({ email: sailor.email, password: 'password' });
    const auth = new AuthStateService();

    await auth.initialization;
    await vi.waitFor(() => expect(auth.ready()).toBe(true));

    expect(auth.user()).toBeNull();
  });

  it('retains the local user when a current authenticated request returns 401', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(fetchResponse(sessionResponse()))
      .mockResolvedValueOnce(fetchResponse({ user: sailor }))
      .mockResolvedValueOnce(fetchResponse({ error: { code: 'UNAUTHORIZED', message: 'Session expired.' } }, 401));
    vi.stubGlobal('fetch', fetchMock);
    await api.login({ email: sailor.email, password: 'password' });
    const auth = new AuthStateService();
    await auth.initialization;
    expect(auth.user()).toEqual(sailor);
    await expect(api.getCurrentUser()).rejects.toThrow();
    expect(auth.user()).toEqual(sailor);
    expect(auth.cloudAuth()).toBe('local');
    expect(sessionStorage.getItem('watchwatcher-signed-out')).toBeNull();
  });

  it('does not let a stale startup response clear a newer login', async () => {
    let finishRestore!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(fetchResponse(sessionResponse()))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { finishRestore = resolve; }))
      .mockResolvedValueOnce(fetchResponse(sessionResponse()));
    vi.stubGlobal('fetch', fetchMock);
    await api.login({ email: sailor.email, password: 'password' });
    const auth = new AuthStateService();

    await auth.login(sailor.email, 'password');
    finishRestore(fetchResponse({ user: sailor }));
    await auth.initialization;

    expect(auth.user()).toEqual(sailor);
    expect(sessionStorage.getItem('watchwatcher-signed-out')).toBeNull();
  });

  it('sets the user and clears the signed-out marker after login or account creation', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(fetchResponse(sessionResponse()))
      .mockResolvedValueOnce(fetchResponse(sessionResponse()));
    vi.stubGlobal('fetch', fetchMock);
    const auth = new AuthStateService();
    await auth.initialization;
    sessionStorage.setItem('watchwatcher-signed-out', 'true');

    await auth.login(sailor.email, 'password');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/login');
    expect(auth.user()).toEqual(sailor);
    expect(sessionStorage.getItem('watchwatcher-signed-out')).toBeNull();

    await auth.createAccount(sailor.name, sailor.email, 'password');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/auth/register');
    expect(auth.user()).toEqual(sailor);
  });

  it('updates state only when Google sign-in authenticates an account', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(fetchResponse({ error: { code: 'CONFLICT', message: 'Link account', details: { reason: 'GOOGLE_ACCOUNT_LINK_REQUIRED' } } }, 409))
      .mockResolvedValueOnce(fetchResponse(sessionResponse()));
    vi.stubGlobal('fetch', fetchMock);
    const auth = new AuthStateService();
    await auth.initialization;
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    await expect(auth.loginWithGoogle({ credential: 'credential', challengeId: 'challenge' })).resolves.toEqual({ kind: 'link-required' });
    expect(auth.user()).toBeNull();
    expect(sessionStorage.getItem('watchwatcher-signed-out')).toBe('true');

    await expect(auth.loginWithGoogle({ credential: 'credential', challengeId: 'challenge' })).resolves.toEqual({ kind: 'authenticated', user: sailor });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.user()).toEqual(sailor);
    expect(sessionStorage.getItem('watchwatcher-signed-out')).toBeNull();
  });

  it('marks the session signed out and clears the user after logout', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(fetchResponse(sessionResponse()))
      .mockResolvedValueOnce(fetchResponse({ user: sailor }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await api.login({ email: sailor.email, password: 'password' });
    const auth = new AuthStateService();
    await auth.initialization;

    await auth.logout();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/auth/logout');
    expect(sessionStorage.getItem('watchwatcher-signed-out')).toBe('true');
    expect(auth.user()).toBeNull();
  });

  it.each(['expired', 'authenticated'])('transitions %s identity to guest without erasing progress', async (state) => {
    const storage = new StorageRepository();
    const accountProgress = { topicMastery: { account: 80 }, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [] };
    const guestProgress = { topicMastery: { guest: 20 }, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [] };
    await storage.saveProgress(sailor.id, accountProgress);
    await storage.saveProgress('guest', guestProgress);
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(fetchResponse(sessionResponse()))
      .mockResolvedValueOnce(state === 'expired' ? fetchResponse({ error: { code: 'UNAUTHORIZED', message: 'Expired' } }, 401) : new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const auth = new AuthStateService();
    await auth.initialization;
    await auth.login(sailor.email, 'password');
    if (state === 'expired') await expect(api.getCurrentUser()).rejects.toThrow();
    await auth.logout();
    expect(auth.user()).toBeNull();
    expect(auth.cloudAuth()).toBe('signed-out');
    expect(await storage.loadProgress(sailor.id)).toEqual(accountProgress);
    expect(await storage.loadProgress('guest')).toEqual(guestProgress);
    if (state === 'authenticated') expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/logout');
  });

  it('rejects a pending sign-in after switching to guest', async () => {
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })));
    const auth = new AuthStateService();
    await auth.initialization;
    const pending = auth.login(sailor.email, 'password');
    await auth.logout();
    finish(fetchResponse(sessionResponse()));
    await expect(pending).rejects.toThrow('superseded');
    expect(auth.user()).toBeNull();
    await expect(api.getCurrentUser()).rejects.toThrow('Sign in');
  });

  it('keeps deletion unconfirmed until the initiating session receipt succeeds after another request returns 401', async () => {
    const owner = { id: 'notice-receipt-owner', name: 'Sailor', email: 'receipt@example.test' };
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(fetchResponse({ accountId: owner.id, session: 'notice-token', user: owner }))
      .mockRejectedValueOnce(new TypeError('response lost'))
      .mockResolvedValueOnce(fetchResponse({ error: { code: 'UNAUTHORIZED', message: 'Expired' } }, 401))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 })));
    vi.spyOn(StorageRepository.prototype, 'deleteAccountProgress').mockResolvedValue();
    const auth = new AuthStateService();
    await auth.initialization;
    await auth.login(owner.email, 'password');
    await expect(auth.deleteAccount(owner.id, auth.accountGeneration, { type: 'password', password: 'fresh' })).rejects.toThrow('response lost');
    await expect(api.getCurrentUser()).rejects.toThrow();
    expect(auth.deletionRetryOwner()).toBe(owner.id);
    await auth.confirmUnresolvedDeletion(owner.id);
    expect(auth.deletionRetryError()).toContain('could not be confirmed');
    expect(auth.unresolvedDeletions()).toContain(owner.id);
    expect(auth.user()?.id).toBe(owner.id);
    await auth.confirmUnresolvedDeletion(owner.id);
    expect(auth.deletionRetryError()).toBe('');
    expect(auth.user()).toBeNull();
    expect(localStorage.getItem(`watchwatcher-deleted:${owner.id}`)).toBeTruthy();
    expect(auth.deletionRetryOwner()).toBeNull();
  });

  it('does not restore a pending deletion bearer after local erasure and failed remote logout', async () => {
    const owner = { id: 'erase-pending-owner', name: 'Sailor', email: 'erase@example.test' };
    let failDelete!: (error: Error) => void;
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(fetchResponse({ accountId: owner.id, session: 'erase-secret', user: owner }))
      .mockReturnValueOnce(new Promise<Response>((_, reject) => { failDelete = reject; }))
      .mockResolvedValueOnce(new Response(null, { status: 503 })));
    vi.spyOn(StorageRepository.prototype, 'deleteAccountProgress').mockResolvedValue();
    const auth = new AuthStateService();
    await auth.initialization;
    await auth.login(owner.email, 'password');
    const deletion = auth.deleteAccount(owner.id, auth.accountGeneration, { type: 'password', password: 'fresh' });
    await auth.eraseUnresolvedLocalData(owner.id);
    await vi.waitFor(() => expect(auth.logoutWarning()).toBe(true));
    failDelete(new TypeError('response lost'));
    await expect(deletion).rejects.toThrow('response lost');
    expect(auth.localCleanupStates()[owner.id]).toBe('done');
    expect(auth.unresolvedDeletions()).toContain(owner.id);
    expect(canConfirmDeletion(owner.id)).toBe(false);
    expect(auth.deletionRetryOwner()).toBeNull();
  });

  it('clears the user immediately and warns when remote logout is unconfirmed', async () => {
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    const auth = new AuthStateService();
    auth.user.set(sailor);
    let fail!: (error: Error) => void;
    vi.spyOn(api, 'logout').mockReturnValueOnce(new Promise<void>((_, reject) => { fail = reject; }));
    const pending = auth.logout();
    expect(auth.user()).toBeNull();
    fail(new Error('offline'));
    await pending;
    expect(auth.logoutWarning()).toBe(true);
  });

  it('warns without clearing a newer login when an older logout fails', async () => {
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    const auth = new AuthStateService();
    auth.user.set(sailor);
    let fail!: (error: Error) => void;
    vi.spyOn(api, 'logout').mockReturnValueOnce(new Promise<void>((_, reject) => { fail = reject; }));
    vi.spyOn(api, 'login').mockResolvedValueOnce({ id: 'new-user', name: 'New', email: 'new@example.test' });
    const pending = auth.logout();
    await auth.login('new@example.test', 'password');
    fail(new Error('network'));
    await pending;
    expect(auth.user()?.id).toBe('new-user');
    expect(auth.logoutWarning()).toBe(true);
  });

  it('clears the user immediately when a subsequent login fails', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(fetchResponse(sessionResponse()))
      .mockResolvedValueOnce(fetchResponse({ user: sailor }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(fetchResponse({ error: { code: 'UNAUTHORIZED', message: 'Invalid credentials.' } }, 401));
    vi.stubGlobal('fetch', fetchMock);
    await api.login({ email: sailor.email, password: 'password' });
    const auth = new AuthStateService();
    await auth.initialization;

    const logout = auth.logout();
    const login = auth.login('other@example.test', 'wrong-password');
    await logout;
    await expect(login).rejects.toThrow();
    expect(auth.user()).toBeNull();
    expect(sessionStorage.getItem('watchwatcher-signed-out')).toBe('true');
  });

  it('leaves local data and session untouched when the delete request fails', async () => {
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    const auth = new AuthStateService();
    auth.user.set(sailor);
    vi.spyOn(api, 'deleteAccount').mockRejectedValue(new Error('Invalid credentials'));
    const cleanup = vi.spyOn(StorageRepository.prototype, 'deleteAccountProgress');
    await expect(auth.deleteAccount(sailor.id, auth.accountGeneration, { type: 'password', password: 'wrong' })).rejects.toThrow();
    expect(auth.user()).toEqual(sailor);
    expect(cleanup).not.toHaveBeenCalled();
    expect(localStorage.getItem(`watchwatcher-deleted:${sailor.id}`)).toBeNull();
  });

  it('persists an intent before the request, keeps data on network failure, and restores the notice', async () => {
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    const auth = new AuthStateService();
    auth.user.set(sailor);
    const cleanup = vi.spyOn(StorageRepository.prototype, 'deleteAccountProgress');
    vi.spyOn(api, 'deleteAccount').mockImplementation(async () => {
      const keys = Object.keys(localStorage).filter((key) => key.startsWith(`watchwatcher-deletion-intent:${sailor.id}:`));
      expect(keys).toHaveLength(1);
      expect(localStorage.getItem(keys[0])).toBe('pending');
      expect(JSON.stringify(localStorage)).not.toContain('secret');
      throw new TypeError('Network failure');
    });
    await expect(auth.deleteAccount(sailor.id, auth.accountGeneration, { type: 'password', password: 'secret' })).rejects.toThrow('Network failure');
    expect(auth.user()).toEqual(sailor);
    expect(cleanup).not.toHaveBeenCalled();
    expect(auth.unresolvedDeletions()).toEqual([sailor.id]);
    const reloaded = new AuthStateService();
    await reloaded.initialization;
    expect(reloaded.unresolvedDeletions()).toEqual([sailor.id]);
    expect(localStorage.getItem(`watchwatcher-deleted:${sailor.id}`)).toBeNull();
  });

  it('erases only the selected account after explicit cleanup, retaining all unresolved intents', async () => {
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    const owner = 'local-choice-owner';
    localStorage.setItem(`watchwatcher-deletion-intent:${owner}:one`, 'pending');
    localStorage.setItem(`watchwatcher-deletion-intent:${owner}:two`, 'pending');
    localStorage.setItem('watchwatcher-deletion-intent:local-choice-other:one', 'pending');
    const storage = new StorageRepository();
    const snapshot = { topicMastery: { topic: 50 }, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [] };
    await Promise.all(['guest', owner, 'local-choice-other'].map((id) => storage.saveProgress(id, snapshot)));
    const auth = new AuthStateService();
    await auth.eraseUnresolvedLocalData(owner);
    expect(auth.unresolvedDeletions()).toContain(owner);
    expect(auth.unresolvedDeletions()).toContain('local-choice-other');
    expect(localStorage.getItem(`watchwatcher-deletion-intent:${owner}:one`)).toBe('pending');
    expect(localStorage.getItem(`watchwatcher-deletion-intent:${owner}:two`)).toBe('pending');
    expect(auth.localCleanupStates()[owner]).toBe('done');
    await expect(storage.loadProgress(owner)).resolves.toBeNull();
    await expect(storage.loadProgress('guest')).resolves.toEqual(snapshot);
    await expect(storage.loadProgress('local-choice-other')).resolves.toEqual(snapshot);
    const cleanup = vi.spyOn(StorageRepository.prototype, 'deleteAccountProgress');
    await auth.eraseUnresolvedLocalData(owner);
    await auth.eraseUnresolvedLocalData('guest');
    expect(cleanup).not.toHaveBeenCalled();
    expect(new AuthStateService().localCleanupStates()[owner]).toBe('done');
  });

  it('leaves a retryable marker after blocked cleanup and retries without clearing intents', async () => {
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    localStorage.setItem('watchwatcher-deletion-intent:retry-owner:one', 'pending');
    const auth = new AuthStateService();
    const cleanup = vi.spyOn(StorageRepository.prototype, 'deleteAccountProgress').mockRejectedValueOnce(new Error('blocked')).mockResolvedValue();
    await auth.eraseUnresolvedLocalData('retry-owner');
    expect(auth.localCleanupStates()['retry-owner']).toBe('pending');
    expect(auth.localCleanupErrors()['retry-owner']).toContain('could not be completed');
    await auth.eraseUnresolvedLocalData('retry-owner');
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(auth.localCleanupStates()['retry-owner']).toBe('done');
    expect(auth.unresolvedDeletions()).toEqual(['retry-owner']);
  });

  it('deduplicates concurrent confirmations and retries after a completion marker failure', async () => {
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    localStorage.setItem('watchwatcher-deletion-intent:completion-failure:one', 'pending');
    const auth = new AuthStateService();
    let finish!: () => void;
    const cleanup = vi.spyOn(StorageRepository.prototype, 'deleteAccountProgress')
      .mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue();
    const setItem = Storage.prototype.setItem;
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'watchwatcher-local-cleanup:completion-failure' && value === 'done') throw new Error('Unavailable');
      return setItem.call(this, key, value);
    });
    const first = auth.eraseUnresolvedLocalData('completion-failure');
    await auth.eraseUnresolvedLocalData('completion-failure');
    expect(cleanup).toHaveBeenCalledTimes(1);
    finish();
    await first;
    expect(auth.localCleanupStates()['completion-failure']).toBe('pending');
    expect(auth.localCleanupErrors()['completion-failure']).toContain('could not be completed');
    storage.mockRestore();
    await auth.eraseUnresolvedLocalData('completion-failure');
    expect(auth.localCleanupStates()['completion-failure']).toBe('done');
    expect(auth.unresolvedDeletions()).toEqual(['completion-failure']);
  });

  it('does not erase if the local cleanup marker cannot be saved', async () => {
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    localStorage.setItem('watchwatcher-deletion-intent:storage-failure:one', 'pending');
    const auth = new AuthStateService();
    const cleanup = vi.spyOn(StorageRepository.prototype, 'deleteAccountProgress');
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'watchwatcher-local-cleanup:storage-failure') throw new Error('Unavailable');
      return setItem.call(this, key, value);
    });
    await auth.eraseUnresolvedLocalData('storage-failure');
    expect(cleanup).not.toHaveBeenCalled();
    expect(auth.localCleanupErrors()['storage-failure']).toContain('could not be completed');
    expect(auth.unresolvedDeletions()).toEqual(['storage-failure']);
  });

  it('keeps the intent when a concurrent deletion is rejected after local cleanup starts', async () => {
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    const auth = new AuthStateService();
    auth.user.set({ ...sailor, id: 'concurrent-cleanup' });
    let rejectDelete!: (error: Error) => void;
    vi.spyOn(api, 'deleteAccount').mockReturnValue(new Promise<void>((_, reject) => { rejectDelete = reject; }));
    vi.spyOn(StorageRepository.prototype, 'deleteAccountProgress').mockResolvedValue();
    const deletion = auth.deleteAccount('concurrent-cleanup', auth.accountGeneration, { type: 'password', password: 'secret' });
    await auth.eraseUnresolvedLocalData('concurrent-cleanup');
    rejectDelete(Object.assign(new Error('Rejected'), { status: 401 }));
    await expect(deletion).rejects.toThrow('Rejected');
    expect(auth.unresolvedDeletions()).toEqual(['concurrent-cleanup']);
    expect(auth.user()).toBeNull();
    expect(JSON.stringify(localStorage)).not.toContain('secret');
  });

  it('does not cancel a newer account sign-in while erasing the previous account', async () => {
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    localStorage.setItem('watchwatcher-deletion-intent:old-account:one', 'pending');
    const auth = new AuthStateService();
    auth.user.set({ ...sailor, id: 'old-account' });
    let finishLogin!: (user: Learner) => void;
    vi.spyOn(api, 'login').mockReturnValue(new Promise<Learner>((resolve) => { finishLogin = resolve; }));
    vi.spyOn(StorageRepository.prototype, 'deleteAccountProgress').mockResolvedValue();
    const login = auth.login('new@example.test', 'password');
    await auth.eraseUnresolvedLocalData('old-account');
    const other = { id: 'new-account', name: 'New', email: 'new@example.test' };
    finishLogin(other);
    await login;
    expect(auth.user()).toEqual(other);
  });

  it('clears only the affected bearer and cached identity when another tab requests cleanup', async () => {
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    const owner = { id: 'tab-cleanup', name: 'Sailor', email: 'tab@example.test' };
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(fetchResponse({ accountId: owner.id, session: 'tab-secret', user: owner }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const auth = new AuthStateService();
    await auth.login(owner.email, 'password');
    localStorage.setItem(`watchwatcher-local-cleanup:${owner.id}`, 'pending');
    window.dispatchEvent(new StorageEvent('storage', { key: `watchwatcher-local-cleanup:${owner.id}`, newValue: 'pending' }));
    expect(auth.user()).toBeNull();
    expect(sessionStorage.getItem('watchwatcher-local-identity')).toBeNull();
    await expect(api.getCurrentUser()).rejects.toThrow('Sign in');
    expect(JSON.stringify(localStorage)).not.toContain('tab-secret');
    expect(JSON.stringify(sessionStorage)).not.toContain('tab-secret');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/auth/logout');
  });

  it('invalidates an in-flight request when another tab confirms deletion', async () => {
    const owner = { id: 'tab-confirmed', name: 'Sailor', email: 'tab-confirmed@example.test' };
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(fetchResponse({ accountId: owner.id, session: 'tab-token', user: owner }))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const auth = new AuthStateService();
    await auth.initialization;
    await auth.login(owner.email, 'password');
    const request = api.getCurrentUser();
    const key = `watchwatcher-deleted:${owner.id}`;
    localStorage.setItem(key, 'pending');
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: 'pending' }));
    expect(auth.user()).toBeNull();
    expect(auth.accountViewInvalidated()).toBe(true);
    expect(sessionStorage.getItem('watchwatcher-local-identity')).toBeNull();
    finish(fetchResponse({ user: owner }));
    await expect(request).rejects.toThrow('Account changed');
    await expect(api.getCurrentUser()).rejects.toThrow('Sign in');
  });

  it('clears a local identity after a 401 when another tab starts cleanup', async () => {
    const owner = { id: 'tab-expired', name: 'Sailor', email: 'expired@example.test' };
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(fetchResponse({ accountId: owner.id, session: 'token', user: owner }))
      .mockResolvedValueOnce(fetchResponse({ error: { message: 'Expired' } }, 401)));
    const auth = new AuthStateService();
    await auth.initialization;
    await auth.login(owner.email, 'password');
    await expect(api.getCurrentUser()).rejects.toThrow();
    expect(auth.cloudAuth()).toBe('local');
    const key = `watchwatcher-local-cleanup:${owner.id}`;
    localStorage.setItem(key, 'pending');
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: 'pending' }));
    expect(auth.user()).toBeNull();
    expect(sessionStorage.getItem('watchwatcher-local-identity')).toBeNull();
    expect(auth.accountViewInvalidated()).toBe(true);
  });

  it('keeps another account and its reload identity when account A is cleaned up', async () => {
    const other = { id: 'tab-other', name: 'Other', email: 'other@example.test' };
    sessionStorage.setItem('watchwatcher-local-identity', JSON.stringify(other));
    localStorage.setItem('watchwatcher-signed-out', 'true');
    const auth = new AuthStateService();
    await auth.initialization;
    const key = 'watchwatcher-deleted:tab-account-a';
    localStorage.setItem(key, 'pending');
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: 'pending' }));
    expect(auth.user()).toEqual(other);
    expect(auth.accountViewInvalidated()).toBe(false);
    const reloaded = new AuthStateService();
    await reloaded.initialization;
    expect(reloaded.user()).toEqual(other);
  });

  it('keeps account B bearer usable when another tab erases account A', async () => {
    const other = { id: 'bearer-other', name: 'Other', email: 'other@example.test' };
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(fetchResponse({ accountId: other.id, session: 'other-token', user: other }))
      .mockResolvedValueOnce(fetchResponse({ user: other })));
    const auth = new AuthStateService();
    await auth.initialization;
    await auth.login(other.email, 'password');
    const key = 'watchwatcher-local-cleanup:bearer-account-a';
    localStorage.setItem(key, 'pending');
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: 'pending' }));
    expect(auth.user()).toEqual(other);
    await expect(api.getCurrentUser()).resolves.toEqual(other);
    expect(sessionStorage.getItem('watchwatcher-local-identity')).toContain(other.id);
  });

  it('restores tab B after tab A signs out using separate tab storage', async () => {
    const makeStorage = (): Storage => {
      const entries = new Map<string, string>();
      return {
        get length() { return entries.size; },
        clear: () => entries.clear(),
        getItem: (key) => entries.get(key) ?? null,
        key: (index) => [...entries.keys()][index] ?? null,
        removeItem: (key) => { entries.delete(key); },
        setItem: (key, value) => { entries.set(key, value); },
      };
    };
    const tabA = makeStorage();
    const tabB = makeStorage();
    const other = { id: 'reload-tab-b', name: 'Other', email: 'other@example.test' };
    tabA.setItem('watchwatcher-signed-out', 'true');
    tabB.setItem('watchwatcher-local-identity', JSON.stringify(other));
    const tab = vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue(tabA);
    const authA = new AuthStateService();
    authA.user.set(sailor);
    vi.spyOn(api, 'logout').mockResolvedValue();
    await authA.logout();
    tab.mockReturnValue(tabB);
    vi.spyOn(api, 'getCurrentUser').mockResolvedValue(other);
    const reloadedB = new AuthStateService();
    await reloadedB.initialization;
    expect(reloadedB.user()).toEqual(other);
    expect(reloadedB.cloudAuth()).toBe('authenticated');
    expect(tabB.getItem('watchwatcher-signed-out')).toBeNull();
    tab.mockRestore();
  });

  it('reports inaccessible browser storage on startup without restoring a session', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Unavailable'); });
    const auth = new AuthStateService();
    await auth.initialization;
    expect(auth.deletionNoticeUnavailable()).toBe(true);
    expect(auth.user()).toBeNull();
    vi.restoreAllMocks();
  });

  it.each([
    { status: 403, code: 'REAUTHENTICATION_FAILED' },
    { status: 429, code: 'RATE_LIMITED' },
    { status: 422, code: 'VALIDATION_ERROR' },
    { status: 401, code: 'UNAUTHORIZED' },
  ])('removes a new intent after a definite rejection ($status)', async ({ status, code }) => {
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    const auth = new AuthStateService();
    auth.user.set(sailor);
    vi.spyOn(api, 'deleteAccount').mockRejectedValue(Object.assign(new Error('Rejected'), { status, code }));
    await expect(auth.deleteAccount(sailor.id, auth.accountGeneration, { type: 'password', password: 'wrong' })).rejects.toThrow();
    expect(auth.user()).toEqual(sailor);
    expect(auth.unresolvedDeletions()).toEqual([]);
    expect(localStorage.getItem(`watchwatcher-deletion-intent:${sailor.id}`)).toBeNull();
  });

  it.each([
    { status: 403, code: 'REAUTHENTICATION_FAILED' },
    { status: 429, code: 'RATE_LIMITED' },
    { status: 422, code: 'VALIDATION_ERROR' },
    { status: 401, code: 'UNAUTHORIZED' },
  ])('retains an earlier ambiguous intent when a retry is rejected ($status)', async ({ status, code }) => {
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    localStorage.setItem(`watchwatcher-deletion-intent:${sailor.id}`, 'pending');
    const auth = new AuthStateService();
    auth.user.set(sailor);
    vi.spyOn(api, 'deleteAccount').mockRejectedValue(Object.assign(new Error('Rejected'), { status, code }));
    await expect(auth.deleteAccount(sailor.id, auth.accountGeneration, { type: 'password', password: 'wrong' })).rejects.toThrow();
    expect(auth.unresolvedDeletions()).toEqual([sailor.id]);
    expect(localStorage.getItem(`watchwatcher-deletion-intent:${sailor.id}`)).toBe('pending');
  });

  it('retains local identity and clears only the rejected intent for an expired bearer', async () => {
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    const auth = new AuthStateService();
    auth.user.set(sailor);
    vi.spyOn(api, 'deleteAccount').mockRejectedValue(Object.assign(new Error('Expired'), { status: 401, code: 'UNAUTHORIZED' }));
    await expect(auth.deleteAccount(sailor.id, auth.accountGeneration, { type: 'password', password: 'fresh' })).rejects.toThrow('Expired');
    expect(auth.user()).toEqual(sailor);
    expect(auth.cloudAuth()).toBe('local');
    expect(auth.unresolvedDeletions()).toEqual([]);
    expect(sessionStorage.getItem('watchwatcher-signed-out')).toBe('true');
  });

  it('keeps another tab\'s ambiguous deletion when this attempt is rejected', async () => {
    const first = new AuthStateService();
    const second = new AuthStateService();
    first.user.set(sailor);
    second.user.set(sailor);
    let rejectFirst!: (error: Error) => void;
    let rejectSecond!: (error: Error) => void;
    vi.spyOn(api, 'deleteAccount')
      .mockReturnValueOnce(new Promise<void>((_, reject) => { rejectFirst = reject; }))
      .mockReturnValueOnce(new Promise<void>((_, reject) => { rejectSecond = reject; }));
    const ambiguous = first.deleteAccount(sailor.id, first.accountGeneration, { type: 'password', password: 'secret' });
    const rejected = second.deleteAccount(sailor.id, second.accountGeneration, { type: 'password', password: 'secret' });
    rejectFirst(new TypeError('Network failure'));
    await expect(ambiguous).rejects.toThrow();
    rejectSecond(Object.assign(new Error('Unauthorized'), { status: 401 }));
    await expect(rejected).rejects.toThrow();
    expect(Object.keys(localStorage).filter((key) => key.startsWith(`watchwatcher-deletion-intent:${sailor.id}:`))).toHaveLength(1);
    expect(new AuthStateService().unresolvedDeletions()).toEqual([sailor.id]);
  });

  it('retains an unconfirmed logout warning across reload and later successful logout', async () => {
    const auth = new AuthStateService();
    vi.spyOn(api, 'logout').mockRejectedValueOnce(new Error('offline')).mockResolvedValue();
    await auth.logout();
    const until = Number(localStorage.getItem('watchwatcher-logout-warning-until'));
    expect(until).toBeGreaterThanOrEqual(Date.now() + 20 * 60 * 1000 - 1000);
    const reloaded = new AuthStateService();
    expect(reloaded.logoutWarning()).toBe(true);
    await reloaded.logout();
    expect(reloaded.logoutWarning()).toBe(true);
    expect(localStorage.getItem('watchwatcher-logout-warning-until')).toBe(String(until));
    expect(JSON.stringify(localStorage)).not.toContain('session-token');
  });

  it('persists an in-flight logout notice before a reload and clears it on confirmation', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(fetchResponse(sessionResponse())));
    const auth = new AuthStateService();
    await auth.initialization;
    await auth.login(sailor.email, 'password');
    let finish!: () => void;
    vi.spyOn(api, 'logout').mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    const pending = auth.logout();
    expect(new AuthStateService().logoutWarning()).toBe(true);
    expect(JSON.stringify(localStorage)).not.toContain('session-token');
    finish();
    await pending;
    expect(auth.logoutWarning()).toBe(false);
    expect(new AuthStateService().logoutWarning()).toBe(false);
  });

  it('stops restoring expired logout warnings', () => {
    localStorage.setItem('watchwatcher-logout-warning-until', String(Date.now() - 1));
    localStorage.setItem('watchwatcher-logout-attempt:old', String(Date.now() - 1));
    expect(new AuthStateService().logoutWarning()).toBe(false);
    expect(localStorage.getItem('watchwatcher-logout-attempt:old')).toBeNull();
  });

  it('reports when an unconfirmed logout warning cannot be stored', async () => {
    const auth = new AuthStateService();
    vi.spyOn(api, 'logout').mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    await auth.logout();
    expect(auth.logoutWarning()).toBe(true);
    expect(auth.logoutWarningStorageUnavailable()).toBe(true);
  });

  it('converts an intent after a confirmed deletion when storage recovers', async () => {
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    const auth = new AuthStateService();
    auth.user.set(sailor);
    vi.spyOn(api, 'deleteAccount').mockResolvedValue();
    vi.spyOn(StorageRepository.prototype, 'deleteAccountProgress').mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue();
    const setItem = Storage.prototype.setItem;
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === `watchwatcher-deleted:${sailor.id}`) throw new Error('Unavailable');
      return setItem.call(this, key, value);
    });
    await auth.deleteAccount(sailor.id, auth.accountGeneration, { type: 'password', password: 'fresh' });
    await vi.waitFor(() => expect(auth.deletionVerificationUnavailable()).toContain(sailor.id));
    expect(auth.cleanupPending()).toBe(true);
    expect(auth.unresolvedDeletions()).toEqual([sailor.id]);
    storage.mockRestore();
    await auth.retryLocalCleanup();
    expect(localStorage.getItem(`watchwatcher-deleted:${sailor.id}`)).toBe('done');
    expect(auth.unresolvedDeletions()).toEqual([]);
    expect(auth.deletionVerificationUnavailable()).toEqual([]);
  });

  it('does not send a deletion request if the recovery intent cannot be stored', async () => {
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    const auth = new AuthStateService();
    auth.user.set(sailor);
    const deletion = vi.spyOn(api, 'deleteAccount');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
    await expect(auth.deleteAccount(sailor.id, auth.accountGeneration, { type: 'password', password: 'secret' })).rejects.toThrow('recovery notice');
    expect(deletion).not.toHaveBeenCalled();
    expect(auth.user()).toEqual(sailor);
  });

  it.each([false, true])('clears the old user without cancelling a pending login (login succeeds: %s)', async (succeeds) => {
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    const auth = new AuthStateService();
    auth.user.set(sailor);
    let finishDelete!: () => void;
    let finishLogin!: (user: Learner) => void;
    let failLogin!: (error: Error) => void;
    vi.spyOn(api, 'deleteAccount').mockReturnValue(new Promise<void>((resolve) => { finishDelete = resolve; }));
    vi.spyOn(api, 'login').mockReturnValue(new Promise<Learner>((resolve, reject) => { finishLogin = resolve; failLogin = reject; }));
    vi.spyOn(StorageRepository.prototype, 'deleteAccountProgress').mockResolvedValue();
    const deleting = auth.deleteAccount(sailor.id, auth.accountGeneration, { type: 'password', password: 'fresh' });
    const login = auth.login('other@example.test', 'password');
    finishDelete();
    await expect(deleting).resolves.toBe(true);
    expect(auth.user()).toBeNull();
    expect(localStorage.getItem(`watchwatcher-deletion-intent:${sailor.id}`)).toBeNull();
    if (succeeds) {
      const other = { id: 'other', name: 'Other', email: 'other@example.test' };
      finishLogin(other);
      await login;
      expect(auth.user()).toEqual(other);
      expect(sessionStorage.getItem('watchwatcher-signed-out')).toBeNull();
    } else {
      failLogin(new Error('Invalid credentials'));
      await expect(login).rejects.toThrow('Invalid credentials');
      expect(auth.user()).toBeNull();
    }
  });

  it.each(['before', 'after'])('does not restore the same account when login completes %s deletion', async (timing) => {
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    const auth = new AuthStateService();
    auth.user.set(sailor);
    let finishDelete!: () => void;
    let finishLogin!: (user: Learner) => void;
    vi.spyOn(api, 'deleteAccount').mockReturnValue(new Promise<void>((resolve) => { finishDelete = resolve; }));
    vi.spyOn(api, 'login').mockReturnValue(new Promise<Learner>((resolve) => { finishLogin = resolve; }));
    vi.spyOn(StorageRepository.prototype, 'deleteAccountProgress').mockResolvedValue();
    const deleting = auth.deleteAccount(sailor.id, auth.accountGeneration, { type: 'password', password: 'fresh' });
    const login = auth.login(sailor.email, 'password');
    if (timing === 'before') {
      finishLogin({ ...sailor });
      await login;
    }
    finishDelete();
    await expect(deleting).resolves.toBe(true);
    if (timing === 'after') {
      finishLogin({ ...sailor });
      await expect(login).rejects.toThrow('deleted');
    }
    expect(auth.user()).toBeNull();
    expect(sessionStorage.getItem('watchwatcher-signed-out')).toBe('true');
  });

  it.each([false, true])('clears a refreshed deleted user without cancelling another login (succeeds: %s)', async (succeeds) => {
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    const auth = new AuthStateService();
    auth.user.set(sailor);
    let finishDelete!: () => void;
    let finishLogin!: (user: Learner) => void;
    let failLogin!: (error: Error) => void;
    vi.spyOn(api, 'deleteAccount').mockReturnValue(new Promise<void>((resolve) => { finishDelete = resolve; }));
    vi.spyOn(api, 'login').mockResolvedValueOnce({ ...sailor }).mockReturnValueOnce(new Promise<Learner>((resolve, reject) => { finishLogin = resolve; failLogin = reject; }));
    vi.spyOn(StorageRepository.prototype, 'deleteAccountProgress').mockResolvedValue();
    const deleting = auth.deleteAccount(sailor.id, auth.accountGeneration, { type: 'password', password: 'fresh' });
    await auth.login(sailor.email, 'password');
    const login = auth.login('other@example.test', 'password');
    finishDelete();
    await expect(deleting).resolves.toBe(true);
    expect(auth.user()).toBeNull();
    if (succeeds) {
      const other = { id: 'other', name: 'Other', email: 'other@example.test' };
      finishLogin(other);
      await login;
      expect(auth.user()).toEqual(other);
    } else {
      failLogin(new Error('Invalid credentials'));
      await expect(login).rejects.toThrow('Invalid credentials');
      expect(auth.user()).toBeNull();
    }
  });

  it('signs out immediately and retains a retry marker when local deletion fails', async () => {
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    const auth = new AuthStateService();
    auth.user.set(sailor);
    vi.spyOn(api, 'deleteAccount').mockResolvedValue();
    const cleanup = vi.spyOn(StorageRepository.prototype, 'deleteAccountProgress').mockRejectedValueOnce(new Error('IndexedDB unavailable')).mockResolvedValue();
    await expect(auth.deleteAccount(sailor.id, auth.accountGeneration, { type: 'password', password: 'fresh' })).resolves.toBe(true);
    expect(auth.user()).toBeNull();
    await vi.waitFor(() => expect(auth.cleanupPending()).toBe(true));
    expect(localStorage.getItem(`watchwatcher-deleted:${sailor.id}`)).toBe('pending');
    await auth.retryLocalCleanup();
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(auth.cleanupPending()).toBe(false);
    expect(localStorage.getItem(`watchwatcher-deleted:${sailor.id}`)).toBe('done');
  });

  it('keeps confirmed cleanup pending when its completion marker cannot be saved', async () => {
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    const owner = { ...sailor, id: 'confirmed-completion-failure' };
    const auth = new AuthStateService();
    auth.user.set(owner);
    vi.spyOn(api, 'deleteAccount').mockResolvedValue();
    const cleanup = vi.spyOn(StorageRepository.prototype, 'deleteAccountProgress').mockResolvedValue();
    const setItem = Storage.prototype.setItem;
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === `watchwatcher-deleted:${owner.id}` && value === 'done') throw new Error('Unavailable');
      return setItem.call(this, key, value);
    });
    await auth.deleteAccount(owner.id, auth.accountGeneration, { type: 'password', password: 'fresh' });
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledWith(owner.id));
    await Promise.resolve();
    expect(auth.cleanupPending()).toBe(true);
    expect(localStorage.getItem(`watchwatcher-deleted:${owner.id}`)).toBe('pending');
    expect(auth.deletionVerificationUnavailable()).toEqual([]);
    storage.mockRestore();
    await auth.retryLocalCleanup();
    expect(auth.cleanupPending()).toBe(false);
    expect(localStorage.getItem(`watchwatcher-deleted:${owner.id}`)).toBe('done');
  });

  it('retries pending cleanup on startup without restoring a signed-out user', async () => {
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    localStorage.setItem(`watchwatcher-deleted:${sailor.id}`, 'pending');
    const cleanup = vi.spyOn(StorageRepository.prototype, 'deleteAccountProgress').mockResolvedValue();
    const auth = new AuthStateService();
    await auth.initialization;
    await vi.waitFor(() => expect(auth.cleanupPending()).toBe(false));
    expect(cleanup).toHaveBeenCalledWith(sailor.id);
    expect(localStorage.getItem(`watchwatcher-deleted:${sailor.id}`)).toBe('done');
    expect(auth.user()).toBeNull();
  });

  it('cleans the deleted owner without signing out an account that switched during the request', async () => {
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    const auth = new AuthStateService();
    auth.user.set(sailor);
    let finish!: () => void;
    vi.spyOn(api, 'deleteAccount').mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const other = { id: 'other', name: 'Other', email: 'other@example.test' };
    vi.spyOn(api, 'login').mockResolvedValue(other);
    const cleanup = vi.spyOn(StorageRepository.prototype, 'deleteAccountProgress').mockResolvedValue();
    const deleting = auth.deleteAccount(sailor.id, auth.accountGeneration, { type: 'password', password: 'fresh' });
    await auth.login(other.email, 'password');
    finish();
    await expect(deleting).resolves.toBe(false);
    expect(auth.user()).toEqual(other);
    expect(cleanup).toHaveBeenCalledWith(sailor.id);
    expect(sessionStorage.getItem('watchwatcher-signed-out')).toBeNull();
  });
});