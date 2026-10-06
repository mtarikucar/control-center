import { randomUUID } from 'node:crypto';
import type { Employee, HireInput, Lifecycle, OfficeEvent, QuotaWindow, Usage } from '@cc/shared';
import { sessionArgs, sideQuestionArgs, terminalCommand } from './claude/args.ts';
import { normalize, replayedUuid, usageSince } from './claude/normalize.ts';
import { runOnce } from './claude/once.ts';
import { ClaudeProcess } from './claude/process.ts';
import { deskDir, prepareDesk } from './desk.ts';
import { ConflictError, ValidationError } from './errors.ts';
import type { EventStore } from './event-store.ts';
import type { TokenRegistry } from './mcp/tokens.ts';
import type { Roster } from './roster.ts';

export const CONTINUE_AFTER_LIMIT = 'Limit açıldı, kaldığın yerden devam et.';
export const CONTINUE_AFTER_RESTART = 'Ofis yeniden başladı; yarım kalan işine kaldığın yerden devam et.';
/**
 * Put before a side question asked while the employee works: the fork sees the open tool call cut off ("interrupted")
 * and would otherwise answer as if the work had stopped.
 */
export const SIDE_QUESTION_MID_WORK =
  '[Ofis notu — yan soru: asıl oturumun şu an çalışıyor ve işine devam ediyor. Bu kopyada son aracın "kesildi" görünmesi yalnızca bu yan soruya ait; iş durmadı. Sorunun dilinde, kısaca cevap ver.]';

const clip = (text: string, limit: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
};

/** "Bash — npm test" style: the tool and its most telling input field. */
function describeTool(name: string, input: unknown): string {
  if (typeof input !== 'object' || input === null) return name;
  const record = input as Record<string, unknown>;
  const key = ['command', 'file_path', 'notebook_path', 'pattern', 'url', 'query', 'description'].find((k) => typeof record[k] === 'string');
  return key ? `${name} — ${clip(record[key] as string, 200)}` : name;
}

export const CONTINUE_AFTER_CRASH =
  'Oturumun beklenmedik şekilde kapandı ve yeniden açıldı; yarım kalan işine kaldığın yerden devam et.';

type TurnFinished = Extract<OfficeEvent, { type: 'turn.finished' }>;
interface Totals {
  usage: Usage;
  costUsd: number;
}
const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };

export interface EngineOptions {
  roster: Roster;
  events: EventStore;
  dataDir: string;
  claudeCommand: string[];
  env?: NodeJS.ProcessEnv;
  home?: string;
  now?: () => number;
  crashWindowMs?: number;
  limitGraceMs?: number;
  stopTimeoutMs?: number;
  sideQuestionTimeoutMs?: number;
  /** The office tools (MCP over HTTP): `url` is read at every session start, a fresh token is issued each time. */
  mcp?: { url: () => string; tokens: TokenRegistry };
}

interface Runtime {
  proc: ClaudeProcess | null;
  turnActive: boolean;
  expectingExit: boolean;
  crashes: number[];
  quotaStatus: string;
  windows: { fiveHour: QuotaWindow | null; sevenDay: QuotaWindow | null };
  limitTimer: NodeJS.Timeout | null;
  turnWaiters: Array<() => void>;
  /** stop / fire / open-in-terminal run one at a time per employee; while any is queued, messages are refused. */
  opChain: Promise<void>;
  pendingOps: number;
  /** Messages written to claude that it has not acknowledged yet; re-sent if the process dies. */
  unread: Array<{ uuid: string; text: string }>;
  /** claude took in at least one message of the current turn, so there is work to continue after a crash. */
  consumedInTurn: boolean;
  /** claude's running totals at the last result; null until loaded from the event log. */
  totals: Totals | null;
  /** Reset of the window that rejected the last request, when claude named it. */
  limitAt: number | null;
}

export class Engine {
  readonly #roster: Roster;
  readonly #events: EventStore;
  readonly #dataDir: string;
  readonly #command: string[];
  readonly #env: NodeJS.ProcessEnv | undefined;
  readonly #home: string | undefined;
  readonly #now: () => number;
  readonly #crashWindowMs: number;
  readonly #limitGraceMs: number;
  readonly #stopTimeoutMs: number;
  readonly #sideQuestionTimeoutMs: number;
  readonly #mcp: EngineOptions['mcp'];
  readonly #runtimes = new Map<string, Runtime>();
  readonly #sideRuns = new Set<AbortController>();

  constructor(o: EngineOptions) {
    this.#roster = o.roster;
    this.#events = o.events;
    this.#dataDir = o.dataDir;
    this.#command = o.claudeCommand;
    this.#env = o.env;
    this.#home = o.home;
    this.#now = o.now ?? Date.now;
    this.#crashWindowMs = o.crashWindowMs ?? 120_000;
    this.#limitGraceMs = o.limitGraceMs ?? 30_000;
    this.#stopTimeoutMs = o.stopTimeoutMs ?? 10_000;
    this.#sideQuestionTimeoutMs = o.sideQuestionTimeoutMs ?? 120_000;
    this.#mcp = o.mcp;
  }

  hire(input: HireInput): Employee {
    const employee = this.#roster.create(input);
    this.#emit(employee.id, { type: 'employee.hired', name: employee.name });
    return this.#start(employee, 'işe alındı');
  }

  send(id: string, text: string, source: 'owner' | 'system' = 'owner'): void {
    const message = text.trim();
    if (!message) throw new ValidationError('Mesaj boş olamaz.');
    const employee = this.#roster.get(id);
    this.#assertReachable(employee);
    const rt = this.#runtime(id);
    this.#assertNotBusy(rt);
    if (employee.lastError !== null || employee.limitResetsAt !== null) this.#roster.update(id, { lastError: null, limitResetsAt: null });
    if (!rt.proc || rt.proc.exited) this.#start(employee, 'mesaj geldi');
    this.#clearLimitTimer(rt);
    const proc = rt.proc;
    if (!proc) throw new ConflictError('Çalışanın oturumu açılamadı.');
    const uuid = randomUUID();
    try {
      proc.sendUser(message, uuid);
    } catch {
      throw new ConflictError('Çalışanın oturumu kapanıyor; birazdan tekrar dene.');
    }
    rt.unread.push({ uuid, text: message });
    this.#emit(id, { type: 'message.user', text: message, source });
    if (!rt.turnActive) {
      rt.turnActive = true;
      this.#emit(id, { type: 'turn.started' });
      this.#setLifecycle(this.#roster.get(id), 'working', source === 'owner' ? 'sahibinden mesaj' : 'sistem mesajı');
    }
  }

  async sideQuestion(id: string, text: string): Promise<{ ok: boolean; answer: string }> {
    const question = text.trim();
    if (!question) throw new ValidationError('Soru boş olamaz.');
    const employee = this.#roster.get(id);
    if (employee.lifecycle === 'archived') throw new ConflictError('Bu çalışan işten çıkarıldı.');
    if (!employee.sessionStarted) throw new ConflictError('Bu çalışan henüz hiç konuşmadı; önce normal bir mesaj gönder.');
    this.#emit(id, { type: 'side.question', text: question });
    const input = this.#runtime(id).turnActive ? `${this.#workNote(id)}\n\n${question}` : question;
    const atFork = this.#totals(id);
    const abort = new AbortController();
    this.#sideRuns.add(abort);
    let result: Awaited<ReturnType<typeof runOnce>>;
    try {
      result = await runOnce({
        signal: abort.signal,
        command: this.#command,
        args: sideQuestionArgs({ model: employee.model, sessionId: employee.sessionId, home: this.#home }),
        cwd: prepareDesk(this.#dataDir, employee),
        env: this.#env,
        input,
        timeoutMs: this.#sideQuestionTimeoutMs,
      });
    } finally {
      this.#sideRuns.delete(abort);
    }
    // The fork's running totals start from the parent's, so only the difference is this question's cost.
    const usage = result.sessionUsage ? usageSince(result.sessionUsage, atFork.usage) : result.usage;
    const costUsd = result.sessionCostUsd >= atFork.costUsd ? result.sessionCostUsd - atFork.costUsd : result.sessionCostUsd;
    this.#emit(id, { type: 'side.answer', text: result.text, ok: result.ok, usage, costUsd });
    return { ok: result.ok, answer: result.text };
  }

  /** What the employee is doing right now, from this turn's events: the owner's asks and the tools still running. */
  #workNote(id: string): string {
    const after = this.#events.latest(id, 'turn.finished')?.seq ?? 0;
    const current = this.#events.list({ after, employeeId: id, limit: 500 });
    const asks: string[] = [];
    const open = new Map<string, string>();
    for (const s of current) {
      const ev = s.event;
      if (ev.type === 'message.user') asks.push(`«${clip(ev.text, 300)}»`);
      else if (ev.type === 'tool.started') open.set(ev.toolUseId, describeTool(ev.name, ev.input));
      else if (ev.type === 'tool.finished') open.delete(ev.toolUseId);
    }
    const lines = [SIDE_QUESTION_MID_WORK];
    if (asks.length > 0) lines.push(`Şu anki iş: ${asks.join(' · ')}`);
    if (open.size > 0) lines.push(`Çalışan araç: ${[...open.values()].join(' · ')}`);
    return lines.join('\n');
  }

  stop(id: string): Promise<Employee> {
    return this.#exclusive(id, async () => {
      this.#assertReachable(this.#roster.get(id));
      await this.#halt(id);
      return this.#setLifecycle(this.#roster.update(id, { limitResetsAt: null }), 'stopped', 'sahibi durdurdu');
    });
  }

  resume(id: string): Employee {
    const employee = this.#roster.get(id);
    this.#assertReachable(employee);
    this.#assertNotBusy(this.#runtime(id));
    const wasInterrupted = employee.lifecycle === 'interrupted';
    this.#runtime(id).crashes = [];
    this.#start(this.#roster.update(id, { lastError: null }), 'sahibi devam ettirdi');
    if (wasInterrupted) this.send(id, CONTINUE_AFTER_RESTART, 'system');
    return this.#roster.get(id);
  }

  openInTerminal(id: string): Promise<{ command: string; employee: Employee }> {
    return this.#exclusive(id, async () => {
      const employee = this.#roster.get(id);
      this.#assertReachable(employee);
      if (!employee.sessionStarted) throw new ConflictError('Bu çalışan henüz hiç konuşmadı; terminalde açılacak bir oturum yok.');
      await this.#halt(id);
      const updated = this.#setLifecycle(this.#roster.get(id), 'in_terminal', 'terminalde açıldı');
      return { command: terminalCommand(deskDir(this.#dataDir, employee.slug), employee.sessionId), employee: updated };
    });
  }

  returnFromTerminal(id: string): Employee {
    const employee = this.#roster.get(id);
    if (employee.lifecycle !== 'in_terminal') throw new ConflictError('Bu çalışan terminalde değil.');
    // Back at the desk and ready: the office picks the same session up again (an idle process spends no tokens).
    this.#runtime(id).crashes = [];
    return this.#start(employee, 'terminalden ofise döndü');
  }

  fire(id: string): Promise<void> {
    this.#roster.get(id);
    return this.#exclusive(id, async () => {
      if (this.#roster.get(id).lifecycle === 'archived') return;
      await this.#halt(id);
      this.#mcp?.tokens.revoke(id);
      this.#setLifecycle(this.#roster.get(id), 'archived', 'işten çıkarıldı');
      this.#emit(id, { type: 'employee.fired' });
    });
  }

  /** Idle with a live session and nothing queued against it: the moment to hand over the next task. */
  ready(id: string): boolean {
    let employee: Employee;
    try {
      employee = this.#roster.get(id);
    } catch {
      return false;
    }
    if (employee.lifecycle !== 'idle') return false;
    const rt = this.#runtimes.get(id);
    return rt !== undefined && rt.proc !== null && !rt.proc.exited && !rt.turnActive && rt.pendingOps === 0;
  }

  /** Call once after the office process starts, before serving requests. */
  recover(): void {
    for (const employee of this.#roster.list()) {
      if (employee.lifecycle === 'working') this.#setLifecycle(employee, 'interrupted', 'ofis kapanırken iş sürüyordu');
      else if (employee.lifecycle === 'idle' || employee.lifecycle === 'starting') this.#start(employee, 'ofis açıldı');
      else if (employee.lifecycle === 'limited' && employee.limitResetsAt !== null) this.#scheduleLimitContinue(employee.id, employee.limitResetsAt);
    }
  }

  /** Closes every session but keeps lifecycles, so the next `recover()` can pick up where we left. */
  async shutdown(): Promise<void> {
    for (const run of this.#sideRuns) run.abort();
    await Promise.all(
      [...this.#runtimes.values()].map(async (rt) => {
        this.#clearLimitTimer(rt);
        const proc = rt.proc;
        if (!proc || proc.exited) return;
        rt.expectingExit = true;
        await proc.close(2000);
        rt.proc = null;
      }),
    );
  }

  #start(employee: Employee, reason: string): Employee {
    const rt = this.#runtime(employee.id);
    if (rt.proc && !rt.proc.exited) return this.#roster.get(employee.id);
    rt.expectingExit = false;
    rt.turnActive = false;
    const mcpConfig = this.#mcp
      ? JSON.stringify({
          mcpServers: {
            office: { type: 'http', url: this.#mcp.url(), headers: { Authorization: `Bearer ${this.#mcp.tokens.issue(employee.id)}` } },
          },
        })
      : undefined;
    rt.proc = new ClaudeProcess(
      {
        command: this.#command,
        args: sessionArgs({ model: employee.model, sessionId: employee.sessionId, resume: employee.sessionStarted, home: this.#home, mcpConfig }),
        cwd: prepareDesk(this.#dataDir, employee),
        env: this.#env,
      },
      {
        onJson: (obj) => this.#onJson(employee.id, obj),
        onExit: (code, signal, stderr) => this.#onExit(employee.id, code, signal, stderr),
      },
    );
    return this.#setLifecycle(this.#roster.get(employee.id), 'idle', reason);
  }

  #onJson(id: string, raw: unknown): void {
    const rt = this.#runtime(id);
    const acknowledged = replayedUuid(raw);
    if (acknowledged) {
      rt.unread = rt.unread.filter((m) => m.uuid !== acknowledged);
      rt.consumedInTurn = true;
    }
    for (const event of normalize(raw)) {
      if (event.type === 'session.started' && !this.#roster.get(id).sessionStarted) this.#roster.update(id, { sessionStarted: true });
      if (event.type === 'quota.updated') {
        rt.quotaStatus = event.status;
        rt.limitAt = event.limitResetsAt ?? null;
        rt.windows = { fiveHour: event.fiveHour ?? rt.windows.fiveHour, sevenDay: event.sevenDay ?? rt.windows.sevenDay };
      }
      if (event.type === 'turn.finished') {
        this.#emit(id, this.#accountTurn(id, event));
        this.#onTurnFinished(id, event.ok, event.queuedTurns);
        continue;
      }
      this.#emit(id, event);
    }
  }

  /** claude reports running totals; record what this turn added on top of the previous result. */
  #accountTurn(id: string, event: TurnFinished): TurnFinished {
    const before = this.#totals(id);
    const usage = event.sessionUsage ? usageSince(event.sessionUsage, before.usage) : event.usage;
    const costUsd = event.sessionCostUsd >= before.costUsd ? event.sessionCostUsd - before.costUsd : event.sessionCostUsd;
    this.#runtime(id).totals = { usage: event.sessionUsage ?? before.usage, costUsd: event.sessionCostUsd };
    return { ...event, usage, costUsd };
  }

  #totals(id: string): Totals {
    const rt = this.#runtime(id);
    if (!rt.totals) {
      const last = this.#events.latest(id, 'turn.finished')?.event;
      rt.totals =
        last?.type === 'turn.finished' ? { usage: last.sessionUsage ?? NO_USAGE, costUsd: last.sessionCostUsd ?? 0 } : { usage: NO_USAGE, costUsd: 0 };
    }
    return rt.totals;
  }

  #onTurnFinished(id: string, ok: boolean, queuedTurns: number): void {
    const rt = this.#runtime(id);
    // A turn that went through proves the subscription is open again, even if claude sent no fresh reading.
    if (ok) {
      rt.quotaStatus = '';
      rt.limitAt = null;
    }
    const rejected = !ok && rt.quotaStatus === 'rejected';
    // claude still holds queued user turns: the work goes on and a later result closes it.
    if (queuedTurns > 0 && !rejected && !rt.expectingExit) return;
    rt.turnActive = false;
    rt.consumedInTurn = false;
    for (const resolve of rt.turnWaiters.splice(0)) resolve();
    if (rt.expectingExit) return;
    const employee = this.#roster.get(id);
    if (employee.lifecycle !== 'working') return;
    if (rejected) {
      const resetsAt = this.#limitResetTime(rt);
      this.#setLifecycle(this.#roster.update(id, { limitResetsAt: resetsAt }), 'limited', 'abonelik limiti doldu');
      this.#scheduleLimitContinue(id, resetsAt);
      return;
    }
    this.#setLifecycle(employee, 'idle', ok ? 'iş bitti' : 'iş hatayla bitti');
  }

  #onExit(id: string, code: number | null, signal: NodeJS.Signals | null, stderr: string): void {
    const rt = this.#runtime(id);
    const wasTurnActive = rt.turnActive;
    const resumeWork = wasTurnActive && rt.consumedInTurn;
    const unread = rt.unread.splice(0);
    rt.consumedInTurn = false;
    rt.proc = null;
    rt.turnActive = false;
    for (const resolve of rt.turnWaiters.splice(0)) resolve();
    if (rt.expectingExit) {
      rt.expectingExit = false;
      return;
    }
    const employee = this.#roster.get(id);
    if (employee.lifecycle === 'archived' || employee.lifecycle === 'in_terminal' || employee.lifecycle === 'stopped') return;
    const now = this.#now();
    rt.crashes = rt.crashes.filter((t) => now - t < this.#crashWindowMs).concat(now);
    const tail = stderr.trim().slice(-500);
    const message = `claude süreci beklenmedik şekilde kapandı (kod ${code ?? '-'}, sinyal ${signal ?? '-'}).${tail ? ` ${tail}` : ''}`;
    this.#emit(id, { type: 'error', message });
    if (rt.crashes.length >= 2) {
      if (unread.length > 0) this.#emit(id, { type: 'error', message: `Okunmamış ${unread.length} mesaj teslim edilemedi.` });
      this.#setLifecycle(this.#roster.update(id, { lastError: message }), 'error', 'süreç kısa sürede tekrar kapandı');
      return;
    }
    this.#start(employee, 'çökme sonrası yeniden açıldı');
    if (resumeWork) this.send(id, CONTINUE_AFTER_CRASH, 'system');
    if (unread.length > 0) this.#redeliver(id, unread);
  }

  /** Re-sends messages claude never acknowledged, without logging them a second time. */
  #redeliver(id: string, messages: Array<{ uuid: string; text: string }>): void {
    const rt = this.#runtime(id);
    const proc = rt.proc;
    if (!proc) return;
    for (const m of messages) {
      try {
        proc.sendUser(m.text, m.uuid);
        rt.unread.push(m);
      } catch {
        this.#emit(id, { type: 'error', message: 'Okunmamış bir mesaj yeniden gönderilemedi.' });
      }
    }
    if (!rt.turnActive) {
      rt.turnActive = true;
      this.#emit(id, { type: 'turn.started' });
      this.#setLifecycle(this.#roster.get(id), 'working', 'okunmamış mesajlar yeniden gönderildi');
    }
  }

  async #halt(id: string): Promise<void> {
    const rt = this.#runtime(id);
    this.#clearLimitTimer(rt);
    const proc = rt.proc;
    if (!proc || proc.exited) {
      rt.proc = null;
      return;
    }
    rt.expectingExit = true;
    if (rt.turnActive) {
      const finished = new Promise<void>((resolve) => rt.turnWaiters.push(resolve));
      try {
        proc.interrupt();
      } catch {
        // The process is already going away; close() below finishes the job.
      }
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([finished, new Promise<void>((resolve) => (timer = setTimeout(resolve, this.#stopTimeoutMs)))]);
      clearTimeout(timer);
    }
    await proc.close();
    rt.proc = null;
    if (rt.unread.length > 0) this.#emit(id, { type: 'error', message: `Durdurma sırasında okunmamış ${rt.unread.length} mesaj iptal edildi.` });
    rt.unread = [];
    rt.consumedInTurn = false;
  }

  #limitResetTime(rt: Runtime): number {
    if (rt.limitAt !== null && rt.limitAt > this.#now()) return rt.limitAt;
    const windows = [rt.windows.fiveHour, rt.windows.sevenDay].filter((w): w is QuotaWindow => w !== null);
    const full = windows.filter((w) => w.utilization >= 1);
    const candidates = (full.length > 0 ? full : windows.slice(0, 1)).map((w) => w.resetsAt);
    return candidates.length > 0 ? Math.max(...candidates) : this.#now() + 60 * 60_000;
  }

  #scheduleLimitContinue(id: string, resetsAt: number): void {
    const rt = this.#runtime(id);
    this.#clearLimitTimer(rt);
    const delay = Math.max(0, resetsAt - this.#now()) + this.#limitGraceMs;
    const timer = setTimeout(() => {
      rt.limitTimer = null;
      if (this.#roster.get(id).lifecycle !== 'limited') return;
      this.#roster.update(id, { limitResetsAt: null });
      try {
        this.send(id, CONTINUE_AFTER_LIMIT, 'system');
      } catch (err) {
        this.#emit(id, { type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    }, delay);
    timer.unref();
    rt.limitTimer = timer;
  }

  #exclusive<T>(id: string, op: () => Promise<T>): Promise<T> {
    const rt = this.#runtime(id);
    rt.pendingOps += 1;
    const run = rt.opChain.then(op);
    rt.opChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run.finally(() => {
      rt.pendingOps -= 1;
    });
  }

  #assertNotBusy(rt: Runtime): void {
    if (rt.pendingOps > 0) throw new ConflictError('Çalışan şu an durduruluyor; birazdan tekrar dene.');
  }

  #clearLimitTimer(rt: Runtime): void {
    if (rt.limitTimer) clearTimeout(rt.limitTimer);
    rt.limitTimer = null;
  }

  #assertReachable(employee: Employee): void {
    if (employee.lifecycle === 'archived') throw new ConflictError('Bu çalışan işten çıkarıldı.');
    if (employee.lifecycle === 'in_terminal') throw new ConflictError('Bu çalışan şu an terminalde; önce ofise geri al.');
  }

  #setLifecycle(employee: Employee, to: Lifecycle, reason: string): Employee {
    if (employee.lifecycle === to) return employee;
    const updated = this.#roster.update(employee.id, { lifecycle: to });
    this.#emit(employee.id, { type: 'lifecycle.changed', from: employee.lifecycle, to, reason });
    return updated;
  }

  #emit(id: string, event: OfficeEvent): void {
    this.#events.append(id, event);
  }

  #runtime(id: string): Runtime {
    let rt = this.#runtimes.get(id);
    if (!rt) {
      rt = {
        proc: null,
        turnActive: false,
        expectingExit: false,
        crashes: [],
        quotaStatus: '',
        windows: { fiveHour: null, sevenDay: null },
        limitTimer: null,
        turnWaiters: [],
        opChain: Promise.resolve(),
        pendingOps: 0,
        unread: [],
        consumedInTurn: false,
        totals: null,
        limitAt: null,
      };
      this.#runtimes.set(id, rt);
    }
    return rt;
  }
}
