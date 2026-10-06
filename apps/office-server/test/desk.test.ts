import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deskDir, prepareDesk, roleCard } from '../src/desk.ts';
import { setup } from './helpers.ts';

describe('desk', () => {
  it('creates the desk folder with a role card', () => {
    const { roster, dataDir } = setup();
    const e = roster.create({ name: 'Ada', role: 'Testleri yazan yazılımcı.' });
    const dir = prepareDesk(dataDir, e);
    expect(dir).toBe(join(dataDir, 'desks', 'ada'));
    expect(dir).toBe(deskDir(dataDir, 'ada'));
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe(roleCard(e));
    expect(roleCard(e)).toContain('Testleri yazan yazılımcı.');
  });

  it('never overwrites a role card the owner edited', () => {
    const { roster, dataDir } = setup();
    const e = roster.create({ name: 'Ada', role: 'r' });
    const dir = prepareDesk(dataDir, e);
    writeFileSync(join(dir, 'CLAUDE.md'), 'elle düzenlendi');
    prepareDesk(dataDir, e);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe('elle düzenlendi');
    expect(existsSync(join(dir, '.claude'))).toBe(false);
  });
});
