import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Employee } from '@cc/shared';
import { BRIEF_FILE, DEFAULT_BRIEF, readBrief, writeBrief } from '../src/company/brief.ts';
import { GUIDE_FILE, deskDir, prepareDesk, roleCard, writeRoleCard } from '../src/desk.ts';
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
  it('names the person and their job, and imports the office guide and the company brief', () => {
    const card = roleCard(person());
    expect(card).toContain('# Ada — Testçi');
    expect(card).toContain('ekibin: Kalite');
    expect(card).toContain('Testleri yazar.');
    expect(card).toContain('@office-guide.md');
    expect(card).toContain('@company-brief.md');
    expect(card).not.toContain('taskFinish');
  });

  it('writes the guide for the employee’s kind on the desk at every start', () => {
    const dataDir = tempDir();
    const dir = prepareDesk(dataDir, person());
    const guide = () => readFileSync(join(dir, GUIDE_FILE), 'utf8');
    expect(guide()).toContain('taskFinish');
    expect(guide()).toContain('taskPass');
    expect(guide()).toContain('memorySearch');
    expect(guide()).toContain('noteWrite');
    expect(guide()).not.toContain('planPropose');
    prepareDesk(dataDir, person({ kind: 'coordinator', title: 'Koordinatör' }));
    expect(guide()).toContain('planPropose');
    expect(guide()).toMatch(/sahibi kartı onaylamadan/i);
    expect(guide()).toContain('employeeNote');
    prepareDesk(dataDir, person({ kind: 'lead' }));
    expect(guide()).toContain('decisionRecord');
    expect(guide()).not.toContain('planPropose');
  });
});


describe('desk', () => {
  it('copies the company brief onto the desk and keeps a card the owner edited', () => {
    const dataDir = tempDir();
    const e = person();
    const dir = prepareDesk(dataDir, e);
    expect(readFileSync(join(dir, BRIEF_FILE), 'utf8')).toBe(DEFAULT_BRIEF);
    const edited = 'elle yazılmış kart\n\n@office-guide.md\n\n@company-brief.md\n';
    writeFileSync(join(dir, 'CLAUDE.md'), edited);
    prepareDesk(dataDir, e);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe(edited);
  });


  it('review focus: gives a desk from before the company its guide and brief once, without rewriting the card', () => {
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
    expect(card.match(/@office-guide\.md/g)).toHaveLength(1);
  });


  it('rewrites the card when the coordinator changes it', () => {
    const dataDir = tempDir();
    const e = person();
    prepareDesk(dataDir, e);
    writeRoleCard(dataDir, { ...e, role: 'Artık sürüm çıkarır.' });
    expect(readFileSync(join(deskDir(dataDir, e.slug), 'CLAUDE.md'), 'utf8')).toContain('Artık sürüm çıkarır.');
    writeRoleCard(dataDir, { ...e, kind: 'coordinator' });
    expect(readFileSync(join(deskDir(dataDir, e.slug), GUIDE_FILE), 'utf8')).toContain('planPropose');
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
