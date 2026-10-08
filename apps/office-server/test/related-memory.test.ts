import { writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER, type StoredEvent } from '@cc/shared';
import { BlueprintStore } from '../src/company/blueprint-store.ts';
import { Blueprints } from '../src/company/blueprint.ts';
import { Dispatcher, WORK_CLOSING } from '../src/company/dispatcher.ts';
import { RELATED_BUDGET, RELATED_HEADING, relatedMemory, relatedQuery } from '../src/company/related-memory.ts';
import { SearchIndex, type SearchDoc } from '../src/company/search.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup, waitFor } from './helpers.ts';
import { brandTopic, clientNote, CLIENTS, pilotBlueprint, pilotProfile } from './pilot-ajans-fixtures.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const doc = (kind: SearchDoc['kind'], ref: string, title: string, body: string, ts = 1000): SearchDoc => ({ kind, ref, title, body, tags: [], ts });
const task = (title: string, done: string[] = []) => ({ title, done });
const lines = (section: string) => section.split('\n').filter((l) => l.startsWith('• '));

describe('B12 related memory: the section a task message carries (C5-6, pilot A9)', () => {
  it('searches by the task’s title, then its definition of done: the first 8 words that say something, each once', () => {
    expect(relatedQuery(task('Haftalık içerik takvimi ve 6 gönderi metni: Pastane Ada (sentetik)', ["takvim.csv'de 6 satır"]))).toBe(
      'haftalik icerik takvimi gonderi metni pastane ada sentetik',
    );
    expect(relatedQuery(task('R10 testi', ['economy scenario kararsız', 'R10 için bir de B7']))).toBe('r10 testi economy scenario kararsiz b7');
    expect(relatedQuery(task(' ', ['ve', 'bir']))).toBe('');
  });

  it('review (Kerem): a task code keeps its number (C5-1 is one word, not c5 and a dropped 1); “inceleme” and “tur” say nothing', () => {
    expect(relatedQuery(task('C5-1 B9a: kanca + onay kaydı', ['v21 gidiş-dönüş']))).toBe('c5-1 b9a kanca onay kaydi v21 gidis donus');
    expect(relatedQuery(task('İnceleme: C5-6 B12: göreve ilgili hafıza (tur 1)'))).toBe('c5-6 b12 goreve ilgili hafiza');
  });

  it('a code is searched as itself: C5-1 finds C5-1, not C5-5; a partial record with a single word of the task is left out', () => {
    const s = setup();
    cleanups.push(s.cleanup);
    const index = new SearchIndex(s.db);
    index.upsert(doc('task', 'a', 'C5-5 Pilot ölçüm betiği', 'KÖ1–KÖ11 tablosu; kanca yok.'));
    index.upsert(doc('decision', 'b', 'C5-1 B9a sırası', 'Kanca ve onay kaydı v21.'));
    index.upsert(doc('note', 'c', 'Kanca deneyi', 'PreToolUse.'));
    const section = relatedMemory(index, task('C5-1 B9a: kanca + onay kaydı'));
    expect(lines(section)[0]).toContain('C5-1 B9a sırası');
    expect(section).not.toContain('C5-5 Pilot');
    // “Kanca deneyi” has one of the five words only.
    expect(section).not.toContain('Kanca deneyi');
    expect(index.search('C5-1', { limit: 10 }).hits.map((h) => h.title)).toEqual(['C5-1 B9a sırası']);
  });

  it('the first three records, best first; partial ones marked with how many words; nothing at all when nothing matches', () => {
    const s = setup();
    cleanups.push(s.cleanup);
    const index = new SearchIndex(s.db);
    index.upsert(doc('playbook', 'Marka dili — Pastane Ada', 'Marka dili — Pastane Ada', 'Ton: sıcak; takvim haftada 6 gönderi.'));
    index.upsert(doc('note', '1', 'Pastane Ada profili', 'Mahalle pastanesi; takvim Pazartesi.'));
    index.upsert(doc('note', '2', 'Pastane Ada geçmiş', 'Son 20 gönderi.'));
    index.upsert(doc('note', '3', 'Pastane Ada fatura', 'Eylül.'));
    index.upsert(doc('decision', 'd1', 'Ses aracı', 'ElevenLabs.'));
    const section = relatedMemory(index, task('Pastane Ada takvimi', ['Marka diline uygun 6 gönderi']));
    expect(section.startsWith(`\n\n${RELATED_HEADING}\n`)).toBe(true);
    expect(lines(section)).toHaveLength(3);
    expect(lines(section)[0]).toMatch(/^• \[el kitabı, kısmi \d\/\d\] Marka dili — Pastane Ada \(1970-01-01, playbookRead konu: Marka dili — Pastane Ada\): /);
    expect(section).not.toContain('Ses aracı');
    expect(relatedMemory(index, task('Kurulum betiği', ['pnpm dokuz']))).toBe('');
    expect(relatedMemory(index, task('', []))).toBe('');
  });

  it('keeps within its character budget: long records are cut, never the heading', () => {
    const s = setup();
    cleanups.push(s.cleanup);
    const index = new SearchIndex(s.db);
    for (const n of [1, 2, 3]) index.upsert(doc('note', String(n), `Pastane Ada ${'uzun başlık '.repeat(20)}${n}`, `pastane ada ${'çok uzun bir gövde '.repeat(200)}`));
    const section = relatedMemory(index, task('Pastane Ada takvimi'));
    expect(section.length).toBeLessThanOrEqual(RELATED_BUDGET);
    expect(lines(section)).toHaveLength(3);
    for (const line of lines(section)) expect(line.endsWith('…'), line).toBe(true);
  });
});

/** A company with a dispatcher, wired as main.ts wires B12 (`related`); `related` replaced where a test says so. */
function office(related?: (t: import('@cc/shared').Task) => string) {
  const s = setup();
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, ['coder']);
  const dispatcher = new Dispatcher({ events: s.events, roster: s.roster, tasks: c.tasks, notices: c.notices, plans: c.plans, company: c.company, engine: f.engine, related: related ?? ((t) => relatedMemory(c.index, t)) });
  cleanups.push(dispatcher.start());
  return { ...s, ...c };
}
const messageTo = (events: import('../src/event-store.ts').EventStore, id: string, title: string) =>
  waitFor(events, (e) => e.employeeId === id && e.event.type === 'message.user' && e.event.text.includes(`## Görev: ${title}`)).then((e) => (e.event as { text: string }).text);
const searched = (events: StoredEvent[]) => events.filter((e) => e.event.type === 'memory.searched').length;

describe('B12 related memory in the task message', () => {
  it('the message carries “## İlgili hafıza” after the definition of done and before the closing; a task with nothing related has none', async () => {
    const t = office();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    t.memory.writeNote(ada.id, { title: 'Pastane Ada marka dili', text: 'Sıcak, samimi; fiyat yazılmaz.' });
    t.company.createTask(OWNER, { assignee: ada.id, title: 'Pastane Ada gönderileri', done: ['6 gönderi'] });
    const text = await messageTo(t.events, ada.id, 'Pastane Ada gönderileri');
    const at = text.indexOf(RELATED_HEADING);
    expect(at).toBeGreaterThan(text.indexOf('- 6 gönderi'));
    expect(at).toBeLessThan(text.indexOf(WORK_CLOSING));
    expect(text.slice(at)).toContain('Pastane Ada marka dili');
    t.company.createTask(OWNER, { assignee: ada.id, title: 'Kurulum betiği', done: ['pnpm dokuz'] });
    const t2 = t.tasks.list({ assignee: ada.id, statuses: ['in_progress'] })[0]!;
    t.company.finish(ada.id, t2.id, { summary: 'Bitti.', outputs: [], learned: '', evidence: ['6 gönderi: tamam'] });
    expect(await messageTo(t.events, ada.id, 'Kurulum betiği')).not.toContain(RELATED_HEADING);
  });

  it('writes no memory.searched event — the searches the office makes for itself do not count in the empty-answer KPI; an employee’s own search still does', async () => {
    const t = office();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    t.memory.writeNote(ada.id, { title: 'Pastane Ada marka dili', text: 'Sıcak.' });
    t.company.createTask(OWNER, { assignee: ada.id, title: 'Pastane Ada gönderileri' });
    expect(await messageTo(t.events, ada.id, 'Pastane Ada gönderileri')).toContain(RELATED_HEADING);
    expect(searched(t.events.list({ limit: 5000 }))).toBe(0);
    t.memory.search('pastane', { by: ada.id });
    expect(searched(t.events.list({ limit: 5000 }))).toBe(1);
  });

  it('a search that fails costs the task nothing: it is handed out without the section', async () => {
    const t = office(() => {
      throw new Error('dizin bozuk');
    });
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    t.company.createTask(OWNER, { assignee: ada.id, title: 'Rapor' });
    const text = await messageTo(t.events, ada.id, 'Rapor');
    expect(text).not.toContain(RELATED_HEADING);
    expect(text).toContain(WORK_CLOSING);
  });
});

describe('B12 K2: the pilot package', () => {
  it('the writer’s tasks carry the client’s brand guide (first task: in its message; second: the same search)', async () => {
    const s = setup();
    const f = fakeEngine(s);
    cleanups.push(f.cleanup, s.cleanup);
    const c = companyFor(s, f, ['coder']);
    const blueprints = new Blueprints({ company: c.company, roster: s.roster, tasks: c.tasks, plans: c.plans, schedules: c.schedules, memory: c.memory, store: new BlueprintStore(s.db), constitution: () => c.budget.constitution() });
    const coordinator = c.company.hireCoordinator();
    for (const [section, fields] of Object.entries(pilotProfile())) c.company.profileUpdate(coordinator.id, { section, fields, assumed: false });
    for (const { slug } of CLIENTS) c.memory.writeNote(coordinator.id, clientNote(slug));
    const { plan } = blueprints.propose(coordinator.id, pilotBlueprint());
    c.company.approve(plan.id);
    expect(blueprints.apply(coordinator.id, plan.id).finished).toBe(true);
    const people = Object.fromEntries(s.roster.list().map((e) => [e.template?.id ?? e.kind, e]));
    const stop = new Dispatcher({ events: s.events, roster: s.roster, tasks: c.tasks, notices: c.notices, plans: c.plans, company: c.company, engine: f.engine, related: (t) => relatedMemory(c.index, t) }).start();
    cleanups.push(stop);
    const writer = await messageTo(s.events, people['icerik-yazari']!.id, 'Müşteri araştırması: Pastane Ada (sentetik)');
    const account = await messageTo(s.events, people['musteri-temsilcisi']!.id, 'İlk gelen kutusu özeti ve 3 yanıt taslağı (sentetik gelen kutusu)');
    const section = (text: string) => text.slice(text.indexOf(RELATED_HEADING), text.indexOf(WORK_CLOSING)).trim();
    // The writer's second task waits behind the first: its section is the same search, made here.
    const second = c.tasks.list({ assignee: people['icerik-yazari']!.id }).find((t) => t.title.startsWith('Haftalık içerik takvimi'))!;
    const secondSection = relatedMemory(c.index, second).trim();
    if (process.env.RELATED_OUT) {
      writeFileSync(process.env.RELATED_OUT, `# Yazar, ilk görev (mesajın tamamı)\n\n${writer}\n\n# Yazar, ikinci görev: “${second.title}” (bölüm)\n\n${secondSection}\n\n# Hesap Asistanı, ilk görev (mesajın tamamı)\n\n${account}\n`);
    }
    expect(lines(section(writer))[0]).toContain(brandTopic('Pastane Ada'));
    expect(lines(secondSection).some((l) => l.includes(brandTopic('Pastane Ada')))).toBe(true);
    // The account assistant's task has a section too; which records it brings is reported with the hand-in.
    expect(lines(section(account))).toHaveLength(3);
    expect(searched(s.events.list({ limit: 5000 }))).toBe(0);
  });
});
