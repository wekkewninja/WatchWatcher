import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import type { Learner } from '../domain-types';
import { AuthStateService } from './auth-state.service';
import { StorageRepository } from './storage-repository.service';

const sailor: Learner = { id: 'sailor-1', name: 'Sailor', email: 'sailor@example.test' };
const sessionResponse = () => ({ accountId: sailor.id, session: 'session-token', user: sailor });
const fetchResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('AuthStateService', () => {
  beforeEach(async () => {
    localStorage.clear();
    await api.logout();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(async () => {
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
    localStorage.setItem('watchwatcher-signed-out', 'true');
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
    expect(localStorage.getItem('watchwatcher-signed-out')).toBeNull();
  });

  it('sets the user and clears the signed-out marker after login or account creation', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(fetchResponse(sessionResponse()))
      .mockResolvedValueOnce(fetchResponse(sessionResponse()));
    vi.stubGlobal('fetch', fetchMock);
    const auth = new AuthStateService();
    await auth.initialization;
    localStorage.setItem('watchwatcher-signed-out', 'true');

    await auth.login(sailor.email, 'password');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/login');
    expect(auth.user()).toEqual(sailor);
    expect(localStorage.getItem('watchwatcher-signed-out')).toBeNull();

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
    localStorage.setItem('watchwatcher-signed-out', 'true');
    await expect(auth.loginWithGoogle({ credential: 'credential', challengeId: 'challenge' })).resolves.toEqual({ kind: 'link-required' });
    expect(auth.user()).toBeNull();
    expect(localStorage.getItem('watchwatcher-signed-out')).toBe('true');

    await expect(auth.loginWithGoogle({ credential: 'credential', challengeId: 'challenge' })).resolves.toEqual({ kind: 'authenticated', user: sailor });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.user()).toEqual(sailor);
    expect(localStorage.getItem('watchwatcher-signed-out')).toBeNull();
  });

  it('marks the session signed out and clears the user after logout', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(fetchResponse(sessionResponse()))
      .mockResolvedValueOnce(fetchResponse({ user: sailor }));
    vi.stubGlobal('fetch', fetchMock);
    await api.login({ email: sailor.email, password: 'password' });
    const auth = new AuthStateService();
    await auth.initialization;

    await auth.logout();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('watchwatcher-signed-out')).toBe('true');
    expect(auth.user()).toBeNull();
  });

  it('clears the user immediately when a subsequent login fails', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(fetchResponse(sessionResponse()))
      .mockResolvedValueOnce(fetchResponse({ user: sailor }))
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
    expect(localStorage.getItem('watchwatcher-signed-out')).toBe('true');
  });

  it('leaves local data and session untouched when the delete request fails', async () => {
    localStorage.setItem('watchwatcher-signed-out', 'true');
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
    localStorage.setItem('watchwatcher-signed-out', 'true');
    const auth = new AuthStateService();
    auth.user.set(sailor);
    const cleanup = vi.spyOn(StorageRepository.prototype, 'deleteAccountProgress');
    vi.spyOn(api, 'deleteAccount').mockImplementation(async () => {
      expect(localStorage.getItem(`watchwatcher-deletion-intent:${sailor.id}`)).toBe('pending');
      expect(localStorage.getItem(`watchwatcher-deletion-intent:${sailor.id}`)).not.toContain('secret');
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

  it.each([
    { status: 403, code: 'REAUTHENTICATION_FAILED' },
    { status: 429, code: 'RATE_LIMITED' },
    { status: 422, code: 'VALIDATION_ERROR' },
    { status: 401, code: 'UNAUTHORIZED' },
  ])('removes a new intent after a definite rejection ($status)', async ({ status, code }) => {
    localStorage.setItem('watchwatcher-signed-out', 'true');
    const auth = new AuthStateService();
    auth.user.set(sailor);
    vi.spyOn(api, 'deleteAccount').mockRejectedValue(Object.assign(new Error('Rejected'), { status, code }));
    await expect(auth.deleteAccount(sailor.id, auth.accountGeneration, { type: 'password', password: 'wrong' })).rejects.toThrow();
    expect(auth.user()).toEqual(status === 401 ? null : sailor);
    expect(auth.unresolvedDeletions()).toEqual([]);
    expect(localStorage.getItem(`watchwatcher-deletion-intent:${sailor.id}`)).toBeNull();
  });

  it.each([
    { status: 403, code: 'REAUTHENTICATION_FAILED' },
    { status: 429, code: 'RATE_LIMITED' },
    { status: 422, code: 'VALIDATION_ERROR' },
    { status: 401, code: 'UNAUTHORIZED' },
  ])('retains an earlier ambiguous intent when a retry is rejected ($status)', async ({ status, code }) => {
    localStorage.setItem('watchwatcher-signed-out', 'true');
    localStorage.setItem(`watchwatcher-deletion-intent:${sailor.id}`, 'pending');
    const auth = new AuthStateService();
    auth.user.set(sailor);
    vi.spyOn(api, 'deleteAccount').mockRejectedValue(Object.assign(new Error('Rejected'), { status, code }));
    await expect(auth.deleteAccount(sailor.id, auth.accountGeneration, { type: 'password', password: 'wrong' })).rejects.toThrow();
    expect(auth.unresolvedDeletions()).toEqual([sailor.id]);
    expect(localStorage.getItem(`watchwatcher-deletion-intent:${sailor.id}`)).toBe('pending');
  });

  it('clears the current user and new intent for an expired bearer', async () => {
    localStorage.setItem('watchwatcher-signed-out', 'true');
    const auth = new AuthStateService();
    auth.user.set(sailor);
    vi.spyOn(api, 'deleteAccount').mockRejectedValue(Object.assign(new Error('Expired'), { status: 401, code: 'UNAUTHORIZED' }));
    await expect(auth.deleteAccount(sailor.id, auth.accountGeneration, { type: 'password', password: 'fresh' })).rejects.toThrow('Expired');
    expect(auth.user()).toBeNull();
    expect(auth.unresolvedDeletions()).toEqual([]);
    expect(localStorage.getItem('watchwatcher-signed-out')).toBe('true');
  });

  it('converts an intent after a confirmed deletion when storage recovers', async () => {
    localStorage.setItem('watchwatcher-signed-out', 'true');
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
    await vi.waitFor(() => expect(auth.cleanupPending()).toBe(true));
    expect(auth.unresolvedDeletions()).toEqual([sailor.id]);
    storage.mockRestore();
    await auth.retryLocalCleanup();
    expect(localStorage.getItem(`watchwatcher-deleted:${sailor.id}`)).toBe('done');
    expect(auth.unresolvedDeletions()).toEqual([]);
  });

  it('does not send a deletion request if the recovery intent cannot be stored', async () => {
    localStorage.setItem('watchwatcher-signed-out', 'true');
    const auth = new AuthStateService();
    auth.user.set(sailor);
    const deletion = vi.spyOn(api, 'deleteAccount');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
    await expect(auth.deleteAccount(sailor.id, auth.accountGeneration, { type: 'password', password: 'secret' })).rejects.toThrow('recovery notice');
    expect(deletion).not.toHaveBeenCalled();
    expect(auth.user()).toEqual(sailor);
  });

  it.each([false, true])('clears the old user without cancelling a pending login (login succeeds: %s)', async (succeeds) => {
    localStorage.setItem('watchwatcher-signed-out', 'true');
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
      expect(localStorage.getItem('watchwatcher-signed-out')).toBeNull();
    } else {
      failLogin(new Error('Invalid credentials'));
      await expect(login).rejects.toThrow('Invalid credentials');
      expect(auth.user()).toBeNull();
    }
  });

  it.each(['before', 'after'])('does not restore the same account when login completes %s deletion', async (timing) => {
    localStorage.setItem('watchwatcher-signed-out', 'true');
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
    expect(localStorage.getItem('watchwatcher-signed-out')).toBe('true');
  });

  it.each([false, true])('clears a refreshed deleted user without cancelling another login (succeeds: %s)', async (succeeds) => {
    localStorage.setItem('watchwatcher-signed-out', 'true');
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
    localStorage.setItem('watchwatcher-signed-out', 'true');
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

  it('retries pending cleanup on startup without restoring a signed-out user', async () => {
    localStorage.setItem('watchwatcher-signed-out', 'true');
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
    localStorage.setItem('watchwatcher-signed-out', 'true');
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
    expect(localStorage.getItem('watchwatcher-signed-out')).toBeNull();
  });
});