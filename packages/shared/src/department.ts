import type { WorkType } from './company.ts';
import type { TemplateRef } from './employee.ts';

/** The rooms around the coordinator: at most this many departments are open at once (spec departments §3). */
export const MAX_DEPARTMENTS = 6;

export const DEPARTMENT_STATUSES = ['open', 'closed'] as const;
export type DepartmentStatus = (typeof DEPARTMENT_STATUSES)[number];

/** A plan stream a department carries is stored as `departman:<id>` (spec §6.1); `alınacak: <rol>` and a person id stay as they were. */
export const STREAM_TO_DEPARTMENT = 'departman';

export function departmentOwner(id: string): string {
  return `${STREAM_TO_DEPARTMENT}:${id}`;
}

/** The department id of a stream owner; null when the owner is a person or a role to hire. */
export function ownerDepartment(owner: string): string | null {
  const prefix = `${STREAM_TO_DEPARTMENT}:`;
  return owner.startsWith(prefix) ? owner.slice(prefix.length) : null;
}

export interface Department {
  id: string;
  /** Unique among open departments and against the names of people at work (folded: case and Turkish letters). */
  name: string;
  mission: string;
  /** The boundary text: Yapar / Yapmaz / Sana gelir, checks, measures, routine suggestions (Markdown). */
  scope: string;
  /** The template it was opened from, at that version; null for a custom one. */
  template: TemplateRef | null;
  /** Its head; null: headless (the coordinator answers for it). */
  headId: string | null;
  status: DepartmentStatus;
  createdAt: number;
  closedAt: number | null;
  /** The room it works in (spec office rooms §4.1), 0–5: the lowest free one when it opened; null once closed (or none was free). */
  room: number | null;
}

export type DepartmentChange = 'created' | 'updated' | 'head' | 'moved' | 'closed';

/** A role a department template suggests, and when to hire it. */
export interface DepartmentRole {
  template: string;
  when: string;
}

/** A department template of the catalog (product knowledge, shipped as craft/departments/<id>.md). */
export interface DepartmentTemplate {
  id: string;
  version: number;
  name: string;
  mission: string;
  /** The head's role template. */
  head: string;
  roles: DepartmentRole[];
  methods: WorkType[];
  /** Suggestions only: never set up by themselves. */
  routines: string[];
  checks: string[];
  kpis: string[];
  /** The Markdown body: ### Yapar, ### Yapmaz, ### Sana gelir. */
  body: string;
}

export interface DepartmentInput {
  /** A department template's id: name, mission and scope come from it unless given. */
  template?: string;
  name?: string;
  mission?: string;
  scope?: string;
  /** Someone at work to head it (moved into it); none: headless. */
  headId?: string | null;
}

export const STREAM_NOTE_KINDS = ['plan', 'report'] as const;
export type StreamNoteKind = (typeof STREAM_NOTE_KINDS)[number];

/** A head's plan of a stream or report on it (spec §5.2); each call a new note, the latest shown. */
export interface StreamNote {
  id: number;
  planId: string;
  streamId: string;
  kind: StreamNoteKind;
  text: string;
  /** A report's evidence, one item each (empty for a plan). */
  evidence: string[];
  /** A report's "what next" (null for a plan). */
  next: string | null;
  by: string;
  at: number;
}
