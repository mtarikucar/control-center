import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Engine, type EngineOptions } from '../src/engine.ts';
import { FAKE_CLAUDE, tempDir, until, type TestSetup } from './helpers.ts';

export interface FakeEngine {
  engine: Engine;
  argvLog: string;
  state: string;
  cleanup: () => Promise<void>;
}

export function fakeEngine(s: TestSetup, opts: { env?: Record<string, string>; engine?: Partial<EngineOptions> } = {}): FakeEngine {
  const state = tempDir('fake-claude-');
  const argvLog = join(state, 'argv.jsonl');
  const engine = new Engine({
    roster: s.roster,
    events: s.events,
    dataDir: s.dataDir,
    claudeCommand: [process.execPath, FAKE_CLAUDE],
    env: { ...process.env, FAKE_CLAUDE_STATE: state, FAKE_CLAUDE_ARGV_LOG: argvLog, ...opts.env },
    home: '/home/test',
    ...opts.engine,
  });
  return {
    engine,
    argvLog,
    state,
    cleanup: async () => {
      await engine.shutdown();
      rmSync(state, { recursive: true, force: true });
    },
  };
}

export interface ArgvEntry {
  args: string[];
  cwd: string;
  /** The deny rules of the desk's .claude/settings.json when the session started; null without the file. */
  deny?: string[] | null;
  /** B9a: OFFICE_GATE_URL and OFFICE_GATE_TOKEN in the session's environment. */
  gate?: { url: string | null; token: string | null };
}

export async function readArgv(file: string, atLeast: number, timeoutMs = 5000): Promise<ArgvEntry[]> {
  const read = (): ArgvEntry[] =>
    existsSync(file)
      ? readFileSync(file, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l) as ArgvEntry)
      : [];
  await until(() => read().length >= atLeast, timeoutMs);
  return read();
}
