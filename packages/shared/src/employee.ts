import type { WorkType } from './company.ts';
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
  /** The role template the employee was hired from, at that version; null when hired with free text (B6). */
  template?: TemplateRef | null;
}

/** Which role template, at which version (spec 2026-10-08-role-templates-design §5). */
export interface TemplateRef {
  id: string;
  version: number;
}

/**
 * A role template of the catalog (product knowledge, shipped as craft/roles/<id>.md): the defaults for a hire and the
 * role text's parts.
 */
export interface RoleTemplate {
  id: string;
  version: number;
  title: string;
  team: string;
  model: ModelAlias;
  summary: string;
  capabilities: string[];
  methods: WorkType[];
  checks: string[];
  kpis: string[];
  /** The Markdown body: responsibilities, how to work, what done means. */
  body: string;
}

export interface HireInput {
  name: string;
  /** With a template: the company's own part of the role (optional); without: the whole role text (required). */
  role: string;
  /** A role template's id (B6): the role text and the defaults come from it. */
  template?: string;
  model?: ModelAlias;
  characterId?: string;
  title?: string;
  team?: string;
  kind?: EmployeeKind;
  reportsTo?: string | null;
}
