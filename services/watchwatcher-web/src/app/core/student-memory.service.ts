import { Injectable } from '@angular/core';
import { api, getAuthenticatedAccountId } from '../../api';
import type { ColregsRule, EvaluationResult, ProgressSnapshot, RuleExerciseAttempt } from '../domain-types';
import { AuthStateService } from './auth-state.service';
import { StorageRepository } from './storage-repository.service';

export function emptyProgressSnapshot(): ProgressSnapshot {
  return { topicMastery: {}, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [] };
}

export function mergeProgressSnapshots(local: ProgressSnapshot, remote: ProgressSnapshot): ProgressSnapshot {
  const attempts = new Map<string, RuleExerciseAttempt>();
  for (const attempt of [...local.ruleExerciseAttempts, ...remote.ruleExerciseAttempts]) attempts.set(attempt.id, attempt);
  const weakSpots = new Map<string, ProgressSnapshot['weakSpotLog'][number]>();
  for (const spot of [...local.weakSpotLog, ...remote.weakSpotLog]) {
    weakSpots.set(`${spot.topicId}:${spot.tag}:${spot.timestamp}`, spot);
  }

  return {
    topicMastery: Object.fromEntries([...new Set([...Object.keys(local.topicMastery), ...Object.keys(remote.topicMastery)])]
      .map((topicId) => [topicId, Math.max(local.topicMastery[topicId] ?? 0, remote.topicMastery[topicId] ?? 0)])),
    weakSpotLog: [...weakSpots.values()].sort((first, second) => first.timestamp.localeCompare(second.timestamp)),
    drillQueue: [...new Set([...local.drillQueue, ...remote.drillQueue])],
    ruleExerciseAttempts: [...attempts.values()].sort((first, second) => first.attemptedAt.localeCompare(second.attemptedAt)),
  };
}

function hasProgressNotOnServer(merged: ProgressSnapshot, remote: ProgressSnapshot): boolean {
  if (Object.entries(merged.topicMastery).some(([topicId, mastery]) => mastery > (remote.topicMastery[topicId] ?? -1))) return true;
  if (merged.drillQueue.some((topicId) => !remote.drillQueue.includes(topicId))) return true;
  const remoteWeakSpots = new Set(remote.weakSpotLog.map((spot) => `${spot.topicId}:${spot.tag}:${spot.timestamp}`));
  if (merged.weakSpotLog.some((spot) => !remoteWeakSpots.has(`${spot.topicId}:${spot.tag}:${spot.timestamp}`))) return true;
  const remoteAttemptIds = new Set(remote.ruleExerciseAttempts.map((attempt) => attempt.id));
  return merged.ruleExerciseAttempts.some((attempt) => !remoteAttemptIds.has(attempt.id));
}

export interface RuleExerciseSummary {
  attempts: number;
  correctAttempts: number;
  completed: boolean;
  mastery: number;
  lastAttemptAt: string | null;
}

export function summarizeRuleExercise(ruleId: string, progress: ProgressSnapshot): RuleExerciseSummary {
  const attempts = progress.ruleExerciseAttempts.filter((attempt) => attempt.ruleId === ruleId);
  const correctAttempts = attempts.filter((attempt) => attempt.correct).length;
  return {
    attempts: attempts.length,
    correctAttempts,
    completed: correctAttempts > 0,
    mastery: attempts.length ? Math.round((correctAttempts / attempts.length) * 100) : 0,
    lastAttemptAt: attempts.at(-1)?.attemptedAt ?? null,
  };
}

export function selectNextRuleExercise(rules: ColregsRule[], progress: ProgressSnapshot): ColregsRule | null {
  if (!rules.length) return null;
  const pending = rules.filter((rule) => !summarizeRuleExercise(rule.id, progress).completed);
  const candidates = pending.length ? pending : rules;
  return [...candidates].sort((first, second) => {
    const firstSummary = summarizeRuleExercise(first.id, progress);
    const secondSummary = summarizeRuleExercise(second.id, progress);
    if (pending.length && firstSummary.attempts !== secondSummary.attempts) return firstSummary.attempts - secondSummary.attempts;
    if (!pending.length && firstSummary.mastery !== secondSummary.mastery) return firstSummary.mastery - secondSummary.mastery;
    return (firstSummary.lastAttemptAt ?? '').localeCompare(secondSummary.lastAttemptAt ?? '');
  })[0];
}

@Injectable({ providedIn: 'root' })
export class StudentMemoryService {
  constructor(private readonly storage: StorageRepository, private readonly auth: AuthStateService) {}

  async loadProgress(): Promise<ProgressSnapshot | null> {
    const ownerId = this.ownerId();
    const progress = await this.storage.loadProgress(ownerId);
    return this.ownerId() === ownerId ? progress : null;
  }
  saveProgress(snapshot: ProgressSnapshot): Promise<void> {
    return this.storage.saveProgress(this.ownerId(), { ...emptyProgressSnapshot(), ...snapshot });
  }

  async loadAndMergeCloudProgress(): Promise<ProgressSnapshot> {
    const ownerId = this.ownerId();
    let merged = emptyProgressSnapshot();
    try {
      if (getAuthenticatedAccountId() !== ownerId || ownerId === 'guest') throw new Error('No matching account session.');
      const remote = await api.getProgress();
      merged = await this.storage.updateProgress(ownerId, (local) => mergeProgressSnapshots(local, remote));
      if (hasProgressNotOnServer(merged, remote)) {
        try {
          if (this.ownerId() === ownerId) await api.syncProgress(merged);
        } catch { /* Keep the merged local snapshot for the next sync attempt. */ }
      }
    } catch { merged = await this.storage.loadProgress(ownerId) ?? emptyProgressSnapshot(); }
    return this.ownerId() === ownerId ? merged : (await this.storage.loadProgress(this.ownerId()) ?? emptyProgressSnapshot());
  }

  async syncProgress(): Promise<{ syncedAt: string; revision: number }> {
    const ownerId = this.ownerId();
    if (ownerId === 'guest' || getAuthenticatedAccountId() !== ownerId) throw new Error("Sign in to synchronize this account's progress.");
    const remote = await api.getProgress();
    const merged = await this.storage.updateProgress(ownerId, (local) => mergeProgressSnapshots(local, remote));
    if (this.ownerId() !== ownerId) throw new Error('Account changed while syncing progress. The local snapshot was preserved.');
    return api.syncProgress(merged);
  }

  async recordEvaluation(topicId: string, evaluation: EvaluationResult, initialMastery: number): Promise<void> {
    const ownerId = this.ownerId();
    await this.storage.updateProgress(ownerId, (current) => {
      const progress = { ...emptyProgressSnapshot(), ...current };
      const previous = progress.topicMastery[topicId] ?? initialMastery;
      progress.topicMastery[topicId] = Math.round(previous * 0.7 + evaluation.score * 100 * 0.3);
      if (evaluation.misconceptionTag) {
        progress.weakSpotLog.unshift({ topicId, tag: evaluation.misconceptionTag, timestamp: new Date().toISOString() });
        progress.drillQueue = [...new Set([topicId, ...progress.drillQueue])];
      }
      return progress;
    });
  }

  async recordRuleExerciseAttempt(ruleId: string, selectedOptionId: string, correctOptionId: string): Promise<ProgressSnapshot> {
    const ownerId = this.ownerId();
    const correct = selectedOptionId === correctOptionId;
    const attempt: RuleExerciseAttempt = {
      id: crypto.randomUUID(),
      ruleId,
      selectedOptionId,
      correct,
      attemptedAt: new Date().toISOString(),
    };
    const progress = await this.storage.updateProgress(ownerId, (current) => {
      const updated = { ...emptyProgressSnapshot(), ...current };
      updated.ruleExerciseAttempts.push(attempt);
      if (correct) updated.drillQueue = updated.drillQueue.filter((topicId) => topicId !== ruleId);
      else {
        updated.weakSpotLog.unshift({ topicId: ruleId, tag: 'incorrect-rule-exercise', timestamp: attempt.attemptedAt });
        updated.drillQueue = [...new Set([ruleId, ...updated.drillQueue])];
      }
      return updated;
    });
    if (this.ownerId() !== ownerId) throw new Error('Account changed while recording progress. Reload before continuing.');
    if (this.ownerId() === ownerId && getAuthenticatedAccountId() === ownerId) void api.syncProgress(progress).catch(() => undefined);
    return progress;
  }

  private ownerId(): string {
    return this.auth.user()?.id ?? 'guest';
  }
}
