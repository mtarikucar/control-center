/**
 * Autonomy (spec 2026-10-13-capabilities-autonomy §5–§7): which outward kinds of a connector's call the owner leaves
 * to the system, and the outbox — the record of every outward call the gate let out.
 */

/** The outward kinds the owner's policy decides; pay, delete, the browser, the office itself and other are always the owner's. */
export const OUTWARD_POLICY_KINDS = ['send', 'publish', 'call', 'calendar'] as const;
export type OutwardPolicyKind = (typeof OUTWARD_POLICY_KINDS)[number];

export const OUTWARD_DECIDERS = ['owner', 'system'] as const;
export type OutwardDecider = (typeof OUTWARD_DECIDERS)[number];
export const OUTWARD_DECIDER_LABELS: Record<OutwardDecider, string> = { owner: 'Sahibine sor', system: 'Sistem halletsin' };

export type OutwardPolicy = Record<OutwardPolicyKind, OutwardDecider>;

export const isOutwardPolicyKind = (kind: string): kind is OutwardPolicyKind => (OUTWARD_POLICY_KINDS as readonly string[]).includes(kind);

/** Who let a call out: the system on the policy and its rules, or the owner's approval. */
export const OUTBOX_VIA = ['system', 'owner'] as const;
export type OutboxVia = (typeof OUTBOX_VIA)[number];
export const OUTBOX_VIA_LABELS: Record<OutboxVia, string> = { system: 'sistem', owner: 'sahibinin onayıyla' };

export const OUTBOX_MAX_RECIPIENTS = 20;
export const OUTBOX_SUMMARY_CHARS = 300;

/** One outward call the gate let out (table outbox, v25): an "allowed", not a "delivered", record. */
export interface OutboxEntry {
  id: number;
  employeeId: string;
  /** The caller's department when it went; null: the centre. */
  departmentId: string | null;
  tool: string;
  kind: OutwardPolicyKind;
  /** The gate's coarse target, as an approval names it. */
  target: string;
  /** Whom it was for, as read from the input (at most OUTBOX_MAX_RECIPIENTS). */
  recipients: string[];
  /** The input without secret-looking fields, its first OUTBOX_SUMMARY_CHARS characters. */
  summary: string;
  via: OutboxVia;
  approvalId: string | null;
  at: number;
}
