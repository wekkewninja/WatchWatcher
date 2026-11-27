import { z } from 'zod';
import { hasMinimumPasswordCharacters, isPasswordWithinLimits, PASSWORD_LIMIT_MESSAGE } from './password';

export const emailSchema = z.string().trim().email().max(254);
const passwordSchema = z.string().refine(isPasswordWithinLimits, PASSWORD_LIMIT_MESSAGE);
const passwordMinimum = (minimum: number) => passwordSchema.refine((password) => hasMinimumPasswordCharacters(password, minimum), `Password must contain at least ${minimum} Unicode code points.`);
export const credentialsSchema = z.object({ email: emailSchema, password: passwordMinimum(8) }).strict();
export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: emailSchema,
  password: passwordMinimum(10),
}).strict();
export const sessionSchema = credentialsSchema;
export const googleSignInSchema = z.object({
  challengeId: z.string().uuid(),
  credential: z.string().min(100).max(10000),
  linkExisting: z.object({
    confirmed: z.literal(true),
    password: passwordMinimum(8),
  }).strict().optional(),
}).strict();

export const deleteAccountSchema = z.union([z.object({
  confirmation: z.literal('DELETE'),
  reauthentication: z.discriminatedUnion('type', [
    z.object({ type: z.literal('password'), password: passwordSchema.pipe(z.string().min(1)) }).strict(),
    z.object({ type: z.literal('google'), credential: z.string().min(100).max(10000), challengeId: z.string().uuid() }).strict(),
  ]),
}).strict(), z.object({ confirmation: z.literal('DELETE'), receiptOnly: z.literal(true) }).strict()]);

export const progressSnapshotSchema = z.object({
  topicMastery: z.record(z.string().min(1).max(120), z.number().min(0).max(100)),
  weakSpotLog: z.array(z.object({
    topicId: z.string().min(1).max(120),
    tag: z.string().min(1).max(120),
    timestamp: z.string().datetime(),
  }).strict()).max(10000),
  drillQueue: z.array(z.string().min(1).max(120)).max(10000),
  ruleExerciseAttempts: z.array(z.object({
    id: z.string().uuid(),
    ruleId: z.string().regex(/^(rule-(?:[1-9]|[1-3][0-9]|4[01])|annex-(?:i|ii|iii|iv))$/),
    selectedOptionId: z.string().regex(/^[a-d]$/),
    correct: z.boolean(),
    attemptedAt: z.string().datetime(),
  }).strict()).max(10000).default([]),
  objectivePracticeAttempts: z.array(z.object({
    id: z.string().uuid(),
    questionId: z.string().min(1).max(160),
    topicId: z.string().min(1).max(120),
    objectiveIds: z.array(z.string().min(1).max(160)).max(100),
    correct: z.boolean(),
    attemptedAt: z.string().datetime(),
  }).strict()).max(10000).default([]),
  examSessions: z.array(z.object({
    id: z.string().uuid(),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    questionResults: z.array(z.object({
      questionId: z.string().min(1).max(160),
      topicId: z.string().min(1).max(120),
      objectiveIds: z.array(z.string().min(1).max(160)).max(100),
      priority: z.enum(['critical', 'major', 'minor']),
      submittedAnswer: z.string().max(12000),
      correct: z.boolean().nullable(),
    }).strict()).min(1).max(250),
    score: z.number().min(0).max(100),
    passed: z.boolean(),
    criticalGatePassed: z.boolean(),
  }).strict()).max(10000).default([]),
  deletedExamSessionIds: z.array(z.string().uuid()).max(10000).default([]),
  examHistoryDeletedAt: z.string().datetime().nullable().default(null),
}).strict();

export const progressSyncSchema = progressSnapshotSchema.extend({
  revision: z.number().int().nonnegative(),
}).strict();

export const evaluateAnswerSchema = z.object({
  topicId: z.string().min(1).max(120),
  context: z.string().min(1).max(10000),
  answer: z.string().trim().min(1).max(12000),
  onlineConsent: z.literal(true),
}).strict();

export type CredentialsInput = z.infer<typeof credentialsSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type SessionInput = z.infer<typeof sessionSchema>;
export type ProgressSyncInput = z.infer<typeof progressSyncSchema>;
export type EvaluateAnswerInput = z.infer<typeof evaluateAnswerSchema>;
