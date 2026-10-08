import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlueprintStore } from '../src/company/blueprint-store.ts';
import { blueprintText, Blueprints } from '../src/company/blueprint.ts';
import { IntegrationRegistry } from '../src/company/integrations.ts';
import { deskDir } from '../src/desk.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';
import { brandTopic, CLIENTS, clientNote, pilotBlueprint, pilotFile, pilotFiles, pilotProfile } from './pilot-ajans-fixtures.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

/** The four rule topics the pilot seeds beside the six brand topics (pilot-senaryosu §4, A7: five seeds). */
const RULE_TOPICS = ['Yayın onay kuralı', 'Müşteri yanıt kuralları', 'Rapor şablonu', 'Takvim formatı'];
/** "Takvim formatı": the calendar's columns, in order. */
const CALENDAR = ['musteri', 'tarih', 'saat', 'kanal', 'tur', 'amac', 'metin_dosyasi', 'gorsel_brief', 'hashtagler', 'durum', 'onay_kaydi'];
/**
 * The servers a session on this machine reports (a session.started in the live office's log, 2026-10-08): the
 * coordinator's session is what tells the office of servers the vocabulary does not name (Slack, Google Drive).
 */
const MACHINE_SERVERS = [
  ['plugin:playwright:playwright', 'connected'], ['claude.ai jeeta', 'connected'], ['claude.ai Higgsfield', 'connected'], ['claude.ai Slack', 'needs-auth'],
  ['claude.ai apify', 'connected'], ['claude.ai Notion', 'connected'], ['claude.ai Google Calendar', 'connected'], ['claude.ai Google Drive', 'needs-auth'], ['claude.ai Gmail', 'connected'],
] as const;

function make() {
  const s = setup();
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, ['coder']);
  const integrations = new IntegrationRegistry({ db: s.db, roster: s.roster, events: s.events });
  const blueprints = new Blueprints({ company: c.company, roster: s.roster, tasks: c.tasks, plans: c.plans, schedules: c.schedules, memory: c.memory, store: new BlueprintStore(s.db), integrations, constitution: () => c.budget.constitution() });
  const coordinator = c.company.hireCoordinator();
  for (const [section, fields] of Object.entries(pilotProfile())) c.company.profileUpdate(coordinator.id, { section, fields, assumed: false });
  s.events.append(coordinator.id, { type: 'session.started', model: 'opus', mcp: MACHINE_SERVERS.map(([name, status]) => ({ name, status })) });
  const snapshot = () => ({
    employees: s.roster.list({ includeArchived: true }).map((e) => `${e.id}|${e.name}|${e.lifecycle}`),
    goals: c.company.goals().map((g) => `${g.id}|${g.title}|${g.status}`),
    playbook: c.memory.playbookTopics().map((p) => `${p.topic}|${p.version}`),
    schedules: c.schedules.list({ statuses: ['active', 'paused', 'stopped'] }).map((x) => `${x.id}|${x.title}`),
    tasks: c.tasks.list({ limit: 1000 }).map((t) => `${t.id}|${t.title}|${t.assignee}`),
    events: s.events.lastSeq(),
  });
  return { ...s, ...c, blueprints, coordinator, snapshot };
}

describe('pilot agency package (C5-3) — the files', () => {
  it('blueprint.json carries the six brand guides word for word, each under 20,000 characters, with its seven headings; no skeleton is left', () => {
    const b = pilotBlueprint();
    expect(b.playbook.map((p) => p.topic)).toEqual([...RULE_TOPICS, ...CLIENTS.map((x) => brandTopic(x.name))]);
    for (const { slug, name } of CLIENTS) {
      const text = pilotFile('marka-dili', `${slug}.md`).trim();
      expect(b.playbook.find((p) => p.topic === brandTopic(name))?.text, slug).toBe(text);
      expect(text.length, slug).toBeLessThanOrEqual(20_000);
      expect(text.length, slug).toBeGreaterThan(2_000);
      for (const heading of ['Ton', 'Yapılacaklar', 'Yapılmayacaklar', 'Kanal ve biçim', 'Hashtag kuralı', 'Örnek cümleler', 'Yasaklı ifadeler']) expect(text, `${slug}: ${heading}`).toContain(`## ${heading}`);
    }
    expect(JSON.stringify(b)).not.toMatch(/Can doldurur|iskelet\]/);
  });

  it('six client notes, 10–15 inbox mails with headers, a calendar in the “Takvim formatı” columns, past posts and performance data', () => {
    expect(pilotFiles('musteriler')).toEqual(CLIENTS.map((x) => `${x.slug}.md`).sort());
    for (const { slug, name } of CLIENTS) {
      const note = clientNote(slug);
      expect(note.title, slug).toBe(`Müşteri profili — ${name} (sentetik)`);
      expect(note.tags, slug).toContain('müşteri');
      expect(note.text.length, slug).toBeGreaterThan(400);
    }
    const mails = pilotFiles('gelen-kutusu');
    expect(mails.length).toBeGreaterThanOrEqual(10);
    expect(mails.length).toBeLessThanOrEqual(15);
    for (const mail of mails) expect(pilotFile('gelen-kutusu', mail), mail).toMatch(/^Kimden: .+\nKime: .+\nTarih: \d{4}-\d{2}-\d{2} \d{2}:\d{2}\nKonu: .+\n\n\S/);
    const [header, ...rows] = pilotFile('takvim.csv').trim().split('\n');
    expect(header!.split(',')).toEqual(CALENDAR);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const cells = row.split(',');
      expect(cells, row).toHaveLength(CALENDAR.length);
      expect(['instagram', 'linkedin', 'facebook'], row).toContain(cells[3]);
      expect(['taslak', 'incelemede', 'onayda', 'onayli', 'yayinlandi'], row).toContain(cells[9]);
      expect(cells[8]!.split(' ').filter(Boolean).length, row).toBeLessThanOrEqual(8);
    }
    expect(pilotFile('gecmis-gonderiler', 'pastane-ada.md').match(/^## /gm)).toHaveLength(20);
    expect(pilotFile('performans.csv').trim().split('\n').slice(1).map((r) => r.split(',')[0])).toEqual(expect.arrayContaining(CLIENTS.map((x) => x.slug)));
  });

  it('is synthetic throughout: every mail and web address on a reserved name (RFC 2606 .example), no phone, IBAN or ID number, every client marked “(sentetik)”', () => {
    const files = ['blueprint.json', 'profil.json', 'takvim.csv', 'performans.csv', 'README.md', 'gecmis-gonderiler/pastane-ada.md',
      ...CLIENTS.flatMap((x) => [`marka-dili/${x.slug}.md`, `musteriler/${x.slug}.md`]), ...pilotFiles('gelen-kutusu').map((m) => `gelen-kutusu/${m}`)];
    for (const file of files) {
      const text = pilotFile(file);
      for (const address of text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? []) expect(address, file).toMatch(/\.example$/);
      for (const host of text.match(/(https?:\/\/|www\.)[^\s)"]+/g) ?? []) expect(host, file).toMatch(/^(https?:\/\/)?(www\.)?[\w.-]+\.example(\/|$)/);
      expect(text, file).not.toMatch(/(\+90|\b0)\s?\(?[2-5]\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/);
      expect(text, file).not.toMatch(/\bTR\d{2}[\s\d]{20,}/);
      expect(text, file).not.toMatch(/\b[1-9]\d{10}\b/);
    }
    for (const { slug, name } of CLIENTS) {
      expect(pilotFile('marka-dili', `${slug}.md`), slug).toContain(`${name} (sentetik)`);
      expect(pilotFile('musteriler', `${slug}.md`), slug).toContain(`${name} (sentetik)`);
    }
    expect(pilotFile('README.md')).toContain('Kıyı Ajans (sentetik)');
  });
});

describe('pilot agency package (C5-3) — K1: the install in a temporary office', () => {
  it('installs: 3 employees from templates, 10 topics (4 rules + 6 brand guides), 2 goals with KPIs, 2 routines, 3 reviewed tasks; every new desk closed by the 12 rules', () => {
    const t = make();
    const c = t.coordinator.id;
    const b = pilotBlueprint();
    const { plan } = t.blueprints.propose(c, b);
    expect(plan.steps).toHaveLength(21);
    expect(plan.risks).not.toMatch(/tanınmayan/);
    t.company.approve(plan.id);
    const report = t.blueprints.apply(c, plan.id);
    expect(report.finished).toBe(true);
    expect(report.steps.every((x) => x.result === 'done')).toBe(true);
    const people = t.roster.list().filter((e) => e.kind !== 'coordinator');
    expect(people.map((e) => [e.name, e.template?.id ?? null, e.model, e.capabilities])).toEqual(b.roles.map((r) => [r.name, r.template, r.model, r.capabilities]));
    expect(t.memory.playbookTopics().map((p) => p.topic).sort()).toEqual(b.playbook.map((p) => p.topic).sort());
    for (const p of b.playbook) expect(t.memory.playbookTopic(p.topic).text, p.topic).toBe(p.text);
    expect(t.company.goals().map((g) => [g.title, g.kpis.length])).toEqual(b.goals.map((g) => [g.title, expect.any(Number)]));
    expect(t.company.goals().every((g) => g.kpis.length > 0)).toBe(true);
    expect(t.schedules.list({ statuses: ['active'] }).map((x) => [x.title, x.cron]).sort()).toEqual(b.routines.map((r) => [r.title, r.cron]).sort());
    const editor = people.find((e) => e.template?.id === 'editor')!;
    expect(t.tasks.list({ planId: plan.id }).map((x) => [x.title, x.reviewer])).toEqual(b.tasks.map((x) => [x.title, editor.id]));
    for (const e of people) {
      const settings = JSON.parse(readFileSync(join(deskDir(t.dataDir, e.slug), '.claude', 'settings.json'), 'utf8'));
      expect(settings, e.name).toEqual({ permissions: { deny: b.closedMode.deny } });
    }
    expect(b.closedMode.deny).toHaveLength(12);
  });

  it('a second and a third run add nothing: every step skipped, no employee, topic version, goal, routine, task or event more', () => {
    const t = make();
    const c = t.coordinator.id;
    const { plan } = t.blueprints.propose(c, pilotBlueprint());
    t.company.approve(plan.id);
    t.blueprints.apply(c, plan.id);
    const before = t.snapshot();
    const again = t.blueprints.apply(c, plan.id);
    expect(again.finished).toBe(true);
    expect(again.steps).toHaveLength(21);
    expect(again.steps.every((x) => x.result === 'skipped')).toBe(true);
    expect(t.snapshot()).toEqual(before);
    t.blueprints.apply(c, plan.id);
    expect(t.snapshot()).toEqual(before);
  });

  it('blueprintRead: every closed-mode rule on every desk is known — no “unknown” (the server rules by the machine’s sessions and the vocabulary, the shell rules unverifiable by a list)', () => {
    const t = make();
    const c = t.coordinator.id;
    const { plan } = t.blueprints.propose(c, pilotBlueprint());
    t.company.approve(plan.id);
    t.blueprints.apply(c, plan.id);
    const view = t.blueprints.read(plan.id);
    expect(view.closedMode).toHaveLength(3);
    for (const desk of view.closedMode) {
      expect(desk.rules.map((r) => r.rule), desk.name).toEqual(pilotBlueprint().closedMode.deny);
      expect(desk.rules.filter((r) => r.check === 'unknown'), desk.name).toEqual([]);
      expect(desk.rules.filter((r) => r.rule.startsWith('Bash(')).map((r) => r.check), desk.name).toEqual(['unverifiable', 'unverifiable', 'unverifiable']);
    }
    expect(blueprintText(view, t.plans.get(plan.id))).not.toContain('tanınmıyor');
  });
});
