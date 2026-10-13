import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MODEL_ALIASES, WORK_TYPES, type Employee } from '@cc/shared';
import { Agenda } from '../src/company/agenda.ts';
import { capabilityKind } from '../src/company/capabilities.ts';
import { listRoleTemplates, parseRoleTemplate, roleTemplate, templateRole } from '../src/company/role-templates.ts';
import { deskDir } from '../src/desk.ts';
import type { McpTool } from '../src/mcp/protocol.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup, until } from './helpers.ts';

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
  /** The desk's role card, once the session has opened and written it. */
  const card = async (e: Employee) => {
    const file = join(deskDir(s.dataDir, e.slug), 'CLAUDE.md');
    await until(() => {
      try {
        return readFileSync(file, 'utf8').length > 0;
      } catch {
        return false;
      }
    });
    return readFileSync(file, 'utf8');
  };
  return { ...s, ...c, tools, call, coordinator, card };
}

const SAMPLE = `---
id: ornek
version: 2
title: Örnek Uzman
team: Örnek
model: haiku
summary: Örnek işleri yapar.
capabilities:
- docs.write
- web.fetch
methods:
- content
- research
checks:
- Kaynak gösterilmiş.
- Biçim doğru.
kpis:
- Zamanında teslim oranı.
---
### Sorumlulukların

- Örnek iş.

### Nasıl çalışırsın

Dikkatle.

### Bitti ne demek

Teslim edildiğinde.
`;

// Templates whose capabilities reach outside or whose work is sent out in the company's name: their "how to work"
// says the owner approves.
const OUTWARD = ['sosyal-medya', 'musteri-temsilcisi', 'satis-asistani', 'operasyon-asistani', 'icerik-yazari', 'iletisim-yoneticisi', 'yonetici-asistani', 'satis-muduru', 'aday-arastirmaci', 'operasyon-finans-yoneticisi', 'satin-alma-uzmani', 'pazarlama-muduru', 'teknik-lider'];

// Spec capabilities §9: the roles that talk to customers and the public — the critical to the owner, the rest the system's.
const AUTONOMOUS = ['iletisim-yoneticisi', 'musteri-temsilcisi', 'sosyal-medya', 'satis-muduru', 'aday-arastirmaci', 'pazarlama-muduru', 'icerik-yazari'];
// What each of them sends or publishes itself (so its text says "kendin gönderirsin / yayınlarsın"): the capabilities that text relies on, no more.
const SENDS_ITSELF: Record<string, string[]> = {
  'iletisim-yoneticisi': ['email.send', 'messages.send'],
  'musteri-temsilcisi': ['email.send', 'messages.send'],
  'sosyal-medya': ['social.publish'],
  'satis-muduru': ['email.send', 'messages.send'],
  'aday-arastirmaci': ['email.send', 'messages.send'],
  'pazarlama-muduru': ['social.publish'],
  // The writer hands a file over; whoever publishes it is someone else.
  'icerik-yazari': [],
};

describe('Role templates — the format', () => {
  it('parses the front matter (scalars and lists) and the body', () => {
    expect(parseRoleTemplate('ornek', SAMPLE)).toEqual({
      id: 'ornek', version: 2, title: 'Örnek Uzman', team: 'Örnek', model: 'haiku', summary: 'Örnek işleri yapar.',
      capabilities: ['docs.write', 'web.fetch'], methods: ['content', 'research'], checks: ['Kaynak gösterilmiş.', 'Biçim doğru.'], kpis: ['Zamanında teslim oranı.'],
      body: '### Sorumlulukların\n\n- Örnek iş.\n\n### Nasıl çalışırsın\n\nDikkatle.\n\n### Bitti ne demek\n\nTeslim edildiğinde.',
    });
  });

  it('review focus: refuses a template that is not whole — no front matter, unknown or missing field, wrong model, version, method, id, section', () => {
    const bad: Array<[string, string, RegExp]> = [
      ['ornek', SAMPLE.replace(/^---\n/, ''), /Rol şablonu ornek: ön bilgi bloğu yok/],
      ['ornek', SAMPLE.replace('team: Örnek\n', 'team: Örnek\nsalary: 10\n'), /Rol şablonu ornek: “salary” bilinmeyen alan/],
      ['ornek', SAMPLE.replace('summary: Örnek işleri yapar.\n', ''), /Rol şablonu ornek: “summary” eksik/],
      ['ornek', SAMPLE.replace('kpis:\n- Zamanında teslim oranı.\n', 'kpis:\n'), /Rol şablonu ornek: “kpis” eksik/],
      ['ornek', SAMPLE.replace('model: haiku', 'model: gpt'), /Rol şablonu ornek: model fable, opus, sonnet, haiku olmalı/],
      ['ornek', SAMPLE.replace('version: 2', 'version: iki'), /Rol şablonu ornek: version pozitif bir tam sayı olmalı/],
      ['ornek', SAMPLE.replace('- research', '- dance'), /Rol şablonu ornek: bilinmeyen yöntem “dance”/],
      ['baska', SAMPLE, /Rol şablonu baska: id “ornek” dosya adıyla aynı olmalı/],
      ['ornek', SAMPLE.replace('### Bitti ne demek', '### Son'), /Rol şablonu ornek: gövdede “### Bitti ne demek” yok/],
    ];
    for (const [id, text, error] of bad) expect(() => parseRoleTemplate(id, text), String(error)).toThrow(error);
  });

  it('the role text: summary, body, checks and measures from the front matter, then the company’s own part when given', () => {
    const t = parseRoleTemplate('ornek', SAMPLE);
    const plain = `Örnek işleri yapar.\n\n${t.body}\n\n### Kalite kontrollerin\n\n- Kaynak gösterilmiş.\n- Biçim doğru.\n\n### Seni neyle ölçeriz\n\n- Zamanında teslim oranı.`;
    expect(templateRole(t)).toBe(plain);
    expect(templateRole(t, '  Marka dili: samimi.  ')).toBe(`${plain}\n\n### Bu şirkette\n\nMarka dili: samimi.`);
    expect(templateRole(t, '   ')).toBe(plain);
  });
});

describe('Role templates — the catalog (ships with the office)', () => {
  it('holds the first general small-business archetypes, each whole and on the office’s models and methods', () => {
    const all = listRoleTemplates();
    expect(all.map((t) => t.id)).toEqual([
      'aday-arastirmaci', 'arastirmaci', 'editor', 'gelistirici', 'icerik-yazari', 'iletisim-yoneticisi', 'musteri-temsilcisi', 'operasyon-asistani',
      'operasyon-finans-yoneticisi', 'otomasyon-test-uzmani', 'pazarlama-muduru', 'satin-alma-uzmani', 'satis-asistani', 'satis-muduru', 'sosyal-medya',
      'teknik-lider', 'yonetici-asistani',
    ]);
    expect(new Set(all.map((t) => t.title)).size).toBe(all.length);
    for (const t of all) {
      expect(MODEL_ALIASES, t.id).toContain(t.model);
      for (const m of t.methods) expect(WORK_TYPES, `${t.id} ${m}`).toContain(m);
      for (const c of t.capabilities) expect(c, t.id).toMatch(/^[a-z]+\.[a-z]+$/);
      expect(t.checks.length, t.id).toBeGreaterThan(1);
      expect(t.kpis.length, t.id).toBeGreaterThan(0);
    }
    // Roles that reach outside carry the company's rule where they are told how to work: posts, sends and payments
    // go through the owner.
    const howTo = (id: string) => /### Nasıl çalışırsın\n([\s\S]*?)\n### /.exec(roleTemplate(id).body)?.[1] ?? '';
    for (const id of OUTWARD) expect(howTo(id), id).toMatch(AUTONOMOUS.includes(id) ? /Kritik olan sahibine, geri kalanı sistemce/ : /sahibinin onayı/);
    expect(roleTemplate('operasyon-asistani').capabilities).not.toContain('payments.charge');
    expect(() => roleTemplate('yok')).toThrow(/Bilinmeyen rol şablonu: yok\. Şablonlar: aday-arastirmaci, arastirmaci, editor/);
  });

  it('the department heads and their suggested roles are on the office’s models (spec departments §4.3)', () => {
    const heads = { 'teknik-lider': 'opus', 'pazarlama-muduru': 'sonnet', 'iletisim-yoneticisi': 'sonnet', 'satis-muduru': 'sonnet', 'operasyon-finans-yoneticisi': 'sonnet' };
    for (const [id, model] of Object.entries(heads)) expect(roleTemplate(id).model, id).toBe(model);
    expect(roleTemplate('sosyal-medya')).toMatchObject({ version: 4, title: 'Sosyal Medya ve Reklam Uzmanı', team: 'Pazarlama' });
    expect(roleTemplate('sosyal-medya').capabilities).toContain('ads.manage');
    expect(roleTemplate('icerik-yazari')).toMatchObject({ version: 4, team: 'Pazarlama' });
    expect(roleTemplate('icerik-yazari').capabilities).toContain('media.generate');
    expect(roleTemplate('musteri-temsilcisi')).toMatchObject({ version: 4, team: 'İç-Dış İletişim' });
    expect(roleTemplate('satis-asistani')).toMatchObject({ version: 3, team: 'Satış' });
    expect(roleTemplate('operasyon-asistani')).toMatchObject({ version: 2, team: 'Operasyon ve Finans' });
    // The assistant of the owner keeps the owner's mail out of the company memory.
    expect(roleTemplate('yonetici-asistani').body).toMatch(/şirket hafızasına/);
    expect(roleTemplate('iletisim-yoneticisi').body).toMatch(/DM/);
  });

  it('spec capabilities §9: the new versions — messages read and sent, consent (İYS) for a first message, the heads’ outbox sample, ad money the owner’s', () => {
    // Final review wave: the critical class grew by bulk sends and special contacts, the heads’ sample says “kapı açıkken” — new versions (new hires only).
    expect(roleTemplate('iletisim-yoneticisi')).toMatchObject({ version: 3 });
    expect(roleTemplate('iletisim-yoneticisi').capabilities).toEqual(expect.arrayContaining(['messages.read', 'messages.send']));
    expect(roleTemplate('musteri-temsilcisi')).toMatchObject({ version: 4, capabilities: ['email.read', 'email.send', 'crm.read', 'messages.read', 'messages.send'] });
    expect(roleTemplate('sosyal-medya').version).toBe(4);
    for (const id of ['satis-muduru', 'aday-arastirmaci', 'pazarlama-muduru']) expect(roleTemplate(id).version, id).toBe(3);
    expect(roleTemplate('icerik-yazari').version).toBe(4);
    expect(roleTemplate('yonetici-asistani').version).toBe(2);
    for (const id of ['satis-muduru', 'aday-arastirmaci', 'iletisim-yoneticisi']) expect(roleTemplate(id).body, id).toMatch(/İYS/);
    // With the gate off nothing is written to the outbox: the heads’ sample is read “kapı açıkken” (final review I4.3).
    for (const id of ['iletisim-yoneticisi', 'satis-muduru', 'pazarlama-muduru']) expect(roleTemplate(id).body, id).toMatch(/- Kapı açıkken her gün odanın giden kutusundan \(`outboxRead`\) örnek okur/);
    expect(roleTemplate('sosyal-medya').body).toMatch(/Reklam harcaması .*her zaman sahibinin onayından geçer/);
  });

  it('spec capabilities §9: Satış sends follow-ups and first contact under the system’s rules, so it declares the sends; conversations are read with messages.read', () => {
    for (const id of ['satis-muduru', 'aday-arastirmaci']) expect(roleTemplate(id).capabilities, id).toEqual(expect.arrayContaining(['email.send', 'messages.send']));
    // The conversation tools moved from crm.read to messages.read: a template that reads customers’ conversations declares both.
    for (const t of listRoleTemplates()) if (t.capabilities.includes('crm.read')) expect(t.capabilities, t.id).toContain('messages.read');
    for (const id of ['sosyal-medya', 'satis-asistani']) expect(roleTemplate(id).capabilities, id).toContain('messages.read');
    // Only the templates that talk to customers send: the others keep to drafts.
    for (const id of ['satis-asistani', 'pazarlama-muduru', 'yonetici-asistani']) expect(roleTemplate(id).capabilities, id).not.toContain('messages.send');
    // The e-mail line follows the department’s “Sana gelir” list: only what that list sends to the owner goes to the owner.
    const how = /### Nasıl çalışırsın\n([\s\S]*?)\n### /.exec(roleTemplate('iletisim-yoneticisi').body)?.[1] ?? '';
    expect(how).not.toMatch(/E-posta gönderimi, takvim daveti ve e-posta silme sahibinin onayından geçer/);
    expect(how).toMatch(/Takvim daveti gönderme ve kabul etme ile e-posta silme sahibinin onayından geçer/);
  });

  it('spec capabilities §9: every autonomous role declares exactly the send and publish capabilities its text relies on — the text and the capabilities cannot drift apart', () => {
    expect(Object.keys(SENDS_ITSELF).sort()).toEqual([...AUTONOMOUS].sort());
    for (const [id, wanted] of Object.entries(SENDS_ITSELF)) {
      const declared = roleTemplate(id).capabilities.filter((c) => ['send', 'publish'].includes(capabilityKind(c) ?? ''));
      expect([...declared].sort(), id).toEqual([...wanted].sort());
    }
    // The ones that publish or send say so in their own words ("kendin"), so the capability is not decoration.
    for (const id of ['iletisim-yoneticisi', 'musteri-temsilcisi', 'sosyal-medya', 'pazarlama-muduru']) expect(roleTemplate(id).body, id).toMatch(/kendin (gönderirsin|yayınlar|yaparsın)/);
  });

  it('spec capabilities §9: what the gate holds mechanically is still an instruction to ask, not a promise that it goes to the owner by itself (the gate may be off)', () => {
    for (const id of AUTONOMOUS) expect(roleTemplate(id).body, id).not.toMatch(/zaten sahibine gider/);
    const marketing = roleTemplate('pazarlama-muduru').body;
    expect(marketing).toMatch(/olağan yayınını kendin yaparsın; sistemce çıkar/);
    // No Pazarlama role sends e-mail: the newsletter and the bulk mail are prepared, their sending asked of the owner.
    expect(marketing).toMatch(/Bülteni ve toplu e-postayı hazırlarsın; gönderimi sahibine sorulur/);
    for (const id of ['pazarlama-muduru', 'sosyal-medya', 'icerik-yazari']) expect(roleTemplate(id).capabilities.filter((c) => c.startsWith('email.')), id).toEqual([]);
    // Bulk sends and anything to or about a special contact are asked of the owner first by whoever sends, gate on or off (the gate passing the ordinary by its rules stays said beside it).
    const ASK = (verb: string, thing: string) =>
      new RegExp(`- Toplu gönderimi \\(eşiği aşan alıcı\\) yapmadan önce ve özel kişilere giden ya da onları anan bir ${thing} ${verb} önce \`approvalRequest\` ile sahibine sorarsın; kapı açıkken de kapalıyken de\\. Özel kişilerin listesi masandaki “Özel kişiler” bölümündedir`);
    for (const id of ['musteri-temsilcisi', 'iletisim-yoneticisi', 'satis-muduru', 'aday-arastirmaci']) {
      expect(roleTemplate(id).body, id).toMatch(ASK('göndermeden', 'mesajı'));
      // What the gate sees is said as it is: the call’s own input, a held draft and reply to everyone.
      expect(roleTemplate(id).body, id).toMatch(/kapı onları yalnız çağrının girdisinde arar \(adres, telefon, ad, aday ya da konuşma kimliği\), o yüzden olağan bir yanıtın alıcılarını çağrıya yaz: kapı açıkken taslağı kimliğiyle göndermek ya da herkese yanıtlamak tutulur \(“alıcılar girdide yok”\)\./);
    }
    for (const id of ['pazarlama-muduru', 'sosyal-medya']) expect(roleTemplate(id).body, id).toMatch(ASK('yayınlamadan', 'gönderiyi'));
    for (const id of ['musteri-temsilcisi', 'iletisim-yoneticisi']) {
      expect(roleTemplate(id).body, id).toMatch(/kapı Anayasa'nın .*geçirir ve giden kutusuna yazar, tutarsa `approvalRequest` ile istersin/);
    }
    // The old phrasing (the participle problem, the “konu alanı” aside, “kapı kapalıyken de” alone) is gone from every role.
    for (const t of listRoleTemplates()) expect(t.body, t.id).not.toMatch(/\(ya da onları konu alanı\)|kapı kapalıyken de\./);
    // Satış carries the same ask-first bullet beside its İYS rule (its department list already says the head asks).
    expect(roleTemplate('satis-muduru').body).toMatch(/İYS\) olmayan kişiye ilk tanıtım mesajı ya da araması göndermezsin; önce sahibine sorarsın\. İzin bilinmiyorsa yok say\.\n- Toplu gönderimi \(eşiği aşan alıcı\)/);
    expect(roleTemplate('aday-arastirmaci').body).toMatch(/sahibinin cevabı gelmeden göndermezsin\.\n- Toplu gönderimi \(eşiği aşan alıcı\)/);
    // The outbox is written only with the gate on: what says a box line exists says so (final review I4.3).
    expect(roleTemplate('satis-muduru').body).toMatch(/her temas CRM'de \(kapı açıkken giden kutusunda da\) kayıtlı/);
    for (const id of ['pazarlama-muduru', 'sosyal-medya']) expect(roleTemplate(id).checks.join('\n'), id).toMatch(/Her yayın \(kapı açıkken\) giden kutusunda/);
    expect(roleTemplate('aday-arastirmaci').body).toMatch(/sahibinin cevabı gelmeden göndermezsin/);
    expect(roleTemplate('sosyal-medya').body).toMatch(/içeren gönderi ve yayın silme önce `approvalRequest`/);
    // The writer: ordinary publishing is the system’s, the critical class (a money promise, legal, a crisis, deleting a post) goes to the owner.
    const writer = /### Nasıl çalışırsın\n([\s\S]*?)\n### /.exec(roleTemplate('icerik-yazari').body)?.[1] ?? '';
    expect(writer).toMatch(/olağan metnin yayını incelemeden sonra sistemce çıkar/);
    expect(writer).toMatch(/Para sözü \(kampanya, fiyat, indirim, çekiliş\) içeren, hukuki konuya ya da krize değen, bir yayının silinmesini gerektiren, toplu gönderilecek \(bülten gibi\) ya da özel kişilere giden ya da onları anan metni teslimde işaretle; yayını yapan onu önce `approvalRequest` ile sahibine sorar\./);
    expect(writer).not.toMatch(/her yayın sahibinin onayıyla/);
    // The assistant drafts and does not send: its own rule wins over the customer method that lets the ordinary go (final review minor 5).
    const assistant = /### Nasıl çalışırsın\n([\s\S]*?)\n### /.exec(roleTemplate('yonetici-asistani').body)?.[1] ?? '';
    expect(assistant).toMatch(/Müşteri yöntemi \(`customer`\) olağan gönderimin sistemce gittiğini söyler; sende bu geçerli değil, rolündeki kural yönteme üstündür: taslak hazırlarsın, göndermezsin\./);
    expect(roleTemplate('yonetici-asistani').capabilities.filter((c) => ['send', 'publish', 'call'].includes(capabilityKind(c) ?? ''))).toEqual([]);
  });
});

describe('Role templates — hiring', () => {
  it('hire(template): the role card from the template with the company’s own part; title, team and model from it unless given; the template recorded', async () => {
    const t = make();
    const c = t.coordinator.id;
    const ece = t.company.hire(c, { name: 'Ece', template: 'icerik-yazari', role: 'Marka dili: samimi, kısa cümleler.' } as never);
    const tpl = roleTemplate('icerik-yazari');
    expect(ece).toMatchObject({ title: 'İçerik Yazarı', team: 'Pazarlama', model: 'sonnet', template: { id: 'icerik-yazari', version: tpl.version } });
    expect(ece.role).toBe(templateRole(tpl, 'Marka dili: samimi, kısa cümleler.'));
    expect(t.roster.get(ece.id)).toMatchObject({ template: { id: 'icerik-yazari', version: tpl.version } });
    const card = await t.card(ece);
    expect(card).toContain('# Ece — İçerik Yazarı');
    expect(card).toContain(`## Rolün\n\n${ece.role}\n\n## Ofiste nasıl çalışırsın`);
    expect(card).toContain('### Bu şirkette\n\nMarka dili: samimi, kısa cümleler.');
    // What is given wins over the template's defaults.
    const efe = t.company.hire(c, { name: 'Efe', template: 'editor', title: 'Baş Editör', team: 'Yayın', model: 'sonnet' } as never);
    expect(efe).toMatchObject({ title: 'Baş Editör', team: 'Yayın', model: 'sonnet', template: { id: 'editor' } });
    expect(efe.role).toBe(templateRole(roleTemplate('editor')));
    // Nothing given: every default is the template's (the editor's model is not the office's default sonnet).
    expect(t.company.hire(c, { name: 'Ozan', template: 'editor' } as never)).toMatchObject({ title: 'Editör ve Kalite Kontrolcüsü', team: 'Kalite', model: 'opus' });
    expect(() => t.company.hire(c, { name: 'Ali', template: 'yok' } as never)).toThrow(/Bilinmeyen rol şablonu: yok/);
    expect(t.roster.list().map((e) => e.name)).toEqual(['Koordinatör', 'Ece', 'Efe', 'Ozan']);
  });

  it('review focus: hire without a template works as before — the role text as given, no template, a role still required', async () => {
    const t = make();
    const c = t.coordinator.id;
    const role = 'Testleri yazar ve çalıştırırsın.';
    const ada = t.company.hire(c, { name: 'Ada', role, title: 'Testçi', model: 'haiku' });
    expect(ada).toMatchObject({ name: 'Ada', role, title: 'Testçi', team: '', model: 'haiku', template: null });
    expect(await t.card(ada)).toContain(`## Rolün\n\n${role}\n\n## Ofiste nasıl çalışırsın`);
    expect(() => t.company.hire(c, { name: 'Boş', role: '  ' })).toThrow(/Rol tanımı boş olamaz/);
    // The coordinator is not a template hire either.
    expect(t.roster.get(c).template).toBeNull();
  });
});

describe('Role templates — tools', () => {
  it('roleTemplates (coordinator and leads) lists the catalog and reads one whole', async () => {
    const t = make();
    expect(t.tools.find((x) => x.name === 'roleTemplates')?.kinds).toEqual(['lead', 'coordinator']);
    const list = await t.call(t.coordinator, 'roleTemplates');
    expect(list).toContain('# Rol şablonları (17)');
    expect(list).toContain(`• icerik-yazari — İçerik Yazarı (sonnet; yöntem: content): ${roleTemplate('icerik-yazari').summary}`);
    const one = await t.call(t.coordinator, 'roleTemplates', { id: 'editor' });
    const e = roleTemplate('editor');
    expect(one).toContain(`# ${e.title} (editor, sürüm ${e.version})`);
    expect(one).toContain(`Model: ${e.model} · Ekip: ${e.team} · Yöntemler: ${e.methods.join(', ')} · Yetenekler: ${e.capabilities.join(', ')}`);
    expect(one).toContain(templateRole(e));
    await expect(t.call(t.coordinator, 'roleTemplates', { id: 'yok' })).rejects.toThrow(/Bilinmeyen rol şablonu/);
  });

  it('hire takes a template (the model then optional); without one it asks for role and model as before', async () => {
    const t = make();
    const reply = await t.call(t.coordinator, 'hire', { name: 'Ece', template: 'icerik-yazari', role: 'Kanallar: Instagram.' });
    // B7: a template hire also says the capabilities it declares (no registry here: only the list).
    expect(reply).toMatch(/^İşe alındı: Ece \(.+\), koltuk \d+, model sonnet, şablon icerik-yazari \(sürüm \d+\)\.\nYetenekler: docs\.write, web\.fetch, media\.generate\.$/);
    // The seat is an id (0 … 44), not a count from one: the reply names the roster's desk as it is.
    expect(reply).toContain(`koltuk ${t.roster.list().find((e) => e.name === 'Ece')!.deskIndex},`);
    expect(t.roster.list().find((e) => e.name === 'Ece')!.role).toContain('### Bu şirkette\n\nKanallar: Instagram.');
    expect(await t.call(t.coordinator, 'hire', { name: 'Ada', role: 'r', model: 'haiku' })).toMatch(/^İşe alındı: Ada \(.+\), koltuk \d+, model haiku\.$/);
    await expect(t.call(t.coordinator, 'hire', { name: 'Can', model: 'haiku' })).rejects.toThrow(/role gerekli/);
    await expect(t.call(t.coordinator, 'hire', { name: 'Can', role: 'r' })).rejects.toThrow(/model gerekli/);
  });
});
