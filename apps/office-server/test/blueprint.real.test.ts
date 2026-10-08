import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { normalize } from '../src/claude/normalize.ts';
import { BlueprintStore } from '../src/company/blueprint-store.ts';
import { Blueprints } from '../src/company/blueprint.ts';
import { IntegrationRegistry } from '../src/company/integrations.ts';
import { deskDir } from '../src/desk.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';
import { LOCKED_TOOLS, realInit } from './real-session.ts';

const enabled = process.env.OFFICE_SMOKE === '1';
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const STUB = fileURLToPath(new URL('./fixtures/mcp-stub.mjs', import.meta.url));

describe.skipIf(!enabled)('the blueprint’s closed mode with the real claude CLI (locked: only the test’s own two stub servers)', () => {
  it('the desk file the install writes holds in a real session: the denied stub has no tools there, and blueprintRead says so from the list alone', async () => {
    const s = setup();
    const f = fakeEngine(s);
    cleanups.push(f.cleanup, s.cleanup);
    const c = companyFor(s, f, ['coder']);
    const integrations = new IntegrationRegistry({ db: s.db, roster: s.roster, events: s.events });
    const blueprints = new Blueprints({ company: c.company, roster: s.roster, tasks: c.tasks, plans: c.plans, schedules: c.schedules, memory: c.memory, store: new BlueprintStore(s.db), integrations, constitution: () => c.budget.constitution() });
    const coordinator = c.company.hireCoordinator();
    for (const [section, fields] of [['identity', { name: 'Fırın', sector: 'gıda' }], ['offer', { products: ['ekmek'] }], ['customers', { segments: ['mahalle'], channels: ['dükkan'] }], ['goals', { goals: ['satış'] }], ['success', { done: ['kâr'] }], ['tools', { email: ['Gmail'] }], ['constraints', { budget: '0', other: ['yok'] }]] as const) {
      c.company.profileUpdate(coordinator.id, { section, fields, assumed: false });
    }
    const { plan } = blueprints.propose(coordinator.id, {
      title: 'Kurulum: Fırın', summary: 'Mahallede ekşi maya ekmek satan bir fırın.',
      roles: [{ key: 'satis', name: 'Ada', template: 'satis-asistani' }], playbook: [], goals: [], routines: [], tasks: [],
      closedMode: { deny: ['mcp__probe_shut', 'Bash(git push*)'] },
    });
    c.company.approve(plan.id);
    expect(blueprints.apply(coordinator.id, plan.id).finished).toBe(true);
    const ada = s.roster.list().find((e) => e.name === 'Ada')!;
    const desk = deskDir(s.dataDir, ada.slug);
    expect(JSON.parse(readFileSync(join(desk, '.claude', 'settings.json'), 'utf8'))).toEqual({ permissions: { deny: ['mcp__probe_shut', 'Bash(git push*)'] } });
    // A real session in that desk, locked: only the test's two stubs, each with one harmless tool; killed at init.
    const mcpConfig = JSON.stringify({ mcpServers: { probe_open: { command: process.execPath, args: [STUB, 'probe_open'] }, probe_shut: { command: process.execPath, args: [STUB, 'probe_shut'] } } });
    const init = await realInit(desk, mcpConfig);
    expect(init).not.toBeNull();
    const tools = init!.tools as string[];
    console.log(`GERÇEK INIT (kurulumun masası): claude ${String(init!.claude_code_version)}; sunucular: ${(init!.mcp_servers as Array<{ name: string; status: string }>).map((m) => `${m.name} ${m.status}`).join(', ')}; ${tools.length} araç: ${tools.join(', ')}`);
    expect((init!.mcp_servers as Array<{ name: string }>).map((m) => m.name).sort()).toEqual(['probe_open', 'probe_shut']);
    expect(tools.filter((t) => t.startsWith('mcp__'))).toEqual(['mcp__probe_open__ping']);
    for (const locked of LOCKED_TOOLS) expect(tools, locked).not.toContain(locked);
    // The office reads that session as it reads any: the closed mode's check comes from the list alone.
    s.events.append(ada.id, normalize(init)[0]!);
    const view = blueprints.read(plan.id);
    console.log(`KAPALI KİP (blueprintRead): ${view.closedMode.map((d) => `${d.name}: ${d.rules.map((r) => `${r.rule} ${r.check}`).join('; ')}`).join(' | ')}`);
    expect(view.closedMode).toEqual([
      { key: 'satis', employeeId: ada.id, name: 'Ada', applied: true, rules: [{ rule: 'mcp__probe_shut', check: 'verified' }, { rule: 'Bash(git push*)', check: 'unverifiable' }] },
    ]);
  }, 120_000);
});
