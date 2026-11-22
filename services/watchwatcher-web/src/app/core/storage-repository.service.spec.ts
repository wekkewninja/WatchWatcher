import 'fake-indexeddb/auto';
import { StorageRepository } from './storage-repository.service';

describe('StorageRepository', () => {
  it('stores and reads the local progress snapshot', async () => {
    const repository = new StorageRepository();
    const snapshot = {
      topicMastery: { colregs_rule_19: 72 },
      weakSpotLog: [{ topicId: 'colregs_rule_19', tag: 'late-action', timestamp: '2026-11-18T09:30:00.000Z' }],
      drillQueue: ['colregs_rule_19'],
    };
    await repository.saveProgress(snapshot);
    await expect(repository.loadProgress()).resolves.toEqual(snapshot);
  });
});
