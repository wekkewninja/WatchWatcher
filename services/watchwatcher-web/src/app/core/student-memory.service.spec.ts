import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { AuthStateService } from './auth-state.service';
import { emptyProgressSnapshot, mergeProgressSnapshots, selectNextRuleExercise, StudentMemoryService, summarizeRuleExercise } from './student-memory.service';
import { StorageRepository } from './storage-repository.service';
import type { ColregsRule, ExamSession, ProgressSnapshot } from '../domain-types';

function rule(id: string, ruleNumber: string): ColregsRule {
  return {
    id,
    ruleNumber,
    title: ruleNumber,
    category: 'General',
    summary: 'Summary',
    keyPoints: ['Point one', 'Point two'],
    exercise: { prompt: 'Question', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answer: 'b', explanation: 'Why', remediation: 'Review' },
    keywords: [],
  };
}

function memoryFor(accountId: string): StudentMemoryService {
  const auth = { user: () => ({ id: accountId, name: accountId, email: `${accountId}@example.test` }) } as unknown as AuthStateService;
  return new StudentMemoryService(new StorageRepository(), auth);
}

describe('StudentMemoryService rule exercise progress', () => {
  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('watchwatcher-local');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Progress database deletion was blocked.'));
    });
  });

  afterEach(async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await api.logout();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('isolates guest attempts from account progress', async () => {
    const guest = new StudentMemoryService(new StorageRepository(), { user: () => null } as unknown as AuthStateService);
    await guest.recordRuleExerciseAttempt('rule-19', 'b', 'b');
    expect((await guest.loadProgress())?.ruleExerciseAttempts).toHaveLength(1);
    expect(await memoryFor('account-a').loadProgress()).toBeNull();
    await memoryFor('account-a').recordRuleExerciseAttempt('rule-5', 'a', 'b');
    expect((await guest.loadProgress())?.ruleExerciseAttempts.map((attempt) => attempt.ruleId)).toEqual(['rule-19']);
  });

  it('records attempts and isolates them by authenticated account', async () => {
    const firstAccount = memoryFor('account-a');
    await firstAccount.recordRuleExerciseAttempt('rule-19', 'a', 'b');
    await firstAccount.recordRuleExerciseAttempt('rule-19', 'b', 'b');

    const firstProgress = await firstAccount.loadProgress();
    const secondProgress = await memoryFor('account-b').loadProgress();

    expect(firstProgress?.ruleExerciseAttempts).toHaveLength(2);
    expect(summarizeRuleExercise('rule-19', firstProgress!).completed).toBe(true);
    expect(summarizeRuleExercise('rule-19', firstProgress!).mastery).toBe(50);
    expect(secondProgress).toBeNull();
  });

  it('keeps study progress in the local account after sync expiry and isolates account switches and logout', async () => {
    const accountA = { id: 'expiry-a', name: 'A', email: 'a@example.test' };
    const accountB = { id: 'expiry-b', name: 'B', email: 'b@example.test' };
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accountId: accountA.id, session: 'token-a', user: accountA }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Expired' } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accountId: accountB.id, session: 'token-b', user: accountB }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 })));
    const auth = new AuthStateService();
    await auth.initialization;
    await auth.login(accountA.email, 'password');
    const memory = new StudentMemoryService(new StorageRepository(), auth);
    await expect(memory.syncProgress()).rejects.toThrow();
    expect(auth.cloudAuth()).toBe('local');
    await memory.recordRuleExerciseAttempt('rule-a', 'a', 'b');
    expect((await new StorageRepository().loadProgress(accountA.id))?.ruleExerciseAttempts).toHaveLength(1);
    expect(await new StorageRepository().loadProgress('guest')).toBeNull();
    await expect(auth.deleteAccount(accountA.id, auth.accountGeneration, { type: 'password', password: 'password' })).rejects.toThrow('Sign in again');
    expect((await memory.loadProgress())?.ruleExerciseAttempts).toHaveLength(1);
    const reloaded = new AuthStateService();
    await reloaded.initialization;
    expect(reloaded.user()?.id).toBe(accountA.id);
    expect(reloaded.cloudAuth()).toBe('local');
    await auth.login(accountB.email, 'password');
    expect(await memory.loadProgress()).toBeNull();
    await auth.logout();
    expect(auth.user()).toBeNull();
    expect(await memory.loadProgress()).toBeNull();
    expect((await new StorageRepository().loadProgress(accountA.id))?.ruleExerciseAttempts).toHaveLength(1);
    expect(await new StorageRepository().loadProgress(accountB.id)).toBeNull();
  });

  it('keeps an in-flight attempt in the account that started it if the active account changes', async () => {
    let activeAccountId = 'account-a';
    let finishRead!: () => void;
    let markReadStarted!: () => void;
    const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve; });
    const finishReadGate = new Promise<void>((resolve) => { finishRead = resolve; });
    const savedOwners: string[] = [];
    const storage = {
      updateProgress: async (ownerId: string, update: (progress: ProgressSnapshot) => ProgressSnapshot) => {
        markReadStarted();
        await finishReadGate;
        savedOwners.push(ownerId);
        return update({ topicMastery: {}, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [] });
      },
      saveProgress: async (ownerId: string) => { savedOwners.push(ownerId); },
    } as unknown as StorageRepository;
    const auth = { user: () => ({ id: activeAccountId, name: activeAccountId, email: `${activeAccountId}@example.test` }) } as unknown as AuthStateService;
    const memory = new StudentMemoryService(storage, auth);

    const recording = memory.recordRuleExerciseAttempt('rule-19', 'b', 'b');
    await readStarted;
    activeAccountId = 'account-b';
    finishRead();
    await expect(recording).rejects.toThrow('Account changed while recording progress.');

    expect(savedOwners).toEqual(['account-a']);
  });

  it('does not merge or sync a delayed cloud snapshot after switching to guest', async () => {
    const owner = { id: 'sync-switch-owner', name: 'Sailor', email: 'sync@example.test' };
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ accountId: owner.id, session: 'sync-token', user: owner }))));
    await api.login({ email: owner.email, password: 'password' });
    let active: typeof owner | null = owner;
    const auth = { user: () => active, accountGeneration: 1 } as unknown as AuthStateService;
    const storage = new StorageRepository();
    const memory = new StudentMemoryService(storage, auth);
    let finish!: (snapshot: ProgressSnapshot) => void;
    vi.spyOn(api, 'getProgress').mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const sync = vi.spyOn(api, 'syncProgress');
    const pending = memory.syncProgress();
    active = null;
    (auth as unknown as { accountGeneration: number }).accountGeneration++;
    finish({ ...emptyProgressSnapshot(), topicMastery: { remote: 100 } });
    await expect(pending).rejects.toThrow('Account changed');
    expect(await storage.loadProgress(owner.id)).toBeNull();
    expect(await storage.loadProgress('guest')).toBeNull();
    expect(sync).not.toHaveBeenCalled();
  });

  it('does not write a delayed study attempt after a switch away and back to the same account', async () => {
    const owner = { id: 'study-switch-owner', name: 'Sailor', email: 'study@example.test' };
    const auth = { user: () => owner, accountGeneration: 1 } as unknown as AuthStateService;
    const storage = new StorageRepository();
    const update = storage.updateProgress.bind(storage);
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    vi.spyOn(storage, 'updateProgress').mockImplementation(async (id, apply) => { await gate; return update(id, apply); });
    const memory = new StudentMemoryService(storage, auth);
    const pending = memory.recordRuleExerciseAttempt('rule-19', 'b', 'b');
    (auth as unknown as { accountGeneration: number }).accountGeneration += 2;
    finish();
    await expect(pending).rejects.toThrow('Account changed');
    expect(await storage.loadProgress(owner.id)).toBeNull();
  });

  it('does not restore cloud progress when a delayed read finishes after local-only cleanup', async () => {
    const owner = { id: 'merge-cleanup', name: 'Sailor', email: 'merge@example.test' };
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ accountId: owner.id, session: 'token', user: owner }), { status: 200 })));
    await api.login({ email: owner.email, password: 'password' });
    const storage = new StorageRepository();
    const auth = { user: () => owner } as unknown as AuthStateService;
    const memory = new StudentMemoryService(storage, auth);
    let finishRead!: (snapshot: ProgressSnapshot) => void;
    vi.spyOn(api, 'getProgress').mockReturnValue(new Promise((resolve) => { finishRead = resolve; }));
    const sync = vi.spyOn(api, 'syncProgress');
    const loading = memory.loadAndMergeCloudProgress();
    localStorage.setItem(`watchwatcher-local-cleanup:${owner.id}`, 'pending');
    await storage.deleteAccountProgress(owner.id, true);
    finishRead({ topicMastery: { remote: 100 }, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [] });
    await expect(loading).resolves.toEqual(emptyProgressSnapshot());
    await expect(storage.loadProgress(owner.id)).resolves.toBeNull();
    expect(sync).not.toHaveBeenCalled();
  });

  it('merges offline events by unique ID without double-counting repeated sync snapshots', () => {
    const attempt = {
      id: '32f63760-6b39-4f06-935e-430251d1b785',
      ruleId: 'rule-5',
      selectedOptionId: 'b',
      correct: true,
      attemptedAt: '2026-11-22T12:00:00.000Z',
    };
    const local = { topicMastery: {}, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [attempt] };
    const remote = { ...local, ruleExerciseAttempts: [attempt, { ...attempt, id: '32f63760-6b39-4f06-935e-430251d1b786', correct: false }] };

    const merged = mergeProgressSnapshots(local, remote);

    expect(merged.ruleExerciseAttempts).toHaveLength(2);
    expect(summarizeRuleExercise('rule-5', merged)).toMatchObject({ attempts: 2, correctAttempts: 1, completed: true, mastery: 50 });
  });

  it('merges mastery conservatively, deduplicates weak spots and queue entries, and sorts events', () => {
    const local: ProgressSnapshot = {
      topicMastery: { local: 40, shared: 70 },
      weakSpotLog: [{ topicId: 'local', tag: 'late', timestamp: '2026-11-22T12:00:00.000Z' }],
      drillQueue: ['local', 'shared'],
      ruleExerciseAttempts: [{ id: 'later', ruleId: 'rule-5', selectedOptionId: 'a', correct: false, attemptedAt: '2026-11-22T12:00:00.000Z' }],
    };
    const remote: ProgressSnapshot = {
      topicMastery: { remote: 55, shared: 60 },
      weakSpotLog: [
        { topicId: 'local', tag: 'late', timestamp: '2026-11-22T12:00:00.000Z' },
        { topicId: 'remote', tag: 'early', timestamp: '2026-11-21T12:00:00.000Z' },
      ],
      drillQueue: ['shared', 'remote'],
      ruleExerciseAttempts: [{ id: 'earlier', ruleId: 'rule-19', selectedOptionId: 'b', correct: true, attemptedAt: '2026-11-20T12:00:00.000Z' }],
    };

    expect(mergeProgressSnapshots(local, remote)).toEqual({
      topicMastery: { local: 40, remote: 55, shared: 70 },
      weakSpotLog: [remote.weakSpotLog[1], local.weakSpotLog[0]],
      drillQueue: ['local', 'shared', 'remote'],
      ruleExerciseAttempts: [remote.ruleExerciseAttempts[0], local.ruleExerciseAttempts[0]],
      objectivePracticeAttempts: [],
      examSessions: [],
      deletedExamSessionIds: [],
      examHistoryDeletedAt: null,
    });
  });

  it('returns an empty exercise summary when no attempts exist', () => {
    expect(summarizeRuleExercise('rule-1', emptyProgressSnapshot())).toEqual({
      attempts: 0,
      correctAttempts: 0,
      completed: false,
      mastery: 0,
      lastAttemptAt: null,
    });
  });

  it('stores objective practice separately and prevents deleted exams returning from a merge', async () => {
    const account = memoryFor('account-a');
    const attempt = await account.recordObjectivePracticeAttempt({ questionId: 'topic-question', topicId: 'topic', objectiveIds: ['objective-a'], correct: true });
    const session: ExamSession = {
      id: '32f63760-6b39-4f06-935e-430251d1b785',
      startedAt: '2026-11-22T12:00:00.000Z',
      completedAt: '2026-11-22T12:05:00.000Z',
      questionResults: [{ questionId: 'exam-question', topicId: 'topic', objectiveIds: ['objective-b'], priority: 'critical', submittedAnswer: 'Answer', correct: true }],
      score: 100,
      passed: true,
      criticalGatePassed: true,
    };
    await account.recordExamSession(session);
    const deleted = await account.deleteExamHistory();
    const unseenRemoteSession = { ...session, id: '32f63760-6b39-4f06-935e-430251d1b786', completedAt: new Date(Date.parse(deleted?.examHistoryDeletedAt ?? '') - 1000).toISOString() };
    const merged = mergeProgressSnapshots(deleted!, { ...emptyProgressSnapshot(), examSessions: [session, unseenRemoteSession] });

    expect((await account.loadProgress())?.objectivePracticeAttempts).toEqual([attempt]);
    expect(deleted?.examSessions).toEqual([]);
    expect(deleted?.deletedExamSessionIds).toContain(session.id);
    expect(deleted?.examHistoryDeletedAt).toBeTruthy();
    expect(merged.examSessions).toEqual([]);
  });

  it('syncs an offline history clear without restoring unseen remote exams', async () => {
    const owner = { id: 'history-clear-owner', name: 'Sailor', email: 'clear@example.test' };
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ accountId: owner.id, session: 'clear-token', user: owner }), { status: 200 })));
    await api.login({ email: owner.email, password: 'a-valid-password' });
    const storage = new StorageRepository();
    const exam: ExamSession = {
      id: '32f63760-6b39-4f06-935e-430251d1b787',
      startedAt: new Date(Date.now() - 120000).toISOString(),
      completedAt: new Date(Date.now() - 60000).toISOString(),
      questionResults: [{ questionId: 'old-q', topicId: 'topic', objectiveIds: ['objective'], priority: 'critical', submittedAnswer: 'Answer', correct: true }],
      score: 100,
      passed: true,
      criticalGatePassed: true,
    };
    const clearAt = new Date().toISOString();
    await storage.saveProgress(owner.id, { ...emptyProgressSnapshot(), examHistoryDeletedAt: clearAt });
    vi.spyOn(api, 'getProgress').mockResolvedValue({ ...emptyProgressSnapshot(), examSessions: [exam] });
    const sync = vi.spyOn(api, 'syncProgress').mockResolvedValue({ revision: 2, syncedAt: new Date().toISOString() });
    const memory = new StudentMemoryService(storage, { user: () => owner, accountGeneration: 1 } as unknown as AuthStateService);

    const merged = await memory.loadAndMergeCloudProgress();

    expect(merged.examSessions).toEqual([]);
    expect(merged.examHistoryDeletedAt).toBe(clearAt);
    expect(sync).toHaveBeenCalledWith(expect.objectContaining({ examSessions: [], examHistoryDeletedAt: clearAt }));
  });

  it('merges remote exam history before a background exam save', async () => {
    const owner = { id: 'exam-merge-owner', name: 'Sailor', email: 'exam-merge@example.test' };
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ accountId: owner.id, session: 'exam-merge-token', user: owner }), { status: 200 })));
    await api.login({ email: owner.email, password: 'a-valid-password' });
    const remoteExam: ExamSession = {
      id: '32f63760-6b39-4f06-935e-430251d1b788', startedAt: '2026-11-25T10:00:00.000Z', completedAt: '2026-11-25T10:05:00.000Z',
      questionResults: [{ questionId: 'remote-q', topicId: 'topic', objectiveIds: ['remote-objective'], priority: 'critical', submittedAnswer: 'remote', correct: true }],
      score: 100, passed: true, criticalGatePassed: true,
    };
    const localExam: ExamSession = {
      id: '32f63760-6b39-4f06-935e-430251d1b789', startedAt: '2026-11-26T10:00:00.000Z', completedAt: '2026-11-26T10:05:00.000Z',
      questionResults: [{ questionId: 'local-q', topicId: 'topic', objectiveIds: ['local-objective'], priority: 'major', submittedAnswer: 'local', correct: true }],
      score: 100, passed: true, criticalGatePassed: true,
    };
    vi.spyOn(api, 'getProgress').mockResolvedValue({ ...emptyProgressSnapshot(), examSessions: [remoteExam] });
    const sync = vi.spyOn(api, 'syncProgress').mockResolvedValue({ revision: 2, syncedAt: new Date().toISOString() });
    const memory = new StudentMemoryService(new StorageRepository(), { user: () => owner, accountGeneration: 1 } as unknown as AuthStateService);

    await memory.recordExamSession(localExam);
    await vi.waitFor(() => expect(sync).toHaveBeenCalledOnce());

    expect(sync).toHaveBeenCalledWith(expect.objectContaining({ examSessions: expect.arrayContaining([remoteExam, localExam]) }));
  });

  it('loads local progress when cloud access is unavailable and rejects sync without a matching account', async () => {
    const account = memoryFor('account-a');
    const saved: ProgressSnapshot = { ...emptyProgressSnapshot(), topicMastery: { offline: 65 } };
    await new StorageRepository().saveProgress('account-a', saved);

    await expect(account.loadAndMergeCloudProgress()).resolves.toEqual(saved);
    await expect(memoryFor('guest').syncProgress()).rejects.toThrow('Sign in to synchronize');
  });

  it('merges cloud and local progress, then syncs local-only records', async () => {
    const account = memoryFor('account-a');
    await new StorageRepository().saveProgress('account-a', {
      ...emptyProgressSnapshot(),
      topicMastery: { local: 75 },
      drillQueue: ['local'],
    });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accountId: 'account-a', session: 'test-token', user: { id: 'account-a', name: 'Student', email: 'student@example.test' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accountId: 'account-a', topicMastery: { remote: 40 }, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [], revision: 1, syncedAt: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accountId: 'account-a', revision: 2, syncedAt: '2026-11-23T12:00:00.000Z' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await api.login({ email: 'student@example.test', password: 'a-valid-password' });

    await expect(account.loadAndMergeCloudProgress()).resolves.toMatchObject({
      topicMastery: { local: 75, remote: 40 },
      drillQueue: ['local'],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not lose simultaneous attempt writes in the same account', async () => {
    const account = memoryFor('account-a');
    await Promise.all(Array.from({ length: 8 }, (_, index) =>
      account.recordRuleExerciseAttempt('rule-19', index % 2 ? 'b' : 'a', 'b'),
    ));

    const progress = await account.loadProgress();
    expect(progress?.ruleExerciseAttempts).toHaveLength(8);
    expect(summarizeRuleExercise('rule-19', progress!).correctAttempts).toBe(4);
  });

  it('preserves local and cloud events when a revision-aware sync conflicts', async () => {
    const account = memoryFor('account-a');
    const localAttempt = { id: '32f63760-6b39-4f06-935e-430251d1b785', ruleId: 'rule-5', selectedOptionId: 'a', correct: false, attemptedAt: '2026-11-22T12:00:00.000Z' };
    const remoteAttempt = { id: '32f63760-6b39-4f06-935e-430251d1b786', ruleId: 'rule-5', selectedOptionId: 'b', correct: true, attemptedAt: '2026-11-22T12:01:00.000Z' };
    await new StorageRepository().saveProgress('account-a', { topicMastery: {}, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [localAttempt] });

    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accountId: 'account-a', session: 'test-token', user: { id: 'account-a', name: 'Student', email: 'student@example.test' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accountId: 'account-a', topicMastery: {}, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [remoteAttempt], revision: 1, syncedAt: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'CONFLICT', message: 'Progress changed on the server.' } }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    await api.login({ email: 'student@example.test', password: 'a-valid-password' });

    await expect(account.syncProgress()).rejects.toThrow('Progress changed on the server.');
    const saved = await account.loadProgress();
    expect(saved?.ruleExerciseAttempts.map((attempt) => attempt.id).sort()).toEqual([localAttempt.id, remoteAttempt.id].sort());
    const requestBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)) as { ruleExerciseAttempts: unknown[] };
    expect(requestBody.ruleExerciseAttempts).toHaveLength(2);
  });

  it('selects an unseen exercise first and revisits the weakest entry after all are complete', () => {
    const rules = [rule('rule-5', 'Rule 5'), rule('rule-19', 'Rule 19'), rule('rule-21', 'Rule 21')];
    const empty: ProgressSnapshot = { topicMastery: {}, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [] };
    const attempted = {
      id: '32f63760-6b39-4f06-935e-430251d1b785',
      ruleId: 'rule-5',
      selectedOptionId: 'a',
      correct: false,
      attemptedAt: '2026-11-22T12:00:00.000Z',
    };

    expect(selectNextRuleExercise(rules, { ...empty, ruleExerciseAttempts: [attempted] })?.id).toBe('rule-19');

    const allCompleted = {
      ...empty,
      ruleExerciseAttempts: [
        attempted,
        { ...attempted, id: '32f63760-6b39-4f06-935e-430251d1b786', correct: true },
        { ...attempted, id: '32f63760-6b39-4f06-935e-430251d1b787', ruleId: 'rule-19', correct: true },
        { ...attempted, id: '32f63760-6b39-4f06-935e-430251d1b788', ruleId: 'rule-21', correct: true },
      ],
    };
    expect(selectNextRuleExercise(rules, allCompleted)?.id).toBe('rule-5');
  });
});