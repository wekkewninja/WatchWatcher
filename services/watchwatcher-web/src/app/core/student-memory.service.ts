import { Injectable } from '@angular/core';
import { api, getAuthenticatedAccountId } from '../../api';
import type { ColregsRule, ExamSession, ObjectivePracticeAttempt, ProgressSnapshot, RuleExerciseAttempt } from '../domain-types';
import { AuthStateService } from './auth-state.service';
import { StorageRepository } from './storage-repository.service';
import { LocaleService } from './locale.service';

export function emptyProgressSnapshot(): ProgressSnapshot {
  return { topicMastery: {}, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [], objectivePracticeAttempts: [], examSessions: [], deletedExamSessionIds: [], examHistoryDeletedAt: null };
}

export function mergeProgressSnapshots(local: ProgressSnapshot, remote: ProgressSnapshot): ProgressSnapshot {
  const attempts = new Map<string, RuleExerciseAttempt>();
  for (const attempt of [...local.ruleExerciseAttempts, ...remote.ruleExerciseAttempts]) attempts.set(attempt.id, attempt);
  const practiceAttempts = new Map<string, ObjectivePracticeAttempt>();
  for (const attempt of [...(local.objectivePracticeAttempts ?? []), ...(remote.objectivePracticeAttempts ?? [])]) practiceAttempts.set(attempt.id, attempt);
  const deletedExamSessionIds = [...new Set([...(local.deletedExamSessionIds ?? []), ...(remote.deletedExamSessionIds ?? [])])];
  const deletedIds = new Set(deletedExamSessionIds);
  const examHistoryDeletedAt = [local.examHistoryDeletedAt, remote.examHistoryDeletedAt]
    .filter((timestamp): timestamp is string => !!timestamp)
    .sort()
    .at(-1) ?? null;
  const historyClearTime = examHistoryDeletedAt ? Date.parse(examHistoryDeletedAt) : Number.NEGATIVE_INFINITY;
  const examSessions = new Map<string, ExamSession>();
  for (const session of [...(local.examSessions ?? []), ...(remote.examSessions ?? [])]) {
    if (!deletedIds.has(session.id) && Date.parse(session.completedAt) > historyClearTime) examSessions.set(session.id, session);
  }
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
    objectivePracticeAttempts: [...practiceAttempts.values()].sort((first, second) => first.attemptedAt.localeCompare(second.attemptedAt)),
    examSessions: [...examSessions.values()].sort((first, second) => first.completedAt.localeCompare(second.completedAt)),
    deletedExamSessionIds,
    examHistoryDeletedAt,
  };
}

function hasProgressNotOnServer(merged: ProgressSnapshot, remote: ProgressSnapshot): boolean {
  if (Object.entries(merged.topicMastery).some(([topicId, mastery]) => mastery > (remote.topicMastery[topicId] ?? -1))) return true;
  if (merged.drillQueue.some((topicId) => !remote.drillQueue.includes(topicId))) return true;
  const remoteWeakSpots = new Set(remote.weakSpotLog.map((spot) => `${spot.topicId}:${spot.tag}:${spot.timestamp}`));
  if (merged.weakSpotLog.some((spot) => !remoteWeakSpots.has(`${spot.topicId}:${spot.tag}:${spot.timestamp}`))) return true;
  const remoteAttemptIds = new Set(remote.ruleExerciseAttempts.map((attempt) => attempt.id));
  if (merged.ruleExerciseAttempts.some((attempt) => !remoteAttemptIds.has(attempt.id))) return true;
  const remotePracticeIds = new Set((remote.objectivePracticeAttempts ?? []).map((attempt) => attempt.id));
  if ((merged.objectivePracticeAttempts ?? []).some((attempt) => !remotePracticeIds.has(attempt.id))) return true;
  const remoteExamIds = new Set((remote.examSessions ?? []).map((session) => session.id));
  if ((merged.examSessions ?? []).some((session) => !remoteExamIds.has(session.id))) return true;
  const remoteDeletedIds = new Set(remote.deletedExamSessionIds ?? []);
  if ((merged.deletedExamSessionIds ?? []).some((id) => !remoteDeletedIds.has(id))) return true;
  return (merged.examHistoryDeletedAt ?? null) !== (remote.examHistoryDeletedAt ?? null);
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
  constructor(private readonly storage: StorageRepository, private readonly auth: AuthStateService, private readonly locales: LocaleService = new LocaleService()) {}

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
    const generation = this.auth.accountGeneration;
    let merged = emptyProgressSnapshot();
    try {
      if (getAuthenticatedAccountId() !== ownerId || ownerId === 'guest') throw new Error(this.locales.translate('progress.noMatchingSession'));
      const remote = await api.getProgress();
      merged = await this.storage.updateProgress(ownerId, (local) => {
        this.ensureOwner(ownerId, generation);
        return mergeProgressSnapshots(local, remote);
      });
      if (hasProgressNotOnServer(merged, remote)) {
        try {
          this.ensureOwner(ownerId, generation);
          await api.syncProgress(merged);
        } catch { /* Keep the merged local snapshot for the next sync attempt. */ }
      }
    } catch { merged = await this.storage.loadProgress(ownerId) ?? emptyProgressSnapshot(); }
    return this.ownerId() === ownerId ? merged : (await this.storage.loadProgress(this.ownerId()) ?? emptyProgressSnapshot());
  }

  async syncProgress(): Promise<{ syncedAt: string; revision: number }> {
    const ownerId = this.ownerId();
    const generation = this.auth.accountGeneration;
    if (ownerId === 'guest' || getAuthenticatedAccountId() !== ownerId) throw new Error(this.locales.translate('progress.signInToSync'));
    const remote = await api.getProgress();
    const merged = await this.storage.updateProgress(ownerId, (local) => {
      this.ensureOwner(ownerId, generation);
      return mergeProgressSnapshots(local, remote);
    });
    this.ensureOwner(ownerId, generation);
    return api.syncProgress(merged);
  }

  async recordRuleExerciseAttempt(ruleId: string, selectedOptionId: string, correctOptionId: string): Promise<ProgressSnapshot> {
    const ownerId = this.ownerId();
    const generation = this.auth.accountGeneration;
    const correct = selectedOptionId === correctOptionId;
    const attempt: RuleExerciseAttempt = {
      id: crypto.randomUUID(),
      ruleId,
      selectedOptionId,
      correct,
      attemptedAt: new Date().toISOString(),
    };
    const progress = await this.storage.updateProgress(ownerId, (current) => {
      this.ensureOwner(ownerId, generation);
      const updated = { ...emptyProgressSnapshot(), ...current };
      updated.ruleExerciseAttempts.push(attempt);
      if (correct) updated.drillQueue = updated.drillQueue.filter((topicId) => topicId !== ruleId);
      else {
        updated.weakSpotLog.unshift({ topicId: ruleId, tag: 'incorrect-rule-exercise', timestamp: attempt.attemptedAt });
        updated.drillQueue = [...new Set([ruleId, ...updated.drillQueue])];
      }
      return updated;
    });
    this.ensureOwner(ownerId, generation);
    this.syncInBackground(ownerId, generation);
    return progress;
  }

  async recordObjectivePracticeAttempt(input: Omit<ObjectivePracticeAttempt, 'id' | 'attemptedAt'>): Promise<ObjectivePracticeAttempt> {
    const ownerId = this.ownerId();
    const generation = this.auth.accountGeneration;
    const attempt: ObjectivePracticeAttempt = { ...input, objectiveIds: [...new Set(input.objectiveIds)], id: crypto.randomUUID(), attemptedAt: new Date().toISOString() };
    const progress = await this.storage.updateProgress(ownerId, (current) => {
      this.ensureOwner(ownerId, generation);
      return { ...emptyProgressSnapshot(), ...current, objectivePracticeAttempts: [...(current.objectivePracticeAttempts ?? []), attempt] };
    });
    this.ensureOwner(ownerId, generation);
    this.syncInBackground(ownerId, generation);
    return attempt;
  }

  async recordExamSession(session: ExamSession): Promise<ProgressSnapshot> {
    const ownerId = this.ownerId();
    const generation = this.auth.accountGeneration;
    const progress = await this.storage.updateProgress(ownerId, (current) => {
      this.ensureOwner(ownerId, generation);
      const deleted = new Set(current.deletedExamSessionIds ?? []);
      if (deleted.has(session.id)) throw new Error('This exam session was deleted.');
      const sessions = new Map((current.examSessions ?? []).map((item) => [item.id, item]));
      sessions.set(session.id, session);
      return { ...emptyProgressSnapshot(), ...current, examSessions: [...sessions.values()] };
    });
    this.ensureOwner(ownerId, generation);
    this.syncInBackground(ownerId, generation);
    return progress;
  }

  async deleteExamHistory(): Promise<ProgressSnapshot> {
    const ownerId = this.ownerId();
    const generation = this.auth.accountGeneration;
    const progress = await this.storage.updateProgress(ownerId, (current) => {
      this.ensureOwner(ownerId, generation);
      const deletedExamSessionIds = [...new Set([...(current.deletedExamSessionIds ?? []), ...(current.examSessions ?? []).map((session) => session.id)])];
      return { ...emptyProgressSnapshot(), ...current, examSessions: [], deletedExamSessionIds, examHistoryDeletedAt: new Date().toISOString() };
    });
    this.ensureOwner(ownerId, generation);
    this.syncInBackground(ownerId, generation);
    return progress;
  }

  private ownerId(): string {
    return this.auth.user()?.id ?? 'guest';
  }

  private ensureOwner(ownerId: string, generation: number): void {
    if (this.ownerId() !== ownerId || this.auth.accountGeneration !== generation) throw new Error(this.locales.translate('progress.accountChanged'));
  }

  private syncInBackground(ownerId: string, generation: number): void {
    if (this.ownerId() === ownerId && this.auth.accountGeneration === generation && getAuthenticatedAccountId() === ownerId) {
      void this.syncProgress().catch(() => undefined);
    }
  }
}
