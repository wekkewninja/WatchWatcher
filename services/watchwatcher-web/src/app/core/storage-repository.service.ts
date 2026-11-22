import { Injectable } from '@angular/core';
import type { ProgressSnapshot } from '../domain-types';

const databaseName = 'watchwatcher-local';
const storeName = 'progress';
const databaseVersion = 2;
const legacySnapshotKey = 'current';
const guestKey = 'guest';

@Injectable({ providedIn: 'root' })
export class StorageRepository {
  async loadProgress(ownerId: string): Promise<ProgressSnapshot | null> {
    const db = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(this.progressKey(ownerId));
      request.onsuccess = () => {
        const stored = request.result as ProgressSnapshot | undefined;
        const progress = stored ? { ...stored, ruleExerciseAttempts: stored.ruleExerciseAttempts ?? [] } : null;
        db.close();
        resolve(progress);
      };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  }

  async saveProgress(ownerId: string, snapshot: ProgressSnapshot): Promise<void> {
    const db = await this.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(storeName, 'readwrite').objectStore(storeName).put(snapshot, this.progressKey(ownerId));
      request.onsuccess = () => { db.close(); resolve(); };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  }

  async updateProgress(ownerId: string, update: (current: ProgressSnapshot) => ProgressSnapshot): Promise<ProgressSnapshot> {
    const db = await this.openDatabase();
    const key = this.progressKey(ownerId);
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      let updated: ProgressSnapshot | undefined;
      let updateError: unknown;
      const request = store.get(key);
      request.onsuccess = () => {
        try {
          const stored = request.result as ProgressSnapshot | undefined;
          const current = stored
            ? { ...stored, ruleExerciseAttempts: stored.ruleExerciseAttempts ?? [] }
            : { topicMastery: {}, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [] };
          updated = update(current);
          store.put(updated, key);
        } catch (error) {
          updateError = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => {
        db.close();
        if (updated) resolve(updated);
        else reject(new Error('Progress update completed without a snapshot.'));
      };
      transaction.onerror = () => { db.close(); reject(updateError ?? transaction.error); };
      transaction.onabort = () => { db.close(); reject(updateError ?? transaction.error ?? new Error('Progress update was aborted.')); };
    });
  }

  private progressKey(ownerId: string): string {
    if (!ownerId) throw new Error('A progress owner is required.');
    return ownerId === guestKey ? guestKey : `user:${ownerId}`;
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion);
      request.onupgradeneeded = (event) => {
        const database = request.result;
        if (!database.objectStoreNames.contains(storeName)) database.createObjectStore(storeName);
        if (event.oldVersion < databaseVersion) {
          const store = request.transaction?.objectStore(storeName);
          if (!store) return;
          const legacy = store.get(legacySnapshotKey);
          legacy.onsuccess = () => {
            if (legacy.result !== undefined) {
              const progress = legacy.result as ProgressSnapshot;
              store.put({ ...progress, ruleExerciseAttempts: progress.ruleExerciseAttempts ?? [] }, guestKey);
            }
            store.delete(legacySnapshotKey);
          };
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}
