import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { stopWindowsDescendants } from '../windows-process.ts';

export type Obj = Record<string, unknown>;
export const obj = (v: unknown): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
export const str = (v: unknown): string => typeof v === 'string' ? v : '';
export const num = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) ? v : 0;

/** Private stdio connection: never exposes the app-server on a network port. */
export class CodexRpc {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #pending = new Map<number, { resolve: (v: Obj) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  #id = 0;
  #stderr = '';
  #exited = false;
  readonly #closed: Promise<void>;

  constructor(o: { command: string[]; cwd: string; env?: NodeJS.ProcessEnv; onMessage: (message: Obj) => void; onExit: (code: number | null, signal: NodeJS.Signals | null, stderr: string) => void }) {
    const [command, ...prefix] = o.command;
    if (!command) throw new Error('Codex komutu boş');
    this.#child = spawn(command, [...prefix, 'app-server', '--listen', 'stdio://'], { cwd: o.cwd, env: o.env ?? process.env, windowsHide: true, detached: process.platform !== 'win32' });
    this.#closed = new Promise((resolve) => {
      const finish = (code: number | null, signal: NodeJS.Signals | null) => {
        if (this.#exited) return;
        this.#exited = true;
        for (const p of this.#pending.values()) { clearTimeout(p.timer); p.reject(new Error(this.#stderr.trim() || 'Codex süreci kapandı')); }
        this.#pending.clear();
        o.onExit(code, signal, this.#stderr);
        resolve();
      };
      this.#child.on('close', finish);
      this.#child.on('exit', (code, signal) => {
        const timer = setTimeout(() => { if (!this.#exited) { this.#signal('SIGKILL'); finish(code, signal); } }, 1000);
        timer.unref();
      });
      this.#child.on('error', (err) => { this.#stderr = `${this.#stderr}\n${err.message}`.slice(-4000); if (this.#child.pid === undefined) finish(null, null); });
    });
    this.#child.stderr.on('data', (data: Buffer) => { this.#stderr = (this.#stderr + data.toString('utf8')).slice(-4000); });
    this.#child.stdin.on('error', () => {});
    createInterface({ input: this.#child.stdout }).on('line', (line) => {
      let m: Obj;
      try { m = obj(JSON.parse(line)); } catch { return; }
      if (typeof m.method === 'string') { o.onMessage(m); return; }
      const p = typeof m.id === 'number' ? this.#pending.get(m.id) : undefined;
      if (!p) return;
      this.#pending.delete(m.id as number); clearTimeout(p.timer);
      if (m.error) p.reject(new Error(str(obj(m.error).message) || 'Codex isteği başarısız'));
      else p.resolve(obj(m.result));
    });
  }

  get exited(): boolean { return this.#exited; }
  get stderrTail(): string { return this.#stderr; }
  write(message: unknown): void {
    if (this.#exited || !this.#child.stdin.writable) throw new Error('Codex süreci kapalı');
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  request(method: string, params: Obj = {}, timeoutMs = 60_000): Promise<Obj> {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#pending.delete(id); reject(new Error(`Codex ${method} yanıtı zaman aşımına uğradı`)); }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); } catch (err) { this.#pending.delete(id); clearTimeout(timer); reject(err); }
    });
  }
  async initialize(): Promise<void> {
    await this.request('initialize', { clientInfo: { name: 'control_center', title: 'ControlCenter', version: '0.1.0' } });
    this.write({ method: 'initialized', params: {} });
  }
  async close(graceMs = 2000): Promise<void> {
    if (this.#exited) return;
    await stopWindowsDescendants(this.#child.pid);
    if (this.#exited) return;
    const term = setTimeout(() => this.#signal('SIGTERM'), graceMs);
    const kill = setTimeout(() => this.#signal('SIGKILL'), graceMs * 2);
    this.#child.stdin.end();
    try { await this.#closed; } finally { clearTimeout(term); clearTimeout(kill); }
  }

  #signal(signal: NodeJS.Signals): void {
    const pid = this.#child.pid;
    if (pid === undefined) return;
    if (process.platform === 'win32' && signal === 'SIGKILL') {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => { this.#child.kill(signal); });
      return;
    }
    try { if (process.platform === 'win32') this.#child.kill(signal); else process.kill(-pid, signal); }
    catch { this.#child.kill(signal); }
  }
}
