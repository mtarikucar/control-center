import type { ModelAlias } from '@cc/shared';

/** Weakest (and cheapest) first. */
export const MODEL_RANK: Record<ModelAlias, number> = { haiku: 0, sonnet: 1, opus: 2, fable: 3 };

export interface ModelChoice {
  current: ModelAlias;
  /** The model the message asks for; none: keep the current one. */
  wanted?: ModelAlias;
  /** When the session's last turn ended; null: it has had none, nothing is cached. */
  lastTurnFinishedAt: number | null;
  now: number;
  /** How long claude keeps a session's prompt cache warm. */
  ttlMinutes: number;
  /** The message starts a task: the task's model applies either way (a task is long enough to pay for one cold start). */
  taskStart?: boolean;
}

/**
 * Whether a session moves to the model a message asks for. A switch restarts the session (memory resumes) and its
 * prompt cache goes cold, so: a stronger model at once (the work needs it); a weaker one only once the cache is cold
 * anyway — no turn for `ttlMinutes` — so a conversation does not flap between models; otherwise keep.
 */
function decide(c: ModelChoice): 'keep' | 'switch' {
  if (!c.wanted || c.wanted === c.current) return 'keep';
  if (MODEL_RANK[c.wanted] > MODEL_RANK[c.current] || c.taskStart) return 'switch';
  const cold = c.lastTurnFinishedAt === null || c.now - c.lastTurnFinishedAt >= c.ttlMinutes * 60_000;
  return cold ? 'switch' : 'keep';
}

export const modelPolicy = { decide };
