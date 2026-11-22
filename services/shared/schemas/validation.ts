import { z } from 'zod';

export const emailSchema = z.string().trim().email().max(254);
export const credentialsSchema = z.object({ email: emailSchema, password: z.string().min(8).max(128) }).strict();
export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: emailSchema,
  password: z.string().min(10).max(128),
}).strict();
export const sessionSchema = credentialsSchema;

export const progressSnapshotSchema = z.object({
  topicMastery: z.record(z.string().min(1).max(120), z.number().min(0).max(100)),
  weakSpotLog: z.array(z.object({
    topicId: z.string().min(1).max(120),
    tag: z.string().min(1).max(120),
    timestamp: z.string().datetime(),
  }).strict()).max(10000),
  drillQueue: z.array(z.string().min(1).max(120)).max(10000),
}).strict();

export const progressSyncSchema = progressSnapshotSchema.extend({
  revision: z.number().int().nonnegative(),
}).strict();

export const evaluateAnswerSchema = z.object({
  topicId: z.string().min(1).max(120),
  context: z.string().min(1).max(10000),
  answer: z.string().trim().min(1).max(12000),
}).strict();

export type CredentialsInput = z.infer<typeof credentialsSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type SessionInput = z.infer<typeof sessionSchema>;
export type ProgressSyncInput = z.infer<typeof progressSyncSchema>;
export type EvaluateAnswerInput = z.infer<typeof evaluateAnswerSchema>;
