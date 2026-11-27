import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageRepository } from '../app/core/storage-repository.service';
import type { OnlineEvaluationRequest } from '@watchwatcher/shared/types';
import { canConfirmDeletion, confirmDeletionReceipt, liveClient, logoutAccountSession } from './client';

describe('live API client sessions', () => {
  it('retains objective evidence and exam deletion metadata from cloud progress', async () => {
    const accountId = '4a3eea85-72f6-4f90-a045-cf8fc2d83ff4';
    const attempt = { id: '32f63760-6b39-4f06-935e-430251d1b785', questionId: 'question-1', topicId: 'topic-1', objectiveIds: ['objective-1'], correct: true, attemptedAt: '2026-11-27T12:00:00.000Z' };
    const exam = {
      id: '5b4ffb96-83a7-4f01-b156-d0fd3e94a885', startedAt: '2026-11-27T12:00:00.000Z', completedAt: '2026-11-27T12:05:00.000Z',
      questionResults: [{ questionId: 'question-1', topicId: 'topic-1', objectiveIds: ['objective-1'], priority: 'critical', submittedAnswer: 'Answer', correct: true }],
      score: 100, passed: true, criticalGatePassed: true,
    };
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accountId, session: 'progress-token', user: { id: accountId, name: 'Student', email: 'student@example.test' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        accountId, topicMastery: {}, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [],
        objectivePracticeAttempts: [attempt], examSessions: [exam], deletedExamSessionIds: [exam.id],
        examHistoryDeletedAt: '2026-11-27T12:06:00.000Z', revision: 3, syncedAt: null,
      }), { status: 200 })));
    await liveClient.login({ email: 'student@example.test', password: 'a-valid-password' });

    await expect(liveClient.getProgress()).resolves.toMatchObject({
      objectivePracticeAttempts: [attempt], examSessions: [exam], deletedExamSessionIds: [exam.id], examHistoryDeletedAt: '2026-11-27T12:06:00.000Z',
    });
  });

  it('exposes a bounded retry delay from rate-limit responses', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many requests.' } }), {
      status: 429, headers: { 'Retry-After': '73' },
    })));
    await expect(liveClient.login({ email: 'a@example.test', password: 'valid-password' })).rejects.toMatchObject({ status: 429, retryAfterSeconds: 73 });
  });

  it('confirms a lost deletion response after a separate 401 without restoring API access', async () => {
    const accountId = 'receipt-lost';
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accountId, session: 'receipt-secret', user: { id: accountId, name: 'Sailor', email: 'receipt@example.test' } })))
      .mockRejectedValueOnce(new TypeError('response lost'))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await liveClient.login({ email: 'receipt@example.test', password: 'password' });
    await expect(liveClient.deleteAccount(accountId, { type: 'password', password: 'fresh' })).rejects.toThrow('response lost');
    await expect(liveClient.getCurrentUser()).rejects.toThrow();
    await expect(liveClient.getProgress()).rejects.toThrow('Sign in');
    await expect(confirmDeletionReceipt('other-account')).rejects.toThrow();
    expect(canConfirmDeletion(accountId)).toBe(true);
    expect(JSON.stringify(localStorage)).not.toContain('receipt-secret');
    expect(JSON.stringify(sessionStorage)).not.toContain('receipt-secret');
    await confirmDeletionReceipt(accountId);
    expect(fetchMock.mock.calls[3][0]).toBe('/api/account');
    expect(fetchMock.mock.calls[3][1]?.method).toBe('DELETE');
    expect(new Headers(fetchMock.mock.calls[3][1]?.headers).get('Authorization')).toBe('Bearer receipt-secret');
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).toEqual({ confirmation: 'DELETE', receiptOnly: true });
    expect(canConfirmDeletion(accountId)).toBe(false);
  });

  it('retains the initiating session when another request returns 401 before the DELETE response is lost', async () => {
    const accountId = 'receipt-race';
    let failDelete!: (error: Error) => void;
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accountId, session: 'race-token', user: { id: accountId, name: 'Sailor', email: 'a@example.test' } })))
      .mockReturnValueOnce(new Promise<Response>((_, reject) => { failDelete = reject; }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await liveClient.login({ email: 'a@example.test', password: 'password' });
    const deleting = liveClient.deleteAccount(accountId, { type: 'password', password: 'fresh' });
    await expect(liveClient.getCurrentUser()).rejects.toThrow();
    failDelete(new TypeError('response lost'));
    await expect(deleting).rejects.toThrow('response lost');
    await expect(confirmDeletionReceipt(accountId)).resolves.toBeUndefined();
  });

  it('does not recreate a retry capability when a pending DELETE fails after logout', async () => {
    const accountId = 'retry-logout-race';
    let failDelete!: (error: Error) => void;
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accountId, session: 'race-token', user: { id: accountId, name: 'Sailor', email: 'a@example.test' } })))
      .mockReturnValueOnce(new Promise<Response>((_, reject) => { failDelete = reject; }))
      .mockResolvedValueOnce(new Response(null, { status: 204 })));
    await liveClient.login({ email: 'a@example.test', password: 'password' });
    const deleting = liveClient.deleteAccount(accountId, { type: 'password', password: 'fresh' });
    await liveClient.logout();
    failDelete(new TypeError('response lost'));
    await expect(deleting).rejects.toThrow('response lost');
    expect(canConfirmDeletion(accountId)).toBe(false);
  });

  it.each([204, 503])('does not recreate a retry after account cleanup and remote logout status %s', async (status) => {
    const accountId = `cleanup-race-${status}`;
    let failDelete!: (error: Error) => void;
    const session = (id: string) => new Response(JSON.stringify({ accountId: id, session: `token-${id}`, user: { id, name: 'Sailor', email: 'a@example.test' } }));
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(session(accountId))
      .mockReturnValueOnce(new Promise<Response>((_, reject) => { failDelete = reject; }))
      .mockResolvedValueOnce(new Response(null, { status })));
    await liveClient.login({ email: 'a@example.test', password: 'password' });
    const deleting = liveClient.deleteAccount(accountId, { type: 'password', password: 'fresh' });
    const cleanup = logoutAccountSession(accountId);
    if (status === 204) await expect(cleanup).resolves.toBeUndefined();
    else await expect(cleanup).rejects.toThrow('could not be confirmed');
    failDelete(new TypeError('response lost'));
    await expect(deleting).rejects.toThrow('response lost');
    expect(canConfirmDeletion(accountId)).toBe(false);
    expect(canConfirmDeletion('cleanup-other')).toBe(false);
  });

  it('lets a pending sign-in to another account finish after account-specific cleanup', async () => {
    let finishLogin!: (response: Response) => void;
    const session = (id: string) => new Response(JSON.stringify({ accountId: id, session: `token-${id}`, user: { id, name: 'Sailor', email: 'a@example.test' } }));
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(session('cleanup-owner'))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { finishLogin = resolve; }))
      .mockResolvedValueOnce(new Response(null, { status: 204 })));
    await liveClient.login({ email: 'a@example.test', password: 'password' });
    const login = liveClient.login({ email: 'other@example.test', password: 'password' });
    await logoutAccountSession('cleanup-owner');
    finishLogin(session('cleanup-new-owner'));
    await expect(login).resolves.toMatchObject({ id: 'cleanup-new-owner' });
  });

  it('does not cancel another account retry when cleaning up a different account', async () => {
    const accountId = 'retry-isolated';
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accountId, session: 'isolated-token', user: { id: accountId, name: 'Sailor', email: 'a@example.test' } })))
      .mockRejectedValueOnce(new TypeError('response lost')));
    await liveClient.login({ email: 'a@example.test', password: 'password' });
    await expect(liveClient.deleteAccount(accountId, { type: 'password', password: 'fresh' })).rejects.toThrow('response lost');
    await logoutAccountSession('different-account');
    expect(canConfirmDeletion(accountId)).toBe(true);
    expect(canConfirmDeletion('different-account')).toBe(false);
  });

  it('invalidates a pending deletion after a 401 has already cleared its active session', async () => {
    const accountId = 'cleanup-after-401';
    let failDelete!: (error: Error) => void;
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accountId, session: 'expired-token', user: { id: accountId, name: 'Sailor', email: 'a@example.test' } })))
      .mockReturnValueOnce(new Promise<Response>((_, reject) => { failDelete = reject; }))
      .mockResolvedValueOnce(new Response(null, { status: 401 })));
    await liveClient.login({ email: 'a@example.test', password: 'password' });
    const deleting = liveClient.deleteAccount(accountId, { type: 'password', password: 'fresh' });
    await expect(liveClient.getCurrentUser()).rejects.toThrow();
    await logoutAccountSession(accountId);
    failDelete(new TypeError('response lost'));
    await expect(deleting).rejects.toThrow('response lost');
    expect(canConfirmDeletion(accountId)).toBe(false);
  });

  it('does not cancel a pending deletion when cleaning up a different account', async () => {
    const accountId = 'pending-isolated';
    let failDelete!: (error: Error) => void;
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accountId, session: 'pending-token', user: { id: accountId, name: 'Sailor', email: 'a@example.test' } })))
      .mockReturnValueOnce(new Promise<Response>((_, reject) => { failDelete = reject; })));
    await liveClient.login({ email: 'a@example.test', password: 'password' });
    const deleting = liveClient.deleteAccount(accountId, { type: 'password', password: 'fresh' });
    await logoutAccountSession('different-account');
    failDelete(new TypeError('response lost'));
    await expect(deleting).rejects.toThrow('response lost');
    expect(canConfirmDeletion(accountId)).toBe(true);
    expect(canConfirmDeletion('different-account')).toBe(false);
  });

  it('does not recreate a pending deletion retry after switching accounts', async () => {
    let failDelete!: (error: Error) => void;
    const session = (id: string) => new Response(JSON.stringify({ accountId: id, session: `token-${id}`, user: { id, name: 'Sailor', email: 'a@example.test' } }));
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(session('switch-old'))
      .mockReturnValueOnce(new Promise<Response>((_, reject) => { failDelete = reject; }))
      .mockResolvedValueOnce(session('switch-new')));
    await liveClient.login({ email: 'old@example.test', password: 'password' });
    const deleting = liveClient.deleteAccount('switch-old', { type: 'password', password: 'fresh' });
    await liveClient.login({ email: 'new@example.test', password: 'password' });
    failDelete(new TypeError('response lost'));
    await expect(deleting).rejects.toThrow('response lost');
    expect(canConfirmDeletion('switch-old')).toBe(false);
    expect(canConfirmDeletion('switch-new')).toBe(false);
  });

  it.each(['logout', 'expiry', 'account switch'])('discards ambiguous receipt capability on %s', async (transition) => {
    const accountId = `retry-${transition}`;
    const session = (id: string) => new Response(JSON.stringify({ accountId: id, session: `token-${id}`, user: { id, name: 'Sailor', email: 'sailor@example.test' } }));
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(session(accountId))
      .mockRejectedValueOnce(new TypeError('response lost'))
      .mockResolvedValueOnce(transition === 'account switch' ? session('new-owner') : new Response(null, { status: 204 })));
    await liveClient.login({ email: 'sailor@example.test', password: 'password' });
    await expect(liveClient.deleteAccount(accountId, { type: 'password', password: 'fresh' })).rejects.toThrow();
    expect(canConfirmDeletion(accountId)).toBe(true);
    if (transition === 'logout') await liveClient.logout();
    if (transition === 'account switch') await liveClient.login({ email: 'new@example.test', password: 'password' });
    if (transition === 'expiry') {
      vi.useFakeTimers();
      vi.advanceTimersByTime(2 * 60 * 1000);
    }
    expect(canConfirmDeletion(accountId)).toBe(false);
    await expect(confirmDeletionReceipt(accountId)).rejects.toThrow('no longer available');
  });

  it('does not retain a capability for a definite reauthentication failure', async () => {
    const accountId = 'retry-definite';
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accountId, session: 'token', user: { id: accountId, name: 'Sailor', email: 'a@example.test' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'REAUTHENTICATION_FAILED', message: 'Rejected' } }), { status: 403 })));
    await liveClient.login({ email: 'a@example.test', password: 'password' });
    await expect(liveClient.deleteAccount(accountId, { type: 'password', password: 'wrong' })).rejects.toThrow();
    expect(canConfirmDeletion(accountId)).toBe(false);
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await liveClient.logout();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('only sends an explicitly consented evaluation and excludes extra fields', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accountId: 'evaluation-a', session: 'token-a', user: { id: 'evaluation-a', name: 'Sailor', email: 'a@example.test' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ score: 0.9, feedback: 'Synthetic', misconceptionTag: null, followUpDrill: 'Review', source: 'online', criticalFailure: false, criticalFailureReason: null })));
    vi.stubGlobal('fetch', fetchMock);
    await liveClient.login({ email: 'a@example.test', password: 'password' });
    const legacy = { topicId: 'rule-5', context: 'Synthetic context', answer: 'Synthetic answer' };
    await expect(liveClient.evaluateAnswer(legacy as OnlineEvaluationRequest)).rejects.toThrow('explicit consent');
    await expect(liveClient.evaluateAnswer({ ...legacy, onlineConsent: false } as unknown as OnlineEvaluationRequest)).rejects.toThrow('explicit consent');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const input = { ...legacy, onlineConsent: true as const, accountId: 'synthetic-account', progress: 'synthetic-progress' };
    await expect(liveClient.evaluateAnswer(input)).resolves.toMatchObject({ source: 'online' });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/exam/evaluate');
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ ...legacy, onlineConsent: true });
  });

  it('discards an evaluation response after the account changes', async () => {
    let finish!: (response: Response) => void;
    const session = (id: string) => new Response(JSON.stringify({ accountId: id, session: `token-${id}`, user: { id, name: 'Sailor', email: `${id}@example.test` } }));
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(session('eval-a'))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce(session('eval-b'));
    vi.stubGlobal('fetch', fetchMock);
    await liveClient.login({ email: 'a@example.test', password: 'password' });
    const pending = liveClient.evaluateAnswer({ topicId: 'rule-5', context: 'Synthetic', answer: 'Synthetic', onlineConsent: true });
    await liveClient.login({ email: 'b@example.test', password: 'password' });
    finish(new Response(JSON.stringify({ score: 0.9, feedback: 'Synthetic', misconceptionTag: null, followUpDrill: 'Review', source: 'online' })));
    await expect(pending).rejects.toThrow('Account changed');
  });

  it('discards an in-flight AI response after switching to guest', async () => {
    let finish!: (response: Response) => void;
    const accountId = 'guest-ai-owner';
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accountId, session: 'ai-token', user: { id: accountId, name: 'Sailor', email: 'a@example.test' } })))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce(new Response(null, { status: 204 })));
    await liveClient.login({ email: 'a@example.test', password: 'password' });
    const pending = liveClient.evaluateAnswer({ topicId: 'rule-5', context: 'Synthetic', answer: 'Synthetic', onlineConsent: true });
    await liveClient.logout();
    finish(new Response(JSON.stringify({ score: 0.9, feedback: 'Synthetic', misconceptionTag: null, followUpDrill: 'Review', source: 'online', criticalFailure: false, criticalFailureReason: null })));
    await expect(pending).rejects.toThrow('Account changed');
  });

  it('rejects oversized answers and invalid safety contracts without treating them as passes', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accountId: 'evaluation-a', session: 'token-a', user: { id: 'evaluation-a', name: 'Sailor', email: 'a@example.test' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ score: 0.99, feedback: 'Synthetic', misconceptionTag: null, followUpDrill: 'Review', source: 'online', criticalFailure: null, criticalFailureReason: null })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ score: 0.99, feedback: 'Synthetic', misconceptionTag: 'unsafe', followUpDrill: 'Review', source: 'online', criticalFailure: true, criticalFailureReason: 'Unsafe action.' })));
    vi.stubGlobal('fetch', fetchMock);
    await liveClient.login({ email: 'a@example.test', password: 'password' });
    const input = { topicId: 'rule-5', context: 'Synthetic', answer: 'Synthetic', onlineConsent: true as const };
    await expect(liveClient.evaluateAnswer({ ...input, answer: 'x'.repeat(12001) })).rejects.toThrow('12,000');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(liveClient.evaluateAnswer(input)).rejects.toThrow('invalid evaluation');
    await expect(liveClient.evaluateAnswer(input)).resolves.toMatchObject({ passed: false, criticalFailure: true });
  });

  it('clears immediately and revokes the captured token without clearing a newer login', async () => {
    let finishLogout!: (response: Response) => void;
    const session = (id: string) => new Response(JSON.stringify({ accountId: id, session: `token-${id}`, user: { id, name: 'Sailor', email: `${id}@example.test` } }), { status: 200 });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(session('logout-a'))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { finishLogout = resolve; }))
      .mockResolvedValueOnce(session('logout-b'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 'logout-b', name: 'Sailor', email: 'logout-b@example.test' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await liveClient.login({ email: 'a@example.test', password: 'password' });
    const logout = liveClient.logout();
    await expect(liveClient.getCurrentUser()).rejects.toThrow('Sign in');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/logout');
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('Authorization')).toBe('Bearer token-logout-a');
    await liveClient.login({ email: 'b@example.test', password: 'password' });
    finishLogout(new Response(null, { status: 204 }));
    await logout;
    await expect(liveClient.getCurrentUser()).resolves.toMatchObject({ id: 'logout-b' });
    expect(new Headers(fetchMock.mock.calls[3][1]?.headers).get('Authorization')).toBe('Bearer token-logout-b');
    expect(JSON.stringify(localStorage)).not.toContain('token-logout-a');
  });

  it('does not send an offline logout and clears the token', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ accountId: 'offline', session: 'offline-token', user: { id: 'offline', name: 'Sailor', email: 'offline@example.test' } })));
    vi.stubGlobal('fetch', fetchMock);
    await liveClient.login({ email: 'offline@example.test', password: 'password' });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await expect(liveClient.logout()).rejects.toThrow('could not be confirmed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(liveClient.getCurrentUser()).rejects.toThrow('Sign in');
  });

  it.each(['failure', 'unexpected-success', 'timeout'])('clears the token when remote logout has a %s', async (outcome) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ accountId: 'failure', session: 'failure-token', user: { id: 'failure', name: 'Sailor', email: 'failure@example.test' } })));
    fetchMock.mockImplementationOnce(() => outcome === 'timeout' ? new Promise<Response>(() => {}) : Promise.resolve(new Response(null, { status: outcome === 'failure' ? 503 : 200 })));
    vi.stubGlobal('fetch', fetchMock);
    await liveClient.login({ email: 'failure@example.test', password: 'password' });
    vi.useFakeTimers();
    const logout = liveClient.logout();
    const rejection = expect(logout).rejects.toThrow();
    if (outcome === 'timeout') await vi.advanceTimersByTimeAsync(5000);
    await rejection;
    await expect(liveClient.getCurrentUser()).rejects.toThrow('Sign in');
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

  it('rejects a valid session after local-only cleanup with a recovery path and without keeping its token', async () => {
    const accountId = 'local-only-login';
    localStorage.setItem(`watchwatcher-local-cleanup:${accountId}`, 'done');
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      accountId, session: 'local-only-secret', user: { id: accountId, name: 'Sailor', email: 'a@example.test' },
    }), { status: 200 })));
    try {
      await expect(liveClient.login({ email: 'a@example.test', password: 'password' })).rejects.toThrow('separate browser profile');
      await expect(liveClient.getCurrentUser()).rejects.toThrow('Sign in');
      expect(JSON.stringify(localStorage)).not.toContain('local-only-secret');
      expect(JSON.stringify(sessionStorage)).not.toContain('local-only-secret');
    } finally {
      localStorage.removeItem(`watchwatcher-local-cleanup:${accountId}`);
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