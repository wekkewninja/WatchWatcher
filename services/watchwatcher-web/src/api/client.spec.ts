import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageRepository } from '../app/core/storage-repository.service';
import { liveClient } from './client';

describe('live API client sessions', () => {
  afterEach(async () => {
    await liveClient.logout();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps the session token in memory and sends it on authenticated requests', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        accountId: '4a3eea85-72f6-4f90-a045-cf8fc2d83ff4',
        session: 'memory-only-token',
        user: { id: '4a3eea85-72f6-4f90-a045-cf8fc2d83ff4', name: 'Student', email: 'student@example.test' },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        user: { id: '4a3eea85-72f6-4f90-a045-cf8fc2d83ff4', name: 'Student', email: 'student@example.test' },
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await liveClient.login({ email: 'student@example.test', password: 'a-valid-password' });
    await liveClient.getCurrentUser();

    const authenticatedHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/login');
    expect(authenticatedHeaders.get('Authorization')).toBe('Bearer memory-only-token');
    expect(localStorage.getItem('watchwatcher-session')).toBeNull();
  });

  it.each([
    { type: 'password' as const, password: 'fresh-password' },
    { type: 'google' as const, credential: 'fresh-credential', challengeId: 'challenge' },
  ])('deletes the authenticated account with fresh $type confirmation', async (reauthentication) => {
    const accountId = `delete-${reauthentication.type}`;
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accountId, session: 'token-a', user: { id: accountId, name: 'Sailor', email: 'a@example.test' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await liveClient.login({ email: 'a@example.test', password: 'password' });
    await liveClient.deleteAccount(accountId, reauthentication);
    const init = fetchMock.mock.calls[1]?.[1];
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/account');
    expect(init?.method).toBe('DELETE');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token-a');
    expect(JSON.parse(String(init?.body))).toEqual({ confirmation: 'DELETE', reauthentication });
    await expect(liveClient.getCurrentUser()).rejects.toThrow('Sign in');
  });

  it('does not clear a newer session when a deletion response arrives late', async () => {
    let finishDelete!: (response: Response) => void;
    const session = (id: string) => new Response(JSON.stringify({ accountId: id, session: `token-${id}`, user: { id, name: 'Sailor', email: `${id}@example.test` } }), { status: 200 });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(session('late-delete-a'))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { finishDelete = resolve; }))
      .mockResolvedValueOnce(session('b'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 'b', name: 'Sailor', email: 'b@example.test' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await liveClient.login({ email: 'a@example.test', password: 'password' });
    const deletion = liveClient.deleteAccount('late-delete-a', { type: 'password', password: 'password' });
    await liveClient.login({ email: 'b@example.test', password: 'password' });
    finishDelete(new Response(null, { status: 204 }));
    await deletion;
    await liveClient.getCurrentUser();
    expect(new Headers(fetchMock.mock.calls[3]?.[1]?.headers).get('Authorization')).toBe('Bearer token-b');
  });

  it.each([false, true])('clears the deleted token while a newer login is pending (login succeeds: %s)', async (succeeds) => {
    const accountId = `pending-login-${succeeds}`;
    let finishDelete!: (response: Response) => void;
    let finishLogin!: (response: Response) => void;
    const session = (id: string) => new Response(JSON.stringify({ accountId: id, session: `token-${id}`, user: { id, name: 'Sailor', email: `${id}@example.test` } }), { status: 200 });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(session(accountId))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { finishDelete = resolve; }))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { finishLogin = resolve; }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 'b', name: 'Sailor', email: 'b@example.test' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await liveClient.login({ email: 'a@example.test', password: 'password' });
    const deletion = liveClient.deleteAccount(accountId, { type: 'password', password: 'password' });
    const login = liveClient.login({ email: 'b@example.test', password: 'password' });
    finishDelete(new Response(null, { status: 204 }));
    await deletion;
    await expect(liveClient.getCurrentUser()).rejects.toThrow('Sign in');
    finishLogin(succeeds ? session('b') : new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Invalid credentials.' } }), { status: 401 }));
    if (succeeds) {
      await expect(login).resolves.toMatchObject({ id: 'b' });
      await liveClient.getCurrentUser();
      expect(new Headers(fetchMock.mock.calls[3]?.[1]?.headers).get('Authorization')).toBe('Bearer token-b');
    } else {
      await expect(login).rejects.toThrow('Invalid credentials.');
      await expect(liveClient.getCurrentUser()).rejects.toThrow('Sign in');
    }
  });

  it.each(['before', 'after'])('rejects a same-account session completed %s deletion', async (timing) => {
    const accountId = `same-account-${timing}`;
    let finishDelete!: (response: Response) => void;
    let finishLogin!: (response: Response) => void;
    const session = (token: string) => new Response(JSON.stringify({ accountId, session: token, user: { id: accountId, name: 'Sailor', email: 'a@example.test' } }), { status: 200 });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(session('old-token'))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { finishDelete = resolve; }))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { finishLogin = resolve; })));
    await liveClient.login({ email: 'a@example.test', password: 'password' });
    const deleting = liveClient.deleteAccount(accountId, { type: 'password', password: 'password' });
    const login = liveClient.login({ email: 'a@example.test', password: 'password' });
    if (timing === 'before') {
      finishLogin(session('new-token'));
      await login;
    }
    finishDelete(new Response(null, { status: 204 }));
    await deleting;
    if (timing === 'after') {
      finishLogin(session('new-token'));
      await expect(login).rejects.toThrow('deleted');
    }
    await expect(liveClient.getCurrentUser()).rejects.toThrow('Sign in');
  });

  it.each([false, true])('clears a refreshed deleted session without cancelling another account login (succeeds: %s)', async (succeeds) => {
    const accountId = `refreshed-${succeeds}`;
    let finishDelete!: (response: Response) => void;
    let finishLogin!: (response: Response) => void;
    const session = (id: string, token: string) => new Response(JSON.stringify({ accountId: id, session: token, user: { id, name: 'Sailor', email: `${id}@example.test` } }), { status: 200 });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(session(accountId, 'old-token'))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { finishDelete = resolve; }))
      .mockResolvedValueOnce(session(accountId, 'new-token'))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { finishLogin = resolve; })));
    await liveClient.login({ email: 'a@example.test', password: 'password' });
    const deleting = liveClient.deleteAccount(accountId, { type: 'password', password: 'password' });
    await liveClient.login({ email: 'a@example.test', password: 'password' });
    const login = liveClient.login({ email: 'b@example.test', password: 'password' });
    finishDelete(new Response(null, { status: 204 }));
    await deleting;
    await expect(liveClient.getCurrentUser()).rejects.toThrow('Sign in');
    finishLogin(succeeds ? session('other', 'other-token') : new Response(JSON.stringify({ error: { message: 'Invalid credentials.' } }), { status: 401 }));
    if (succeeds) await expect(login).resolves.toMatchObject({ id: 'other' });
    else {
      await expect(login).rejects.toThrow('Invalid credentials.');
      await expect(liveClient.getCurrentUser()).rejects.toThrow('Sign in');
    }
  });

  it.each(['pending', 'done'])('rejects a session with a persisted %s deletion marker', async (marker) => {
    const accountId = `persisted-${marker}`;
    localStorage.setItem(`watchwatcher-deleted:${accountId}`, marker);
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ accountId, session: 'token', user: { id: accountId, name: 'Sailor', email: 'a@example.test' } }), { status: 200 })));
    try {
      await expect(liveClient.login({ email: 'a@example.test', password: 'password' })).rejects.toThrow('deleted');
    } finally {
      localStorage.removeItem(`watchwatcher-deleted:${accountId}`);
    }
  });

  it('does not accept a session when local deletion status cannot be checked', async () => {
    vi.spyOn(StorageRepository.prototype, 'isAccountDeleted').mockRejectedValue(new Error('IndexedDB unavailable'));
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      accountId: 'unavailable', session: 'token', user: { id: 'unavailable', name: 'Sailor', email: 'a@example.test' },
    }), { status: 200 })));
    await expect(liveClient.login({ email: 'a@example.test', password: 'password' })).rejects.toThrow('Local account status is unavailable.');
    await expect(liveClient.getCurrentUser()).rejects.toThrow('Sign in');
  });

  it('rechecks confirmed deletions after an in-flight tombstone read', async () => {
    const accountId = 'tombstone-read-race';
    let finishDelete!: (response: Response) => void;
    let finishRead!: (deleted: boolean) => void;
    const session = new Response(JSON.stringify({ accountId, session: 'token', user: { id: accountId, name: 'Sailor', email: 'a@example.test' } }), { status: 200 });
    vi.stubGlobal('indexedDB', {});
    vi.spyOn(StorageRepository.prototype, 'isAccountDeleted').mockResolvedValueOnce(false)
      .mockReturnValueOnce(new Promise<boolean>((resolve) => { finishRead = resolve; }));
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(session.clone())
      .mockReturnValueOnce(new Promise<Response>((resolve) => { finishDelete = resolve; }))
      .mockResolvedValueOnce(session.clone()));
    await liveClient.login({ email: 'a@example.test', password: 'password' });
    const deleting = liveClient.deleteAccount(accountId, { type: 'password', password: 'password' });
    const login = liveClient.login({ email: 'a@example.test', password: 'password' });
    await vi.waitFor(() => expect(finishRead).toBeDefined());
    finishDelete(new Response(null, { status: 204 }));
    await deleting;
    finishRead(false);
    await expect(login).rejects.toThrow('deleted');
    await expect(liveClient.getCurrentUser()).rejects.toThrow('Sign in');
  });

  it.each([403, 401])('preserves the token only for deletion reauthentication failure (%s)', async (status) => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accountId: 'a', session: 'token-a', user: { id: 'a', name: 'Sailor', email: 'a@example.test' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: status === 403 ? 'REAUTHENTICATION_FAILED' : 'UNAUTHORIZED', message: 'Rejected' } }), { status }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 'a', name: 'Sailor', email: 'a@example.test' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await liveClient.login({ email: 'a@example.test', password: 'password' });
    await expect(liveClient.deleteAccount('a', { type: 'password', password: 'wrong' })).rejects.toMatchObject({ status });
    if (status === 403) {
      await liveClient.getCurrentUser();
      expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get('Authorization')).toBe('Bearer token-a');
    } else await expect(liveClient.getCurrentUser()).rejects.toThrow('Sign in');
  });

  it('does not replace a newer session with an older sign-in response', async () => {
    let finishFirstLogin!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => { finishFirstLogin = resolve; });
    const loginResponse = (id: string, token: string) => new Response(JSON.stringify({
      accountId: id, session: token, user: { id, name: 'Student', email: `${id}@example.test` },
    }), { status: 200 });
    const fetchMock = vi.fn<typeof fetch>()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(loginResponse('account-b', 'token-b'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 'account-b', name: 'Student', email: 'account-b@example.test' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const firstLogin = liveClient.login({ email: 'a@example.test', password: 'a-valid-password' });
    await liveClient.login({ email: 'b@example.test', password: 'a-valid-password' });
    finishFirstLogin(loginResponse('account-a', 'token-a'));

    await expect(firstLogin).rejects.toThrow();
    await liveClient.getCurrentUser();
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get('Authorization')).toBe('Bearer token-b');
  });

  it('does not restore a session from a sign-in response received after logout', async () => {
    let finishLogin!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockReturnValue(new Promise<Response>((resolve) => { finishLogin = resolve; })));

    const login = liveClient.login({ email: 'a@example.test', password: 'a-valid-password' });
    await liveClient.logout();
    finishLogin(new Response(JSON.stringify({
      accountId: 'account-a', session: 'token-a', user: { id: 'account-a', name: 'Student', email: 'a@example.test' },
    }), { status: 200 }));

    await expect(login).rejects.toThrow();
    await expect(liveClient.getCurrentUser()).rejects.toThrow('Sign in to use account services.');
  });

  it.each(['register', 'google'])('rejects a stale %s response after another login', async (method) => {
    let finishFirst!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>()
      .mockReturnValueOnce(new Promise<Response>((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        accountId: 'account-b', session: 'token-b', user: { id: 'account-b', name: 'Student', email: 'b@example.test' },
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const first = method === 'register'
      ? liveClient.createAccount({ name: 'Student', email: 'a@example.test', password: 'a-valid-password' })
      : liveClient.googleSignIn({ credential: 'credential', challengeId: 'challenge' });
    await liveClient.login({ email: 'b@example.test', password: 'a-valid-password' });
    finishFirst(new Response(JSON.stringify({
      accountId: 'account-a', session: 'token-a', user: { id: 'account-a', name: 'Student', email: 'a@example.test' },
    }), { status: 200 }));

    await expect(first).rejects.toThrow('Sign-in was superseded by another account change.');
  });

  it('does not send an in-flight progress snapshot with a different account session', async () => {
    const accountA = '4a3eea85-72f6-4f90-a045-cf8fc2d83ff4';
    const accountB = '5b4ffb96-83a7-4f01-b156-d0fd3e94a885';
    let finishProgressRead!: (response: Response) => void;
    const pendingProgress = new Promise<Response>((resolve) => { finishProgressRead = resolve; });
    const loginResponse = (id: string, token: string) => new Response(JSON.stringify({ accountId: id, session: token, user: { id, name: 'Student', email: `${id}@example.test` } }), { status: 200 });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(loginResponse(accountA, 'account-a-token'))
      .mockReturnValueOnce(pendingProgress)
      .mockResolvedValueOnce(loginResponse(accountB, 'account-b-token'));
    vi.stubGlobal('fetch', fetchMock);

    await liveClient.login({ email: `${accountA}@example.test`, password: 'a-valid-password' });
    const syncing = liveClient.syncProgress({ topicMastery: {}, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await liveClient.login({ email: `${accountB}@example.test`, password: 'a-valid-password' });
    finishProgressRead(new Response(JSON.stringify({
      accountId: accountA,
      topicMastery: {},
      weakSpotLog: [],
      drillQueue: [],
      ruleExerciseAttempts: [],
      revision: 1,
      syncedAt: null,
    }), { status: 200 }));

    await expect(syncing).rejects.toThrow('Account changed while an API request was in progress.');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('accepts a verified Google session and returns an explicit account-link state', async () => {
    const accountId = '4a3eea85-72f6-4f90-a045-cf8fc2d83ff4';
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        accountId,
        session: 'google-session-token',
        user: { id: accountId, name: 'Google Student', email: 'google@example.test' },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          code: 'CONFLICT',
          message: 'A password account already uses this verified Google email.',
          details: { reason: 'GOOGLE_ACCOUNT_LINK_REQUIRED' },
        },
      }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(liveClient.googleSignIn({ credential: 'signed-google-id-token', challengeId: '4a3eea85-72f6-4f90-a045-cf8fc2d83ff4' }))
      .resolves.toEqual({ kind: 'authenticated', user: { id: accountId, name: 'Google Student', email: 'google@example.test' } });
    await expect(liveClient.googleSignIn({ credential: 'another-signed-token', challengeId: '5b4ffb96-83a7-4f01-b156-d0fd3e94a885' }))
      .resolves.toEqual({ kind: 'link-required' });
  });
});