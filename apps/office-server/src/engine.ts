import { randomUUID } from 'node:crypto';
import type { Employee, HireInput, Lifecycle, ModelAlias, OfficeEvent, QuotaWindow, Usage } from '@cc/shared';
import { sessionArgs, sideQuestionArgs, terminalCommand } from './claude/args.ts';
import { normalize, replayedUuid, taskChange, usageSince } from './claude/normalize.ts';
import { runOnce } from './claude/once.ts';
import { ClaudeProcess } from './claude/process.ts';
import { deskDir, prepareDesk, writeDeskDeny } from './desk.ts';
import { ConflictError, ValidationError } from './errors.ts';
import type { EventStore } from './event-store.ts';
import type { TokenRegistry } from './mcp/tokens.ts';
import { modelPolicy } from './model-policy.ts';
import type { NewEmployee, Roster } from './roster.ts';

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
/** How long jobs of the session alone (no turn) may keep an employee working before they are free for tasks again. */
export const BACKGROUND_LIMIT_MS = 2 * 60 * 60_000;
export const CONTINUE_AFTER_TERMINAL =
  'Terminalden ofise döndün. Terminale alınırken süren işin ve arka planda çalışan komutların durduruldu; yarım kalmış bir değişiklik varsa kontrol et ve kaldığın yerden devam et.';

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
  /**
   * The gate (B9a): the hook's command for the sessions' settings and where it asks. The session's environment gets
   * OFFICE_GATE_URL and OFFICE_GATE_TOKEN (the session's own office token). Needs `mcp`.
   */
  gate?: { url: () => string; hook: string };
  /** How long a session's prompt cache stays warm (the constitution's cacheTtlMinutes; default 5). */
  cacheTtlMinutes?: () => number;
  /**
   * The constitution's modelPolicyEnabled (default off): off, hints are ignored and sessions run on the employee's own
   * model — all but role hints (the coordinator's model by turn type), which apply either way.
   */
  modelPolicyEnabled?: () => boolean;
  /** The employee's own closed tools (B9b, session-deny.ts), asked for each time a session starts; absent: none. */
  sessionDeny?: (employee: Employee) => string[];
  /** After the last background job ends between turns, how long the turn claude opens to read it may take to come (default 30 s). */
  followUpGraceMs?: number;
  /** Past this the jobs no longer hold the employee: idle, the office is told, the jobs run on (default BACKGROUND_LIMIT_MS). */
  backgroundLimitMs?: number;
}

/** What a message would best run on; the session moves there only as modelPolicy allows, never in the middle of a turn. */
export interface ModelHint {
  model?: ModelAlias;
  /** The message starts a task: the task's model applies either way. */
  taskStart?: boolean;
  /**
   * A role hint: the coordinator's model for what the turn is for (management cycle §3.5). It applies whatever the
   * model policy says, by the same rule as any hint (a stronger model at once, a weaker one after the cache pause).
   */
  role?: boolean;
}

export interface SendOptions extends ModelHint {
  /** Called once if the message is lost: no session could be (re)started to read it. */
  onLost?: () => void;
}

/** A model the session could not start on is not asked for again this long; the work goes on on the model it had. */
const FAILED_MODEL_PAUSE_MS = 10 * 60_000;

interface Pending {
  text: string;
  source: 'owner' | 'system';
  onLost?: () => void;
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
  /** The role card or tools changed while a turn was running: start the session again once it ends. */
  reloadPending: boolean;
  pendingOps: number;
  /** Messages written to claude that it has not acknowledged yet; re-sent if the process dies. */
  unread: Array<{ uuid: string; text: string; onLost?: () => void }>;
  /** claude took in at least one message of the current turn, so there is work to continue after a crash. */
  consumedInTurn: boolean;
  /** claude's running totals at the last result; null until loaded from the event log. */
  totals: Totals | null;
  /** When the last turn ended (engine clock); null until one ends in this run (then the event log says). */
  lastTurnAt: number | null;
  /** The session is restarting on another model: the message that asked for it and those that came meanwhile. */
  switching: Pending[] | null;
  /** The model it is restarting on (meaningful while `switching`). */
  switchingTo: ModelAlias | null;
  /** The model the running session was started on when it is not the employee's own (role) model; null: their own. */
  model: ModelAlias | null;
  /**
   * The session was just restarted from this model onto another. Until its first turn ends well the switch is on trial:
   * if the process exits or that turn fails, the switch failed (e.g. the account cannot use the model).
   */
  switchedFrom: ModelAlias | null;
  /** The model its session ran on when it was taken to the terminal at work (K1): the work goes on on it when it is back. */
  terminalModel: ModelAlias | null;
  /** Messages written since the switch, sent again on the old model if the switch fails. */
  sinceSwitch: Pending[];
  /** A tool ran in the turn now open: the session did work on its model (a failure then is not the model's). */
  toolsInTurn: boolean;
  /** The last thing the session said (why a failed turn failed). */
  lastText: string;
  /** The last model the session could not start on, and when. */
  failedModel: { model: ModelAlias; at: number } | null;
  /** Reset of the window that rejected the last request, when claude named it. */
  limitAt: number | null;
  /** Jobs the session runs beside its turns that keep the employee working (claude's task id → description); they end with the process. */
  background: Map<string, string>;
  /** Jobs still running that the cap freed the employee from. */
  freed: Set<string>;
  /** Jobs alone hold the employee: when the cap comes. */
  capTimer: NodeJS.Timeout | null;
  /** The last job ended between turns: waiting for the turn claude opens by itself to read it. */
  followUpTimer: NodeJS.Timeout | null;
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
  readonly #gate: EngineOptions['gate'];
  readonly #cacheTtlMinutes: () => number;
  readonly #modelPolicyEnabled: () => boolean;
  readonly #sessionDeny: ((employee: Employee) => string[]) | undefined;
  readonly #followUpGraceMs: number;
  readonly #backgroundLimitMs: number;
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
    this.#gate = o.gate;
    this.#cacheTtlMinutes = o.cacheTtlMinutes ?? (() => 5);
    this.#modelPolicyEnabled = o.modelPolicyEnabled ?? (() => false);
    this.#sessionDeny = o.sessionDeny;
    this.#followUpGraceMs = o.followUpGraceMs ?? 30_000;
    this.#backgroundLimitMs = o.backgroundLimitMs ?? BACKGROUND_LIMIT_MS;
  }

  hire(input: NewEmployee): Employee {
    const employee = this.#roster.create(input);
    this.#emit(employee.id, { type: 'employee.hired', name: employee.name });
    // Closed mode (B5): the desk's settings are in place before the first session opens and reads them.
    if (input.deskDeny?.length) writeDeskDeny(this.#dataDir, employee.slug, input.deskDeny);
    return this.#start(employee, 'işe alındı');
  }

  /** Sends a message; returns the model it runs on (where the hint moved the session, or the one it keeps). */
  send(id: string, text: string, source: 'owner' | 'system' = 'owner', opts: SendOptions = {}): ModelAlias {
    return this.#deliver(id, text, source, opts, false);
  }

  /**
   * `keep`: the office's own "continue" (after a crash, a limit, a restart) — the same work goes on on the session's
   * model, whatever the policy says (with it off, it would otherwise take a role hint's model back).
   */
  #deliver(id: string, text: string, source: 'owner' | 'system', opts: SendOptions, keep: boolean): ModelAlias {
    const message = text.trim();
    if (!message) throw new ValidationError('Mesaj boş olamaz.');
    let employee = this.#roster.get(id);
    this.#assertReachable(employee);
    const rt = this.#runtime(id);
    if (rt.switching) {
      // The session is restarting on another model: this message goes in right after the one that asked for it.
      rt.switching.push({ text: message, source, onLost: opts.onLost });
      this.#emit(id, { type: 'message.user', text: message, source });
      return rt.switchingTo ?? this.#sessionModel(employee, rt);
    }
    this.#assertNotBusy(rt);
    if (employee.lastError !== null || employee.limitResetsAt !== null) employee = this.#roster.update(id, { lastError: null, limitResetsAt: null });
    this.#clearLimitTimer(rt);
    // The hint moves only this session; the employee's own model (the roster's) stays what the owner or coordinator set.
    const model = keep ? null : this.#switchTo(employee, rt, opts);
    if (model && rt.proc && !rt.proc.exited) {
      this.#restartAndWrite(id, model, { text: message, source, onLost: opts.onLost });
      return model;
    }
    if (model) rt.model = model;
    if (!rt.proc || rt.proc.exited) this.#start(employee, 'mesaj geldi');
    this.#write(id, message, source, { onLost: opts.onLost });
    return this.#sessionModel(employee, rt);
  }

  /** The model the session runs on (or would start on). */
  #sessionModel(employee: Employee, rt: Runtime): ModelAlias {
    return rt.model ?? employee.model;
  }

  /**
   * The model a hint moves the session to now, or null to keep it. With the policy off: back to their own model — but a
   * role hint applies whatever the policy says.
   */
  #switchTo(employee: Employee, rt: Runtime, requested: ModelHint): ModelAlias | null {
    const hint: ModelHint = this.#modelPolicyEnabled() || requested.role ? requested : { model: employee.model, taskStart: true };
    // Restarting the session would end the jobs it runs.
    if (!hint.model || rt.turnActive || this.#jobsRunning(rt)) return null;
    if (rt.failedModel?.model === hint.model && this.#now() - rt.failedModel.at < FAILED_MODEL_PAUSE_MS) return null;
    const lastTurnFinishedAt = rt.lastTurnAt ?? this.#events.latest(employee.id, 'turn.finished')?.ts ?? null;
    const choice = modelPolicy.decide({
      current: this.#sessionModel(employee, rt), wanted: hint.model, lastTurnFinishedAt, now: this.#now(), ttlMinutes: this.#cacheTtlMinutes(), taskStart: hint.taskStart,
    });
    return choice === 'switch' ? hint.model : null;
  }

  /**
   * Starts the idle session again on another model (memory resumes), then writes the message and any that came meanwhile.
   * If it cannot start there, the session goes on on the model it had and the messages go to it (see #onExit too).
   */
  #restartAndWrite(id: string, model: ModelAlias, first: Pending): void {
    const rt = this.#runtime(id);
    const from = this.#sessionModel(this.#roster.get(id), rt);
    rt.switching = [first];
    rt.switchingTo = model;
    rt.reloadPending = false;
    this.#emit(id, { type: 'message.user', text: first.text, source: first.source });
    void this.#exclusive(id, async () => {
      await this.#halt(id);
      const queued = rt.switching ?? [];
      rt.switching = null;
      try {
        rt.model = model;
        rt.switchedFrom = from;
        rt.sinceSwitch = [];
        this.#start(this.#roster.get(id), `${model} modeline geçti`);
      } catch (err) {
        this.#failedSwitch(id, model, from, err instanceof Error ? err.message : String(err));
        try {
          this.#start(this.#roster.get(id), `${from} ile sürüyor`);
        } catch (again) {
          for (const m of queued) m.onLost?.();
          throw again;
        }
      }
      queued.forEach((m, i) => {
        try {
          this.#write(id, m.text, m.source, { logged: true, onLost: m.onLost });
        } catch (err) {
          for (const lost of queued.slice(i)) lost.onLost?.();
          throw err;
        }
      });
    }).catch((err: unknown) => {
      for (const m of rt.switching ?? []) m.onLost?.();
      rt.switching = null;
      this.#emit(id, { type: 'error', message: `Model değişirken mesaj teslim edilemedi: ${err instanceof Error ? err.message : String(err)}` });
    });
  }

  /** The session could not run on `model`: it goes on on `from`, and `model` is not asked for again for a while. */
  #failedSwitch(id: string, model: ModelAlias, from: ModelAlias, reason: string): void {
    const rt = this.#runtime(id);
    rt.failedModel = { model, at: this.#now() };
    rt.model = from;
    rt.switchedFrom = null;
    this.#emit(id, { type: 'model.switch.failed', from, to: model, reason: reason.slice(0, 500) });
  }

  /**
   * The first turn on a new model failed — the real CLI starts on a model the account cannot use, takes the message and
   * answers with an error, and stays up. Close it, start again on the model it had and send the turn's messages again.
   */
  #retryOn(id: string, from: ModelAlias): void {
    const rt = this.#runtime(id);
    const messages = rt.sinceSwitch;
    rt.sinceSwitch = [];
    this.#failedSwitch(id, this.#sessionModel(this.#roster.get(id), rt), from, rt.lastText || 'ilk tur hatayla bitti');
    rt.switching = messages;
    rt.switchingTo = from;
    void this.#exclusive(id, async () => {
      await this.#halt(id);
      rt.model = from;
      const queued = rt.switching ?? [];
      rt.switching = null;
      this.#start(this.#roster.get(id), `${from} ile sürüyor`);
      queued.forEach((m, i) => {
        try {
          this.#write(id, m.text, m.source, { logged: true, onLost: m.onLost });
        } catch (err) {
          for (const lost of queued.slice(i)) lost.onLost?.();
          throw err;
        }
      });
    }).catch((err: unknown) => {
      for (const m of rt.switching ?? []) m.onLost?.();
      rt.switching = null;
      this.#emit(id, { type: 'error', message: `Model geri alınırken mesaj teslim edilemedi: ${err instanceof Error ? err.message : String(err)}` });
    });
  }

  /** Writes a message to the running session and opens a turn if none is open. */
  #write(id: string, message: string, source: 'owner' | 'system', o: { logged?: boolean; onLost?: () => void } = {}): void {
    const rt = this.#runtime(id);
    const proc = rt.proc;
    if (!proc) throw new ConflictError('Çalışanın oturumu açılamadı.');
    const uuid = randomUUID();
    try {
      proc.sendUser(message, uuid);
    } catch {
      throw new ConflictError('Çalışanın oturumu kapanıyor; birazdan tekrar dene.');
    }
    rt.unread.push({ uuid, text: message, onLost: o.onLost });
    if (rt.switchedFrom) rt.sinceSwitch.push({ text: message, source, onLost: o.onLost });
    if (!o.logged) this.#emit(id, { type: 'message.user', text: message, source });
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

  /** Closes an idle employee's session to free the machine; their next task or message starts it again (same session). */
  sleep(id: string): Promise<Employee> {
    return this.#exclusive(id, async () => {
      const employee = this.#roster.get(id);
      if (employee.lifecycle === 'sleeping') return employee;
      if (employee.lifecycle !== 'idle' || this.#runtime(id).turnActive) throw new ConflictError('Yalnız boştaki bir çalışan uyutulabilir; işi bitince uyut.');
      if (this.#jobsRunning(this.#runtime(id))) throw new ConflictError('Arka planda işi sürüyor; uyutulursa o iş de kapanır.');
      await this.#halt(id);
      return this.#setLifecycle(this.#roster.get(id), 'sleeping', 'uyutuldu');
    });
  }

  /** A sleeper starts again with the same session; anyone else is left as they are. */
  wake(id: string): Employee {
    const employee = this.#roster.get(id);
    if (employee.lifecycle !== 'sleeping') return employee;
    this.#assertNotBusy(this.#runtime(id));
    return this.#start(employee, 'uyandı');
  }

  resume(id: string): Employee {
    const employee = this.#roster.get(id);
    this.#assertReachable(employee);
    this.#assertNotBusy(this.#runtime(id));
    const wasInterrupted = employee.lifecycle === 'interrupted';
    this.#runtime(id).crashes = [];
    this.#start(this.#roster.update(id, { lastError: null }), 'sahibi devam ettirdi');
    if (wasInterrupted) this.#deliver(id, CONTINUE_AFTER_RESTART, 'system', {}, true);
    return this.#roster.get(id);
  }

  openInTerminal(id: string): Promise<{ command: string; employee: Employee }> {
    return this.#exclusive(id, async () => {
      const employee = this.#roster.get(id);
      this.#assertReachable(employee);
      if (!employee.sessionStarted) throw new ConflictError('Bu çalışan henüz hiç konuşmadı; terminalde açılacak bir oturum yok.');
      const rt = this.#runtime(id);
      rt.terminalModel = this.#sessionModel(employee, rt);
      await this.#halt(id);
      const updated = this.#setLifecycle(this.#roster.get(id), 'in_terminal', 'terminalde açıldı');
      return { command: terminalCommand(deskDir(this.#dataDir, employee.slug), employee.sessionId), employee: updated };
    });
  }

  returnFromTerminal(id: string): Employee {
    const employee = this.#roster.get(id);
    if (employee.lifecycle !== 'in_terminal') throw new ConflictError('Bu çalışan terminalde değil.');
    // Taken there at work (a turn, or a job it left running) closing the session for the terminal cut that work; taken
    // there interrupted, the office restart had cut it before.
    const opened = this.#events.latest(id, 'lifecycle.changed')?.event;
    const from = opened?.type === 'lifecycle.changed' && opened.to === 'in_terminal' ? opened.from : null;
    const note = from === 'working' ? CONTINUE_AFTER_TERMINAL : from === 'interrupted' ? CONTINUE_AFTER_RESTART : null;
    // Back at the desk and ready: the office picks the same session up again (an idle process spends no tokens).
    const rt = this.#runtime(id);
    rt.crashes = [];
    const kept = rt.terminalModel;
    rt.terminalModel = null;
    // Work cut by the terminal goes on on the model it ran on, as after a crash or a limit (K1); back idle, their own.
    if (note && kept) rt.model = kept === employee.model ? null : kept;
    const back = this.#start(employee, 'terminalden ofise döndü');
    if (!note) return back;
    // It hears so and goes on: working, as its process is — the office's own "continue", on the session's model.
    this.#deliver(id, note, 'system', {}, true);
    return this.#roster.get(id);
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

  /**
   * The role card or the office tools changed (e.g. the employee became coordinator). A session reads both only when
   * it starts, so start it again — memory is kept, the session resumes — now if it is idle, or as soon as the turn
   * it is in ends. A session that is not running reads the new card whenever it next starts.
   */
  reload(id: string): void {
    const rt = this.#runtime(id);
    if (!rt.proc || rt.proc.exited) return;
    if (rt.turnActive || this.#roster.get(id).lifecycle !== 'idle' || this.#jobsRunning(rt)) {
      rt.reloadPending = true;
      return;
    }
    this.#reloadNow(id);
  }

  #reloadNow(id: string): void {
    const rt = this.#runtime(id);
    // A job still runs: the reload waits for a later idle moment with none.
    if (this.#jobsRunning(rt)) return;
    rt.reloadPending = false;
    void this.#exclusive(id, async () => {
      const employee = this.#roster.get(id);
      if (employee.lifecycle !== 'idle' || rt.turnActive) return;
      await this.#halt(id);
      this.#start(this.#roster.get(id), 'rol kartı ve araçlar yenilendi');
    }).catch((err: unknown) => this.#emit(id, { type: 'error', message: `Oturum yenilenemedi: ${err instanceof Error ? err.message : String(err)}` }));
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
    const token = this.#mcp?.tokens.issue(employee.id);
    const mcpConfig = this.#mcp
      ? JSON.stringify({
          mcpServers: {
            office: { type: 'http', url: this.#mcp.url(), headers: { Authorization: `Bearer ${token}` } },
          },
        })
      : undefined;
    // The gate's hook asks the office with this session's own token (B9a).
    const gate = this.#gate && token ? this.#gate : undefined;
    rt.proc = new ClaudeProcess(
      {
        command: this.#command,
        args: sessionArgs({ model: rt.model ?? employee.model, sessionId: employee.sessionId, resume: employee.sessionStarted, home: this.#home, mcpConfig, hook: gate?.hook, disallowed: this.#sessionDeny?.(employee) }),
        cwd: prepareDesk(this.#dataDir, employee),
        env: gate ? { ...(this.#env ?? process.env), OFFICE_GATE_URL: gate.url(), OFFICE_GATE_TOKEN: token } : this.#env,
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
    const task = taskChange(raw);
    if (task) this.#onTask(id, task);
    for (const event of normalize(raw)) {
      if (event.type === 'session.started' && !this.#roster.get(id).sessionStarted) this.#roster.update(id, { sessionStarted: true });
      // claude opened a turn by itself (to read what a background job left): work, as a turn the office opens is.
      if ((event.type === 'message.assistant' || event.type === 'tool.started') && !rt.turnActive) this.#ownTurn(id);
      if (event.type === 'message.assistant') rt.lastText = event.text;
      if (event.type === 'tool.started') rt.toolsInTurn = true;
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
    rt.lastTurnAt = this.#now();
    const onTrial = rt.switchedFrom;
    const worked = rt.toolsInTurn;
    rt.switchedFrom = null;
    rt.toolsInTurn = false;
    rt.consumedInTurn = false;
    for (const resolve of rt.turnWaiters.splice(0)) resolve();
    if (rt.expectingExit) return;
    // A model the account cannot use answers at once, before any tool: a turn that already worked and then failed
    // (overloaded API, a tool error) ends as on main — idle, the office reminds — and is not re-run on the old model.
    if (onTrial && !ok && !rejected && !worked) {
      this.#retryOn(id, onTrial);
      return;
    }
    rt.sinceSwitch = [];
    const employee = this.#roster.get(id);
    if (employee.lifecycle !== 'working') return;
    if (rejected) {
      const resetsAt = this.#limitResetTime(rt);
      this.#setLifecycle(this.#roster.update(id, { limitResetsAt: resetsAt }), 'limited', 'abonelik limiti doldu');
      this.#scheduleLimitContinue(id, resetsAt);
      return;
    }
    // A job it started runs on (its end opens the next turn): still at work.
    this.#idleIfDone(id, ok ? 'iş bitti' : 'iş hatayla bitti');
  }

  /** The work is over when no turn is open and no job of the session runs: idle, and a reload waiting for it happens. */
  #idleIfDone(id: string, reason: string): void {
    const rt = this.#runtime(id);
    const employee = this.#roster.get(id);
    if (rt.turnActive || employee.lifecycle !== 'working') return;
    if (rt.background.size > 0) {
      this.#armCap(id);
      return;
    }
    this.#setLifecycle(employee, 'idle', reason);
    if (rt.reloadPending) this.#reloadNow(id);
  }

  #ownTurn(id: string): void {
    const rt = this.#runtime(id);
    rt.turnActive = true;
    this.#emit(id, { type: 'turn.started' });
    this.#setLifecycle(this.#roster.get(id), 'working', 'kendi açtığı tur (arka plan işi)');
  }

  #onTask(id: string, task: { taskId: string; running: boolean; description?: string }): void {
    const rt = this.#runtime(id);
    if (task.running) {
      rt.background.set(task.taskId, task.description ?? '');
      return;
    }
    rt.freed.delete(task.taskId);
    if (!rt.background.delete(task.taskId) || rt.background.size > 0 || rt.turnActive) return;
    // The last job ended between turns: claude opens a turn by itself to read it. Idle only if none comes in time.
    if (rt.followUpTimer) clearTimeout(rt.followUpTimer);
    rt.followUpTimer = setTimeout(() => {
      rt.followUpTimer = null;
      this.#idleIfDone(id, 'arka plan işi bitti');
    }, this.#followUpGraceMs);
    rt.followUpTimer.unref();
  }

  /** Jobs alone hold the employee: past the cap they are free for tasks again (a turn running then: at its end). */
  #armCap(id: string): void {
    const rt = this.#runtime(id);
    if (rt.capTimer) return;
    rt.capTimer = setTimeout(() => {
      rt.capTimer = null;
      if (rt.background.size === 0 || rt.turnActive) return;
      // The jobs run on (nothing is killed) but no longer keep the employee working; the office decides about them.
      const jobs = [...rt.background.values()];
      for (const taskId of rt.background.keys()) rt.freed.add(taskId);
      rt.background.clear();
      this.#emit(id, { type: 'background.overdue', jobs, limitMs: this.#backgroundLimitMs });
      this.#idleIfDone(id, 'arka plan işi üst süreyi aştı; süreç sürüyor');
    }, this.#backgroundLimitMs);
    rt.capTimer.unref();
  }

  #jobsRunning(rt: Runtime): boolean {
    return rt.background.size > 0 || rt.freed.size > 0;
  }

  /** The process is gone: the jobs it ran are gone with it. */
  #endBackground(rt: Runtime): void {
    rt.background.clear();
    rt.freed.clear();
    if (rt.capTimer) clearTimeout(rt.capTimer);
    rt.capTimer = null;
    if (rt.followUpTimer) clearTimeout(rt.followUpTimer);
    rt.followUpTimer = null;
  }

  #onExit(id: string, code: number | null, signal: NodeJS.Signals | null, stderr: string): void {
    const rt = this.#runtime(id);
    // Work was under way: a turn that took its message in, a job beside the turns, or one that ended and waits to be read.
    const resumeWork = (rt.turnActive && rt.consumedInTurn) || this.#jobsRunning(rt) || rt.followUpTimer !== null;
    const unread = rt.unread.splice(0);
    rt.consumedInTurn = false;
    rt.proc = null;
    rt.turnActive = false;
    this.#endBackground(rt);
    for (const resolve of rt.turnWaiters.splice(0)) resolve();
    if (rt.expectingExit) {
      rt.expectingExit = false;
      return;
    }
    const employee = this.#roster.get(id);
    if (employee.lifecycle === 'archived' || employee.lifecycle === 'in_terminal' || employee.lifecycle === 'stopped') {
      for (const m of unread) m.onLost?.();
      return;
    }
    const now = this.#now();
    rt.crashes = rt.crashes.filter((t) => now - t < this.#crashWindowMs).concat(now);
    const tail = stderr.trim().slice(-500);
    // Gone before its first turn on a new model ended well: the switch failed. Restart on the model it had and send
    // everything written since the switch again (not "continue after a crash").
    const onTrial = rt.switchedFrom;
    const sinceSwitch = rt.sinceSwitch;
    rt.sinceSwitch = [];
    if (onTrial) this.#failedSwitch(id, this.#sessionModel(employee, rt), onTrial, tail || `süreç ilk turdan önce kapandı (kod ${code ?? '-'})`);
    const message = `claude süreci beklenmedik şekilde kapandı (kod ${code ?? '-'}, sinyal ${signal ?? '-'}).${tail ? ` ${tail}` : ''}`;
    this.#emit(id, { type: 'error', message });
    if (rt.crashes.length >= 2) {
      const lost = onTrial ? sinceSwitch : unread;
      if (lost.length > 0) this.#emit(id, { type: 'error', message: `Okunmamış ${lost.length} mesaj teslim edilemedi.` });
      for (const m of lost) m.onLost?.();
      this.#setLifecycle(this.#roster.update(id, { lastError: message }), 'error', 'süreç kısa sürede tekrar kapandı');
      return;
    }
    if (onTrial) {
      this.#start(employee, `${onTrial} ile sürüyor`);
      for (const m of sinceSwitch) this.#write(id, m.text, m.source, { logged: true, onLost: m.onLost });
      return;
    }
    this.#start(employee, 'çökme sonrası yeniden açıldı');
    if (resumeWork) this.#deliver(id, CONTINUE_AFTER_CRASH, 'system', {}, true);
    if (unread.length > 0) this.#redeliver(id, unread);
  }

  /** Re-sends messages claude never acknowledged, without logging them a second time. */
  #redeliver(id: string, messages: Array<{ uuid: string; text: string; onLost?: () => void }>): void {
    const rt = this.#runtime(id);
    const proc = rt.proc;
    if (!proc) {
      for (const m of messages) m.onLost?.();
      return;
    }
    for (const m of messages) {
      try {
        proc.sendUser(m.text, m.uuid);
        rt.unread.push(m);
      } catch {
        this.#emit(id, { type: 'error', message: 'Okunmamış bir mesaj yeniden gönderilemedi.' });
        m.onLost?.();
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
      rt.model = null;
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
    // The next session starts on the employee's own model unless a hint says otherwise.
    rt.model = null;
    rt.switchedFrom = null;
    rt.sinceSwitch = [];
    if (rt.unread.length > 0) this.#emit(id, { type: 'error', message: `Durdurma sırasında okunmamış ${rt.unread.length} mesaj iptal edildi.` });
    for (const m of rt.unread) m.onLost?.();
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
        this.#deliver(id, CONTINUE_AFTER_LIMIT, 'system', {}, true);
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
        reloadPending: false,
        pendingOps: 0,
        unread: [],
        consumedInTurn: false,
        totals: null,
        limitAt: null,
        lastTurnAt: null,
        switching: null,
        switchingTo: null,
        model: null,
        switchedFrom: null,
        terminalModel: null,
        sinceSwitch: [],
        toolsInTurn: false,
        lastText: '',
        failedModel: null,
        background: new Map(),
        freed: new Set(),
        capTimer: null,
        followUpTimer: null,
      };
      this.#runtimes.set(id, rt);
    }
    return rt;
  }
}
