import { Injectable } from '@angular/core';
import type { ProgressSnapshot } from '../domain-types';

const databaseName = 'watchwatcher-local';
const storeName = 'progress';
const databaseVersion = 3;
const legacySnapshotKey = 'current';
const guestKey = 'guest';
const deletionPrefix = 'watchwatcher-deleted:';

export function deletionMarkerKey(ownerId: string): string {
  return `${deletionPrefix}${ownerId}`;
}

@Injectable({ providedIn: 'root' })
export class StorageRepository {
  async loadProgress(ownerId: string): Promise<ProgressSnapshot | null> {
    const db = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const tombstone = store.get(this.tombstoneKey(ownerId));
      const request = store.get(this.progressKey(ownerId));
      transaction.oncomplete = () => {
        try {
          const stored = tombstone.result || localStorage.getItem(deletionMarkerKey(ownerId)) ? undefined : request.result as ProgressSnapshot | undefined;
          resolve(stored ? { ...stored, ruleExerciseAttempts: stored.ruleExerciseAttempts ?? [] } : null);
        } catch (error) { reject(error); }
        finally { db.close(); }
      };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    });
  }

  async saveProgress(ownerId: string, snapshot: ProgressSnapshot): Promise<void> {
    await this.updateProgress(ownerId, () => snapshot);
  }

  async updateProgress(ownerId: string, update: (current: ProgressSnapshot) => ProgressSnapshot): Promise<ProgressSnapshot> {
    const db = await this.openDatabase();
    const key = this.progressKey(ownerId);
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      let updated: ProgressSnapshot | undefined;
      let updateError: unknown;
      const tombstone = store.get(this.tombstoneKey(ownerId));
      tombstone.onsuccess = () => {
        try {
          if (tombstone.result || localStorage.getItem(deletionMarkerKey(ownerId))) throw new Error('Progress for this deleted account cannot be saved.');
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

  async deleteAccountProgress(ownerId: string): Promise<void> {
    if (!ownerId || ownerId === guestKey) throw new Error('An account owner is required.');
    const db = await this.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      store.put(true, this.tombstoneKey(ownerId));
      store.delete(this.progressKey(ownerId));
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('Local deletion failed.')); };
    });
  }

  async isAccountDeleted(ownerId: string): Promise<boolean> {
    const db = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).get(this.tombstoneKey(ownerId));
      transaction.oncomplete = () => { db.close(); resolve(Boolean(request.result)); };
      transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('Local deletion status is unavailable.')); };
    });
  }

  private tombstoneKey(ownerId: string): string {
    return `deleted:${this.progressKey(ownerId)}`;
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
        if (event.oldVersion < 2) {
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
      let blocked = false;
      request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
      request.onerror = () => reject(request.error);
      request.onblocked = () => { blocked = true; reject(new Error('Local storage is blocked by another open tab.')); };
    });
  }
}
