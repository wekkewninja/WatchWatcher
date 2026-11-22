import { Injectable } from '@angular/core';
import type { ProgressSnapshot } from '../domain-types';

const databaseName = 'watchwatcher-local';
const storeName = 'progress';
const snapshotKey = 'current';

@Injectable({ providedIn: 'root' })
export class StorageRepository {
  async loadProgress(): Promise<ProgressSnapshot | null> {
    const db = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(snapshotKey);
      request.onsuccess = () => resolve((request.result as ProgressSnapshot | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async saveProgress(snapshot: ProgressSnapshot): Promise<void> {
    const db = await this.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(storeName, 'readwrite').objectStore(storeName).put(snapshot, snapshotKey);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(storeName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}
