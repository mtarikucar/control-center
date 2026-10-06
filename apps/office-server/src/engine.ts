import type { Employee, HireInput, Lifecycle, OfficeEvent, QuotaWindow } from '@cc/shared';
import { sessionArgs, sideQuestionArgs, terminalCommand } from './claude/args.ts';
import { normalize } from './claude/normalize.ts';
import { runOnce } from './claude/once.ts';
import { ClaudeProcess } from './claude/process.ts';
import { deskDir, prepareDesk } from './desk.ts';
import { ConflictError, ValidationError } from './errors.ts';
import type { EventStore } from './event-store.ts';
import type { Roster } from './roster.ts';

export const CONTINUE_AFTER_LIMIT = 'Limit açıldı, kaldığın yerden devam et.';
export const CONTINUE_AFTER_RESTART = 'Ofis yeniden başladı; yarım kalan işine kaldığın yerden devam et.';
export const CONTINUE_AFTER_CRASH =
  'Oturumun beklenmedik şekilde kapandı ve yeniden açıldı; yarım kalan işine kaldığın yerden devam et.';

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
  readonly #runtimes = new Map<string, Runtime>();

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
    if (!rt.proc || rt.proc.exited) this.#start(employee, 'mesaj geldi');
    this.#clearLimitTimer(rt);
    const proc = rt.proc;
    if (!proc) throw new ConflictError('Çalışanın oturumu açılamadı.');
    try {
      proc.sendUser(message);
    } catch {
      throw new ConflictError('Çalışanın oturumu kapanıyor; birazdan tekrar dene.');
    }
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
    const result = await runOnce({
      command: this.#command,
      args: sideQuestionArgs({ model: employee.model, sessionId: employee.sessionId, home: this.#home }),
      cwd: prepareDesk(this.#dataDir, employee),
      env: this.#env,
      input: question,
      timeoutMs: this.#sideQuestionTimeoutMs,
    });
    this.#emit(id, { type: 'side.answer', text: result.text, ok: result.ok, usage: result.usage, costUsd: result.costUsd });
    return { ok: result.ok, answer: result.text };
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
    return this.#setLifecycle(employee, 'stopped', 'terminalden ofise döndü');
  }

  fire(id: string): Promise<void> {
    this.#roster.get(id);
    return this.#exclusive(id, async () => {
      if (this.#roster.get(id).lifecycle === 'archived') return;
      await this.#halt(id);
      this.#setLifecycle(this.#roster.get(id), 'archived', 'işten çıkarıldı');
      this.#emit(id, { type: 'employee.fired' });
    });
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
    rt.proc = new ClaudeProcess(
      {
        command: this.#command,
        args: sessionArgs({ model: employee.model, sessionId: employee.sessionId, resume: employee.sessionStarted, home: this.#home }),
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
    for (const event of normalize(raw)) {
      if (event.type === 'session.started' && !this.#roster.get(id).sessionStarted) this.#roster.update(id, { sessionStarted: true });
      if (event.type === 'quota.updated') {
        rt.quotaStatus = event.status;
        rt.windows = { fiveHour: event.fiveHour ?? rt.windows.fiveHour, sevenDay: event.sevenDay ?? rt.windows.sevenDay };
      }
      this.#emit(id, event);
      if (event.type === 'turn.finished') this.#onTurnFinished(id, event.ok, event.queuedTurns);
    }
  }

  #onTurnFinished(id: string, ok: boolean, queuedTurns: number): void {
    const rt = this.#runtime(id);
    const rejected = !ok && rt.quotaStatus === 'rejected';
    // claude still holds queued user turns: the work goes on and a later result closes it.
    if (queuedTurns > 0 && !rejected && !rt.expectingExit) return;
    rt.turnActive = false;
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
      this.#setLifecycle(this.#roster.update(id, { lastError: message }), 'error', 'süreç kısa sürede tekrar kapandı');
      return;
    }
    this.#start(employee, 'çökme sonrası yeniden açıldı');
    if (wasTurnActive) this.send(id, CONTINUE_AFTER_CRASH, 'system');
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
  }

  #limitResetTime(rt: Runtime): number {
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
      };
      this.#runtimes.set(id, rt);
    }
    return rt;
  }
}
