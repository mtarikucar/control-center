import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireLock } from '../src/lock.ts';
import { tempDir } from './helpers.ts';

describe('data directory lock', () => {
  it('lets only one office use a data directory at a time', () => {
    const dir = tempDir();
    const release = acquireLock(dir);
    expect(() => acquireLock(dir)).toThrow(/başka bir office-server/);
    release();
    expect(existsSync(join(dir, 'office.lock'))).toBe(false);
    acquireLock(dir)();
  });

  it('takes over a lock left behind by a process that is gone', () => {
    const dir = tempDir();
    const deadPid = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']).stdout.toString();
    writeFileSync(join(dir, 'office.lock'), deadPid);
    const release = acquireLock(dir);
    expect(existsSync(join(dir, 'office.lock'))).toBe(true);
    release();
  });
});
