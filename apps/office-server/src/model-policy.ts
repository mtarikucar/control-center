import type { Constitution, CoordinatorTurn, ModelAlias } from '@cc/shared';
import type { ModelHint } from './engine.ts';

/** Weakest (and cheapest) first. */
export const MODEL_RANK: Record<ModelAlias, number> = { haiku: 0, sonnet: 1, opus: 2, fable: 3 };

export interface ModelChoice {
  current: ModelAlias;
  /** The model the message asks for; none: keep the current one. */
  wanted?: ModelAlias;
  /** When the session's last turn ended; null: it has had none, nothing is cached. */
  lastTurnFinishedAt: number | null;
  now: number;
  /** The pause before a weaker model (the constitution's cacheTtlMinutes). */
  ttlMinutes: number;
  /** The message starts a task: the task's model applies either way (a task is long enough to pay for one cold start). */
  taskStart?: boolean;
}

/**
 * Whether a session moves to the model a message asks for. A switch restarts the session (memory resumes) and the
 * conversation is cached anew on the new model, so: a stronger model at once (the work needs it); a weaker one only
 * after `ttlMinutes` without a turn, so a conversation does not flap between models; otherwise keep. (The real CLI's
 * cache outlives 5 minutes; a weaker model still pays off — notes/economy-cache-observation.md.)
 */
function decide(c: ModelChoice): 'keep' | 'switch' {
  if (!c.wanted || c.wanted === c.current) return 'keep';
  if (MODEL_RANK[c.wanted] > MODEL_RANK[c.current] || c.taskStart) return 'switch';
  const quiet = c.lastTurnFinishedAt === null || c.now - c.lastTurnFinishedAt >= c.ttlMinutes * 60_000;
  return quiet ? 'switch' : 'keep';
}

export const modelPolicy = { decide };

/**
 * The coordinator's hint for a turn of this type (management cycle §3.5): the constitution's model for it, as a role
 * hint — the engine applies it whatever the model policy says, by decide's rule (a stronger model at once, a weaker one
 * after the cache pause).
 */
export function coordinatorHint(turn: CoordinatorTurn, c: Constitution): ModelHint {
  return { model: c.coordinatorModels[turn], role: true };
}
