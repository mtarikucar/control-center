import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Employee } from '@cc/shared';
import { BRIEF_FILE, DEFAULT_BRIEF, readBrief, writeBrief } from '../src/company/brief.ts';
import { deskDir, prepareDesk, roleCard, writeRoleCard } from '../src/desk.ts';
import { setup, tempDir } from './helpers.ts';

describe('desk folder', () => {
  it('creates the desk folder with a role card', () => {
    const { roster, dataDir } = setup();
    const e = roster.create({ name: 'Ada', role: 'Testleri yazan yazılımcı.' });
    const dir = prepareDesk(dataDir, e);
    expect(dir).toBe(join(dataDir, 'desks', 'ada'));
    expect(dir).toBe(deskDir(dataDir, 'ada'));
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe(roleCard(e));
    expect(roleCard(e)).toContain('Testleri yazan yazılımcı.');
    expect(existsSync(join(dir, '.claude'))).toBe(false);
  });
});

const person = (over: Partial<Employee> = {}): Employee => ({
  id: 'e1', slug: 'ada', name: 'Ada', role: 'Testleri yazar.', model: 'haiku', characterId: 'coder', title: 'Testçi', team: 'Kalite',
  kind: 'member', reportsTo: null, deskIndex: 0, sessionId: 's', sessionStarted: false, lifecycle: 'stopped', limitResetsAt: null,
  lastError: null, createdAt: 1, ...over,
});

describe('role card', () => {
  it('names the person and their job, explains the office tools and imports the company brief', () => {
    const card = roleCard(person());
    expect(card).toContain('# Ada — Testçi');
    expect(card).toContain('ekibin: Kalite');
    expect(card).toContain('Testleri yazar.');
    expect(card).toContain('taskFinish');
    expect(card).toContain('taskPass');
    expect(card).toContain('@company-brief.md');
    expect(card).not.toContain('planPropose');
  });

  it("gives the coordinator the coordinator's way of working", () => {
    const card = roleCard(person({ kind: 'coordinator', title: 'Koordinatör' }));
    expect(card).toContain('planPropose');
    expect(card).toMatch(/sahibi kartı onaylamadan/i);
    expect(card).toContain('hire');
  });
});

describe('desk', () => {
  it('copies the company brief onto the desk and keeps a card the owner edited', () => {
    const dataDir = tempDir();
    const e = person();
    const dir = prepareDesk(dataDir, e);
    expect(readFileSync(join(dir, BRIEF_FILE), 'utf8')).toBe(DEFAULT_BRIEF);
    writeFileSync(join(dir, 'CLAUDE.md'), 'elle yazılmış kart\n\n@company-brief.md\n');
    prepareDesk(dataDir, e);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe('elle yazılmış kart\n\n@company-brief.md\n');
  });

  it('gives a desk from before the company its brief once, without rewriting the card', () => {
    const dataDir = tempDir();
    const e = person();
    const dir = deskDir(dataDir, e.slug);
    prepareDesk(dataDir, e);
    writeFileSync(join(dir, 'CLAUDE.md'), '# Ada\n\neski kart\n');
    prepareDesk(dataDir, e);
    prepareDesk(dataDir, e);
    const card = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    expect(card.startsWith('# Ada\n\neski kart\n')).toBe(true);
    expect(card.match(/@company-brief\.md/g)).toHaveLength(1);
  });

  it('rewrites the card when the coordinator changes it', () => {
    const dataDir = tempDir();
    const e = person();
    prepareDesk(dataDir, e);
    writeRoleCard(dataDir, { ...e, role: 'Artık sürüm çıkarır.' });
    expect(readFileSync(join(deskDir(dataDir, e.slug), 'CLAUDE.md'), 'utf8')).toContain('Artık sürüm çıkarır.');
  });
});

describe('company brief', () => {
  it('starts with a default, and an update reaches the company folder and every desk', () => {
    const dataDir = tempDir();
    expect(readBrief(dataDir)).toBe(DEFAULT_BRIEF);
    const a = prepareDesk(dataDir, person());
    const b = prepareDesk(dataDir, person({ id: 'e2', slug: 'can', name: 'Can' }));
    writeBrief(dataDir, '# Özet\n\nMisyon: iyi yazılım.\n', [a, b]);
    expect(readBrief(dataDir)).toContain('Misyon');
    for (const dir of [a, b]) expect(readFileSync(join(dir, BRIEF_FILE), 'utf8')).toContain('Misyon');
    expect(existsSync(join(dataDir, 'company', 'brief.md'))).toBe(true);
  });
});
