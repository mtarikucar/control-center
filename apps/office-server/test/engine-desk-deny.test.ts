import { afterEach, describe, expect, it, vi } from 'vitest';
import { deskDir } from '../src/desk.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

/** What each spawn saw: the desk it opened in, and the deny rules its .claude/settings.json held at that moment. */
const seen = vi.hoisted(() => [] as Array<{ cwd: string; deny: string[] | null }>);
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>();
  const fs = await import('node:fs');
  const path = await import('node:path');
  return {
    ...real,
    spawn: ((command: string, args: readonly string[], options: { cwd?: string }) => {
      const file = options?.cwd ? path.join(options.cwd, '.claude', 'settings.json') : '';
      const deny = file && fs.existsSync(file) ? ((JSON.parse(fs.readFileSync(file, 'utf8')) as { permissions?: { deny?: string[] } }).permissions?.deny ?? null) : null;
      seen.push({ cwd: options?.cwd ?? '', deny });
      return real.spawn(command, args as string[], options as never);
    }) as typeof real.spawn,
  };
});

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

describe('Engine — a hire with deny rules (B5 closed mode; review, Kerem round 1: E1)', () => {
  it('the desk’s settings are on disk when the first session’s process is spawned, not after', () => {
    const s = setup();
    const f = fakeEngine(s);
    cleanups.push(f.cleanup, s.cleanup);
    const ada = f.engine.hire({ name: 'Ada', role: 'r', deskDeny: ['mcp__claude_ai_Gmail', 'Bash(git push*)'] });
    const spawned = seen.filter((x) => x.cwd === deskDir(s.dataDir, ada.slug));
    expect(spawned.length).toBeGreaterThan(0);
    expect(spawned[0]!.deny).toEqual(['mcp__claude_ai_Gmail', 'Bash(git push*)']);
    // Without rules, no file: the desk is as before.
    const can = f.engine.hire({ name: 'Can', role: 'r' });
    expect(seen.find((x) => x.cwd === deskDir(s.dataDir, can.slug))!.deny).toBeNull();
  });
});
