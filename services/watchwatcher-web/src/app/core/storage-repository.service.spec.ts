import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { AuthStateService } from './auth-state.service';
import { StorageRepository } from './storage-repository.service';

describe('StorageRepository', () => {
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

  it('isolates local progress by account', async () => {
    const repository = new StorageRepository();
    const firstAccount = {
      topicMastery: { 'rule-19': 72 },
      weakSpotLog: [{ topicId: 'rule-19', tag: 'late-action', timestamp: '2026-11-18T09:30:00.000Z' }],
      drillQueue: ['colregs_rule_19'],
      ruleExerciseAttempts: [],
    };
    const secondAccount = { topicMastery: {}, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [] };

    await repository.saveProgress('account-a', firstAccount);
    await repository.saveProgress('account-b', secondAccount);

    await expect(repository.loadProgress('account-a')).resolves.toEqual(firstAccount);
    await expect(repository.loadProgress('account-b')).resolves.toEqual(secondAccount);
    await expect(repository.loadProgress('guest')).resolves.toBeNull();
  });

  it('tombstones deleted owners and rejects stale writes without affecting other owners', async () => {
    const repository = new StorageRepository();
    const snapshot = { topicMastery: { topic: 50 }, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [] };
    await repository.saveProgress('account-a', snapshot);
    await repository.saveProgress('account-b', snapshot);
    await repository.saveProgress('guest', snapshot);
    await repository.deleteAccountProgress('account-a');
    await expect(repository.saveProgress('account-a', snapshot)).rejects.toThrow('deleted account');
    await expect(repository.updateProgress('account-a', () => snapshot)).rejects.toThrow('deleted account');
    await expect(repository.loadProgress('account-a')).resolves.toBeNull();
    await expect(repository.loadProgress('account-b')).resolves.toEqual(snapshot);
    await expect(repository.loadProgress('guest')).resolves.toEqual(snapshot);
  });

  it('fences version-2 clients after cleanup', async () => {
    await new StorageRepository().deleteAccountProgress('account-a');
    await expect(new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('watchwatcher-local', 2);
      request.onsuccess = () => { request.result.close(); resolve(); };
      request.onerror = () => reject(request.error);
    })).rejects.toMatchObject({ name: 'VersionError' });
  });

  it('rejects a session using a persisted IndexedDB tombstone without a localStorage marker', async () => {
    const accountId = 'persisted-tombstone';
    await new StorageRepository().deleteAccountProgress(accountId);
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      accountId, session: 'token', user: { id: accountId, name: 'Sailor', email: 'sailor@example.test' },
    }), { status: 200 })));
    try {
      await expect(api.login({ email: 'sailor@example.test', password: 'password' })).rejects.toThrow('deleted');
    } finally {
      await api.logout();
      vi.unstubAllGlobals();
    }
  });

  it('reports a blocked upgrade instead of claiming cleanup succeeded', async () => {
    const oldDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('watchwatcher-local', 2);
      request.onupgradeneeded = () => request.result.createObjectStore('progress');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await expect(new StorageRepository().deleteAccountProgress('account-a')).rejects.toThrow('blocked');
    } finally {
      oldDatabase.close();
    }
  });

  it('retains the retry marker when an old connection blocks deletion cleanup', async () => {
    const oldDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('watchwatcher-local', 2);
      request.onupgradeneeded = () => request.result.createObjectStore('progress');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    sessionStorage.setItem('watchwatcher-signed-out', 'true');
    const auth = new AuthStateService();
    await auth.initialization;
    auth.user.set({ id: 'blocked-owner', name: 'Sailor', email: 'sailor@example.test' });
    auth.cloudAuth.set('authenticated');
    vi.spyOn(api, 'deleteAccount').mockResolvedValue();
    const cleanup = vi.spyOn(StorageRepository.prototype, 'deleteAccountProgress');
    try {
      await auth.deleteAccount('blocked-owner', auth.accountGeneration, { type: 'password', password: 'password' });
      await expect(cleanup.mock.results[0].value).rejects.toThrow('blocked');
      expect(auth.cleanupPending()).toBe(true);
      expect(localStorage.getItem('watchwatcher-deleted:blocked-owner')).toBe('pending');
      oldDatabase.close();
      await auth.retryLocalCleanup();
      expect(localStorage.getItem('watchwatcher-deleted:blocked-owner')).toBe('done');
      expect(auth.cleanupPending()).toBe(false);
    } finally {
      oldDatabase.close();
      vi.restoreAllMocks();
    }
  });

  it('keeps an unresolved local-only cleanup retryable while an old tab blocks IndexedDB', async () => {
    const oldDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('watchwatcher-local', 2);
      request.onupgradeneeded = () => request.result.createObjectStore('progress');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    localStorage.setItem('watchwatcher-signed-out', 'true');
    localStorage.setItem('watchwatcher-deletion-intent:blocked-local:one', 'pending');
    const auth = new AuthStateService();
    try {
      await auth.eraseUnresolvedLocalData('blocked-local');
      expect(auth.localCleanupStates()['blocked-local']).toBe('pending');
      expect(auth.localCleanupErrors()['blocked-local']).toContain('could not be completed');
      expect(auth.unresolvedDeletions()).toEqual(['blocked-local']);
      oldDatabase.close();
      await auth.eraseUnresolvedLocalData('blocked-local');
      expect(auth.localCleanupStates()['blocked-local']).toBe('done');
      expect(auth.unresolvedDeletions()).toEqual(['blocked-local']);
    } finally { oldDatabase.close(); }
  });

  it.each(['save', 'update'])('rejects an in-flight %s whose transaction starts after deletion', async (method) => {
    const repository = new StorageRepository();
    const snapshot = { topicMastery: { topic: 50 }, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [] };
    await repository.saveProgress('account-a', snapshot);
    const internals = repository as unknown as { openDatabase(): Promise<IDBDatabase> };
    const open = internals.openDatabase.bind(repository);
    const delayedDatabase = await open();
    let release!: (db: IDBDatabase) => void;
    vi.spyOn(internals, 'openDatabase').mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const write = method === 'save' ? repository.saveProgress('account-a', snapshot) : repository.updateProgress('account-a', () => snapshot);
    const rejected = expect(write).rejects.toThrow('deleted account');
    await repository.deleteAccountProgress('account-a');
    release(delayedDatabase);
    await rejected;
    await expect(repository.loadProgress('account-a')).resolves.toBeNull();
    vi.restoreAllMocks();
  });

  it('fences delayed writes after local-only cleanup', async () => {
    const repository = new StorageRepository();
    const snapshot = { topicMastery: { topic: 50 }, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [] };
    await repository.saveProgress('local-only-race', snapshot);
    const internals = repository as unknown as { openDatabase(): Promise<IDBDatabase> };
    const open = internals.openDatabase.bind(repository);
    const delayedDatabase = await open();
    let release!: (db: IDBDatabase) => void;
    vi.spyOn(internals, 'openDatabase').mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const write = repository.saveProgress('local-only-race', snapshot);
    const rejected = expect(write).rejects.toThrow('deleted account');
    localStorage.setItem('watchwatcher-local-cleanup:local-only-race', 'pending');
    await repository.deleteAccountProgress('local-only-race', true);
    release(delayedDatabase);
    await rejected;
    localStorage.removeItem('watchwatcher-local-cleanup:local-only-race');
    await expect(repository.saveProgress('local-only-race', snapshot)).rejects.toThrow('deleted account');
    await expect(repository.loadProgress('local-only-race')).resolves.toBeNull();
    vi.restoreAllMocks();
  });

  it('hides data and blocks writes while local cleanup is pending', async () => {
    const repository = new StorageRepository();
    const snapshot = { topicMastery: {}, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [] };
    await repository.saveProgress('account-a', snapshot);
    localStorage.setItem('watchwatcher-deleted:account-a', 'pending');
    await expect(repository.loadProgress('account-a')).resolves.toBeNull();
    await expect(repository.saveProgress('account-a', snapshot)).rejects.toThrow('deleted account');
  });

  it('erases a write whose transaction was already active when deletion was requested', async () => {
    const repository = new StorageRepository();
    const snapshot = { topicMastery: { topic: 50 }, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [] };
    let deletion!: Promise<void>;
    await repository.updateProgress('account-a', () => {
      deletion = repository.deleteAccountProgress('account-a');
      return snapshot;
    });
    await deletion;
    await expect(repository.loadProgress('account-a')).resolves.toBeNull();
    await expect(repository.saveProgress('account-a', snapshot)).rejects.toThrow('deleted account');
  });

  it('moves the legacy shared snapshot to the isolated guest namespace during upgrade', async () => {
    const legacy = { topicMastery: { colregs_rule_19d: 55 }, weakSpotLog: [], drillQueue: ['colregs_rule_19d'] };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('watchwatcher-local', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('progress');
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('progress', 'readwrite');
        transaction.objectStore('progress').put(legacy, 'current');
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => { database.close(); reject(transaction.error); };
      };
      request.onerror = () => reject(request.error);
    });

    const repository = new StorageRepository();
    await expect(repository.loadProgress('guest')).resolves.toEqual({ ...legacy, ruleExerciseAttempts: [] });
    await expect(repository.loadProgress('account-a')).resolves.toBeNull();
  });

  it('does not repeat the legacy migration when upgrading version 2', async () => {
    const guest = { topicMastery: { guest: 75 }, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [] };
    const legacy = { topicMastery: { legacy: 10 }, weakSpotLog: [], drillQueue: [] };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('watchwatcher-local', 2);
      request.onupgradeneeded = () => request.result.createObjectStore('progress');
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('progress', 'readwrite');
        transaction.objectStore('progress').put(guest, 'guest');
        transaction.objectStore('progress').put(legacy, 'current');
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => { database.close(); reject(transaction.error); };
      };
      request.onerror = () => reject(request.error);
    });
    await expect(new StorageRepository().loadProgress('guest')).resolves.toEqual(guest);
  });
});
