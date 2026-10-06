import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface ProcessOptions {
  command: string[];
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

export interface ProcessHandlers {
  onJson: (obj: unknown) => void;
  onExit: (code: number | null, signal: NodeJS.Signals | null, stderrTail: string) => void;
}

const STDERR_TAIL = 4000;
/** How long to wait, after claude has exited, for pipes a leftover tool process still holds. */
const EXIT_PIPE_GRACE_MS = 1000;

/** One long-lived `claude -p --input-format stream-json` process. */
export class ClaudeProcess {
  readonly #child: ChildProcessWithoutNullStreams;
  #stderr = '';
  #exited = false;
  #requests = 0;
  readonly #closeWaiters: Array<() => void> = [];
  readonly #closeTimers: NodeJS.Timeout[] = [];

  constructor(opts: ProcessOptions, handlers: ProcessHandlers) {
    const [command, ...prefix] = opts.command;
    if (!command) throw new Error('claude komutu boş');
    // Its own process group, so a forced stop also ends what its tools started (a dev server, a test watcher…).
    this.#child = spawn(command, [...prefix, ...opts.args], { cwd: opts.cwd, env: opts.env ?? process.env, detached: true });
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (this.#exited) return;
      this.#exited = true;
      for (const timer of this.#closeTimers.splice(0)) clearTimeout(timer);
      handlers.onExit(code, signal, this.#stderr);
      for (const resolve of this.#closeWaiters.splice(0)) resolve();
    };
    createInterface({ input: this.#child.stdout }).on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return;
      }
      handlers.onJson(parsed);
    });
    this.#child.stderr.on('data', (chunk: Buffer) => {
      this.#stderr = (this.#stderr + chunk.toString('utf8')).slice(-STDERR_TAIL);
    });
    this.#child.stdin.on('error', () => {
      // EPIPE after the process is gone; the exit itself is reported through 'close'.
    });
    this.#child.on('error', (err) => {
      this.#stderr = `${this.#stderr}\n${err.message}`.slice(-STDERR_TAIL);
      if (this.#child.pid === undefined) finish(null, null);
    });
    this.#child.on('close', (code, signal) => finish(code, signal));
    this.#child.on('exit', (code, signal) => {
      // Something its tools started can keep the pipes open after claude has gone: end it rather than wait forever.
      setTimeout(() => {
        if (this.#exited) return;
        this.#signal('SIGKILL');
        finish(code, signal);
      }, EXIT_PIPE_GRACE_MS).unref();
    });
  }

  /** Signals claude's whole process group; falls back to claude alone. */
  #signal(sig: NodeJS.Signals): void {
    const pid = this.#child.pid;
    try {
      if (pid === undefined) throw new Error('no pid');
      process.kill(-pid, sig);
    } catch {
      this.#child.kill(sig);
    }
  }

  get exited(): boolean {
    return this.#exited;
  }

  get stderrTail(): string {
    return this.#stderr;
  }

  /** `uuid` comes back in a `user` event with `isReplay: true` once claude has taken the message in. */
  sendUser(text: string, uuid?: string): void {
    this.#write({ type: 'user', ...(uuid ? { uuid } : {}), message: { role: 'user', content: text } });
  }

  interrupt(): void {
    this.#requests += 1;
    this.#write({ type: 'control_request', request_id: `interrupt-${this.#requests}`, request: { subtype: 'interrupt' } });
  }

  /**
   * Ends stdin so claude exits after the current turn; SIGTERM to its process group after `graceMs`, SIGKILL after
   * twice that.
   */
  close(graceMs = 5000): Promise<void> {
    if (this.#exited) return Promise.resolve();
    return new Promise((resolve) => {
      this.#closeWaiters.push(resolve);
      if (this.#closeTimers.length === 0) {
        this.#closeTimers.push(
          setTimeout(() => this.#signal('SIGTERM'), graceMs),
          setTimeout(() => this.#signal('SIGKILL'), graceMs * 2),
        );
      }
      this.#child.stdin.end();
    });
  }

  #write(message: unknown): void {
    if (this.#exited || !this.#child.stdin.writable) throw new Error('claude süreci kapalı');
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }
}
