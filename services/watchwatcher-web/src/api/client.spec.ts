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
});