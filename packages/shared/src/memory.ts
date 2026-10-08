import type { Employee } from './employee.ts';

/** A choice the company made: what was chosen, why, and what else was on the table. `reverts` = the decision it undoes. */
export interface Decision {
  id: string;
  ts: number;
  /** An employee id, or OWNER for the owner's reverts. */
  by: string;
  title: string;
  chosen: string;
  reason: string;
  alternatives: string[];
  planId: string | null;
  reverts: string | null;
}

/** One version of a playbook topic: how the company does something (testing, releases, video production…). */
export interface PlaybookEntry {
  topic: string;
  version: number;
  text: string;
  by: string;
  reason: string;
  ts: number;
}

export interface Note {
  id: number;
  ts: number;
  by: string;
  title: string;
  text: string;
  tags: string[];
  /** Where it came from: `task:<id>` for what a hand-in taught; null for a note written directly. */
  source: string | null;
}

export interface EmployeeNote {
  id: number;
  ts: number;
  employeeId: string;
  by: string;
  text: string;
}

/** What the memory search looks through: knowledge notes, decisions, playbook topics, finished work, profile sections. */
export const MEMORY_KINDS = ['note', 'decision', 'playbook', 'task', 'profile'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

/** One search result across the company's memory. */
export interface MemoryHit {
  kind: MemoryKind;
  /** The note's number, the decision's or task's id, the playbook topic, the profile section. */
  id: string;
  title: string;
  snippet: string;
  ts: number;
  /** Set when the record has only some of the query's words: found after every record that has them all. */
  partial?: true;
  /** With `partial`: how many of the query's (distinct) words it has. */
  matched?: number;
}

/** What the company knows about one employee: the coordinator's notes and their track record. */
export interface EmployeeFile {
  employee: Employee;
  notes: EmployeeNote[];
  finished: number;
  recent: Array<{ id: string; title: string; summary: string; finishedAt: number | null }>;
}
