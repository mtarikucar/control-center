export const MODEL_ALIASES = ['opus', 'sonnet', 'haiku'] as const;
export type ModelAlias = (typeof MODEL_ALIASES)[number];

export const LIFECYCLES = [
  'starting',
  'idle',
  'working',
  'stopped',
  'in_terminal',
  'limited',
  'interrupted',
  'error',
  'archived',
] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];

export interface Employee {
  id: string;
  slug: string;
  name: string;
  role: string;
  model: ModelAlias;
  characterId: string;
  deskIndex: number;
  sessionId: string;
  /** true once claude has reported the session (first `system/init`); before that we start with --session-id. */
  sessionStarted: boolean;
  lifecycle: Lifecycle;
  limitResetsAt: number | null;
  lastError: string | null;
  createdAt: number;
}

export interface HireInput {
  name: string;
  role: string;
  model?: ModelAlias;
  characterId?: string;
}
