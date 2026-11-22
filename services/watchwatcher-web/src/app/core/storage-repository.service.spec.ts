import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { StorageRepository } from './storage-repository.service';

describe('StorageRepository', () => {
  beforeEach(async () => {
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
});
