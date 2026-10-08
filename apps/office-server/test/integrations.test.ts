import { afterEach, describe, expect, it } from 'vitest';
import type { Employee } from '@cc/shared';
import { Agenda } from '../src/company/agenda.ts';
import { IntegrationRegistry } from '../src/company/integrations.ts';
import type { McpTool } from '../src/mcp/protocol.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const HOUR = 3_600_000;
const T0 = new Date(2026, 9, 8, 9, 0).getTime();

function make() {
  let clock = T0;
  const now = () => clock;
  const s = setup(8, now);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, ['coder'], now);
  const integrations = new IntegrationRegistry({ db: s.db, roster: s.roster, events: s.events, now });
  const agenda = new Agenda({ roster: s.roster, tasks: c.tasks, schedules: c.schedules, company: c.company, budget: c.budget });
  const tools = officeTools({ company: c.company, roster: s.roster, tasks: c.tasks, characters: () => ['coder'], memory: c.memory, budget: c.budget, engine: f.engine, plans: () => c.plans.list(), agenda, integrations });
  const call = async (employee: Employee, name: string, args: Record<string, unknown> = {}) => {
    const tool = tools.find((x: McpTool) => x.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    const current = s.roster.get(employee.id);
    if (!tool.kinds.includes(current.kind)) throw new Error(`Bilinmeyen ya da bu çalışana kapalı araç: ${name}`);
    return tool.run({ employee: current }, args);
  };
  const coordinator = c.company.hireCoordinator();
  const ada = c.company.hire(coordinator.id, { name: 'Ada', role: 'r' });
  const can = c.company.hire(coordinator.id, { name: 'Can', role: 'r' });
  /** A session's report; with a tool count when given (sessions before tool counts carry none). */
  const session = (who: Employee, mcp: Array<[string, string] | [string, string, number]>) =>
    s.events.append(who.id, { type: 'session.started', model: 'm', mcp: mcp.map(([name, status, tools]) => (tools === undefined ? { name, status } : { name, status, tools })) });
  const advance = (ms: number) => void (clock += ms);
  return { ...s, ...c, integrations, tools, call, coordinator, ada, can, session, advance };
}

/** Ada at 09:00 and 11:00 (blender gone by then), Can at 10:00; the coordinator never opened a session. */
function day() {
  const t = make();
  t.session(t.ada, [['office', 'connected'], ['claude.ai Gmail', 'connected'], ['plugin:design:figma', 'needs-auth'], ['blender', 'failed'], ['claude.ai Slack', 'starting']]);
  t.advance(HOUR);
  t.session(t.can, [['office', 'connected'], ['claude.ai Gmail', 'needs-auth'], ['plugin:design:figma', 'needs-auth'], ['cad', 'pending']]);
  t.advance(HOUR);
  t.session(t.ada, [['office', 'connected'], ['claude.ai Gmail', 'connected'], ['plugin:design:figma', 'needs-auth'], ['claude.ai Slack', 'starting']]);
  return t;
}

describe('Integration registry — what the desks report', () => {
  it('reads each current desk’s latest session: the kind from the name, the status per desk, the best one overall', () => {
    const t = day();
    const one = (name: string) => t.integrations.get(name);
    expect(one('office')).toMatchObject({ kind: 'office', status: 'connected', registryClosed: false, registeredBy: null, firstSeen: T0, lastSeen: T0 + 2 * HOUR });
    // These sessions predate tool counts: what the server state says, the tools unknown.
    expect(one('office').desks.map((d) => [d.tools, d.closedBy])).toEqual([[null, null], [null, null]]);
    expect(one('office').desks.map((d) => [d.name, d.status, d.open])).toEqual([['Ada', 'connected', true], ['Can', 'connected', true]]);
    expect(one('claude.ai Gmail')).toMatchObject({ kind: 'claude_ai', status: 'connected' });
    expect(one('claude.ai Gmail').desks.map((d) => [d.name, d.status, d.raw, d.open, d.seenAt])).toEqual([
      ['Ada', 'connected', 'connected', true, T0 + 2 * HOUR],
      ['Can', 'needs_auth', 'needs-auth', false, T0 + HOUR],
    ]);
    expect(one('plugin:design:figma')).toMatchObject({ kind: 'plugin', status: 'needs_auth' });
    expect(one('cad')).toMatchObject({ kind: 'local_mcp', status: 'pending' });
    expect(t.integrations.list().map((i) => i.name)).toEqual(['claude.ai Gmail', 'office', 'plugin:design:figma', 'cad', 'blender', 'claude.ai Slack']);
  });

  it('review focus: unknown — a status the office does not know, a connector no current desk reports, one gone from the latest session', () => {
    const t = day();
    // A raw status the office does not recognise: kept, counted as unknown, never as open.
    expect(t.integrations.get('claude.ai Slack')).toMatchObject({ status: 'unknown' });
    expect(t.integrations.get('claude.ai Slack').desks).toEqual([expect.objectContaining({ name: 'Ada', status: 'unknown', raw: 'starting', open: false })]);
    // In Ada's first session only: no desk has it now; when it was last seen stays.
    expect(t.integrations.get('blender')).toMatchObject({ status: 'unknown', desks: [], firstSeen: T0, lastSeen: T0 });
    // Let go: their desk no longer counts.
    t.roster.update(t.can.id, { lifecycle: 'archived' });
    expect(t.integrations.get('cad')).toMatchObject({ status: 'unknown', desks: [] });
    expect(t.integrations.get('claude.ai Gmail').desks.map((d) => d.name)).toEqual(['Ada']);
    // Registered by hand and never seen in a session.
    const cli = t.integrations.register(t.coordinator.id, { name: 'Muhasebe CLI', kind: 'cli', capabilities: ['payments.read'], authNeeded: 'API anahtarı sahibinde' });
    expect(cli).toMatchObject({ status: 'unknown', desks: [], firstSeen: null, lastSeen: null, registeredBy: t.coordinator.id, capabilities: ['payments.read'] });
    expect(() => t.integrations.get('yok')).toThrow(/Bağlantı bulunamadı: yok/);
  });

  it('review focus: closed — the registry closes a connector whatever the desks say; no desk counts it open; it can be opened again', () => {
    const t = day();
    const closed = t.integrations.register(t.coordinator.id, { name: 'claude.ai Gmail', closed: true, note: 'gönderim sahibinde' });
    expect(closed).toMatchObject({ kind: 'claude_ai', status: 'closed', registryClosed: true, note: 'gönderim sahibinde' });
    // Shut by the registry where the session has it, by the server state where it does not: told apart.
    expect(closed.desks.map((d) => [d.name, d.status, d.open, d.closedBy])).toEqual([['Ada', 'connected', false, 'registry'], ['Can', 'needs_auth', false, 'server']]);
    expect(t.integrations.list({ status: 'closed' }).map((i) => i.name)).toEqual(['claude.ai Gmail']);
    // Writing one field keeps the others.
    expect(t.integrations.register(t.coordinator.id, { name: 'claude.ai Gmail', costNote: 'ücretsiz' })).toMatchObject({ status: 'closed', note: 'gönderim sahibinde', costNote: 'ücretsiz' });
    expect(t.integrations.register(t.coordinator.id, { name: 'claude.ai Gmail', closed: false })).toMatchObject({ status: 'connected', registryClosed: false, note: 'gönderim sahibinde' });
    expect(t.integrations.get('claude.ai Gmail').desks.find((d) => d.name === 'Ada')!.open).toBe(true);
  });

  it('review focus: refuses wrong registrations, changing nothing; only the coordinator registers', () => {
    const t = day();
    const c = t.coordinator.id;
    for (const [input, error] of [
      [{ name: 'Yeni adaptör' }, /“Yeni adaptör” hiçbir oturumda görünmedi: tür \(kind\) gerekli/],
      [{ name: 'x', kind: 'robot' }, /tür \(kind\) office, claude_ai, plugin, local_mcp, adapter ya da cli olmalı/],
      [{ name: 'x', kind: 'cli', capabilities: Array.from({ length: 21 }, (_, i) => `c${i}`) }, /Yetenekler en fazla 20 madde/],
      [{ name: 'x', kind: 'cli', capabilities: 'email.send' }, /Yetenekler metinlerden oluşan bir liste olmalı/],
      [{ name: 'x', kind: 'cli', closed: 'evet' }, /closed true ya da false olmalı/],
      [{ name: '  ', kind: 'cli' }, /Bağlantı adı boş olamaz/],
    ] as const) {
      expect(() => t.integrations.register(c, input as never), JSON.stringify(input)).toThrow(error);
    }
    expect(() => t.integrations.register(t.ada.id, { name: 'office', closed: true })).toThrow(/Yalnız koordinatör/);
    expect(t.integrations.list().every((i) => i.registeredBy === null)).toBe(true);
    // A connector the desks report takes its kind from its name.
    expect(t.integrations.register(c, { name: 'plugin:design:figma', authNeeded: 'Figma hesabı bağlanmalı' })).toMatchObject({ kind: 'plugin', authNeeded: 'Figma hesabı bağlanmalı' });
  });
});

describe('Integration registry — a desk whose settings deny a connector (review, Kerem round 1)', () => {
  it('connected but with no tools in the session is shut on that desk (“masada kapalı”), open where the session has its tools; denied everywhere, the connector is denied', async () => {
    const t = make();
    // Ada's desk denies Gmail (Pilot 0's closed mode): the CLI keeps it connected and lists none of its tools.
    t.session(t.ada, [['office', 'connected', 70], ['claude.ai Gmail', 'connected', 0], ['claude.ai Notion', 'connected', 46], ['claude.ai Jeeta', 'connected', 0]]);
    t.session(t.can, [['office', 'connected', 70], ['claude.ai Gmail', 'connected', 9], ['claude.ai Notion', 'connected', 46], ['claude.ai Jeeta', 'connected', 0]]);
    const gmail = t.integrations.get('claude.ai Gmail');
    expect(gmail).toMatchObject({ status: 'connected' });
    expect(gmail.desks.map((d) => [d.name, d.status, d.raw, d.tools, d.open, d.closedBy])).toEqual([
      ['Ada', 'denied', 'connected', 0, false, 'desk'],
      ['Can', 'connected', 'connected', 9, true, null],
    ]);
    // Shut on every desk: the connector itself is denied, not connected.
    expect(t.integrations.get('claude.ai Jeeta')).toMatchObject({ status: 'denied' });
    expect(t.integrations.get('claude.ai Jeeta').desks.every((d) => !d.open && d.closedBy === 'desk')).toBe(true);
    expect(t.integrations.list({ status: 'denied' }).map((i) => i.name)).toEqual(['claude.ai Jeeta']);
    const text = await t.call(t.ada, 'integrationsList');
    expect(text).toContain('• claude.ai Gmail [bağlı] (claude.ai bağlayıcısı) — açık: Can; kapalı: Ada (masa ayarı: oturumda aracı yok)');
    expect(text).toContain('• claude.ai Jeeta [masada kapalı] (claude.ai bağlayıcısı) — kapalı: Ada (masa ayarı: oturumda aracı yok), Can (masa ayarı: oturumda aracı yok)');
    // Closed in the registry while the session still has the tools: the JSON says so (closedBy, tools).
    const closed = t.integrations.register(t.coordinator.id, { name: 'claude.ai Notion', closed: true });
    expect(closed.desks.map((d) => [d.name, d.tools, d.open, d.closedBy])).toEqual([['Ada', 46, false, 'registry'], ['Can', 46, false, 'registry']]);
  });
});

describe('Integration registry — reading it', () => {
  it('integrationsList (everyone) reads without calling any connector; integrationRegister (coordinator) writes one event', async () => {
    const t = day();
    expect(t.tools.find((x) => x.name === 'integrationsList')?.kinds).toEqual(['member', 'lead', 'coordinator']);
    expect(t.tools.find((x) => x.name === 'integrationRegister')?.kinds).toEqual(['coordinator']);
    await t.call(t.coordinator, 'integrationRegister', { name: 'claude.ai Gmail', closed: true });
    const events = t.events.lastSeq();
    const all = await t.call(t.ada, 'integrationsList');
    expect(t.events.lastSeq()).toBe(events);
    expect(t.events.list({ limit: 5000 }).filter((e) => e.event.type === 'integration.changed')).toHaveLength(1);
    expect(all).toContain('# Bağlantılar (6: bağlı 1, yetki bekliyor 1, bağlanıyor 1, kapalı 1, bilinmiyor 2) — salt okunur; hiçbir bağlayıcı çağrılmadı.');
    expect(all).toContain('• office [bağlı] (ofis) — açık: Ada, Can');
    expect(all).toContain('• plugin:design:figma [yetki bekliyor] (eklenti) — kapalı: Ada (yetki bekliyor), Can (yetki bekliyor)');
    // Each desk says its own reason: the registry where the session has it, the server state where it does not.
    expect(all).toContain('• claude.ai Gmail [kapalı] (claude.ai bağlayıcısı) — kapalı: Ada (kayıtta kapalı), Can (yetki bekliyor); kayıtta kapalı, oturumlarda kapatma B9’da');
    expect(all).toContain('• claude.ai Slack [bilinmiyor] (claude.ai bağlayıcısı) — kapalı: Ada (bilinmeyen durum: starting)');
    expect(all).toMatch(/• blender \[bilinmiyor\] \(yerel MCP\) — güncel hiçbir masada yok \(son görülme: .+\)/);
    const pending = await t.call(t.ada, 'integrationsList', { status: 'needs_auth' });
    expect(pending.split('\n').filter((l) => l.startsWith('• '))).toEqual(['• plugin:design:figma [yetki bekliyor] (eklenti) — kapalı: Ada (yetki bekliyor), Can (yetki bekliyor)']);
    const cans = await t.call(t.ada, 'integrationsList', { employee: 'can' });
    expect(cans).toContain('• cad [bağlanıyor] (yerel MCP) — kapalı: Can (bağlanıyor)');
    // Reported on both desks: only Can's desk is shown.
    expect(cans).toMatch(/^• office \[bağlı\] \(ofis\) — açık: Can$/m);
    expect(t.integrations.list({ employee: t.can.id }).find((i) => i.name === 'office')!.desks.map((d) => d.name)).toEqual(['Can']);
    expect(cans).not.toContain('blender');
    await expect(t.call(t.ada, 'integrationsList', { status: 'kapalı' })).rejects.toThrow(/durum \(status\) connected, denied, needs_auth, pending, failed, closed ya da unknown olmalı/);
    await expect(t.call(t.ada, 'integrationRegister', { name: 'office', closed: true })).rejects.toThrow(/kapalı araç/);
  });

  it('says so when no desk has reported anything yet', async () => {
    const t = make();
    expect(await t.call(t.coordinator, 'integrationsList')).toContain('Henüz hiçbir masa bağlantı bildirmedi ve elle kayıt yok.');
  });
});
