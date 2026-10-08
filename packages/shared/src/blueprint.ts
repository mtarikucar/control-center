import type { Kpi, TaskDifficulty } from './company.ts';
import type { ModelAlias } from './employee.ts';

/**
 * The blueprint (B5; spec 2026-10-08-blueprint-design): a structured install plan the coordinator writes from the
 * company profile, the office checks and shows on a plan card, and installs once approved — step by step, idempotent.
 */

export interface BlueprintRole {
  /** Unique in the blueprint: a-z, 0-9, dashes. Routines and tasks name their doer and reviewer by it. */
  key: string;
  name: string;
  template?: string;
  /** With a template: the company's own part; without: the whole role card. */
  role?: string;
  title?: string;
  team?: string;
  model?: ModelAlias;
  capabilities?: string[];
}

export interface BlueprintGoal {
  key: string;
  title: string;
  why: string;
  done: string[];
  kpis: Kpi[];
}

export interface BlueprintRoutine {
  key: string;
  title: string;
  description: string;
  done: string[];
  /** A role's key, or 'coordinator'. */
  role: string;
  reviewer: string | null;
  cron: string;
  difficulty: TaskDifficulty | null;
}

export interface BlueprintTask {
  key: string;
  title: string;
  description: string;
  done: string[];
  role: string;
  reviewer: string | null;
  requires: string[];
  difficulty: TaskDifficulty | null;
  priority: number;
}

export interface Blueprint {
  title: string;
  summary: string;
  brief: string | null;
  roles: BlueprintRole[];
  playbook: Array<{ topic: string; text: string }>;
  goals: BlueprintGoal[];
  routines: BlueprintRoutine[];
  tasks: BlueprintTask[];
  /** Pilot 0's closed mode: these deny rules go into each new desk's .claude/settings.json before its first session. */
  closedMode: { deny: string[] } | null;
  estimates: { quotaPct: number | null; usd: number | null; days: number | null };
  risks: string;
}

/** `done`: the office made it; `adopted`: it already existed by its natural key and is used. */
export type BlueprintOutcome = 'done' | 'adopted';

export interface BlueprintStepRecord {
  step: string;
  ref: string | null;
  outcome: BlueprintOutcome;
  at: number;
}

/** One step of an install run: made, adopted, already recorded (skipped), failed (the run stops), or not reached. */
export type BlueprintStepResult = 'done' | 'adopted' | 'skipped' | 'failed' | 'pending';

export interface BlueprintApplyReport {
  planId: string;
  title: string;
  finished: boolean;
  steps: Array<{ step: string; label: string; result: BlueprintStepResult; ref: string | null; error: string | null }>;
}

/**
 * How one closed-mode rule stands on one desk, read from its latest session only (no tool is ever called):
 * `verified` — the session has none of the tools it denies; `open` — it has them (the rule did not hold);
 * `not_connected` — the server is not connected there (no tools either way); `no_session` — the desk has not opened
 * one yet; `unverifiable` — not a connector rule (a shell pattern): a list cannot show it, the call is refused.
 */
export type ClosedModeCheck = 'verified' | 'open' | 'not_connected' | 'no_session' | 'unverifiable';

export interface BlueprintView {
  planId: string;
  blueprint: Blueprint;
  /** The company profile's version the blueprint was written on, and now (A4: re-onboarding when they differ). */
  profileVersion: number;
  profileNow: number;
  /** Every step of the blueprint in install order, then recorded ones it no longer has (`removed`). */
  steps: Array<{ step: string; label: string; state: 'pending' | BlueprintOutcome | 'removed'; ref: string | null }>;
  /** Per role installed: whether the install closed its desk, and each rule's check. */
  closedMode: Array<{ key: string; employeeId: string; name: string; applied: boolean; rules: Array<{ rule: string; check: ClosedModeCheck }> }>;
}
