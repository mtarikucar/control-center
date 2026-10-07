import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Employee, Plan } from '@cc/shared';
import { Agenda } from '../src/company/agenda.ts';
import { deskDir } from '../src/desk.ts';
import type { McpTool } from '../src/mcp/protocol.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { companyFor, METHOD } from './company-helpers.ts';
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
  const c = companyFor(s, f, ['coder']);
  const agenda = new Agenda({ roster: s.roster, tasks: c.tasks, schedules: c.schedules, company: c.company, budget: c.budget });
  const tools = officeTools({ company: c.company, roster: s.roster, tasks: c.tasks, characters: () => ['coder'], memory: c.memory, budget: c.budget, engine: f.engine, plans: () => c.plans.list(), agenda });
  const call = async (employee: Employee, name: string, args: Record<string, unknown> = {}) => {
    const tool = tools.find((x: McpTool) => x.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    const current = s.roster.get(employee.id);
    if (!tool.kinds.includes(current.kind)) throw new Error(`Bilinmeyen ya da bu çalışana kapalı araç: ${name}`);
    return tool.run({ employee: current }, args);
  };
  const coordinator = c.company.hireCoordinator();
  const ada = c.company.hire(coordinator.id, { name: 'Ada', role: 'r' });
  return { ...s, ...c, tools, call, coordinator, ada };
}

const profileEvents = (t: ReturnType<typeof make>) => t.events.list({ limit: 5000 }).filter((e) => e.event.type === 'profile.updated');

describe('Company profile — store and rules', () => {
  it('merges each update into its section, one company-wide version per change, the history kept', () => {
    const t = make();
    const c = t.coordinator.id;
    expect(t.company.profile()).toEqual({ version: 0, sections: {} });
    const first = t.company.profileUpdate(c, { section: 'identity', fields: { name: 'Tatlı Fırın', sector: 'gıda perakende' }, assumed: true });
    expect(first).toMatchObject({ version: 1, section: 'identity', fields: { name: 'Tatlı Fırın', sector: 'gıda perakende' }, assumed: true, by: c });
    t.company.profileUpdate(c, { section: 'customers', fields: { segments: ['mahalle sakinleri', 'kafeler'], channels: ['Instagram'] } });
    // A later update adds a field and changes one; the others stay; the owner's word clears the assumption.
    const third = t.company.profileUpdate(c, { section: 'identity', fields: { sector: 'fırın', languages: ['tr', 'en'] }, assumed: false });
    expect(third).toMatchObject({ version: 3, fields: { name: 'Tatlı Fırın', sector: 'fırın', languages: ['tr', 'en'] }, assumed: false });
    const profile = t.company.profile();
    expect(profile.version).toBe(3);
    expect(profile.sections.identity?.fields).toEqual({ name: 'Tatlı Fırın', sector: 'fırın', languages: ['tr', 'en'] });
    expect(profile.sections.customers).toMatchObject({ version: 2, assumed: false, fields: { segments: ['mahalle sakinleri', 'kafeler'], channels: ['Instagram'] } });
    expect(t.company.profileHistory('identity').map((e) => [e.version, e.fields.sector, e.assumed])).toEqual([
      [3, 'fırın', false],
      [1, 'gıda perakende', true],
    ]);
    expect(profileEvents(t).map((e) => [e.employeeId, (e.event as { entry: { version: number } }).entry.version])).toEqual([[c, 1], [c, 2], [c, 3]]);
  });

  it('removes a field given null, empty text or an empty list; an update that changes nothing opens no version', () => {
    const t = make();
    const c = t.coordinator.id;
    t.company.profileUpdate(c, { section: 'constraints', fields: { budget: 'aylık 500 TL', legal: ['KVKK'], timezone: 'Europe/Istanbul', brandVoice: 'samimi' } });
    const next = t.company.profileUpdate(c, { section: 'constraints', fields: { budget: null, legal: [], brandVoice: '  ' } });
    expect(next).toMatchObject({ version: 2, fields: { timezone: 'Europe/Istanbul' } });
    expect(Object.keys(next.fields)).toEqual(['timezone']);
    const same = t.company.profileUpdate(c, { section: 'constraints', fields: { timezone: ' Europe/Istanbul ' } });
    expect(same.version).toBe(2);
    expect(t.company.profile().version).toBe(2);
    expect(profileEvents(t)).toHaveLength(2);
    // Only the assumption changes: that is a change.
    expect(t.company.profileUpdate(c, { section: 'constraints', fields: {}, assumed: true })).toMatchObject({ version: 3, assumed: true, fields: { timezone: 'Europe/Istanbul' } });
  });

  it('review focus: refuses unknown sections and fields, wrong types and oversize values, changing nothing; only the coordinator writes', () => {
    const t = make();
    const c = t.coordinator.id;
    const bad: Array<[unknown, unknown, RegExp]> = [
      ['finance', { budget: 'x' }, /Bilinmeyen profil bölümü: finance/],
      ['identity', { revenue: '1M' }, /Kimlik bölümünde “revenue” alanı yok.*name, sector, summary, country, languages, notes/],
      ['identity', { languages: 'tr' }, /Diller bir liste olmalı/],
      ['identity', { name: ['a'] }, /Ad metin olmalı/],
      ['identity', { name: 'x'.repeat(1001) }, /en fazla 1000 karakter/],
      ['offer', { products: Array.from({ length: 21 }, (_, i) => `ürün ${i}`) }, /en fazla 20 madde/],
      ['offer', { products: [7] }, /Ürün ve hizmetler bir liste olmalı/],
      ['identity', 'name=x', /alanlar \(fields\) bir nesne olmalı/],
      ['identity', ['x'], /alanlar \(fields\) bir nesne olmalı/],
    ];
    for (const [section, fields, error] of bad) {
      expect(() => t.company.profileUpdate(c, { section: section as never, fields: fields as never }), JSON.stringify([section, fields])).toThrow(error);
    }
    expect(() => t.company.profileUpdate(c, { section: 'identity', fields: { name: 'x' }, assumed: 'yes' as never })).toThrow(/assumed true ya da false olmalı/);
    // Nothing to write into an empty section: no empty version.
    expect(() => t.company.profileUpdate(c, { section: 'offer', fields: { pricing: null, products: [] } })).toThrow(/Teklif bölümü boş; yazacak bir alan ver/);
    expect(() => t.company.profileUpdate(t.ada.id, { section: 'identity', fields: { name: 'x' } })).toThrow(/Yalnız koordinatör/);
    expect(t.company.profile()).toEqual({ version: 0, sections: {} });
    expect(profileEvents(t)).toEqual([]);
  });
});

describe('Company profile — tools', () => {
  it('profileRead shows every section, the empty ones as empty and the assumed ones marked; everyone reads, the coordinator writes', async () => {
    const t = make();
    expect(t.tools.find((x) => x.name === 'profileRead')?.kinds).toEqual(['member', 'lead', 'coordinator']);
    expect(t.tools.find((x) => x.name === 'profileUpdate')?.kinds).toEqual(['coordinator']);
    const empty = await t.call(t.ada, 'profileRead');
    expect(empty).toContain('Şirket profili henüz boş');
    for (const label of ['Kimlik', 'Teklif', 'Müşteri ve kanallar', 'Araçlar ve hesaplar', 'Kısıtlar', 'Hedefler ve KPI\'lar', 'Başarı tanımı']) expect(empty).toContain(`## ${label}\nboş`);
    expect(await t.call(t.coordinator, 'profileUpdate', { section: 'identity', fields: { name: 'Tatlı Fırın', summary: 'Mahallede ekşi maya ekmek satıyoruz.' }, assumed: true })).toBe(
      'Profil güncellendi: Kimlik (sürüm 1, varsayım). Sahibi doğrulayınca assumed: false ile yeniden yaz.',
    );
    expect(await t.call(t.coordinator, 'profileUpdate', { section: 'offer', fields: { products: ['ekşi maya ekmek', 'kurabiye'], pricing: 'ekmek 60 TL' } })).toBe('Profil güncellendi: Teklif (sürüm 2).');
    expect(await t.call(t.coordinator, 'profileUpdate', { section: 'offer', fields: { pricing: 'ekmek 60 TL' } })).toBe('Değişiklik yok: Teklif (sürüm 2) zaten böyle.');
    const text = await t.call(t.ada, 'profileRead');
    expect(text).toContain('# Şirket profili (sürüm 2)');
    expect(text).toContain('## Kimlik (varsayım)\n- Ad: Tatlı Fırın\n- Ne yapıyor: Mahallede ekşi maya ekmek satıyoruz.');
    expect(text).toContain('## Teklif\n- Ürün ve hizmetler: ekşi maya ekmek; kurabiye\n- Fiyatlandırma: ekmek 60 TL');
    expect(text).toContain('## Kısıtlar\nboş');
    const one = await t.call(t.ada, 'profileRead', { section: 'offer' });
    expect(one).toContain('## Teklif');
    expect(one).not.toContain('Kimlik');
    await expect(t.call(t.ada, 'profileUpdate', { section: 'identity', fields: { name: 'x' } })).rejects.toThrow(/kapalı araç/);
  });

  it('profileRead with history lists a section’s versions, newest first, who wrote them and whether assumed', async () => {
    const t = make();
    await t.call(t.coordinator, 'profileUpdate', { section: 'identity', fields: { sector: 'gıda' }, assumed: true });
    await t.call(t.coordinator, 'profileUpdate', { section: 'offer', fields: { pricing: 'x' } });
    await t.call(t.coordinator, 'profileUpdate', { section: 'identity', fields: { sector: 'fırın' } });
    const history = await t.call(t.ada, 'profileRead', { section: 'identity', history: true });
    const lines = history.split('\n').filter((l) => l.startsWith('• '));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^• sürüm 3, Koordinatör, .+: \{"sector":"fırın"\}$/);
    expect(lines[1]).toMatch(/^• sürüm 1, Koordinatör, .+ \(varsayım\): \{"sector":"gıda"\}$/);
    await expect(t.call(t.ada, 'profileRead', { history: true })).rejects.toThrow(/Geçmiş için bir bölüm \(section\) ver/);
  });
});

describe('Company profile — the brief and the plan cards work as before', () => {
  it('a profile update leaves the brief, its desk copies and its events alone; briefUpdate leaves the profile alone', async () => {
    const t = make();
    t.company.updateBrief(t.coordinator.id, '# Özet\n\nMisyon: ekmek.\n');
    const desk = join(deskDir(t.dataDir, t.ada.slug), 'company-brief.md');
    const brief = t.company.brief();
    const copy = readFileSync(desk, 'utf8');
    const briefEvents = () => t.events.list({ limit: 5000 }).filter((e) => e.event.type === 'brief.updated').length;
    await t.call(t.coordinator, 'profileUpdate', { section: 'identity', fields: { name: 'Tatlı Fırın', summary: 'ekmek' } });
    await t.call(t.coordinator, 'profileUpdate', { section: 'success', fields: { done: ['ayda 300 ekmek'] } });
    expect(t.company.brief()).toBe(brief);
    expect(await t.call(t.ada, 'briefRead')).toBe('# Özet\n\nMisyon: ekmek.\n');
    expect(readFileSync(desk, 'utf8')).toBe(copy);
    expect(briefEvents()).toBe(1);
    const profile = t.company.profile();
    await t.call(t.coordinator, 'briefUpdate', { text: '# Özet\n\nMisyon: kurabiye.' });
    expect(readFileSync(desk, 'utf8')).toBe('# Özet\n\nMisyon: kurabiye.\n');
    expect(t.company.profile()).toEqual(profile);
  });

  it('a plan card is the same with a profile as without one', async () => {
    const card = async (withProfile: boolean) => {
      const t = make();
      if (withProfile) await t.call(t.coordinator, 'profileUpdate', { section: 'goals', fields: { goals: ['ilk ay 100 sipariş'], kpis: ['haftalık sipariş'] } });
      const answer = await t.call(t.coordinator, 'planPropose', { title: 'Açılış', goal: 'ilk siparişler', approach: 'Instagram', steps: ['menü', 'gönderi'], method: METHOD });
      const plan = t.plans.list()[0]!;
      t.company.approve(plan.id);
      const strip = (p: Plan) => ({ ...p, id: '', proposedBy: '', createdAt: 0, updatedAt: 0, approvedAt: p.approvedAt === null ? null : 0 });
      return { answer: answer.replace(plan.id, '<id>'), plan: strip(t.plans.get(plan.id)) };
    };
    expect(await card(true)).toEqual(await card(false));
  });
});
