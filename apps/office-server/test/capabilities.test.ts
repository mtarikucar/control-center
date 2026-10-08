import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../src/migrations.ts';
import type { Employee, Integration, IntegrationDesk } from '@cc/shared';
import { Agenda } from '../src/company/agenda.ts';
import { capability, capabilityIds, capabilityVocabulary, coverage, parseCapabilities, toolClass, unclassifiedTools } from '../src/company/capabilities.ts';
import { IntegrationRegistry } from '../src/company/integrations.ts';
import { listRoleTemplates, parseRoleTemplate } from '../src/company/role-templates.ts';
import { TaskStore } from '../src/company/store.ts';
import { mcpToolPrefix, normalize } from '../src/claude/normalize.ts';
import { migrateUp, openDb } from '../src/db.ts';
import type { McpTool } from '../src/mcp/protocol.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { Roster } from '../src/roster.ts';
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
  const c = companyFor(s, f, ['coder']);
  const integrations = new IntegrationRegistry({ db: s.db, roster: s.roster, events: s.events });
  const agenda = new Agenda({ roster: s.roster, tasks: c.tasks, schedules: c.schedules, company: c.company, budget: c.budget });
  const tools = officeTools({ company: c.company, roster: s.roster, tasks: c.tasks, characters: () => ['coder'], memory: c.memory, budget: c.budget, engine: f.engine, plans: () => c.plans.list(), agenda, integrations });
  const call = async (employee: Employee, name: string, args: Record<string, unknown> = {}) => {
    const tool = tools.find((x: McpTool) => x.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    const current = s.roster.get(employee.id);
    if (!tool.kinds.includes(current.kind)) throw new Error(`Bilinmeyen ya da bu çalışana kapalı araç: ${name}`);
    return tool.run({ employee: current }, args) as Promise<string>;
  };
  const coordinator = c.company.hireCoordinator();
  /** A session's report: with a tool count when given, and the tools' names (without the server's prefix) when given too. */
  const session = (who: Employee, mcp: Array<[string, string] | [string, string, number] | [string, string, number, string[]]>) =>
    s.events.append(who.id, {
      type: 'session.started', model: 'm',
      mcp: mcp.map(([name, status, tools, toolNames]) => (tools === undefined ? { name, status } : toolNames === undefined ? { name, status, tools } : { name, status, tools, toolNames })),
    });
  return { ...s, ...c, integrations, tools, call, coordinator, session };
}

/**
 * Ada: Gmail and Google Calendar open, jeeta denied by her desk. Can: Gmail waiting for authorisation, jeeta open, no
 * calendar in his session. Efe: hired, no session yet. By hand: a CLI that reads payments, and jeeta noted for orders.
 */
function office() {
  const t = make();
  const c = t.coordinator.id;
  const ada = t.company.hire(c, { name: 'Ada', role: 'r' });
  const can = t.company.hire(c, { name: 'Can', role: 'r' });
  const efe = t.company.hire(c, { name: 'Efe', role: 'r' });
  t.session(ada, [['office', 'connected', 18], ['claude.ai Gmail', 'connected', 30], ['claude.ai jeeta', 'connected', 0], ['claude.ai Google Calendar', 'connected', 9]]);
  t.session(can, [['office', 'connected', 18], ['claude.ai Gmail', 'needs-auth'], ['claude.ai jeeta', 'connected', 46]]);
  t.integrations.register(c, { name: 'iyzico-cli', kind: 'cli', capabilities: ['payments.read'] });
  t.integrations.register(c, { name: 'claude.ai jeeta', capabilities: ['ecommerce.orders'] });
  const of = (who: Employee | undefined, ids: string[]) => coverage(t.integrations.list(), ids, who?.id);
  const status = (who: Employee | undefined, id: string) => of(who, [id])[0]!.status;
  return { ...t, ada, can, efe, of, status };
}

const SAMPLE = JSON.stringify({
  version: 2,
  capabilities: [
    { id: 'email.read', title: 'E-posta okuma', summary: 'Gelen kutusunu okur.', outward: false, builtin: [], tools: ['mcp__claude_ai_Gmail__get_message'] },
    { id: 'web.fetch', title: 'Web’den okuma', summary: 'Sayfaları okur.', outward: false, builtin: ['WebFetch'], tools: [] },
    { id: 'email.send', title: 'E-posta gönderme', summary: 'Gönderir.', outward: true, builtin: [], tools: ['mcp__claude_ai_Gmail__send_message'] },
  ],
});
const sample = () => JSON.parse(SAMPLE) as { version: number; capabilities: Array<Record<string, unknown>> };
const variant = (change: (v: ReturnType<typeof sample>) => void) => {
  const v = sample();
  change(v);
  return JSON.stringify(v);
};

describe('Capability vocabulary — the file', () => {
  it('reads a vocabulary: its version and each capability as written', () => {
    const v = parseCapabilities(SAMPLE);
    expect(v.version).toBe(2);
    expect(v.capabilities.map((c) => c.id)).toEqual(['email.read', 'web.fetch', 'email.send']);
    expect(v.capabilities[2]).toEqual({ id: 'email.send', title: 'E-posta gönderme', summary: 'Gönderir.', outward: true, builtin: [], tools: ['mcp__claude_ai_Gmail__send_message'] });
  });

  it('reads the connectors known by name only (none when the field is absent): their tools are classified nowhere', () => {
    expect(parseCapabilities(SAMPLE).knownConnectors).toEqual([]);
    const v = parseCapabilities(variant((x) => void ((x as Record<string, unknown>).knownConnectors = [{ name: 'claude.ai Slack', source: 'oturumlar: needs-auth, 0 araç' }])));
    expect(v.knownConnectors).toEqual([{ name: 'claude.ai Slack', source: 'oturumlar: needs-auth, 0 araç' }]);
    const known = (list: unknown) => variant((x) => void ((x as Record<string, unknown>).knownConnectors = list));
    const bad: Array<[string, RegExp]> = [
      [known('claude.ai Slack'), /knownConnectors bir liste olmalı/],
      [known([{ source: 's' }]), /knownConnectors: ad boş olamaz/],
      [known([{ name: 'claude.ai Slack', source: ' ' }]), /knownConnectors: “claude.ai Slack” için kaynak boş olamaz/],
      [known([{ name: 'claude.ai Slack', source: 's', tools: [] }]), /knownConnectors: “claude.ai Slack”: “tools” bilinmeyen alan/],
      [known([{ name: 'claude.ai Slack', source: 's' }, { name: 'claude.ai_Slack', source: 's' }]), /knownConnectors: “claude.ai_Slack” iki kez geçiyor \(araç ön eki mcp__claude_ai_Slack__\)/],
      // A connector whose tools the vocabulary classifies is known by them: listing it here would say the opposite.
      [known([{ name: 'claude.ai Gmail', source: 's' }]), /knownConnectors: “claude.ai Gmail” araçları sözlükte sınıflandırılmış \(email.read, email.send\)/],
    ];
    for (const [text, error] of bad) expect(() => parseCapabilities(text), String(error)).toThrow(error);
  });

  it('review focus: refuses a wrong vocabulary, saying what is wrong', () => {
    const bad: Array<[string, RegExp]> = [
      ['{', /Yetenek sözlüğü: JSON değil/],
      [variant((v) => void (v.version = 0)), /version pozitif bir tam sayı olmalı/],
      [variant((v) => void ((v as Record<string, unknown>).capabilities = 'x')), /capabilities bir liste olmalı/],
      [variant((v) => void (v.capabilities[0]!.id = 'Email.Read')), /“Email.Read”: kimlik alan.eylem biçiminde olmalı/],
      [variant((v) => void (v.capabilities[0]!.id = 'email')), /“email”: kimlik alan.eylem biçiminde olmalı/],
      [variant((v) => void (v.capabilities[1]!.id = 'email.read')), /“email.read” iki kez geçiyor/],
      [variant((v) => void (v.capabilities[0]!.title = ' ')), /email.read: title boş olamaz/],
      [variant((v) => void (v.capabilities[0]!.summary = '')), /email.read: summary boş olamaz/],
      [variant((v) => void (v.capabilities[0]!.outward = 'no')), /email.read: outward true ya da false olmalı/],
      [variant((v) => void (v.capabilities[1]!.builtin = 'WebFetch')), /web.fetch: builtin metinlerden oluşan bir liste olmalı/],
      [variant((v) => void (v.capabilities[0]!.tools = ['get_message'])), /email.read: “get_message” bir bağlayıcı aracı değil \(mcp__sunucu__araç\)/],
      [variant((v) => void (v.capabilities[2]!.tools = ['mcp__claude_ai_Gmail__get_message'])), /“mcp__claude_ai_Gmail__get_message” iki yetenekte geçiyor: email.read, email.send/],
      [variant((v) => void (v.capabilities[0]!.extra = 1)), /email.read: “extra” bilinmeyen alan/],
      [variant((v) => void delete v.capabilities[0]!.tools), /email.read: tools metinlerden oluşan bir liste olmalı/],
    ];
    for (const [text, error] of bad) expect(() => parseCapabilities(text), String(error)).toThrow(error);
  });

  it('the shipped vocabulary: twenty-three capabilities, which go outward, which the session always has, the connectors named by their tools', () => {
    const v = capabilityVocabulary();
    expect(v.version).toBe(2);
    expect(v.capabilities.map((c) => c.id)).toEqual([
      'docs.read', 'docs.write', 'web.fetch', 'email.read', 'email.draft', 'email.send', 'calendar.read', 'calendar.write',
      'social.read', 'social.draft', 'social.publish', 'crm.read', 'crm.write', 'payments.read', 'payments.charge', 'ecommerce.orders',
      'email.delete', 'messages.send', 'calls.make', 'ads.manage', 'web.publish', 'media.generate', 'automation.run',
    ]);
    expect(v.capabilities.filter((c) => c.outward).map((c) => c.id)).toEqual([
      'email.send', 'calendar.write', 'social.publish', 'payments.charge', 'email.delete', 'messages.send', 'calls.make', 'ads.manage', 'web.publish', 'media.generate', 'automation.run',
    ]);
    expect(Object.fromEntries(v.capabilities.filter((c) => c.builtin.length).map((c) => [c.id, c.builtin]))).toEqual({
      'docs.read': ['Read', 'Glob', 'Grep'], 'docs.write': ['Write', 'Edit'], 'web.fetch': ['WebFetch', 'WebSearch'],
    });
    // Only the connectors this machine's sessions have shown, by their tools' prefix.
    const servers = ['claude.ai Gmail', 'claude.ai Google Calendar', 'claude.ai jeeta', 'claude.ai Higgsfield', 'claude.ai Notion', 'claude.ai Claude Docs', 'claude.ai apify', 'plugin:playwright:playwright'];
    for (const c of v.capabilities) for (const tool of c.tools) expect(servers.some((s) => tool.startsWith(mcpToolPrefix(s))), tool).toBe(true);
    // Sending is not reading, a draft is not sending, publishing is not drafting.
    expect(capability('email.send').tools).toEqual(expect.arrayContaining(['mcp__claude_ai_Gmail__send_message', 'mcp__claude_ai_Gmail__reply', 'mcp__claude_ai_Gmail__forward', 'mcp__claude_ai_jeeta__jeeta_send_email']));
    expect(capability('email.draft').tools).toEqual(expect.arrayContaining(['mcp__claude_ai_Gmail__create_draft']));
    expect(capability('email.read').tools).toEqual(expect.arrayContaining(['mcp__claude_ai_Gmail__get_message', 'mcp__claude_ai_Gmail__search_threads']));
    expect(capability('social.publish').tools).toEqual(expect.arrayContaining(['mcp__claude_ai_jeeta__jeeta_publish_social_post', 'mcp__claude_ai_jeeta__jeeta_schedule_social_post']));
    expect(capability('social.draft').tools).toEqual(['mcp__claude_ai_jeeta__jeeta_draft_social_post']);
    expect(capability('calendar.write').tools).toEqual(expect.arrayContaining(['mcp__claude_ai_Google_Calendar__create_event']));
    // No connector here handles payments or orders: the company records its own (integrationRegister).
    for (const id of ['payments.read', 'payments.charge', 'ecommerce.orders']) expect(capability(id).tools, id).toEqual([]);
    expect(() => capability('email.sending')).toThrow(/Bilinmeyen yetenek: email.sending/);
    // Review, Kerem round 1: the outward and paying tools the first vocabulary left out.
    const J = 'mcp__claude_ai_jeeta__';
    const H = 'mcp__claude_ai_Higgsfield__';
    expect(capability('messages.send').tools).toEqual([`${J}jeeta_send_message`]);
    expect(capability('calls.make').tools).toEqual([`${J}jeeta_click_to_dial`]);
    expect(capability('ads.manage').tools).toEqual(expect.arrayContaining([`${J}jeeta_reallocate_budget`, `${J}jeeta_create_campaign`, `${J}jeeta_set_campaign_status`, `${J}jeeta_approve_strategy_action`]));
    expect(capability('web.publish').tools).toEqual([`${H}publish_website`, `${H}deploy_website`]);
    expect(capability('media.generate').tools).toEqual(expect.arrayContaining([`${H}generate_image`, `${H}generate_video`, `${H}generate_audio`]));
    expect(capability('email.delete').tools).toEqual(expect.arrayContaining(['mcp__claude_ai_Gmail__trash_message', 'mcp__claude_ai_Gmail__delete_label']));
    expect(capability('automation.run').tools).toEqual(['mcp__claude_ai_apify__call-actor']);
    expect(capability('docs.write').tools).toEqual(expect.arrayContaining(['mcp__claude_ai_Notion__notion-create-comment']));
  });

  it('every role template’s capabilities are in the vocabulary; a template asking for one that is not fails to load', () => {
    const ids = new Set(capabilityVocabulary().capabilities.map((c) => c.id));
    for (const t of listRoleTemplates()) for (const c of t.capabilities) expect(ids.has(c), `${t.id}: ${c}`).toBe(true);
    const tpl = (caps: string) =>
      `---\nid: ornek\nversion: 1\ntitle: Örnek\nteam: Örnek\nmodel: haiku\nsummary: Örnek.\ncapabilities:\n${caps}\nmethods:\n- content\nchecks:\n- k\nkpis:\n- o\n---\n### Sorumlulukların\nx\n### Nasıl çalışırsın\ny\n### Bitti ne demek\nz\n`;
    expect(parseRoleTemplate('ornek', tpl('- email.read')).capabilities).toEqual(['email.read']);
    expect(() => parseRoleTemplate('ornek', tpl('- email.sending'))).toThrow(/Rol şablonu ornek: bilinmeyen yetenek “email.sending”/);
  });

  it('a list of capabilities as given: each known, each once, in the given order', () => {
    expect(capabilityIds([' email.send', 'email.read', 'email.send'], 'Yetenekler')).toEqual(['email.send', 'email.read']);
    expect(capabilityIds([], 'Yetenekler')).toEqual([]);
    expect(() => capabilityIds('email.read', 'Yetenekler')).toThrow(/Yetenekler metinlerden oluşan bir liste olmalı/);
    expect(() => capabilityIds([1], 'Gereken yetenekler')).toThrow(/Gereken yetenekler metinlerden oluşan bir liste olmalı/);
    expect(() => capabilityIds(['email.read', 'mail.send'], 'Yetenekler')).toThrow(/Bilinmeyen yetenek: mail.send\. Sözlük: docs.read, docs.write, web.fetch, email.read/);
  });
});

const REAL_INIT = () => JSON.parse(readFileSync(new URL('./fixtures/init-mcp-deny.json', import.meta.url), 'utf8')) as Record<string, unknown>;

describe('Capabilities — the vocabulary is an allow-list (review, Kerem round 1)', () => {
  it('the shipped vocabulary knows Slack and Google Drive by name only, from the sessions that report them: no tool of theirs is named, each counts as outward', () => {
    const v = capabilityVocabulary();
    expect(v.knownConnectors.map((c) => c.name)).toEqual(['claude.ai Slack', 'claude.ai Google Drive']);
    for (const c of v.knownConnectors) {
      expect(c.source, c.name).toMatch(/session\.started/);
      expect(c.source, c.name).toMatch(/needs-auth/);
      expect(v.capabilities.flatMap((x) => x.tools).filter((t) => t.startsWith(mcpToolPrefix(c.name))), c.name).toEqual([]);
    }
    // The only tools of theirs a session here has listed: Claude Code's own sign-in helpers. Unclassified, so outward.
    for (const tool of ['mcp__claude_ai_Slack__authenticate', 'mcp__claude_ai_Google_Drive__complete_authentication']) {
      expect(toolClass(tool), tool).toEqual({ kind: 'unclassified', outward: true });
    }
  });

  it('every tool has a class: the office’s, built in, classified (its capability, outward or not) — or unclassified, which counts as outward', () => {
    expect(toolClass('mcp__office__taskFinish')).toEqual({ kind: 'office' });
    expect(toolClass('Bash')).toEqual({ kind: 'builtin' });
    expect(toolClass('WebFetch')).toEqual({ kind: 'builtin' });
    expect(toolClass('mcp__claude_ai_Gmail__get_message')).toEqual({ kind: 'classified', capability: 'email.read', outward: false });
    expect(toolClass('mcp__claude_ai_Gmail__send_message')).toEqual({ kind: 'classified', capability: 'email.send', outward: true });
    // Not in the vocabulary: no capability of a role ever opens it, and the gate treats it as outward.
    expect(toolClass('mcp__claude_ai_jeeta__jeeta_list_team')).toEqual({ kind: 'unclassified', outward: true });
    expect(toolClass('mcp__blender__execute_blender_code')).toEqual({ kind: 'unclassified', outward: true });
    // The tools the review named: each is now in a capability, outward unless it only writes the company’s own notes.
    const named = [
      'mcp__claude_ai_jeeta__jeeta_send_message', 'mcp__claude_ai_jeeta__jeeta_reallocate_budget', 'mcp__claude_ai_jeeta__jeeta_click_to_dial', 'mcp__claude_ai_jeeta__jeeta_create_campaign',
      'mcp__claude_ai_jeeta__jeeta_set_campaign_status', 'mcp__claude_ai_jeeta__jeeta_approve_strategy_action', 'mcp__claude_ai_Higgsfield__publish_website', 'mcp__claude_ai_Higgsfield__deploy_website',
      'mcp__claude_ai_Higgsfield__generate_image', 'mcp__claude_ai_Gmail__trash_message', 'mcp__claude_ai_Gmail__delete_label', 'mcp__claude_ai_apify__call-actor',
    ];
    for (const tool of named) expect(toolClass(tool), tool).toMatchObject({ kind: 'classified', outward: true });
    expect(toolClass('mcp__claude_ai_Notion__notion-create-comment')).toEqual({ kind: 'classified', capability: 'docs.write', outward: false });
  });

  it('review focus: a real session’s tools not in the vocabulary show as unclassified, per connector; a classified tool never does', () => {
    const t = make();
    const ada = t.company.hire(t.coordinator.id, { name: 'Ada', role: 'r' });
    // A real init (claude 2.1.293; Gmail, jeeta and Higgsfield denied on that desk, so none of their tools).
    t.events.append(ada.id, normalize(REAL_INIT())[0]!);
    const list = unclassifiedTools(t.integrations.list());
    const of = (server: string) => list.find((u) => u.server === server);
    // Google Calendar's nine are all in the vocabulary; the denied ones have no tools in the session.
    for (const server of ['claude.ai Google Calendar', 'claude.ai Gmail', 'claude.ai jeeta', 'claude.ai Higgsfield']) expect(of(server), server).toBeUndefined();
    expect(of('blender')).toMatchObject({ kind: 'local_mcp', tools: 9, unclassified: expect.arrayContaining(['mcp__blender__execute_blender_code']), atLeast: 9 });
    expect(of('blender')!.unclassified).toHaveLength(9);
    const notion = of('claude.ai Notion')!;
    expect(notion.tools).toBe(46);
    expect(notion.unclassified).toContain('mcp__claude_ai_Notion__notion-move-pages');
    expect(notion.unclassified).not.toContain('mcp__claude_ai_Notion__notion-search');
    expect(notion.atLeast).toBe(notion.unclassified!.length);
    for (const u of list) for (const tool of u.unclassified ?? []) expect(toolClass(tool), tool).toEqual({ kind: 'unclassified', outward: true });
    // Most first.
    expect(list.map((u) => u.atLeast)).toEqual([...list.map((u) => u.atLeast)].sort((a, b) => b - a));
  });

  it('review focus: names from every current desk’s latest session together; a session from before names gives a lower bound; the office’s own server is never listed', () => {
    const t = make();
    const c = t.coordinator.id;
    const ada = t.company.hire(c, { name: 'Ada', role: 'r' });
    const can = t.company.hire(c, { name: 'Can', role: 'r' });
    t.session(ada, [['office', 'connected', 2, ['taskFinish', 'myTasks']], ['claude.ai jeeta', 'connected', 2, ['jeeta_list_team', 'jeeta_send_message']], ['claude.ai Higgsfield', 'connected', 120]]);
    t.session(can, [['claude.ai jeeta', 'connected', 2, ['jeeta_list_team', 'jeeta_get_workspace_info']], ['blender', 'connected', 0, []]]);
    const list = unclassifiedTools(t.integrations.list());
    expect(list.find((u) => u.server === 'claude.ai jeeta')).toEqual({
      server: 'claude.ai jeeta', kind: 'claude_ai', tools: 3, unclassified: ['mcp__claude_ai_jeeta__jeeta_get_workspace_info', 'mcp__claude_ai_jeeta__jeeta_list_team'], atLeast: 2,
    });
    const known = capabilityVocabulary().capabilities.flatMap((x) => x.tools).filter((x) => x.startsWith('mcp__claude_ai_Higgsfield__')).length;
    expect(list.find((u) => u.server === 'claude.ai Higgsfield')).toEqual({ server: 'claude.ai Higgsfield', kind: 'claude_ai', tools: 120, unclassified: null, atLeast: 120 - known });
    expect(list.map((u) => u.server)).not.toContain('office');
    // A desk that denies a server has none of its tools: nothing to list.
    expect(list.map((u) => u.server)).not.toContain('blender');
    // The move to names: a desk whose session predates them but denies jeeta (0 tools, no names) leaves the names known.
    const efe = t.company.hire(c, { name: 'Efe', role: 'r' });
    t.session(efe, [['claude.ai jeeta', 'connected', 0]]);
    expect(unclassifiedTools(t.integrations.list()).find((u) => u.server === 'claude.ai jeeta')).toMatchObject({ unclassified: ['mcp__claude_ai_jeeta__jeeta_get_workspace_info', 'mcp__claude_ai_jeeta__jeeta_list_team'], atLeast: 2 });
  });

  it('capabilitiesRead and the API show them after the vocabulary', async () => {
    const t = make();
    const ada = t.company.hire(t.coordinator.id, { name: 'Ada', role: 'r' });
    expect(await t.call(ada, 'capabilitiesRead')).toContain('\n## Sınıflandırılmamış bağlayıcı araçları: henüz hiçbir oturum araç bildirmedi.');
    t.session(ada, [['claude.ai jeeta', 'connected', 9, ['jeeta_list_team', 'jeeta_send_message', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7']], ['claude.ai Higgsfield', 'connected', 120]]);
    const read = await t.call(ada, 'capabilitiesRead');
    expect(read).toContain('\n## Sınıflandırılmamış bağlayıcı araçları — sözlük bir izin listesidir: bunlar hiçbir yeteneğe ait değil, hiçbir rolde açılmaz; B9 kapısı onları dışa dönük sayar.');
    expect(read).toContain('• claude.ai jeeta: 8 (a1, a2, a3, a4, a5, a6, … +2)');
    expect(read).toContain('• claude.ai Higgsfield: en az 108 (araç adları eski bir oturumdan; sayı = oturumdaki araç − sözlükteki)');
  });
});

describe('Capabilities — what an employee declares', () => {
  it('from a template: the template’s, unless given; a given list replaces it, [] clears it; free text may declare some', () => {
    const t = make();
    const c = t.coordinator.id;
    const ece = t.company.hire(c, { name: 'Ece', template: 'musteri-temsilcisi' } as never);
    expect(ece.capabilities).toEqual(['email.read', 'email.send', 'crm.read']);
    expect(t.roster.get(ece.id).capabilities).toEqual(['email.read', 'email.send', 'crm.read']);
    const efe = t.company.hire(c, { name: 'Efe', template: 'musteri-temsilcisi', capabilities: ['email.read', 'email.draft'] } as never);
    expect(t.roster.get(efe.id).capabilities).toEqual(['email.read', 'email.draft']);
    const ozan = t.company.hire(c, { name: 'Ozan', template: 'sosyal-medya', capabilities: [] } as never);
    expect(t.roster.get(ozan.id).capabilities).toEqual([]);
    const ada = t.company.hire(c, { name: 'Ada', role: 'Muhasebe kayıtlarını tutar.', capabilities: ['payments.read', 'docs.write'] } as never);
    expect(t.roster.get(ada.id)).toMatchObject({ template: null, capabilities: ['payments.read', 'docs.write'] });
  });

  it('review focus: an unknown capability hires nobody', () => {
    const t = make();
    const c = t.coordinator.id;
    expect(() => t.company.hire(c, { name: 'Ece', template: 'musteri-temsilcisi', capabilities: ['email.read', 'whatsapp.send'] } as never)).toThrow(/Bilinmeyen yetenek: whatsapp.send/);
    expect(() => t.company.hire(c, { name: 'Ada', role: 'r', capabilities: 'email.read' } as never)).toThrow(/Yetenekler metinlerden oluşan bir liste olmalı/);
    expect(t.roster.list().map((e) => e.name)).toEqual(['Koordinatör']);
  });

  it('the coordinator changes them later on the role card; the rest of the card and other fields stay', () => {
    const t = make();
    const c = t.coordinator.id;
    const ada = t.company.hire(c, { name: 'Ada', role: 'Serbest metin.', title: 'Asistan' });
    expect(t.company.editRoleCard(c, ada.id, { capabilities: ['calendar.read', 'email.read'] } as never)).toMatchObject({ role: 'Serbest metin.', title: 'Asistan', capabilities: ['calendar.read', 'email.read'] });
    expect(t.roster.get(ada.id).capabilities).toEqual(['calendar.read', 'email.read']);
    // Not given: kept.
    t.company.editRoleCard(c, ada.id, { title: 'Baş Asistan' });
    expect(t.roster.get(ada.id)).toMatchObject({ title: 'Baş Asistan', capabilities: ['calendar.read', 'email.read'] });
    expect(() => t.company.editRoleCard(c, ada.id, { capabilities: ['x.y'] } as never)).toThrow(/Bilinmeyen yetenek: x.y/);
    expect(t.roster.get(ada.id).capabilities).toEqual(['calendar.read', 'email.read']);
    t.company.editRoleCard(c, ada.id, { capabilities: [] } as never);
    expect(t.roster.get(ada.id).capabilities).toEqual([]);
    expect(t.db.prepare('SELECT capabilities FROM employees WHERE id = ?').get(ada.id)).toMatchObject({ capabilities: null });
  });

  it('review focus: a hire with no capabilities is written as before — the column empty, the reply unchanged; old employees read as none', async () => {
    const t = make();
    const c = t.coordinator.id;
    const ada = t.company.hire(c, { name: 'Ada', role: 'r', model: 'haiku' });
    expect(ada.capabilities).toEqual([]);
    expect(t.db.prepare('SELECT capabilities FROM employees WHERE id = ?').get(ada.id)).toMatchObject({ capabilities: null });
    expect(t.roster.get(c).capabilities).toEqual([]);
    expect(await t.call(t.coordinator, 'hire', { name: 'Can', role: 'r', model: 'haiku' })).toMatch(/^İşe alındı: Can \(.+\), masa \d+, model haiku\.$/);
    // A database before v17 (the economy report reads old ones): a hire with no capabilities still writes.
    const db = openDb(':memory:');
    migrateUp(db, MIGRATIONS.filter((m) => m.version <= 16));
    const old = new Roster(db, 8).create({ name: 'Eski', role: 'r' });
    expect(old.capabilities).toEqual([]);
    expect(new Roster(db, 8).list().map((e) => e.name)).toEqual(['Eski']);
  });
});

describe('Capabilities — what a task requires', () => {
  it('a task records what it requires; myTasks shows it; an unknown one opens nothing', async () => {
    const t = make();
    const c = t.coordinator.id;
    const ada = t.company.hire(c, { name: 'Ada', role: 'r' });
    const task = t.company.createTask(c, { assignee: ada.id, title: 'Müşteri yanıtları', requires: ['email.read', 'email.draft', 'email.read'] } as never);
    expect(task.requires).toEqual(['email.read', 'email.draft']);
    expect(t.tasks.get(task.id).requires).toEqual(['email.read', 'email.draft']);
    expect(await t.call(ada, 'myTasks')).toContain(`${task.id} “Müşteri yanıtları” (öncelik 3, isteyen Koordinatör) — gereken yetenekler: email.read, email.draft`);
    expect(() => t.company.createTask(c, { assignee: ada.id, title: 'X', requires: ['email.reed'] } as never)).toThrow(/Bilinmeyen yetenek: email.reed/);
    expect(t.tasks.list().map((x) => x.title)).toEqual(['Müşteri yanıtları']);
  });

  it('review focus: a task requiring nothing is written as before — the column empty, myTasks and the reply unchanged', async () => {
    const t = make();
    const c = t.coordinator.id;
    const ada = t.company.hire(c, { name: 'Ada', role: 'r' });
    const task = t.company.createTask(c, { assignee: ada.id, title: 'Rapor', done: ['rapor.md var'] });
    expect(task.requires).toEqual([]);
    expect(t.db.prepare('SELECT requires FROM tasks WHERE id = ?').get(task.id)).toMatchObject({ requires: null });
    expect(await t.call(ada, 'myTasks')).not.toContain('gereken yetenekler');
    expect(await t.call(t.coordinator, 'taskCreate', { assignee: 'Ada', title: 'Özet' })).toMatch(/^Görev açıldı: \S+ “Özet” → Ada\.$/);
    expect(await t.call(ada, 'taskPass', { to: 'Koordinatör', title: 'Soru' })).toMatch(/^“Soru” Koordinatör adlı çalışanın sırasına eklendi \(görev \S+\)\.$/);
    // A database before v17: a task with no requirement still writes.
    const db = openDb(':memory:');
    migrateUp(db, MIGRATIONS.filter((m) => m.version <= 16));
    const store = new TaskStore(db);
    const old = store.create({ planId: null, title: 'Eski', description: '', done: [], requester: 'owner', assignee: 'a', priority: 3, dependsOn: [], chainDepth: 0 });
    expect(store.get(old.id)).toMatchObject({ title: 'Eski', requires: [] });
  });
});

describe('Capabilities — matched with the integration registry', () => {
  it('on a desk: open where a provider is open there, or the session always has a tool for it', () => {
    const t = office();
    const [web, read] = t.of(t.ada, ['web.fetch', 'email.read']);
    expect(web).toMatchObject({ id: 'web.fetch', status: 'open', builtin: ['WebFetch', 'WebSearch'] });
    expect(read).toMatchObject({ id: 'email.read', status: 'open', builtin: [] });
    expect(read!.providers).toEqual([
      expect.objectContaining({ name: 'claude.ai Gmail', kind: 'claude_ai', via: ['vocabulary'], status: 'connected', openOn: ['Ada'], desk: expect.objectContaining({ employeeId: t.ada.id, open: true }) }),
    ]);
    expect(t.status(t.ada, 'calendar.read')).toBe('open');
    expect(t.status(t.can, 'crm.read')).toBe('open');
    // The registry's own word counts too: jeeta noted for orders, open on Can's desk.
    expect(t.of(t.can, ['ecommerce.orders'])[0]!.providers).toEqual([expect.objectContaining({ name: 'claude.ai jeeta', via: ['registry'], openOn: ['Can'] })]);
    expect(t.status(t.can, 'ecommerce.orders')).toBe('open');
  });

  it('review focus: shut on a desk — reported there but not open (waiting for authorisation, denied by the desk, closed in the registry)', () => {
    const t = office();
    expect(t.status(t.can, 'email.read')).toBe('shut');
    expect(t.of(t.can, ['email.read'])[0]!.providers[0]!.desk).toMatchObject({ status: 'needs_auth', open: false, closedBy: 'server' });
    // Denied by Ada's desk, open on Can's: still shut for Ada — her session has none of its tools.
    expect(t.status(t.ada, 'crm.read')).toBe('shut');
    expect(t.of(t.ada, ['crm.read'])[0]!.providers[0]).toMatchObject({ name: 'claude.ai jeeta', openOn: ['Can'], desk: expect.objectContaining({ status: 'denied', closedBy: 'desk' }) });
    expect(t.status(t.ada, 'ecommerce.orders')).toBe('shut');
    t.integrations.register(t.coordinator.id, { name: 'claude.ai Google Calendar', closed: true });
    expect(t.status(t.ada, 'calendar.read')).toBe('shut');
    expect(t.of(t.ada, ['calendar.read'])[0]!.providers[0]!.desk).toMatchObject({ open: false, closedBy: 'registry' });
  });

  it('review focus: unseen — a desk with no session yet, a provider open on another desk; missing otherwise', () => {
    const t = office();
    expect(t.status(t.efe, 'email.read')).toBe('unseen');
    expect(t.of(t.efe, ['email.read'])[0]!.providers[0]).toMatchObject({ name: 'claude.ai Gmail', desk: null, openOn: ['Ada'] });
    expect(t.status(t.efe, 'crm.read')).toBe('unseen');
    // Can has a session and no calendar in it: not on his desk, whatever Ada's has.
    expect(t.status(t.can, 'calendar.read')).toBe('missing');
    expect(t.of(t.can, ['calendar.read'])[0]!.providers[0]).toMatchObject({ desk: null, openOn: ['Ada'] });
    // No provider at all.
    expect(t.of(t.ada, ['payments.charge'])[0]).toMatchObject({ status: 'missing', providers: [], builtin: [] });
    // Open nowhere: no session to wait for makes it unseen.
    t.integrations.register(t.coordinator.id, { name: 'claude.ai Google Calendar', closed: true });
    expect(t.status(t.efe, 'calendar.read')).toBe('missing');
  });

  it('review focus: manual — an adapter or a CLI recorded by hand, which no session ever shows; closed, it counts for nothing', () => {
    const t = office();
    for (const who of [t.ada, t.can, t.efe]) expect(t.status(who, 'payments.read'), who.name).toBe('manual');
    expect(t.of(t.ada, ['payments.read'])[0]!.providers).toEqual([expect.objectContaining({ name: 'iyzico-cli', kind: 'cli', via: ['registry'], status: 'unknown', desk: null, openOn: [] })]);
    t.integrations.register(t.coordinator.id, { name: 'iyzico-cli', closed: true });
    expect(t.status(t.ada, 'payments.read')).toBe('missing');
  });

  it('the order: open before manual before shut before unseen before missing', () => {
    const desk = (employeeId: string, open: boolean): IntegrationDesk => ({
      employeeId, name: employeeId, deskIndex: 0, status: open ? 'connected' : 'needs_auth', raw: open ? 'connected' : 'needs-auth', tools: open ? 3 : null, toolNames: null, seenAt: 1, open, closedBy: open ? null : 'server',
    });
    const integration = (name: string, kind: Integration['kind'], desks: IntegrationDesk[], capabilities: string[] = []): Integration => ({
      name, kind, status: desks.some((d) => d.open) ? 'connected' : desks.length ? 'needs_auth' : 'unknown', registryClosed: false, desks, capabilities,
      authNeeded: null, costNote: null, note: null, registeredBy: null, registeredAt: null, firstSeen: null, lastSeen: null,
    });
    const gmailOpen = integration('claude.ai Gmail', 'claude_ai', [desk('a', true), desk('b', true)]);
    const gmailShutForA = integration('claude.ai Gmail', 'claude_ai', [desk('a', false), desk('b', true)]);
    const cli = integration('mail-cli', 'cli', [], ['email.read']);
    const office = integration('office', 'office', [desk('a', true), desk('b', true)]);
    const at = (list: Integration[], who?: string) => coverage(list, ['email.read'], who)[0]!.status;
    expect(at([gmailOpen, cli, office], 'a')).toBe('open');
    expect(at([gmailShutForA, cli, office], 'a')).toBe('manual');
    expect(at([gmailShutForA, office], 'a')).toBe('shut');
    expect(at([integration('claude.ai Gmail', 'claude_ai', [desk('b', true)]), office], 'c')).toBe('unseen');
    expect(at([integration('claude.ai Gmail', 'claude_ai', [desk('b', true)]), office], 'a')).toBe('missing');
    expect(at([integration('claude.ai Gmail', 'claude_ai', [desk('b', false)])], 'c')).toBe('missing');
    // The office as a whole: open on any desk; else by hand; else known but shut; else nothing.
    expect(at([gmailShutForA])).toBe('open');
    expect(at([integration('claude.ai Gmail', 'claude_ai', [desk('a', false)]), cli])).toBe('manual');
    expect(at([integration('claude.ai Gmail', 'claude_ai', [desk('a', false)])])).toBe('shut');
    expect(at([office])).toBe('missing');
    // A registry entry whose capability the vocabulary does not name matches nothing, and none of the office's server.
    expect(coverage([integration('x', 'cli', [], ['email.reading'])], ['email.read'])[0]!.providers).toEqual([]);
  });
});

describe('Capabilities — reading them, and the tools that take them', () => {
  it('capabilitiesRead (everyone, read-only): the vocabulary with the office’s connectors; someone’s; a task’s on its assignee’s desk or on another', async () => {
    const t = office();
    expect(t.tools.find((x) => x.name === 'capabilitiesRead')?.kinds).toEqual(['member', 'lead', 'coordinator']);
    // Each read writes nothing to the log.
    const read = async (who: Employee, args: Record<string, unknown> = {}) => {
      const before = t.events.list({ limit: 100_000 }).length;
      const text = await t.call(who, 'capabilitiesRead', args);
      expect(t.events.list({ limit: 100_000 }).length).toBe(before);
      return text;
    };
    const all = await read(t.ada);
    expect(all).toContain('# Yetenek sözlüğü (23 yetenek, sürüm 2) — ofisteki karşılığı; salt okunur, hiçbir bağlayıcı çağrılmadı.');
    expect(all).toContain('\n## Adıyla bilinen bağlayıcılar — araçları sözlükte yok, hepsi dışa dönük sayılır: claude.ai Slack, claude.ai Google Drive');
    expect(all).toContain('• email.read — E-posta okuma [açık] claude.ai Gmail: açık: Ada');
    expect(all).toContain('• web.fetch — Web’den okuma [açık] yerleşik: WebFetch, WebSearch');
    expect(all).toContain('• payments.read — Ödeme kayıtlarını okuma [elle kayıtlı] iyzico-cli: elle kayıtlı (komut satırı), oturumlarda görünmez');
    expect(all).toContain('• payments.charge — Ödeme alma (dışa dönük) [yok] sağlayan bağlantı yok');
    t.company.editRoleCard(t.coordinator.id, t.ada.id, { capabilities: ['email.read', 'crm.read', 'payments.charge'] } as never);
    const ada = await read(t.can, { employee: 'Ada' });
    expect(ada).toContain('# Ada — yetenekler (3), masasındaki karşılığı');
    expect(ada).toContain('• email.read — E-posta okuma [açık] claude.ai Gmail: bu masada açık');
    expect(ada).toContain('• crm.read — Müşteri kayıtlarını okuma [kapalı] claude.ai jeeta: oturumda aracı yok (masa ayarı ya da rolün kapatması) (açık: Can)');
    expect(await read(t.ada, { employee: 'Efe' })).toBe('Efe için bildirilmiş yetenek yok. Koordinatör editRoleCard(capabilities) ile bildirir.');
    const task = t.company.createTask(t.coordinator.id, { assignee: t.efe.id, title: 'Kampanya', requires: ['email.send', 'crm.read'] } as never);
    const forTask = await read(t.efe, { task: task.id });
    expect(forTask).toContain('# Görev “Kampanya” — gereken yetenekler (2); masa: Efe');
    expect(forTask).toContain('• email.send — E-posta gönderme (dışa dönük) [bu masada görülmedi] claude.ai Gmail: açık: Ada');
    expect(await read(t.efe, { task: task.id, employee: 'Can' })).toContain('• crm.read — Müşteri kayıtlarını okuma [açık] claude.ai jeeta: bu masada açık');
    const plain = t.company.createTask(t.coordinator.id, { assignee: t.efe.id, title: 'Düz iş' });
    expect(await read(t.efe, { task: plain.id })).toBe('“Düz iş” görevi yetenek istemiyor.');
  });

  it('review focus: a capability the vocabulary no longer has (a later product version dropped it) reads as missing, never breaks the read', async () => {
    const t = office();
    // As if written under an older vocabulary: straight into the row, past today's check.
    t.db.prepare('UPDATE employees SET capabilities = ? WHERE id = ?').run(JSON.stringify(['old.cap', 'email.read']), t.ada.id);
    expect(t.of(t.ada, ['old.cap'])[0]).toEqual({ id: 'old.cap', status: 'missing', builtin: [], providers: [] });
    const read = await t.call(t.can, 'capabilitiesRead', { employee: 'Ada' });
    expect(read).toContain('• old.cap — sözlükte yok [yok] sağlayan bağlantı yok');
    expect(read).toContain('• email.read — E-posta okuma [açık] claude.ai Gmail: bu masada açık');
    // The registry may still name it: then that connector provides it.
    t.integrations.register(t.coordinator.id, { name: 'iyzico-cli', capabilities: ['old.cap'] });
    expect(t.status(t.ada, 'old.cap')).toBe('manual');
  });

  it('hire, editRoleCard, taskCreate, taskPass and taskAssign take them and say what each desk has; the work happens anyway', async () => {
    const t = office();
    const hired = await t.call(t.coordinator, 'hire', { name: 'Nil', template: 'musteri-temsilcisi', role: 'Kanal: e-posta.' });
    expect(hired).toMatch(/^İşe alındı: Nil \(.+\), masa \d+, model sonnet, şablon musteri-temsilcisi \(sürüm \d+\)\.\nYetenekler: email\.read \[bu masada görülmedi\], email\.send \[bu masada görülmedi\], crm\.read \[bu masada görülmedi\]\. Ayrıntı: capabilitiesRead\.$/);
    expect(await t.call(t.coordinator, 'hire', { name: 'Ali', role: 'r', model: 'haiku', capabilities: ['payments.charge'] })).toContain('\nYetenekler: payments.charge [yok]. Açık olmayanlar için sahibinden yetki iste (propose). Ayrıntı: capabilitiesRead.');
    expect(t.roster.list().find((e) => e.name === 'Ali')!.capabilities).toEqual(['payments.charge']);
    expect(await t.call(t.coordinator, 'editRoleCard', { employee: 'Can', capabilities: ['crm.read', 'email.read'] })).toBe('Can adlı çalışanın rol kartı güncellendi.\nYetenekler: crm.read [açık], email.read [kapalı]. Açık olmayanlar için sahibinden yetki iste (propose). Ayrıntı: capabilitiesRead.');
    const created = await t.call(t.coordinator, 'taskCreate', { assignee: 'Ada', title: 'Takvim', requires: ['calendar.read', 'crm.read'] });
    expect(created).toMatch(/^Görev açıldı: \S+ “Takvim” → Ada\.\nGereken yetenekler, Ada masasında: calendar\.read \[açık\], crm\.read \[kapalı\]\. Görev yine açıldı; açık olmayanlar için sahibinden yetki iste \(propose\)\. Ayrıntı: capabilitiesRead\.$/);
    const passed = await t.call(t.ada, 'taskPass', { to: 'Can', title: 'Siparişler', requires: ['ecommerce.orders'] });
    expect(passed).toMatch(/^“Siparişler” Can adlı çalışanın sırasına eklendi \(görev \S+\)\.\nGereken yetenekler, Can masasında: ecommerce\.orders \[açık\]\. Ayrıntı: capabilitiesRead\.$/);
    const id = /görev (\S+)\)/.exec(passed)![1]!;
    expect(t.tasks.get(id).requires).toEqual(['ecommerce.orders']);
    expect(await t.call(t.coordinator, 'taskAssign', { taskId: id, assignee: 'Ada' })).toBe('“Siparişler” artık Ada adlı çalışanda.\nGereken yetenekler, Ada masasında: ecommerce.orders [kapalı]. Açık olmayanlar için sahibinden yetki iste (propose). Ayrıntı: capabilitiesRead.');
    await expect(t.call(t.coordinator, 'taskCreate', { assignee: 'Ada', title: 'X', requires: ['x.y'] })).rejects.toThrow(/Bilinmeyen yetenek: x.y/);
  });

  it('integrationRegister still takes any capability text (as in B3) but says which ones the vocabulary does not know', async () => {
    const t = office();
    expect(await t.call(t.coordinator, 'integrationRegister', { name: 'trendyol-cli', kind: 'cli', capabilities: ['ecommerce.orders'] })).toBe('Kayıt güncellendi: trendyol-cli [bilinmiyor].');
    expect(await t.call(t.coordinator, 'integrationRegister', { name: 'sms-cli', kind: 'cli', capabilities: ['sms.send', 'email.send'] })).toBe(
      'Kayıt güncellendi: sms-cli [bilinmiyor].\nSözlükte olmayan yetenek: sms.send — eşleşmede kullanılmaz (sözlük: capabilitiesRead).',
    );
    expect(t.integrations.get('sms-cli').capabilities).toEqual(['sms.send', 'email.send']);
  });
});
