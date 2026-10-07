import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER } from '@cc/shared';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make() {
  const s = setup();
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f);
  const ada = c.company.hire(OWNER, { name: 'Ada', role: 'r' });
  return { ...s, ...c, ada };
}

describe('a hand-in carries evidence (spec §5.3)', () => {
  it('refuses a hand-in with fewer evidence lines than done items, saying how many', () => {
    const t = make();
    const task = t.company.createTask(OWNER, { assignee: t.ada.id, title: 'README', done: ['kurulum anlatılıyor', 'adımlar çalıştı', 'lisans var'] });
    expect(() => t.company.finish(t.ada.id, task.id, { summary: 'yazdım', outputs: [], learned: '' })).toThrow(/3 madde var/);
    expect(() => t.company.finish(t.ada.id, task.id, { summary: 'yazdım', outputs: [], learned: '', evidence: ['hepsi tamam'] })).toThrow(/3 madde var/);
    expect(t.tasks.get(task.id).status).toBe('waiting');
  });

  it('keeps the evidence with the result and writes item–evidence pairs to the archive', () => {
    const t = make();
    const task = t.company.createTask(OWNER, { assignee: t.ada.id, title: 'README', done: ['kurulum anlatılıyor', 'adımlar çalıştı'] });
    const done = t.company.finish(t.ada.id, task.id, { summary: 'yazdım', outputs: [], learned: '', evidence: ['README.md 1–3. bölüm', 'boş klasörde npm i && npm start çalıştı', 'ek: yazım denetimi'] });
    expect(done.status).toBe('done');
    expect(done.result?.evidence).toEqual(['README.md 1–3. bölüm', 'boş klasörde npm i && npm start çalıştı', 'ek: yazım denetimi']);
    const teslim = readFileSync(join(t.dataDir, done.result!.archive!, 'teslim.md'), 'utf8');
    expect(teslim).toContain('## Bitti tanımı ve kanıt');
    expect(teslim).toContain('- kurulum anlatılıyor\n  Kanıt: README.md 1–3. bölüm');
    expect(teslim).toContain('- adımlar çalıştı\n  Kanıt: boş klasörde npm i && npm start çalıştı');
    expect(teslim).toContain('- Kanıt: ek: yazım denetimi');
  });

  it('needs no evidence when the task has no definition of done, and none for a hand-over', () => {
    const t = make();
    const free = t.company.createTask(OWNER, { assignee: t.ada.id, title: 'Bak' });
    expect(t.company.finish(t.ada.id, free.id, { summary: 'baktım', outputs: [], learned: '' }).status).toBe('done');
    const handover = t.company.beginHandover(t.ada.id);
    expect(handover.done.length).toBeGreaterThan(0);
    expect(t.company.finish(t.ada.id, handover.id, { summary: 'devrettim', outputs: [], learned: '' }).status).toBe('done');
  });

  it('refuses evidence lines that are too long or too many', () => {
    const t = make();
    const task = t.company.createTask(OWNER, { assignee: t.ada.id, title: 'X', done: ['a'] });
    expect(() => t.company.finish(t.ada.id, task.id, { summary: 's', outputs: [], learned: '', evidence: ['x'.repeat(1001)] })).toThrow(/Kanıt/);
    expect(() => t.company.finish(t.ada.id, task.id, { summary: 's', outputs: [], learned: '', evidence: Array.from({ length: 21 }, () => 'k') })).toThrow(/Kanıt/);
  });
});
