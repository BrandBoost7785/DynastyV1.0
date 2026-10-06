/**
 * API request contracts.
 *
 * The *intent* payload is validated by the simulation's own schema (`src/sim/validation.ts`)
 * — there is deliberately no second copy of those rules here, so a new intent type or a
 * changed bound is a one-line change in the domain layer and the API follows.
 *
 * What lives in this file is the transport envelope around a command: who the client
 * is, which version it acted on, and what its idempotency key is. Those are API
 * concerns, not game rules, so they are validated with the project's existing zod
 * dependency right at the boundary.
 */
import { z } from 'zod';
import { getBalance } from '../config/balance';

const B = getBalance();

/** Identifier shape shared by every id we accept in a path or body. */
export const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_.:-]+$/, 'Identifiers may contain letters, digits, dot, dash, colon and underscore only.');

export const requestIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/, 'A request id may contain letters, digits, dot, dash, colon and underscore only.');

export const registerSchema = z.object({
  email: z.string().trim().min(3).max(160),
  password: z.string().min(1).max(200),
  displayName: z.string().trim().min(2).max(32),
});

export const loginSchema = z.object({
  email: z.string().trim().min(3).max(160),
  password: z.string().min(1).max(200),
});

export const createGameSchema = z.object({
  playerName: z.string().trim().min(1).max(40),
  gameName: z.string().trim().min(1).max(80).optional(),
  /** Optional deterministic seed; the server also derives one from the account. */
  seed: z.string().trim().min(1).max(64).optional(),
  difficulty: z.enum(['relaxed', 'standard', 'hardcore', 'brutal']).optional(),
  startLocationId: idSchema.optional(),
  permadeath: z.boolean().optional(),
  endless: z.boolean().optional(),
});

/**
 * A command request.
 *
 * `expectedVersion` is the version the client last saw; for state-changing intents the
 * service requires it, because a write that cannot be proven current is rejected
 * rather than applied over a newer state.
 */
export const intentRequestSchema = z.object({
  intent: z.unknown(),
  expectedVersion: z.number().int().min(0).max(1_000_000_000).optional(),
  /** Idempotency key. A retry with the same key replays the recorded outcome. */
  requestId: requestIdSchema.optional(),
});

export const advanceRequestSchema = z.object({
  days: z.number().int().min(1).max(B.api.maxAdvanceDaysPerRequest),
  expectedVersion: z.number().int().min(0).max(1_000_000_000).optional(),
  requestId: requestIdSchema.optional(),
});

export const restoreVersionSchema = z.object({
  /** Restoring overwrites live state, so it must be explicit and version-checked. */
  confirm: z.literal(true),
  expectedVersion: z.number().int().min(0).max(1_000_000_000).optional(),
  requestId: requestIdSchema.optional(),
});

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ContractResult<T> = { ok: true; value: T } | { ok: false; message: string; issues: ValidationIssue[] };

/**
 * Validate a body against a schema, producing the API's own issue shape.
 *
 * Unknown keys are stripped by zod, so a client cannot smuggle a field past the
 * contract by adding it to an otherwise valid envelope.
 */
export function validate<T>(schema: z.ZodType<T>, body: unknown): ContractResult<T> {
  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issues = (parsed.error.issues ?? []).slice(0, 12).map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
  return { ok: false, message: `Request rejected: ${issues.map((i) => `${i.path} ${i.message}`).join('; ') || 'malformed payload'}`, issues };
}
