import { afterEach, describe, expect, it, vi } from 'vitest';
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