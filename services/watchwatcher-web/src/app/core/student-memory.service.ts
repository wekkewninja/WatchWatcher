import { Injectable } from '@angular/core';
import type { EvaluationResult, ProgressSnapshot } from '../domain-types';
import { StorageRepository } from './storage-repository.service';

@Injectable({ providedIn: 'root' })
export class StudentMemoryService {
  constructor(private readonly storage: StorageRepository) {}

  loadProgress(): Promise<ProgressSnapshot | null> { return this.storage.loadProgress(); }
  saveProgress(snapshot: ProgressSnapshot): Promise<void> { return this.storage.saveProgress(snapshot); }

  async recordEvaluation(topicId: string, evaluation: EvaluationResult, initialMastery: number): Promise<void> {
    const progress = await this.storage.loadProgress() ?? {
      topicMastery: {},
      weakSpotLog: [],
      drillQueue: [],
    };
    const previous = progress.topicMastery[topicId] ?? initialMastery;
    progress.topicMastery[topicId] = Math.round(previous * 0.7 + evaluation.score * 100 * 0.3);
    if (evaluation.misconceptionTag) {
      progress.weakSpotLog.unshift({ topicId, tag: evaluation.misconceptionTag, timestamp: new Date().toISOString() });
      progress.drillQueue = [...new Set([topicId, ...progress.drillQueue])];
    }
    await this.storage.saveProgress(progress);
  }
}
