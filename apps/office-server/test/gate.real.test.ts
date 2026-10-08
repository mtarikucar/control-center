import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OWNER } from '@cc/shared';
import { createApi } from '../src/api.ts';
import { Agenda } from '../src/company/agenda.ts';
import { ApprovalStore } from '../src/company/approval-store.ts';
import { Approvals } from '../src/company/approvals.ts';
import { Gate, liveContext } from '../src/company/gate.ts';
import { Company } from '../src/company/company.ts';
import { CompanyStateStore, GoalStore } from '../src/company/goal-store.ts';
import { OnboardingStore } from '../src/company/onboarding-store.ts';
import { ProfileStore } from '../src/company/profile-store.ts';
import { NoticeStore, PlanStore, ScheduleStore, TaskStore } from '../src/company/store.ts';
import { gateHookCommand } from '../src/claude/args.ts';
import { REPO_ROOT } from '../src/config.ts';
import { deskDir } from '../src/desk.ts';
import { Engine } from '../src/engine.ts';
import { TokenRegistry } from '../src/mcp/tokens.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { QuotaTracker } from '../src/quota.ts';
import { setup, tempDir, until } from './helpers.ts';
import { pageHeaders } from './owner-helpers.ts';
import { LOCKED_ARGS, LOCKED_TOOLS, realInit } from './real-session.ts';

/**
 * B9a K3 (design §7 K3, §10 madde 6 and 13): the gate in a real claude session, locked — LOCKED_ARGS, only the
 * office's server and a stub of the test's own (one harmless tool), haiku, a throwaway data folder. The stub's tool is
 * in no capability, so the gate holds it (unclassified = outward). Held → approvalRequest → the owner approves with
 * the page's headers → the same call passes → the next is held again. The desk carries a settings.local.json with
 * disableAllHooks: true the whole time (deney 6B: the office's --settings outranks it).
 */

const enabled = process.env.OFFICE_SMOKE === '1';
const STUB = fileURLToPath(new URL('./fixtures/mcp-stub.mjs', import.meta.url));
const STUB_CONFIG = JSON.stringify({ mcpServers: { probe_open: { command: process.execPath, args: [STUB, 'probe_open'] } } });
const PING = 'mcp__probe_open__ping';
const allowed = (name: string) => name.startsWith('mcp__office__') || name === 'ToolSearch' || name === PING;

function post(port: number, path: string, headers: Record<string, string>): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method: 'POST', path, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    req.end('{}');
  });
}

describe.skipIf(!enabled)('B9a with the real claude CLI (locked: the office’s server and a stub only)', () => {
  it('held → approvalRequest → the owner approves on the page → the same call passes → the next is held; office tools never reach the hook; a desk file cannot turn the hook off', { timeout: 900_000 }, async () => {
    const s = setup();
    const tokens = new TokenRegistry();
    const trace = join(tempDir('gate-k3-'), 'hook-trace.log');
    let url = '';
    let gateUrl = '';
    let port = 0;
    const engine = new Engine({
      roster: s.roster, events: s.events, dataDir: s.dataDir, claudeCommand: ['claude', ...LOCKED_ARGS, '--mcp-config', STUB_CONFIG],
      env: { ...process.env, OFFICE_GATE_TRACE: trace }, mcp: { url: () => url, tokens }, gate: { url: () => gateUrl, hook: gateHookCommand() },
    });
    const { SearchIndex } = await import('../src/company/search.ts');
    const index = new SearchIndex(s.db);
    const tasks = new TaskStore(s.db, Date.now, index);
    const plans = new PlanStore(s.db);
    const notices = new NoticeStore(s.db);
    const schedules = new ScheduleStore(s.db);
    const { DecisionStore, EmployeeNoteStore, NoteStore, PlaybookStore } = await import('../src/company/memory-store.ts');
    const { Memory } = await import('../src/company/memory.ts');
    const memory = new Memory({ roster: s.roster, events: s.events, notices, tasks, plans, dataDir: s.dataDir, index, decisions: new DecisionStore(s.db, Date.now, index), playbook: new PlaybookStore(s.db, Date.now, index), notes: new NoteStore(s.db, Date.now, index), employeeNotes: new EmployeeNoteStore(s.db) });
    const { Budget } = await import('../src/company/budget.ts');
    const { ConstitutionStore, SpendStore } = await import('../src/company/budget-store.ts');
    const quota = new QuotaTracker(s.db, s.events);
    const budget = new Budget({ constitution: new ConstitutionStore(s.db), spend: new SpendStore(s.db), tasks, plans, roster: s.roster, events: s.events, notices, quota, deskCount: 8 });
    budget.setConstitution({ gateEnabled: true });
    const { ProposalStore } = await import('../src/company/proposal-store.ts');
    const proposals = new ProposalStore(s.db);
    const company = new Company({
      roster: s.roster, events: s.events, tasks, plans, notices, dataDir: s.dataDir, hire: (i) => engine.hire(i), characters: () => ['coder'], memory, reload: (id) => engine.reload(id),
      constitution: () => budget.constitution(), proposals, goals: new GoalStore(s.db), state: new CompanyStateStore(s.db), schedules, profile: new ProfileStore(s.db, Date.now, index), onboarding: new OnboardingStore(s.db),
    });
    const approvals = new Approvals({ store: new ApprovalStore(s.db), events: s.events, notices, roster: s.roster, tasks, coordinator: () => company.coordinator(), memory });
    const gate = new Gate({ approvals, events: s.events, roster: s.roster, enabled: () => budget.constitution().gateEnabled, context: liveContext({ repoRoot: REPO_ROOT, dataDir: s.dataDir, home: process.env.HOME ?? '/', port: () => port, hosts: [] }) });
    const agenda = new Agenda({ roster: s.roster, tasks, schedules, company, budget });
    const api = createApi(
      {
        engine, roster: s.roster, events: s.events, quota, gate,
        mcp: { tokens, tools: officeTools({ company, roster: s.roster, tasks, characters: () => ['coder'], memory, budget, engine, plans: () => plans.list(), agenda, approvals, gate }) },
        company: { service: company, tasks, plans, memory, budget, proposals, agenda, approvals },
      },
      { allowedOrigins: [] },
    );
    await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', resolve));
    port = (api.server.address() as AddressInfo).port;
    url = `http://127.0.0.1:${port}/mcp`;
    gateUrl = `http://127.0.0.1:${port}/gate/check`;
    const short = (text: string) => text.replace(/\s+/g, ' ').slice(0, 300);
    const journal = () =>
      s.events
        .list({ limit: 100_000 })
        .flatMap(({ event: e }) => {
          if (e.type === 'session.started') return [`oturum ${e.model}, ${e.mcp.length} MCP sunucusu: ${e.mcp.map((m) => `${m.name} ${m.status} (${m.tools ?? '?'} araç)`).join(', ')}`];
          if (e.type === 'tool.started') return [`araç ${e.name} ${short(JSON.stringify(e.input))}`];
          if (e.type === 'tool.finished') return [`  ${e.isError ? 'HATA ' : ''}${short(e.output)}`];
          if (e.type === 'gate.checked') return [`  KAPI ${e.decision} ${e.kind} “${e.target}” (${e.tool})${e.approvalId ? ` onay ${e.approvalId}` : ''}`];
          if (e.type === 'approval.changed') return [`  ONAY ${e.change} ${e.approval.id} ${e.approval.status}${e.approval.decidedVia ? ` via ${e.approval.decidedVia}` : ''}`];
          if (e.type === 'message.assistant') return [`yanıt ${short(e.text)}`];
          if (e.type === 'turn.finished') return [`tur bitti ${e.subtype} ${e.numTurns} adım $${e.costUsd.toFixed(4)}`];
          if (e.type === 'error') return [`hata ${short(e.message)}`];
          return [];
        })
        .join('\n');
    const turns = (id: string) => s.events.list({ limit: 100_000 }).filter((e) => e.employeeId === id && e.event.type === 'turn.finished').length;
    try {
      // Deney 6B as a test: the desk's own file would turn every hook off; the office's --settings says otherwise.
      const desk = deskDir(s.dataDir, 'ada');
      mkdirSync(join(desk, '.claude'), { recursive: true });
      writeFileSync(join(desk, '.claude', 'settings.local.json'), JSON.stringify({ disableAllHooks: true }));
      const ada = company.hire(OWNER, { name: 'Ada', role: 'Kapı denemesi için geçici çalışan.', model: 'haiku' });
      expect(existsSync(join(desk, '.claude', 'settings.local.json'))).toBe(true);
      engine.send(
        ada.id,
        `Bu bir araç denemesi. Sırayla: (1) myTasks aracını bir kez çağır. (2) ${PING} aracını argümansız bir kez çağır. (3) Engellenirse approvalRequest aracını yalnız summary: "kapı denemesi" ile bir kez çağır. Başka hiçbir araç çağırma. Sonra dur ve bana tek cümle yaz.`,
        'owner',
      );
      await until(() => turns(ada.id) >= 1, 400_000);
      const pending = approvals.visible().filter((a) => a.status === 'pending');
      expect(pending).toEqual([expect.objectContaining({ employeeId: ada.id, tool: PING, kind: 'other', target: 'ping', scope: 'call' })]);
      // The owner approves the way the page does: Origin and the page's nonce (the owner guard).
      const decided = await post(port, `/api/approvals/${pending[0]!.id}/approve`, await pageHeaders(port));
      expect(decided).toMatchObject({ status: 200, body: { status: 'approved', decidedVia: 'page' } });
      engine.send(ada.id, `Sahibi onayladı. Şimdi ${PING} aracını bir kez çağır ve sonucu yaz. Sonra aynı aracı bir kez daha çağır ve sonucu yaz. Başka araç çağırma.`, 'owner');
      await until(() => turns(ada.id) >= 2, 400_000);

      const events = s.events.list({ limit: 100_000 });
      const cost = events.reduce((n, e) => n + (e.event.type === 'turn.finished' ? e.event.costUsd : 0), 0);
      const hookSaw = existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean) : [];
      console.log(`K3 KAYDI\n${journal()}\nkancanın gördüğü araçlar: ${hookSaw.join(', ')}\ntoplam maliyet (CLI'nin bildirdiği): $${cost.toFixed(4)}\nK3 KAYDI SONU`);

      const tools = events.flatMap((e) => (e.event.type === 'tool.started' ? [e.event.name] : []));
      expect(tools.filter((n) => !allowed(n))).toEqual([]);
      const finished = new Map(events.flatMap((e) => (e.event.type === 'tool.finished' ? [[e.event.toolUseId, e.event] as const] : [])));
      const pings = events.flatMap((e) => (e.event.type === 'tool.started' && e.event.name === PING ? [finished.get(e.event.toolUseId)!] : []));
      // Held, passed with the approval ("pong"), held again.
      expect(pings.map((p) => (p.isError ? 'kapı' : p.output))).toEqual(['kapı', 'pong', 'kapı']);
      expect(pings[0]!.output).toContain('OFİS KAPISI');
      const checked = events.flatMap((e) => (e.event.type === 'gate.checked' ? [e.event] : []));
      expect(checked.map((c) => [c.tool, c.decision, c.approvalId])).toEqual([[PING, 'deny', null], [PING, 'allow', pending[0]!.id], [PING, 'deny', null]]);
      expect(approvals.get(pending[0]!.id).status).toBe('used');
      // The office's tools never reach the hook (the matcher's negative lookahead works in Claude Code), nor the gate.
      expect(tools.some((n) => n.startsWith('mcp__office__'))).toBe(true);
      expect(hookSaw.filter((n) => n.startsWith('mcp__office__'))).toEqual([]);
      expect(hookSaw.filter((n) => n === PING)).toHaveLength(3);
      expect(checked.filter((c) => c.tool.startsWith('mcp__office__'))).toEqual([]);
    } catch (err) {
      console.log(`K3 KAYDI (hata)\n${journal()}\nK3 KAYDI SONU`);
      throw err;
    } finally {
      await engine.shutdown();
      await api.close();
      s.cleanup();
    }
  });

  it('two --disallowedTools flags (the lock’s and the office’s own) both hold: neither list’s tools are in the session', { timeout: 120_000 }, async () => {
    const init = await realInit(tempDir('gate-k3-init-'), JSON.stringify({ mcpServers: {} }));
    expect(init).not.toBeNull();
    const tools = init!.tools as string[];
    console.log(`GERÇEK INIT (iki --disallowedTools): claude ${String(init!.claude_code_version)}; ${tools.length} araç: ${tools.join(', ')}`);
    for (const locked of LOCKED_TOOLS) expect(tools, locked).not.toContain(locked);
    for (const own of ['CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup', 'RemoteTrigger']) expect(tools, own).not.toContain(own);
  });
});
