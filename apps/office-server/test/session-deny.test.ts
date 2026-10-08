import { afterEach, describe, expect, it } from 'vitest';
import type { Employee } from '@cc/shared';
import { Agenda } from '../src/company/agenda.ts';
import { capabilityVocabulary } from '../src/company/capabilities.ts';
import { IntegrationRegistry } from '../src/company/integrations.ts';
import { serverRule, sessionDeny } from '../src/company/session-deny.ts';
import type { McpTool } from '../src/mcp/protocol.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine, readArgv } from './engine-helpers.ts';
import { setup, until } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const vocabulary = capabilityVocabulary().capabilities;
const toolsOf = (id: string) => vocabulary.find((c) => c.id === id)!.tools;
const OUTWARD = vocabulary.filter((c) => c.outward).flatMap((c) => c.tools);

describe('B9b — what an employee’s session closes', () => {
  it('every outward connector tool of the vocabulary the role does not declare; the ones it declares and every non-outward one stay', () => {
    const none = sessionDeny({ capabilities: [], seen: [], closedServers: [] });
    expect(new Set(none)).toEqual(new Set(OUTWARD));
    const sender = sessionDeny({ capabilities: ['email.send', 'email.read'], seen: [], closedServers: [] });
    for (const t of toolsOf('email.send')) expect(sender).not.toContain(t);
    for (const t of toolsOf('social.publish')) expect(sender).toContain(t);
    for (const t of [...toolsOf('email.read'), ...toolsOf('docs.write')]) expect(none).not.toContain(t);
  });

  it('every unclassified connector tool a session ever reported; never the office’s own tools or Claude Code’s built-ins', () => {
    const seen = ['mcp__plugin_x_x__do_anything', 'mcp__office__myTasks', 'Bash', 'WebFetch', toolsOf('email.read')[0]!];
    const deny = sessionDeny({ capabilities: [], seen, closedServers: [] });
    expect(deny).toContain('mcp__plugin_x_x__do_anything');
    for (const t of ['mcp__office__myTasks', 'Bash', 'WebFetch', toolsOf('email.read')[0]!]) expect(deny).not.toContain(t);
    expect(deny.some((t) => t.startsWith('mcp__office__'))).toBe(false);
  });

  it('the whole of a server the registry closed, by its server rule (its tools are not listed one by one); never the office', () => {
    expect(serverRule('claude.ai Higgsfield')).toBe('mcp__claude_ai_Higgsfield');
    const deny = sessionDeny({ capabilities: ['media.generate'], seen: ['mcp__claude_ai_Higgsfield__balance'], closedServers: ['claude.ai Higgsfield', 'office'] });
    expect(deny).toContain('mcp__claude_ai_Higgsfield');
    expect(deny.filter((t) => t.startsWith('mcp__claude_ai_Higgsfield__'))).toEqual([]);
    expect(deny).not.toContain('mcp__office');
    // The list is sorted and without repeats.
    expect(deny).toEqual([...new Set(deny)].sort());
  });
});

function make() {
  const s = setup();
  const f = fakeEngine(s, {
    engine: {
      sessionDeny: (e: Employee) => sessionDeny({ capabilities: e.capabilities ?? [], seen: integrations.seenToolNames(), closedServers: integrations.closedServers() }),
    },
  });
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, ['coder'], undefined, (id) => f.engine.reload(id));
  const integrations = new IntegrationRegistry({ db: s.db, roster: s.roster, events: s.events });
  const agenda = new Agenda({ roster: s.roster, tasks: c.tasks, schedules: c.schedules, company: c.company, budget: c.budget });
  const tools = officeTools({ company: c.company, roster: s.roster, tasks: c.tasks, characters: () => ['coder'], memory: c.memory, budget: c.budget, engine: f.engine, plans: () => c.plans.list(), agenda, integrations });
  const call = async (employee: Employee, name: string, args: Record<string, unknown> = {}) => {
    const tool = tools.find((x: McpTool) => x.name === name)!;
    return tool.run({ employee: s.roster.get(employee.id) }, args);
  };
  const report = (e: Employee, mcp: Array<{ name: string; status: string; toolNames: string[] }>) =>
    s.events.append(e.id, { type: 'session.started', model: 'haiku', mcp: mcp.map((m) => ({ ...m, tools: m.toolNames.length })) });
  /** The tools after --disallowedTools in the n-th claude start of this desk (starts run side by side: picked by desk). */
  const denied = async (slug: string, n = 1) => {
    const mine = () => readArgv(f.argvLog, 1).then((all) => all.filter((a) => a.cwd.endsWith(`/desks/${slug}`)));
    let starts = await mine();
    for (let i = 0; i < 100 && starts.length < n; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      starts = await mine();
    }
    const args = starts[n - 1]!.args;
    const i = args.indexOf('--disallowedTools');
    const end = args.findIndex((a, j) => j > i && a.startsWith('--'));
    return args.slice(i + 1, end);
  };
  return { ...s, ...c, engine: f.engine, argvLog: f.argvLog, integrations, call, report, denied, coordinator: c.company.hireCoordinator() };
}

describe('B9b — the list is made when a session starts', () => {
  it('engine.#start asks for each employee’s own list: their capabilities, every tool name ever reported, the closed servers', async () => {
    const t = make();
    t.report(t.coordinator, [{ name: 'plugin:x:x', status: 'connected', toolNames: ['do_anything'] }]);
    t.integrations.register(t.coordinator.id, { name: 'claude.ai Higgsfield', kind: 'claude_ai', closed: true });
    const ada = t.company.hire(t.coordinator.id, { name: 'Ada', role: 'r', capabilities: ['email.send'] });
    const can = t.company.hire(t.coordinator.id, { name: 'Can', role: 'r' });
    const adaDeny = await t.denied(ada.slug);
    const canDeny = await t.denied(can.slug);
    expect(adaDeny).toEqual(expect.arrayContaining(['mcp__plugin_x_x__do_anything', 'mcp__claude_ai_Higgsfield', toolsOf('social.publish')[0]!]));
    expect(adaDeny).not.toContain(toolsOf('email.send')[0]);
    expect(canDeny).toContain(toolsOf('email.send')[0]);
  });

  it('a tool closed everywhere stays closed: a name reported once is remembered after the sessions stop reporting it', async () => {
    const t = make();
    t.report(t.coordinator, [{ name: 'plugin:x:x', status: 'connected', toolNames: ['do_anything'] }]);
    // The next session no longer has it (it was closed): the latest reports say nothing of it.
    t.report(t.coordinator, [{ name: 'plugin:x:x', status: 'connected', toolNames: [] }]);
    expect(t.integrations.seenToolNames()).toContain('mcp__plugin_x_x__do_anything');
    const ada = t.company.hire(t.coordinator.id, { name: 'Ada', role: 'r' });
    expect(await t.denied(ada.slug)).toContain('mcp__plugin_x_x__do_anything');
  });

  it('a role that gains a capability gets a session without that tool closed (editRoleCard restarts it)', async () => {
    const t = make();
    const ada = t.company.hire(t.coordinator.id, { name: 'Ada', role: 'r' });
    expect(await t.denied(ada.slug)).toContain(toolsOf('email.send')[0]);
    t.company.editRoleCard(t.coordinator.id, ada.id, { capabilities: ['email.send'] });
    expect(await t.denied(ada.slug, 2)).not.toContain(toolsOf('email.send')[0]);
  });

  it('closing a connector in the registry restarts the sessions so it is closed in them; integrationsList says so and counts it', async () => {
    const t = make();
    const ada = t.company.hire(t.coordinator.id, { name: 'Ada', role: 'r' });
    await until(() => t.engine.ready(ada.id) && t.engine.ready(t.coordinator.id));
    t.report(ada, [{ name: 'claude.ai Higgsfield', status: 'connected', toolNames: ['balance', 'generate_image'] }, { name: 'plugin:x:x', status: 'connected', toolNames: ['do_anything', 'do_more'] }]);
    await t.call(t.coordinator, 'integrationRegister', { name: 'claude.ai Higgsfield', closed: true });
    expect(await t.denied(ada.slug, 2)).toContain('mcp__claude_ai_Higgsfield');
    expect(await t.denied(t.coordinator.slug, 2)).toContain('mcp__claude_ai_Higgsfield');
    const list = await t.call(t.coordinator, 'integrationsList');
    const higgsfield = vocabulary.flatMap((c) => c.tools).filter((x) => x.startsWith('mcp__claude_ai_Higgsfield__'));
    const known = new Set([...higgsfield, 'mcp__claude_ai_Higgsfield__balance']).size;
    expect(list).toContain(`kayıtta kapalı, oturumda kapalı (${known} araç)`);
    expect(list).not.toContain('B9’da');
    expect(list).toMatch(/• plugin:x:x \[[^\]]+\] \(eklenti\) — .*oturumda kapalı: 2 sınıflandırılmamış araç/);
  });

  it('integrationsList counts a connector’s outward tools that only a role with the capability has open', async () => {
    const t = make();
    t.report(t.coordinator, [{ name: 'claude.ai Gmail', status: 'connected', toolNames: ['search_threads', 'send_message'] }]);
    const gmailOutward = vocabulary.filter((c) => c.outward).flatMap((c) => c.tools).filter((x) => x.startsWith('mcp__claude_ai_Gmail__')).length;
    const list = await t.call(t.coordinator, 'integrationsList');
    expect(list).toContain(`dışa dönük ${gmailOutward} araç yalnız yeteneği olan rollerde açık`);
  });
});
