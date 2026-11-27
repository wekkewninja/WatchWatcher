import type {
  OnlineEvaluationRequest as SharedEvaluationRequest,
  ErrorResponse,
  ProgressSnapshot,
  ProgressSyncResponse,
  PublicAccount,
  SessionResponse,
  RuleExerciseAttempt,
  StoredProgress,
} from '@watchwatcher/shared/types';
import type { ColregsExercise, ColregsRule, EvaluationResult, StudyModule, StudySnapshot } from '../app/domain-types';
import { deletionMarkerKey, localCleanupKey, StorageRepository } from '../app/core/storage-repository.service';
import type { AccountInput, AccountReauthentication, ApiClient, Credentials, GoogleAuthChallenge, GoogleSignInInput, GoogleSignInResult } from './types';

type JsonObject = Record<string, unknown>;

interface CurriculumTopic {
  id: string;
  title: string;
  summary: string;
}

interface CurriculumModule {
  id: string;
  title: string;
  pass_threshold: number;
  topics: CurriculumTopic[];
}

interface CurriculumAsset {
  modules: CurriculumModule[];
}

interface ColregsAsset {
  rules: Array<{
    rule_number: string;
    title: string;
    category: string;
    summary: string;
    memory_hook: string;
    asa_inland_note: string;
    key_points: string[];
    exercise: ColregsExercise;
  }>;
}

interface ColregsOfficialTextAsset {
  source_url: string;
  source_updated_on: string;
  checked_on: string;
  rules: Array<{
    rule_number: string;
    source_fragment: string;
    international: string[];
    inland?: string[];
  }>;
}

let sessionToken: string | null = null;
let sessionAccountId: string | null = null;
let cloudRevision: number | null = null;
let sessionGeneration = 0;
let deletionRetry: { accountId: string; token: string; expiresAt: number } | null = null;
let deletionRetryTimer: ReturnType<typeof setTimeout> | undefined;
const deletionRetryLifetime = 2 * 60 * 1000;
const deletionGenerations = new Map<string, number>();
const deletedAccountIds = new Set<string>();
let curriculumPromise: Promise<CurriculumAsset> | null = null;
let colregsPromise: Promise<ColregsAsset> | null = null;
let colregsOfficialTextPromise: Promise<ColregsOfficialTextAsset> | null = null;

class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string, readonly details?: unknown, readonly retryAfterSeconds?: number) {
    super(message);
  }
}

function object(value: unknown, label: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`The API returned an invalid ${label}.`);
  }
  return value as JsonObject;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`The API returned an invalid ${label}.`);
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`The API returned an invalid ${label}.`);
  return value;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`The API returned an invalid ${label}.`);
  return value;
}

function parseAccount(value: unknown): PublicAccount {
  const account = object(value, 'account');
  return {
    id: text(account['id'], 'account id'),
    name: text(account['name'], 'account name'),
    email: text(account['email'], 'account email'),
  };
}

function parseSession(value: unknown): SessionResponse {
  const session = object(value, 'session');
  return {
    accountId: text(session['accountId'], 'account id'),
    session: text(session['session'], 'session token'),
    user: parseAccount(session['user']),
  };
}

function parseProgress(value: unknown): StoredProgress {
  const progress = object(value, 'progress snapshot');
  const rawMastery = object(progress['topicMastery'], 'topic mastery');
  const topicMastery: Record<string, number> = {};
  for (const [topicId, mastery] of Object.entries(rawMastery)) {
    const parsedMastery = finiteNumber(mastery, 'topic mastery value');
    if (parsedMastery < 0 || parsedMastery > 100) throw new Error('The API returned an out-of-range mastery value.');
    topicMastery[topicId] = parsedMastery;
  }
  const weakSpotLog = array(progress['weakSpotLog'], 'weak spot log').map((entry) => {
    const weakSpot = object(entry, 'weak spot');
    return {
      topicId: text(weakSpot['topicId'], 'weak spot topic id'),
      tag: text(weakSpot['tag'], 'weak spot tag'),
      timestamp: text(weakSpot['timestamp'], 'weak spot timestamp'),
    };
  });
  const drillQueue = array(progress['drillQueue'], 'drill queue').map((topicId) => text(topicId, 'drill topic id'));
  const ruleExerciseAttempts = array(progress['ruleExerciseAttempts'] ?? [], 'rule exercise attempts').map((value) => {
    const attempt = object(value, 'rule exercise attempt');
    const correct = attempt['correct'];
    if (typeof correct !== 'boolean') throw new Error('The API returned an invalid exercise result.');
    return {
      id: text(attempt['id'], 'exercise attempt id'),
      ruleId: text(attempt['ruleId'], 'exercise rule id'),
      selectedOptionId: text(attempt['selectedOptionId'], 'selected exercise option'),
      correct,
      attemptedAt: text(attempt['attemptedAt'], 'exercise attempt timestamp'),
    } satisfies RuleExerciseAttempt;
  });
  const revision = finiteNumber(progress['revision'], 'progress revision');
  const syncedAt = progress['syncedAt'];
  if (typeof syncedAt !== 'string' && syncedAt !== null) throw new Error('The API returned an invalid sync timestamp.');
  return {
    accountId: text(progress['accountId'], 'account id'),
    topicMastery,
    weakSpotLog,
    drillQueue,
    ruleExerciseAttempts,
    revision,
    syncedAt,
  };
}

function parseEvaluation(value: unknown, topicId: string): EvaluationResult {
  const evaluation = object(value, 'evaluation result');
  const score = finiteNumber(evaluation['score'], 'evaluation score');
  const source = evaluation['source'];
  const misconceptionTag = evaluation['misconceptionTag'];
  const criticalFailure = evaluation['criticalFailure'];
  const criticalFailureReason = evaluation['criticalFailureReason'];
  if (score < 0 || score > 1 || source !== 'online' || typeof criticalFailure !== 'boolean'
    || (criticalFailure ? typeof criticalFailureReason !== 'string' || !criticalFailureReason.trim() : criticalFailureReason !== null)) {
    throw new Error('The API returned an invalid evaluation result.');
  }
  if (misconceptionTag !== null && typeof misconceptionTag !== 'string') {
    throw new Error('The API returned an invalid misconception tag.');
  }
  return {
    score,
    feedback: text(evaluation['feedback'], 'evaluation feedback'),
    misconceptionTag,
    followUpDrill: text(evaluation['followUpDrill'], 'follow-up drill'),
    source,
    criticalFailure,
    criticalFailureReason: criticalFailureReason as string | null,
    passed: !criticalFailure && score >= (/colregs|emerg|mob/i.test(topicId) ? 0.85 : 0.8),
  };
}

function errorMessage(value: unknown, fallback: string): string {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const body = value as Partial<ErrorResponse>;
    const message = body.error?.message;
    if (typeof message === 'string') return message;
  }
  return fallback || 'The request could not be completed.';
}

async function request(path: string, init: RequestInit = {}, authenticated = false, acceptStaleSuccess = false): Promise<unknown> {
  if (authenticated && !sessionToken) throw new Error('Sign in to use account services.');
  const tokenAtRequest = authenticated ? sessionToken : null;
  const accountAtRequest = authenticated ? sessionAccountId : null;
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (authenticated && sessionToken) headers.set('Authorization', `Bearer ${sessionToken}`);
  const response = await fetch(`/api${path}`, { ...init, headers });
  const body: unknown = await response.json().catch(() => null);
  if (authenticated && (sessionToken !== tokenAtRequest || sessionAccountId !== accountAtRequest) && !(acceptStaleSuccess && response.ok)) {
    throw new Error('Account changed while an API request was in progress.');
  }
  if (!response.ok) {
    if (authenticated && response.status === 401) {
      sessionToken = null;
      sessionAccountId = null;
      cloudRevision = null;
      window.dispatchEvent(new CustomEvent('watchwatcher-session-expired', { detail: accountAtRequest }));
    }
    const errorBody = typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Partial<ErrorResponse>).error
      : undefined;
    const retryAfter = response.headers.get('Retry-After');
    const retryAfterSeconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined;
    throw new ApiError(response.status, errorMessage(body, response.statusText), errorBody?.code, errorBody?.details,
      retryAfterSeconds !== undefined && retryAfterSeconds > 0 && retryAfterSeconds <= 86400 ? retryAfterSeconds : undefined);
  }
  return body;
}

async function loadAsset<T>(path: string, parse: (value: unknown) => T): Promise<T> {
  const response = await fetch(new URL(path, document.baseURI));
  if (!response.ok) throw new Error(`Bundled study content could not be loaded (${response.status}).`);
  const value: unknown = await response.json();
  return parse(value);
}

function parseCurriculum(value: unknown): CurriculumAsset {
  const root = object(value, 'curriculum');
  const modules = array(root['modules'], 'curriculum modules').map((item) => {
    const module = object(item, 'curriculum module');
    const threshold = finiteNumber(module['pass_threshold'], 'pass threshold');
    if (threshold < 0 || threshold > 1) throw new Error('Bundled curriculum has an invalid pass threshold.');
    return {
      id: text(module['id'], 'module id'),
      title: text(module['title'], 'module title'),
      pass_threshold: threshold,
      topics: array(module['topics'], 'curriculum topics').map((topicValue) => {
        const topic = object(topicValue, 'curriculum topic');
        return {
          id: text(topic['id'], 'topic id'),
          title: text(topic['title'], 'topic title'),
          summary: text(topic['summary'], 'topic summary'),
        };
      }),
    };
  });
  return { modules };
}

function parseColregs(value: unknown): ColregsAsset {
  const root = object(value, 'COLREGs reference');
  return {
    rules: array(root['rules'], 'COLREGs rules').map((ruleValue) => {
      const rule = object(ruleValue, 'COLREGs rule');
      const exercise = object(rule['exercise'], 'COLREGs exercise');
      const options = array(exercise['options'], 'COLREGs exercise options').map((optionValue) => {
        const option = object(optionValue, 'COLREGs exercise option');
        return { id: text(option['id'], 'COLREGs option id'), text: text(option['text'], 'COLREGs option text') };
      });
      const answer = text(exercise['answer'], 'COLREGs exercise answer');
      if (options.length < 2 || !options.some((option) => option.id === answer)) {
        throw new Error('Bundled COLREGs exercise has an invalid answer option.');
      }
      return {
        rule_number: text(rule['rule_number'], 'rule number'),
        title: text(rule['title'], 'rule title'),
        category: text(rule['category'], 'rule category'),
        summary: text(rule['summary'], 'rule summary'),
        memory_hook: text(rule['memory_hook'], 'memory hook'),
        asa_inland_note: text(rule['asa_inland_note'], 'ASA Inland note'),
        key_points: array(rule['key_points'], 'COLREGs key points').map((point) => text(point, 'COLREGs key point')),
        exercise: {
          prompt: text(exercise['prompt'], 'COLREGs exercise prompt'),
          options,
          answer,
          explanation: text(exercise['explanation'], 'COLREGs exercise explanation'),
          remediation: text(exercise['remediation'], 'COLREGs exercise remediation'),
        },
      };
    }),
  };
}

function parseColregsOfficialText(value: unknown): ColregsOfficialTextAsset {
  const root = object(value, 'official COLREGs text');
  const rules = array(root['rules'], 'official COLREGs rules').map((ruleValue) => {
    const rule = object(ruleValue, 'official COLREGs rule');
    const inlandValue = rule['inland'];
    const paragraphs = (value: unknown, label: string) => array(value, label).map((paragraph) => text(paragraph, label));
    const international = paragraphs(rule['international'], 'International rule paragraphs');
    if (!international.length) throw new Error('Bundled official COLREGs rule has no International wording.');
    const inland = inlandValue === undefined ? undefined : paragraphs(inlandValue, 'Inland rule paragraphs');
    return {
      rule_number: text(rule['rule_number'], 'official COLREGs rule number'),
      source_fragment: text(rule['source_fragment'], 'official COLREGs source fragment'),
      international,
      inland,
    };
  });
  if (rules.length !== 41 || rules.some((rule, index) => rule.rule_number !== `Rule ${index + 1}`)) {
    throw new Error('Bundled official COLREGs text must include Rules 1–41 in order.');
  }
  return {
    source_url: text(root['source_url'], 'official COLREGs source URL'),
    source_updated_on: text(root['source_updated_on'], 'official COLREGs source update date'),
    checked_on: text(root['checked_on'], 'official COLREGs check date'),
    rules,
  };
}

function curriculum(): Promise<CurriculumAsset> {
  curriculumPromise ??= loadAsset('assets/syllabus/curriculum_seed.json', parseCurriculum);
  return curriculumPromise;
}

function colregsReference(): Promise<ColregsAsset> {
  colregsPromise ??= loadAsset('assets/reference/colregs_catalog.json', parseColregs);
  return colregsPromise;
}

function colregsOfficialText(): Promise<ColregsOfficialTextAsset> {
  colregsOfficialTextPromise ??= loadAsset('assets/reference/colregs_official_text.json', parseColregsOfficialText);
  return colregsOfficialTextPromise;
}

async function readProgress(): Promise<StoredProgress> {
  const tokenAtStart = sessionToken;
  if (!tokenAtStart) throw new Error('Sign in to use account services.');
  const response = await request('/progress', {}, true);
  if (sessionToken !== tokenAtStart) throw new Error('Account changed while progress was loading.');
  const progress = parseProgress(response);
  cloudRevision = progress.revision;
  return progress;
}

function sessionRequest(input: AccountInput | Credentials): RequestInit {
  return { method: 'POST', body: JSON.stringify(input) };
}

async function acceptSession(value: unknown, generation: number): Promise<PublicAccount> {
  if (generation !== sessionGeneration) throw new Error('Sign-in was superseded by another account change.');
  const result = parseSession(value);
  if (result.accountId !== result.user.id) throw new Error('The API returned an invalid session account.');
  let tombstone: boolean;
  try { tombstone = await new StorageRepository().isAccountDeleted(result.accountId); }
  catch { throw new Error('Local account status is unavailable. Close other tabs and try again.'); }
  if (generation !== sessionGeneration) throw new Error('Sign-in was superseded by another account change.');
  if (deletedAccountIds.has(result.accountId) || localStorage.getItem(deletionMarkerKey(result.accountId))) {
    throw new Error('This account has been deleted.');
  }
  if (localStorage.getItem(localCleanupKey(result.accountId))) {
    throw new Error('Local data was erased on this browser profile. To recover an account that still exists, use a separate browser profile; server data may return and a pending deletion may still complete.');
  }
  if (tombstone) {
    throw new Error('This account has been deleted.');
  }
  sessionToken = result.session;
  sessionAccountId = result.accountId;
  cloudRevision = null;
  return result.user;
}

export function getAuthenticatedAccountId(): string | null {
  return sessionAccountId;
}

function clearDeletionRetry(): void {
  deletionRetry = null;
  clearTimeout(deletionRetryTimer);
  window.dispatchEvent(new Event('watchwatcher-deletion-retry-changed'));
}

export function canConfirmDeletion(accountId: string): boolean {
  if (deletionRetry && deletionRetry.expiresAt <= Date.now()) clearDeletionRetry();
  return deletionRetry?.accountId === accountId;
}

export async function confirmDeletionReceipt(accountId: string): Promise<void> {
  if (!canConfirmDeletion(accountId) || !deletionRetry) throw new Error('Deletion confirmation is no longer available in this tab. The server outcome remains unconfirmed.');
  const retry = deletionRetry;
  const response = await fetch('/api/account', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${retry.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmation: 'DELETE', receiptOnly: true }),
  });
  if (deletionRetry !== retry || retry.expiresAt <= Date.now()) throw new Error('Deletion confirmation expired or the account changed. The server outcome remains unconfirmed.');
  if (response.status !== 204) throw new Error('Deletion could not be confirmed. Server data may still exist.');
  clearDeletionRetry();
  deletedAccountIds.add(accountId);
  if (sessionAccountId === accountId && sessionToken === retry.token) {
    sessionToken = null;
    sessionAccountId = null;
    cloudRevision = null;
  }
}

async function revokeSession(token: string | null): Promise<void> {
  if (!token) return;
  if (!navigator.onLine) throw new Error('Remote sign-out could not be confirmed.');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Remote sign-out timed out.')); }, 5000);
    });
    const response = await Promise.race([
      fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }),
      timeout,
    ]);
    if (response.status !== 204) throw new Error('Remote sign-out could not be confirmed.');
  } finally {
    clearTimeout(timer);
  }
}

export function logoutAccountSession(accountId: string): Promise<void> {
  deletionGenerations.set(accountId, (deletionGenerations.get(accountId) ?? 0) + 1);
  if (deletionRetry?.accountId === accountId) clearDeletionRetry();
  if (sessionAccountId !== accountId) return Promise.resolve();
  const token = sessionToken;
  sessionToken = null;
  sessionAccountId = null;
  cloudRevision = null;
  return revokeSession(token);
}

export const liveClient: ApiClient = {
  async getCurrentUser() {
    const result = object(await request('/auth/me', {}, true), 'current-user response');
    return parseAccount(result['user']);
  },
  async createAccount(input: AccountInput) {
    clearDeletionRetry();
    const generation = ++sessionGeneration;
    return acceptSession(await request('/auth/register', sessionRequest(input)), generation);
  },
  async login(credentials: Credentials) {
    clearDeletionRetry();
    const generation = ++sessionGeneration;
    return acceptSession(await request('/auth/login', sessionRequest(credentials)), generation);
  },
  async getGoogleClientId(): Promise<string> {
    const result = object(await request('/auth/google/config'), 'Google sign-in configuration');
    return text(result['clientId'], 'Google client ID');
  },
  async createGoogleChallenge(): Promise<GoogleAuthChallenge> {
    const challenge = object(await request('/auth/google/challenge', { method: 'POST' }), 'Google sign-in challenge');
    return {
      challengeId: text(challenge['challengeId'], 'Google challenge ID'),
      nonce: text(challenge['nonce'], 'Google challenge nonce'),
      expiresAt: text(challenge['expiresAt'], 'Google challenge expiry'),
    };
  },
  async googleSignIn(input: GoogleSignInInput): Promise<GoogleSignInResult> {
    clearDeletionRetry();
    const generation = ++sessionGeneration;
    try {
      const user = await acceptSession(await request('/auth/google', { method: 'POST', body: JSON.stringify(input) }), generation);
      return { kind: 'authenticated', user };
    } catch (error) {
      if (generation !== sessionGeneration) throw new Error('Sign-in was superseded by another account change.');
      if (error instanceof ApiError && error.status === 409 && error.code === 'CONFLICT') {
        const details = typeof error.details === 'object' && error.details !== null ? error.details as Record<string, unknown> : {};
        if (details['reason'] === 'GOOGLE_ACCOUNT_LINK_REQUIRED') {
          return { kind: 'link-required' };
        }
      }
      throw error;
    }
  },
  async deleteAccount(accountId: string, reauthentication: AccountReauthentication): Promise<void> {
    if (!sessionToken || sessionAccountId !== accountId) throw new Error('Account changed. Sign in again before deleting.');
    const generation = sessionGeneration;
    const deletionGeneration = deletionGenerations.get(accountId) ?? 0;
    const token = sessionToken;
    try {
      await request('/account', { method: 'DELETE', body: JSON.stringify({ confirmation: 'DELETE', reauthentication }) }, true, true);
    } catch (error) {
      const definite = error instanceof ApiError && (error.status === 401 || error.status === 422 || error.status === 429 || (error.status === 403 && error.code === 'REAUTHENTICATION_FAILED'));
      if (!definite && generation === sessionGeneration && deletionGeneration === (deletionGenerations.get(accountId) ?? 0)) {
        clearDeletionRetry();
        deletionRetry = { accountId, token, expiresAt: Date.now() + deletionRetryLifetime };
        deletionRetryTimer = setTimeout(clearDeletionRetry, deletionRetryLifetime);
        window.dispatchEvent(new Event('watchwatcher-deletion-retry-changed'));
      }
      throw error;
    }
    if (generation === sessionGeneration && deletionRetry?.accountId === accountId && deletionRetry.token === token) clearDeletionRetry();
    deletedAccountIds.add(accountId);
    if (sessionAccountId === accountId) {
      if (generation === sessionGeneration) sessionGeneration++;
      sessionToken = null;
      sessionAccountId = null;
      cloudRevision = null;
    }
  },
  async logout() {
    clearDeletionRetry();
    const token = sessionToken;
    sessionGeneration++;
    sessionToken = null;
    sessionAccountId = null;
    cloudRevision = null;
    await revokeSession(token);
  },
  async getStudySnapshot(): Promise<StudySnapshot> {
    const content = await curriculum();
    const topics = content.modules.flatMap((module) => module.topics.map((topic) => ({
      id: topic.id,
      contentId: topic.id,
      moduleId: module.id,
      moduleTitle: module.title,
      title: topic.title,
      summary: topic.summary,
      mastery: 0,
      passThreshold: Math.round(module.pass_threshold * 100),
      state: 'remediation' as const,
    })));
    return { topics, averageMastery: 0, atThreshold: 0, weakSpots: 0 };
  },
  async getModules(): Promise<StudyModule[]> {
    const content = await curriculum();
    return content.modules.map((module) => ({
      id: module.id,
      title: module.title,
      mastery: 0,
      completed: 0,
      topicCount: module.topics.length,
      passThreshold: Math.round(module.pass_threshold * 100),
      topics: module.topics.map((topic) => topic.title),
      topicIds: module.topics.map((topic) => topic.id),
    }));
  },
  async searchColregs(query: string): Promise<ColregsRule[]> {
    const [content, officialText] = await Promise.all([colregsReference(), colregsOfficialText()]);
    const normalized = query.trim().toLowerCase();
    const officialTextByRule = new Map(officialText.rules.map((rule) => [rule.rule_number, rule]));
    return content.rules.map((rule) => {
      const ruleText = officialTextByRule.get(rule.rule_number);
      const officialTextForRule = ruleText ? {
        sourceUrl: `${officialText.source_url}#${encodeURIComponent(ruleText.source_fragment)}`,
        sourceUpdatedOn: officialText.source_updated_on,
        checkedOn: officialText.checked_on,
        international: ruleText.international,
        inland: ruleText.inland,
      } : undefined;
      const officialWords = officialTextForRule
        ? `${officialTextForRule.international.join(' ')} ${officialTextForRule.inland?.join(' ') ?? ''}`
        : '';
      const keywords = `${rule.title} ${rule.summary} ${rule.memory_hook} ${rule.asa_inland_note} ${rule.key_points.join(' ')} ${rule.exercise.prompt} ${rule.exercise.options.map((option) => option.text).join(' ')} ${officialWords}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      return {
        id: rule.rule_number.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        ruleNumber: rule.rule_number,
        title: rule.title,
        category: rule.category,
        summary: rule.summary,
        officialText: officialTextForRule,
        memoryHook: rule.memory_hook,
        asaInlandNote: rule.asa_inland_note,
        keyPoints: rule.key_points,
        exercise: rule.exercise,
        keywords,
      };
    }).filter((rule) => !normalized || `${rule.ruleNumber} ${rule.title} ${rule.summary} ${rule.keywords.join(' ')}`.toLowerCase().includes(normalized));
  },
  async getProgress(): Promise<ProgressSnapshot> {
    const { topicMastery, weakSpotLog, drillQueue, ruleExerciseAttempts } = await readProgress();
    return { topicMastery, weakSpotLog, drillQueue, ruleExerciseAttempts };
  },
  async syncProgress(snapshot: ProgressSnapshot, revision?: number): Promise<ProgressSyncResponse> {
    const tokenAtStart = sessionToken;
    if (!tokenAtStart) throw new Error('Sign in to use account services.');
    const expectedRevision = revision ?? cloudRevision ?? (await readProgress()).revision;
    if (sessionToken !== tokenAtStart) throw new Error('Account changed while progress was synchronizing.');
    const result = object(await request('/progress', {
      method: 'PUT',
      body: JSON.stringify({ ...snapshot, revision: expectedRevision }),
    }, true), 'progress sync response');
    if (sessionToken !== tokenAtStart) throw new Error('Account changed while progress was synchronizing.');
    const syncedAt = text(result['syncedAt'], 'sync timestamp');
    const nextRevision = finiteNumber(result['revision'], 'progress revision');
    cloudRevision = nextRevision;
    return { syncedAt, revision: nextRevision };
  },
  async evaluateAnswer(input: SharedEvaluationRequest): Promise<EvaluationResult> {
    if (input.onlineConsent !== true) throw new Error('Online evaluation requires explicit consent.');
    if (input.answer.trim().length > 12000) throw new Error('Shorten your answer to 12,000 characters or fewer.');
    const tokenAtStart = sessionToken;
    const result = await request('/exam/evaluate', { method: 'POST', body: JSON.stringify({ topicId: input.topicId, context: input.context, answer: input.answer, onlineConsent: true }) }, true);
    if (sessionToken !== tokenAtStart) throw new Error('Account changed while the answer was being evaluated.');
    return parseEvaluation(result, input.topicId);
  },
};