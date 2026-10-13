import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { APPROVAL_KIND_LABELS, isOutwardPolicyKind, type ApprovalKind, type ApprovalScope, type Constitution, type Employee, type GateDecision, type OutboxEntry, type OutboxVia, type OutwardPolicyKind } from '@cc/shared';
import { deskDir } from '../desk.ts';
import type { EventStore } from '../event-store.ts';
import type { Roster } from '../roster.ts';
import type { Approvals } from './approvals.ts';
import { classifyCall, type GateContext, type GatePart } from './gate-policy.ts';
import type { OutboxStore } from './outbox-store.ts';
import { outwardRule } from './outward-rules.ts';
import { callSummary, recipientsOf } from './recipients.ts';

export interface GateDeps {
  approvals: Approvals;
  events: EventStore;
  roster: Roster;
  /** The constitution's switch (gateEnabled): off, every call passes and nothing is written. */
  enabled: () => boolean;
  /** The context of one employee's calls (their desk; the live checkout; git's answers). */
  context: (employee: Pick<Employee, 'slug'>) => GateContext;
  /** git's answers, asked asynchronously when the context lacked them (liveContext's own; absent in tests that fake it). */
  git?: { missing(): boolean; refresh(): Promise<void> };
  /**
   * Spec capabilities §5–§7: the constitution's outward policy and its rules, and the outbox every outward call the gate
   * lets out is written to. Absent (an office before them, the approvals' own tests): every held call waits for the
   * owner and nothing is written, as before.
   */
  autonomy?: { constitution: () => Constitution; outbox: OutboxStore; now?: () => number };
}

export interface HeldCall {
  tool: string;
  kind: ApprovalKind;
  target: string;
  scope: ApprovalScope;
}

const MAX_SCRIPT_BYTES = 256 * 1024;

/**
 * The gate (B9a): the hook asks it before a tool call runs. It classifies the call (gate-policy), and lets a held call
 * through on the owner's approval — or, for a connector's outward call the owner's policy leaves to the system, on the
 * policy's rules (spec capabilities §5). A held call, let through or not, leaves a gate.checked event; every outward
 * call let out goes to the outbox; a free one leaves nothing.
 */
export class Gate {
  readonly #d: GateDeps;
  /** The last call the gate held for each employee: approvalRequest with no tool and target asks for it. */
  readonly #held = new Map<string, HeldCall>();

  constructor(d: GateDeps) {
    this.#d = d;
  }

  lastHeld(employeeId: string): HeldCall | null {
    return this.#held.get(employeeId) ?? null;
  }

  /**
   * What the gate makes of a call before it is made (approvalRequest with the call's own input, spec capabilities §8):
   * its first held part, so the approval's print is that very call's; null when the gate would not hold it at all.
   */
  preview(employeeId: string, tool: string, input: unknown): HeldCall | null {
    const verdict = classifyCall(tool, input, undefined, this.#d.context(this.#d.roster.get(employeeId)));
    const first = verdict.parts[0];
    return first ? { tool, kind: first.kind, target: first.target, scope: verdict.scope } : null;
  }

  async check(employeeId: string, input: unknown): Promise<GateDecision> {
    const hook = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
    if (!hook || typeof hook.tool_name !== 'string' || !hook.tool_name) {
      return { decision: 'deny', reason: 'OFİS KAPISI: kancanın girdisi okunamadı; çağrı yapılmadı.' };
    }
    if (!this.#d.enabled()) return { decision: 'allow', reason: 'kapı kapalı' };
    const tool = hook.tool_name;
    const employee = this.#d.roster.get(employeeId);
    const classify = () => classifyCall(tool, hook.tool_input, typeof hook.cwd === 'string' ? hook.cwd : undefined, this.#d.context(employee));
    let verdict = classify();
    // What git had not answered yet was taken the careful way; ask it (off the event loop) and classify again —
    // twice at most: a worktree the first answer lists may need its own.
    for (let round = 0; round < 2 && this.#d.git?.missing(); round += 1) {
      await this.#d.git.refresh();
      verdict = classify();
    }
    if (!verdict.gated) return { decision: 'allow', reason: 'serbest' };
    const matched = this.#d.approvals.match(employeeId, tool, verdict.parts);
    const first = verdict.parts[0]!;
    if (matched.ok) {
      const approvalId = matched.byPart[0]!;
      // The outbox line first, then the approvals' use and the events, as one write (Task 8 review M1): a line that
      // cannot be written fails the call closed with its approval unspent and no allow on record.
      this.#together(() => {
        const line = this.#line(employee, tool, hook.tool_input, verdict.parts, 'owner', matched.byPart);
        this.#d.approvals.spend(employeeId, matched.calls);
        this.#d.events.append(employeeId, { type: 'gate.checked', tool, kind: first.kind, target: first.target, decision: 'allow', approvalId });
        if (line) this.#d.events.append(employee.id, { type: 'outbox.sent', entry: line });
      });
      return { decision: 'allow', reason: 'sahibinin onayıyla', kind: first.kind, target: first.target, approvalId };
    }
    const system = this.#system(employee, tool, hook.tool_input, verdict.parts);
    if (system === true) return { decision: 'allow', reason: 'sistemce (otonomi politikası)', kind: first.kind, target: first.target };
    const part = matched.missing;
    this.#held.set(employeeId, { tool, kind: part.kind, target: part.target, scope: verdict.scope });
    this.#d.events.append(employeeId, { type: 'gate.checked', tool, kind: part.kind, target: part.target, decision: 'deny', approvalId: null });
    const rule = system === null ? '' : ' Sistem bu çağrıyı kuralı yüzünden kendi geçirmedi.';
    const more = verdict.parts.length > 1 ? ` Bu çağrıda onay isteyen ${verdict.parts.length} parça var; her biri için ayrı onay gerekir.` : '';
    const scope = verdict.scope === 'task' ? ' Görev boyunca bu tür tarayıcı işleri için scope: task iste.' : '';
    return {
      decision: 'deny',
      kind: part.kind,
      target: part.target,
      reason:
        `OFİS KAPISI: ${APPROVAL_KIND_LABELS[part.kind]} — “${part.target}” onaysız yapılamaz (${system ?? part.why}).${rule}${more} ` +
        `approvalRequest aracıyla sahibinden onay iste: summary'ye neden gerektiğini yaz (tool, kind ve target boş kalırsa bu çağrı alınır).${scope} ` +
        'Sahibi onaylayınca aynı çağrıyı tekrarla; beklerken görevi taskPark ile park et.',
    };
  }

  /**
   * Spec capabilities §5: a call is the system's when every part comes from a connector's classified tool, of a kind
   * the owner's policy leaves to the system — the shell's and the built-in tools' sends and publishes never are, and
   * never make the gate read the constitution (Task 8 review M4). Then true — it passes, and its outbox line is
   * written — or the rule of §6 that holds it. null: the owner's, as before; also when the system cannot decide or
   * write the call (M4: held, never a 500).
   */
  #system(employee: Employee, tool: string, input: unknown, parts: GatePart[]): true | string | null {
    const a = this.#d.autonomy;
    if (!a || parts.some((p) => p.capability === undefined)) return null;
    try {
      const c = a.constitution();
      const kinds: OutwardPolicyKind[] = [];
      for (const p of parts) {
        if (!isOutwardPolicyKind(p.kind) || c.outwardPolicy[p.kind] !== 'system') return null;
        kinds.push(p.kind);
      }
      const departmentId = employee.departmentId ?? null;
      const rule = outwardRule({
        input, kinds, rules: c, now: (a.now ?? Date.now)(),
        count: (k, since) => a.outbox.countSystem({ departmentId, employeeId: employee.id, kinds: k, since }),
      });
      if (rule) return rule;
      // Counted and written with no await between (Task 8 review M5): two calls at once never both take the last place.
      // The line and its event are one write (M1).
      a.outbox.together(() => {
        const line = this.#line(employee, tool, input, parts, 'system', []);
        if (line) this.#d.events.append(employee.id, { type: 'outbox.sent', entry: line });
      });
      return true;
    } catch (err) {
      console.error('ofis kapısı: sistem yolu hata verdi; çağrı sahibine kaldı', err);
      return null;
    }
  }

  /** The writes that go together (the outbox's savepoint); without an outbox there is no line to keep them with. */
  #together(work: () => void): void {
    const outbox = this.#d.autonomy?.outbox;
    if (outbox) outbox.together(work);
    else work();
  }

  /**
   * The outbox's line for a call let out (spec §7): its first part of an outward kind, with the approval that part
   * passed on (`approvals`: by part, Task 8 review M2); other calls write none. The caller announces it (outbox.sent).
   */
  #line(employee: Employee, tool: string, input: unknown, parts: GatePart[], via: OutboxVia, approvals: readonly string[]): OutboxEntry | null {
    const outbox = this.#d.autonomy?.outbox;
    const at = parts.findIndex((p) => isOutwardPolicyKind(p.kind));
    if (!outbox || at === -1) return null;
    const part = parts[at]!;
    return outbox.add({
      employeeId: employee.id, departmentId: employee.departmentId ?? null, tool, kind: part.kind as OutwardPolicyKind, target: part.target,
      recipients: recipientsOf(input), summary: callSummary(input), via, approvalId: approvals[at] ?? null,
    });
  }
}

const run = promisify(execFile);

/**
 * git's answers about the live checkout's worktrees, kept for two seconds (review round 1, Kerem: never run git in the
 * office's event loop). A question it has no fresh answer to is answered the careful way at once — the list as it was
 * (or empty), a worktree as dirty — and remembered; refresh() asks git for them all, in parallel, asynchronously.
 */
export class GitState {
  readonly #repoRoot: string;
  readonly #ttlMs: number;
  readonly #timeoutMs: number;
  #list: { at: number; paths: string[] } | null = null;
  readonly #states = new Map<string, { at: number; dirty: boolean }>();
  #wantList = false;
  readonly #wantDirty = new Set<string>();

  constructor(repoRoot: string, o: { ttlMs?: number; timeoutMs?: number } = {}) {
    this.#repoRoot = repoRoot;
    this.#ttlMs = o.ttlMs ?? 2000;
    this.#timeoutMs = o.timeoutMs ?? 2000;
  }

  worktrees(): string[] {
    if (this.#list && Date.now() - this.#list.at < this.#ttlMs) return this.#list.paths;
    this.#wantList = true;
    return this.#list?.paths ?? [];
  }

  dirty(wt: string): boolean {
    const known = this.#states.get(wt);
    if (known && Date.now() - known.at < this.#ttlMs) return known.dirty;
    this.#wantDirty.add(wt);
    return true;
  }

  missing(): boolean {
    return this.#wantList || this.#wantDirty.size > 0;
  }

  async refresh(): Promise<void> {
    const git = (args: string[]) => run('git', args, { encoding: 'utf8', timeout: this.#timeoutMs }).then((r) => r.stdout);
    const jobs: Array<Promise<void>> = [];
    if (this.#wantList) {
      this.#wantList = false;
      jobs.push(
        git(['-C', this.#repoRoot, 'worktree', 'list', '--porcelain'])
          .then((out) => out.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice('worktree '.length)))
          .catch(() => [] as string[])
          .then((paths) => void (this.#list = { at: Date.now(), paths })),
      );
    }
    for (const wt of [...this.#wantDirty]) {
      this.#wantDirty.delete(wt);
      jobs.push(
        git(['-C', wt, 'status', '--porcelain', '--untracked-files=all'])
          .then((out) => out.trim() !== '')
          // A worktree git cannot read: as if it held work (the careful side).
          .catch(() => true)
          .then((dirty) => void this.#states.set(wt, { at: Date.now(), dirty })),
      );
    }
    await Promise.all(jobs);
  }
}

/**
 * The real context: the live checkout's worktrees and their state from git (GitState, asynchronously), a repository's
 * top folder from the nearest .git, a script's text from the disk. Its `git` goes to the Gate.
 */
export function liveContext(o: { repoRoot: string; dataDir: string; home: string; port: () => number; hosts: string[] }): ((employee: Pick<Employee, 'slug'>) => GateContext) & { git: GitState } {
  const git = new GitState(o.repoRoot);
  const toplevel = (path: string) => {
    for (let dir = resolve(path); ; dir = dirname(dir)) {
      if (existsSync(join(dir, '.git'))) return dir;
      if (dir === dirname(dir)) return null;
    }
  };
  const realpath = (path: string) => {
    // As far as the path exists: a file to be created resolves through its folder.
    let head = resolve(path);
    let tail = '';
    while (!existsSync(head) && head !== dirname(head)) {
      tail = tail ? join(head.slice(dirname(head).length + 1), tail) : head.slice(dirname(head).length + 1);
      head = dirname(head);
    }
    try {
      const real = realpathSync(head);
      return tail ? join(real, tail) : real;
    } catch {
      return resolve(path);
    }
  };
  const readScript = (path: string) => {
    try {
      const st = statSync(path);
      return st.isFile() && st.size <= MAX_SCRIPT_BYTES ? readFileSync(path, 'utf8') : null;
    } catch {
      return null;
    }
  };
  const tmpDirs = [...new Set(['/tmp', tmpdir()])];
  const context = (employee: Pick<Employee, 'slug'>): GateContext => ({
    home: o.home,
    repoRoot: o.repoRoot,
    dataDir: o.dataDir,
    deskDir: deskDir(o.dataDir, employee.slug),
    officePort: o.port(),
    officeHosts: o.hosts,
    tmpDirs,
    toplevel,
    worktrees: () => git.worktrees(),
    dirty: (wt) => git.dirty(wt),
    readScript,
    realpath,
  });
  return Object.assign(context, { git });
}
