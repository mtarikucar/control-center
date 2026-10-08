import { APPROVAL_KIND_LABELS, APPROVAL_KINDS, APPROVAL_SCOPES, OWNER, type Approval, type ApprovalKind, type ApprovalScope, type Employee, type StoredEvent } from '@cc/shared';
import { ConflictError, ValidationError } from '../errors.ts';
import type { EventStore } from '../event-store.ts';
import type { Roster } from '../roster.ts';
import type { ApprovalStore } from './approval-store.ts';
import { fingerprint, toolFamily, type GatePart } from './gate-policy.ts';
import type { NoticeStore, TaskStore } from './store.ts';
import { clean } from './text.ts';

/** How long an approval stays good after the owner gives it (design §4 madde 2). */
export const APPROVAL_TTL_MS = 24 * 60 * 60_000;

export interface ApprovalsDeps {
  store: ApprovalStore;
  events: EventStore;
  notices: NoticeStore;
  roster: Roster;
  tasks: TaskStore;
  coordinator: () => Employee | null;
  /** The decision ledger (absent in tests that do not care). */
  memory?: { recordOwnerDecision(d: { title: string; chosen: string; reason: string; planId?: string | null }): unknown };
  now?: () => number;
  ttlMs?: number;
  /** Runs work after the current event has been handled (default setImmediate): no event is written inside another. */
  defer?: (fn: () => void) => void;
}

export interface ApprovalInput {
  kind: unknown;
  tool: unknown;
  target: unknown;
  summary: unknown;
  scope?: unknown;
  taskId?: unknown;
}

const label = (kind: ApprovalKind) => APPROVAL_KIND_LABELS[kind];

/**
 * The owner's approvals (B9a): an employee asks for one call (or a task's worth of one kind), the owner decides on
 * the office page, the gate lets the approved call through once. Every step is an event, the decision a ledger line.
 */
export class Approvals {
  readonly #d: ApprovalsDeps;
  readonly #now: () => number;

  constructor(d: ApprovalsDeps) {
    this.#d = d;
    this.#now = d.now ?? Date.now;
    d.events.subscribe((e) => this.#onEvent(e));
  }

  get(id: string): Approval {
    return this.#d.store.get(id);
  }

  /** What the owner sees: every waiting request, and the last 30 decided. */
  visible(): Approval[] {
    this.#expireDue();
    const waiting = this.#d.store.list({ statuses: ['pending'], limit: 1000 });
    const decided = this.#d.store.list({ statuses: ['approved', 'denied', 'used', 'expired'], limit: 30 });
    return [...waiting, ...decided];
  }

  /** One person's, newest first; everyone's when no one is named. */
  list(employeeId?: string, limit = 30): Approval[] {
    this.#expireDue();
    return this.#d.store.list({ employeeId, limit });
  }

  request(by: string, input: ApprovalInput): Approval {
    const who = this.#d.roster.get(by);
    const summary = clean(typeof input.summary === 'string' ? input.summary : '', 'summary (neden gerektiği)', 1000, true);
    if (typeof input.kind !== 'string' || !(APPROVAL_KINDS as readonly string[]).includes(input.kind)) {
      throw new ValidationError(`kind şunlardan biri olmalı: ${APPROVAL_KINDS.join(', ')}.`);
    }
    const kind = input.kind as ApprovalKind;
    const tool = clean(typeof input.tool === 'string' ? input.tool : '', 'tool', 200, true);
    const target = clean(typeof input.target === 'string' ? input.target : '', 'target', 500, true);
    const scope = (input.scope ?? 'call') as ApprovalScope;
    if (!(APPROVAL_SCOPES as readonly string[]).includes(scope)) throw new ValidationError('scope call ya da task olmalı.');
    let taskId: string | null = typeof input.taskId === 'string' && input.taskId ? input.taskId : null;
    if (taskId) {
      const task = this.#d.tasks.get(taskId);
      if (task.assignee !== who.id || task.status === 'done' || task.status === 'cancelled') throw new ValidationError('Görev senin açık görevlerinden biri olmalı.');
    } else taskId = this.#d.tasks.inProgressOf(who.id)?.id ?? null;
    if (scope === 'task' && !taskId) throw new ValidationError('Görev boyunca geçerli onay (scope: task) için üzerinde çalıştığın bir görev gerekir; taskId ver ya da scope: call kullan.');
    const print = fingerprint(tool, { kind, target });
    const waiting = this.#d.store.pending(who.id, print, scope);
    if (waiting) return waiting;
    const approval = this.#d.store.create({ employeeId: who.id, taskId, kind, tool, target, fingerprint: print, summary, scope });
    this.#d.events.append(who.id, { type: 'approval.changed', change: 'requested', approval });
    const coordinator = this.#d.coordinator();
    if (coordinator && coordinator.id !== who.id) {
      this.#d.notices.add(coordinator.id, 'approval.requested', `${who.name} sahibinden onay istedi: ${label(kind)} — “${target}” (${tool}). Gerekçe: ${summary} Sahibi ofis sayfasından karar verecek.`);
    }
    return approval;
  }

  /** The owner's decision (the API calls this only after the owner guard: Origin and the page's nonce). */
  decide(id: string, approve: boolean, o: { via: 'page'; note?: string }): Approval {
    const current = this.#d.store.get(id);
    if (current.status !== 'pending') throw new ConflictError('Bu onay isteği artık beklemiyor (bekleyen bir istek değil).');
    const note = clean(o.note, 'Not', 2000, false) || null;
    const at = this.#now();
    const decided = this.#d.store.decide(id, { approve, decidedBy: OWNER, decidedVia: o.via, note, at, expiresAt: at + (this.#d.ttlMs ?? APPROVAL_TTL_MS) });
    if (!decided) throw new ConflictError('Bu onay isteği artık beklemiyor (bekleyen bir istek değil).');
    const task = decided.taskId ? this.#task(decided.taskId) : null;
    this.#d.memory?.recordOwnerDecision({
      title: `Onay: ${label(decided.kind)} — ${decided.target}`.slice(0, 160),
      chosen: approve ? 'Onaylandı' : 'Reddedildi',
      reason: note ?? (approve ? 'Sahibi onayladı.' : 'Sahibi onaylamadı.'),
      planId: task?.planId ?? null,
    });
    const line = approve
      ? `Sahibi onayladı: ${label(decided.kind)} — “${decided.target}” (onay no ${decided.id}). Aynı çağrıyı şimdi tekrarla; onay ${decided.scope === 'task' ? 'görev kapanana kadar bu tür ve araç için' : 'tek seferlik'}, 24 saat geçerli.${note ? ` Not: ${note}` : ''}`
      : `Sahibi onaylamadı: ${label(decided.kind)} — “${decided.target}” (onay no ${decided.id}).${note ? ` Not: ${note}` : ''} Bu çağrıyı yapma; gerekiyorsa koordinatöre başka bir yol öner.`;
    this.#d.notices.add(decided.employeeId, 'approval.decided', line);
    this.#d.events.append(decided.employeeId, { type: 'approval.changed', change: approve ? 'approved' : 'denied', approval: decided });
    return decided;
  }

  /**
   * The gate's question: is every held part of this call approved? One-call approvals are used now (all or none);
   * a task's approval covers the same kind and tool family while its task is open.
   */
  pass(employeeId: string, tool: string, parts: GatePart[]): { ok: true; ids: string[] } | { ok: false; missing: GatePart } {
    this.#expireDue();
    const now = this.#now();
    const calls: string[] = [];
    const tasks: string[] = [];
    for (const part of parts) {
      const call = this.#d.store.findCall(employeeId, fingerprint(tool, part), now);
      if (call && !calls.includes(call.id)) {
        calls.push(call.id);
        continue;
      }
      const family = toolFamily(tool, part.target);
      const scoped = this.#d.store.taskScoped(employeeId, part.kind, now).find((a) => toolFamily(a.tool, a.target) === family && this.#open(a.taskId));
      if (scoped) {
        tasks.push(scoped.id);
        continue;
      }
      return { ok: false, missing: part };
    }
    const used: Approval[] = [];
    for (const id of calls) {
      const u = this.#d.store.use(id, now);
      if (u) used.push(u);
    }
    for (const u of used) this.#d.events.append(employeeId, { type: 'approval.changed', change: 'used', approval: u });
    return { ok: true, ids: [...calls, ...tasks] };
  }

  #open(taskId: string | null): boolean {
    const task = taskId ? this.#task(taskId) : null;
    return task !== null && task.status !== 'done' && task.status !== 'cancelled';
  }

  #task(id: string) {
    try {
      return this.#d.tasks.get(id);
    } catch {
      return null;
    }
  }

  #expireDue(): void {
    for (const a of this.#d.store.expireDue(this.#now())) this.#d.events.append(a.employeeId, { type: 'approval.changed', change: 'expired', approval: a });
  }

  /** A task that closes takes its approvals of the task's scope with it. */
  #onEvent(e: StoredEvent): void {
    const ev = e.event;
    if (ev.type !== 'task.changed' || (ev.task.status !== 'done' && ev.task.status !== 'cancelled')) return;
    const taskId = ev.task.id;
    (this.#d.defer ?? setImmediate)(() => {
      for (const a of this.#d.store.expireTask(taskId)) this.#d.events.append(a.employeeId, { type: 'approval.changed', change: 'expired', approval: a });
    });
  }
}
