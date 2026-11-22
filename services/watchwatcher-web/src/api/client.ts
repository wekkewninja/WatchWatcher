import type {
  EvaluationRequest as SharedEvaluationRequest,
  ErrorResponse,
  ProgressSnapshot,
  ProgressSyncResponse,
  PublicAccount,
  SessionResponse,
  StoredProgress,
} from '@watchwatcher/shared/types';
import type { ColregsRule, EvaluationResult, StudyModule, StudySnapshot } from '../app/domain-types';
import type { AccountInput, ApiClient, Credentials } from './types';

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
  }>;
}

let sessionToken: string | null = null;
let cloudRevision: number | null = null;
let curriculumPromise: Promise<CurriculumAsset> | null = null;
let colregsPromise: Promise<ColregsAsset> | null = null;

class ApiError extends Error {
  constructor(readonly status: number, message: string) {
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
  const revision = finiteNumber(progress['revision'], 'progress revision');
  const syncedAt = progress['syncedAt'];
  if (typeof syncedAt !== 'string' && syncedAt !== null) throw new Error('The API returned an invalid sync timestamp.');
  return {
    accountId: text(progress['accountId'], 'account id'),
    topicMastery,
    weakSpotLog,
    drillQueue,
    revision,
    syncedAt,
  };
}

function parseEvaluation(value: unknown, topicId: string): EvaluationResult {
  const evaluation = object(value, 'evaluation result');
  const score = finiteNumber(evaluation['score'], 'evaluation score');
  const source = evaluation['source'];
  const misconceptionTag = evaluation['misconceptionTag'];
  if (score < 0 || score > 1 || (source !== 'online' && source !== 'offline')) {
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
    passed: score >= (/colregs|emerg|mob/i.test(topicId) ? 0.85 : 0.8),
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

async function request(path: string, init: RequestInit = {}, authenticated = false): Promise<unknown> {
  if (authenticated && !sessionToken) throw new Error('Sign in to use account services.');
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (authenticated && sessionToken) headers.set('Authorization', `Bearer ${sessionToken}`);
  const response = await fetch(`/api${path}`, { ...init, headers });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (authenticated && response.status === 401) {
      sessionToken = null;
      cloudRevision = null;
    }
    throw new ApiError(response.status, errorMessage(body, response.statusText));
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
      return {
        rule_number: text(rule['rule_number'], 'rule number'),
        title: text(rule['title'], 'rule title'),
        category: text(rule['category'], 'rule category'),
        summary: text(rule['summary'], 'rule summary'),
        memory_hook: text(rule['memory_hook'], 'memory hook'),
        asa_inland_note: text(rule['asa_inland_note'], 'ASA Inland note'),
      };
    }),
  };
}

function curriculum(): Promise<CurriculumAsset> {
  curriculumPromise ??= loadAsset('assets/syllabus/curriculum_seed.json', parseCurriculum);
  return curriculumPromise;
}

function colregsReference(): Promise<ColregsAsset> {
  colregsPromise ??= loadAsset('assets/reference/colregs_72.json', parseColregs);
  return colregsPromise;
}

async function readProgress(): Promise<StoredProgress> {
  const progress = parseProgress(await request('/progress', {}, true));
  cloudRevision = progress.revision;
  return progress;
}

function sessionRequest(input: AccountInput | Credentials): RequestInit {
  return { method: 'POST', body: JSON.stringify(input) };
}

function acceptSession(value: unknown): PublicAccount {
  const result = parseSession(value);
  sessionToken = result.session;
  cloudRevision = null;
  return result.user;
}

export const liveClient: ApiClient = {
  async getCurrentUser() {
    const result = object(await request('/auth/me', {}, true), 'current-user response');
    return parseAccount(result['user']);
  },
  async createAccount(input: AccountInput) {
    return acceptSession(await request('/auth/register', sessionRequest(input)));
  },
  async login(credentials: Credentials) {
    return acceptSession(await request('/auth/login', sessionRequest(credentials)));
  },
  async logout() {
    sessionToken = null;
    cloudRevision = null;
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
    const content = await colregsReference();
    const normalized = query.trim().toLowerCase();
    return content.rules.map((rule, index) => ({
      id: `rule-${index + 1}`,
      ruleNumber: rule.rule_number,
      title: rule.title,
      category: rule.category,
      summary: rule.summary,
      memoryHook: rule.memory_hook,
      asaInlandNote: rule.asa_inland_note,
      keywords: `${rule.title} ${rule.memory_hook} ${rule.asa_inland_note}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),
    })).filter((rule) => !normalized || `${rule.ruleNumber} ${rule.title} ${rule.summary} ${rule.keywords.join(' ')}`.toLowerCase().includes(normalized));
  },
  async getProgress(): Promise<ProgressSnapshot> {
    const { topicMastery, weakSpotLog, drillQueue } = await readProgress();
    return { topicMastery, weakSpotLog, drillQueue };
  },
  async syncProgress(snapshot: ProgressSnapshot, revision?: number): Promise<ProgressSyncResponse> {
    const expectedRevision = revision ?? cloudRevision ?? (await readProgress()).revision;
    const result = object(await request('/progress', {
      method: 'PUT',
      body: JSON.stringify({ ...snapshot, revision: expectedRevision }),
    }, true), 'progress sync response');
    const syncedAt = text(result['syncedAt'], 'sync timestamp');
    const nextRevision = finiteNumber(result['revision'], 'progress revision');
    cloudRevision = nextRevision;
    return { syncedAt, revision: nextRevision };
  },
  async evaluateAnswer(input: SharedEvaluationRequest): Promise<EvaluationResult> {
    return parseEvaluation(
      await request('/exam/evaluate', { method: 'POST', body: JSON.stringify(input) }, true),
      input.topicId,
    );
  },
};