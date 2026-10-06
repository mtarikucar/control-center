/** Claude Code model aliases: each always resolves to the newest model of its family. */
export const MODEL_ALIASES = ['fable', 'opus', 'sonnet', 'haiku'] as const;
export type ModelAlias = (typeof MODEL_ALIASES)[number];

/** Who someone is in the company: the coordinator (one per office), a team lead, or a member. */
export const EMPLOYEE_KINDS = ['coordinator', 'lead', 'member'] as const;
export type EmployeeKind = (typeof EMPLOYEE_KINDS)[number];

export const LIFECYCLES = [
  'starting',
  'idle',
  'working',
  'stopped',
  'sleeping',
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
  /** Job title written by the coordinator, e.g. "Testçi". Empty when none. */
  title: string;
  team: string;
  kind: EmployeeKind;
  /** The lead or coordinator this employee reports to; null = the coordinator (or nobody, for the coordinator). */
  reportsTo: string | null;
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
  title?: string;
  team?: string;
  kind?: EmployeeKind;
  reportsTo?: string | null;
}
