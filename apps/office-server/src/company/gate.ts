import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { APPROVAL_KIND_LABELS, type ApprovalKind, type ApprovalScope, type Employee, type GateDecision } from '@cc/shared';
import { deskDir } from '../desk.ts';
import type { EventStore } from '../event-store.ts';
import type { Roster } from '../roster.ts';
import type { Approvals } from './approvals.ts';
import { classifyCall, type GateContext } from './gate-policy.ts';

export interface GateDeps {
  approvals: Approvals;
  events: EventStore;
  roster: Roster;
  /** The constitution's switch (gateEnabled): off, every call passes and nothing is written. */
  enabled: () => boolean;
  /** The context of one employee's calls (their desk; the live checkout; git's answers). */
  context: (employee: Pick<Employee, 'slug'>) => GateContext;
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
 * through only on the owner's approval; a held call, let through or not, leaves a gate.checked event — a free one
 * leaves nothing.
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

  check(employeeId: string, input: unknown): GateDecision {
    const hook = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
    if (!hook || typeof hook.tool_name !== 'string' || !hook.tool_name) {
      return { decision: 'deny', reason: 'OFİS KAPISI: kancanın girdisi okunamadı; çağrı yapılmadı.' };
    }
    if (!this.#d.enabled()) return { decision: 'allow', reason: 'kapı kapalı' };
    const tool = hook.tool_name;
    const employee = this.#d.roster.get(employeeId);
    const verdict = classifyCall(tool, hook.tool_input, typeof hook.cwd === 'string' ? hook.cwd : undefined, this.#d.context(employee));
    if (!verdict.gated) return { decision: 'allow', reason: 'serbest' };
    const passed = this.#d.approvals.pass(employeeId, tool, verdict.parts);
    const first = verdict.parts[0]!;
    if (passed.ok) {
      this.#d.events.append(employeeId, { type: 'gate.checked', tool, kind: first.kind, target: first.target, decision: 'allow', approvalId: passed.ids[0] ?? null });
      return { decision: 'allow', reason: 'sahibinin onayıyla', kind: first.kind, target: first.target, approvalId: passed.ids[0] };
    }
    const part = passed.missing;
    this.#held.set(employeeId, { tool, kind: part.kind, target: part.target, scope: verdict.scope });
    this.#d.events.append(employeeId, { type: 'gate.checked', tool, kind: part.kind, target: part.target, decision: 'deny', approvalId: null });
    const more = verdict.parts.length > 1 ? ` Bu çağrıda onay isteyen ${verdict.parts.length} parça var; her biri için ayrı onay gerekir.` : '';
    const scope = verdict.scope === 'task' ? ' Görev boyunca bu tür tarayıcı işleri için scope: task iste.' : '';
    return {
      decision: 'deny',
      kind: part.kind,
      target: part.target,
      reason:
        `OFİS KAPISI: ${APPROVAL_KIND_LABELS[part.kind]} — “${part.target}” onaysız yapılamaz (${part.why}).${more} ` +
        `approvalRequest aracıyla sahibinden onay iste: summary'ye neden gerektiğini yaz (tool, kind ve target boş kalırsa bu çağrı alınır).${scope} ` +
        'Sahibi onaylayınca aynı çağrıyı tekrarla; beklerken görevi taskPark ile park et.',
    };
  }
}

/**
 * The real context: the live checkout's worktrees and their state come from git (cached for a second: a burst of
 * calls asks once), a repository's top folder from the nearest .git, a script's text from the disk.
 */
export function liveContext(o: { repoRoot: string; dataDir: string; home: string; port: () => number; hosts: string[] }): (employee: Pick<Employee, 'slug'>) => GateContext {
  const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
  let listed: { at: number; paths: string[] } | null = null;
  const states = new Map<string, { at: number; dirty: boolean }>();
  const worktrees = () => {
    if (listed && Date.now() - listed.at < 1000) return listed.paths;
    let paths: string[] = [];
    try {
      paths = git(['-C', o.repoRoot, 'worktree', 'list', '--porcelain'])
        .split('\n')
        .filter((l) => l.startsWith('worktree '))
        .map((l) => l.slice('worktree '.length));
    } catch {
      paths = [];
    }
    listed = { at: Date.now(), paths };
    return paths;
  };
  const dirty = (wt: string) => {
    const cached = states.get(wt);
    if (cached && Date.now() - cached.at < 1000) return cached.dirty;
    let isDirty = true;
    try {
      isDirty = git(['-C', wt, 'status', '--porcelain', '--untracked-files=all']).trim() !== '';
    } catch {
      // A worktree git cannot read: as if it held work (the careful side).
      isDirty = true;
    }
    states.set(wt, { at: Date.now(), dirty: isDirty });
    return isDirty;
  };
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
      const s = statSync(path);
      return s.isFile() && s.size <= MAX_SCRIPT_BYTES ? readFileSync(path, 'utf8') : null;
    } catch {
      return null;
    }
  };
  const tmpDirs = [...new Set(['/tmp', tmpdir()])];
  return (employee) => ({
    home: o.home,
    repoRoot: o.repoRoot,
    dataDir: o.dataDir,
    deskDir: deskDir(o.dataDir, employee.slug),
    officePort: o.port(),
    officeHosts: o.hosts,
    tmpDirs,
    toplevel,
    worktrees,
    dirty,
    readScript,
    realpath,
  });
}
