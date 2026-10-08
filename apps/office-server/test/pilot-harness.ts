import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { Employee, HireInput } from '@cc/shared';
import { createApi, type Api } from '../src/api.ts';
import { gateHookCommand } from '../src/claude/args.ts';
import { Agenda } from '../src/company/agenda.ts';
import { ApprovalStore } from '../src/company/approval-store.ts';
import { Approvals } from '../src/company/approvals.ts';
import { BlueprintStore } from '../src/company/blueprint-store.ts';
import { Blueprints } from '../src/company/blueprint.ts';
import { buildBoard } from '../src/company/board.ts';
import { Budget } from '../src/company/budget.ts';
import { ConstitutionStore, SpendStore } from '../src/company/budget-store.ts';
import { Clock } from '../src/company/clock.ts';
import { Company } from '../src/company/company.ts';
import { ManagementCycle } from '../src/company/cycle.ts';
import { Dispatcher } from '../src/company/dispatcher.ts';
import { Gate, liveContext } from '../src/company/gate.ts';
import { CompanyStateStore, GoalStore } from '../src/company/goal-store.ts';
import { IntegrationRegistry } from '../src/company/integrations.ts';
import { KpiReadings } from '../src/company/kpi-readings.ts';
import { DecisionStore, EmployeeNoteStore, NoteStore, PlaybookStore } from '../src/company/memory-store.ts';
import { Memory } from '../src/company/memory.ts';
import { officeMetrics } from '../src/company/office-metrics.ts';
import { OnboardingStore } from '../src/company/onboarding-store.ts';
import { CapabilityPrecheck } from '../src/company/precheck.ts';
import { ProfileStore } from '../src/company/profile-store.ts';
import { ProposalStore } from '../src/company/proposal-store.ts';
import { Pulse } from '../src/company/pulse.ts';
import { relatedMemory } from '../src/company/related-memory.ts';
import { Scheduling, dueLabel } from '../src/company/scheduling.ts';
import { SearchIndex } from '../src/company/search.ts';
import { toolClass, type ToolClass } from '../src/company/capabilities.ts';
import { sessionDeny } from '../src/company/session-deny.ts';
import { NoticeStore, PlanStore, ScheduleStore, TaskStore } from '../src/company/store.ts';
import { REPO_ROOT } from '../src/config.ts';
import { Engine } from '../src/engine.ts';
import { TokenRegistry } from '../src/mcp/tokens.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { OwnerFlags } from '../src/owner-flags.ts';
import { performanceReport } from '../src/performance.ts';
import { QuotaTracker } from '../src/quota.ts';
import { setup, type TestSetup } from './helpers.ts';
import { LOCKED_ARGS } from './real-session.ts';

/**
 * The pilot's end-to-end K3 (C5-4; pilot readiness §4): the whole office wired as main.ts wires it, in a throwaway data
 * directory, every session locked. The bounds are fixed here, not asked for in a prompt, and pilot-bounds.test.ts (K1)
 * checks them on the arguments the sessions really get.
 */

/**
 * Every session's model: the coordinator and the members the blueprint hires (its sonnet/opus are overridden), and the
 * coordinator's role models too (management cycle §3.5: a role hint applies whatever the model policy says; by default
 * a project start would move it to fable, a cycle to opus, any other turn to sonnet).
 */
export const PILOT_MODEL = 'haiku' as const;
/** The task's cost ceiling (≈ $0.50), earlier runs included (`spentBefore`): passed, the run stops every session and fails. */
export const COST_CAP_USD = 0.5;
/** No step may take longer (pilot readiness §4). */
export const STEP_TIMEOUT_MS = 600_000;

const STUB = fileURLToPath(new URL('./fixtures/mcp-stub.mjs', import.meta.url));
/** The test's own two stubs (one harmless tool each, it answers "pong"): no connector of the owner's ever enters. */
export const PILOT_STUBS = ['probe_open', 'probe_shut'] as const;
export const STUB_CONFIG = JSON.stringify({ mcpServers: Object.fromEntries(PILOT_STUBS.map((n) => [n, { command: process.execPath, args: [STUB, n] }])) });

/**
 * The stubs' tools count as a non-outward capability here (as B9b's own K3 does; no real connector's name is used): B9b
 * leaves them open, so probe_shut is closed by the desk file alone (closed mode, step 4), not by B9b.
 */
export const pilotClassify = (name: string): ToolClass => (PILOT_STUBS.some((s) => name.startsWith(`mcp__${s}__`)) ? { kind: 'classified', capability: 'docs.read', outward: false } : toolClass(name));

/** How every session starts: the lock (--strict-mcp-config, outward built-ins gone), then the stubs; the office's own server comes from the engine. */
export function pilotCommand(claude: string[] = ['claude']): string[] {
  return [...claude, ...LOCKED_ARGS, '--mcp-config', STUB_CONFIG];
}

/** What the run has spent so far: claude's own count, every turn result. */
export function spentUsd(s: TestSetup): number {
  return s.events.list({ limit: 1_000_000 }).reduce((sum, e) => sum + (e.event.type === 'turn.finished' ? e.event.costUsd : 0), 0);
}

export interface PilotOffice extends TestSetup {
  engine: Engine;
  company: Company;
  budget: Budget;
  cycle: ManagementCycle;
  blueprints: Blueprints;
  memory: Memory;
  kpis: KpiReadings;
  clock: Clock;
  scheduling: Scheduling;
  tokens: TokenRegistry;
  tasks: TaskStore;
  plans: PlanStore;
  schedules: ScheduleStore;
  notices: NoticeStore;
  integrations: IntegrationRegistry;
  api: Api;
  port: number;
  /** The test's clock: shared by the company, the scheduler, the dispatcher and the log; moved by `advance`. */
  now: () => number;
  advance: (ms: number) => void;
  /** Throws (after stopping every session) once the earlier runs and this one have spent more than COST_CAP_USD; returns this run's. */
  checkCost: () => number;
  stop: () => Promise<void>;
}

/** Builds the office for the pilot run. `claude` is the CLI (the K1 check gives the fake one; the run, the real one). */
/**
 * `autonomy` 'plans' (default here): every plan, the blueprint's too, waits for the owner's approval, as pilot §6 has it.
 * `safetyMs`: how often the clock runs at the latest (and the dispatcher sweeps after it): a notice without an event (the
 * owner's onboarding answers) reaches the coordinator within it. `spentBefore`: what earlier runs of the task spent, USD.
 * Everything else is main.ts's: the management cycle beside the pulse, the precheck (B8), related memory (B12), the gate's
 * hook in every session (B9a; the constitution's gateEnabled, off by default, as live) and the owner flags.
 */
export async function pilotOffice(o: { claude?: string[]; env?: NodeJS.ProcessEnv; autonomy?: 'plans' | 'free'; safetyMs?: number; spentBefore?: number } = {}): Promise<PilotOffice> {
  let offset = 0;
  const now = () => Date.now() + offset;
  const s = setup(8, now);
  const tokens = new TokenRegistry();
  let url = '';
  let gateUrl = '';
  let port = 0;
  // eslint-disable-next-line prefer-const
  let integrations: IntegrationRegistry;
  const engine = new Engine({
    roster: s.roster, events: s.events, dataDir: s.dataDir, claudeCommand: pilotCommand(o.claude), env: o.env, mcp: { url: () => url, tokens },
    sessionDeny: (e) => sessionDeny({ capabilities: e.capabilities ?? [], seen: integrations.seenToolNames(), closedServers: integrations.closedServers(), classify: pilotClassify }),
    gate: { url: () => gateUrl, hook: gateHookCommand() },
    cacheTtlMinutes: () => budget.constitution().cacheTtlMinutes,
    modelPolicyEnabled: () => budget.constitution().modelPolicyEnabled,
  });
  const index = new SearchIndex(s.db);
  index.rebuildIfStale();
  const tasks = new TaskStore(s.db, now, index);
  const plans = new PlanStore(s.db, now);
  const notices = new NoticeStore(s.db, now);
  const schedules = new ScheduleStore(s.db, now);
  const proposals = new ProposalStore(s.db, now);
  const goals = new GoalStore(s.db, now);
  const state = new CompanyStateStore(s.db);
  const memory = new Memory({
    roster: s.roster, events: s.events, notices, tasks, plans, dataDir: s.dataDir, index,
    decisions: new DecisionStore(s.db, now, index), playbook: new PlaybookStore(s.db, now, index), notes: new NoteStore(s.db, now, index), employeeNotes: new EmployeeNoteStore(s.db, now),
  });
  const quota = new QuotaTracker(s.db, s.events);
  const constitution = new ConstitutionStore(s.db);
  // The owner's reserve as the live office has it (ownerReservePct 0; the brief's "sınır %100"): the default 25 sleeps every
  // member once the real account passes 75% of its week (run 5: 84%). The run's own ceiling is COST_CAP_USD.
  constitution.set({ autonomy: o.autonomy ?? 'plans', coordinatorModels: { kickoff: PILOT_MODEL, cycle: PILOT_MODEL, routine: PILOT_MODEL }, ownerReservePct: 0 });
  const budget = new Budget({ constitution, spend: new SpendStore(s.db, now), tasks, plans, roster: s.roster, events: s.events, notices, quota, deskCount: 8, now });
  const characters = () => ['coder', 'designer', 'manager'];
  // Every hire runs on the pilot's model, whatever the blueprint or a template says.
  const hire = (input: HireInput): Employee => engine.hire({ ...input, model: PILOT_MODEL });
  const company = new Company({
    roster: s.roster, events: s.events, tasks, plans, notices, dataDir: s.dataDir, hire, characters, reload: (id) => engine.reload(id), memory,
    constitution: () => budget.constitution(), proposals, goals, state, schedules, profile: new ProfileStore(s.db, now, index), onboarding: new OnboardingStore(s.db, now), now,
  });
  const pulse = new Pulse({ company, roster: s.roster, goals, state, plans, tasks, notices, budget, now });
  const scheduling = new Scheduling({ db: s.db, tasks, schedules, notices, company, state, events: s.events, constitution: () => budget.constitution(), now });
  const clock = new Clock({ scheduling, state, events: s.events, label: (at) => dueLabel(tasks, schedules, company, at), now, safetyMs: o.safetyMs ?? 5_000 });
  company.attachClock(clock);
  const kpis = new KpiReadings({ db: s.db, goals, plans, notices, state, coordinator: () => company.coordinator(), performance: (p) => performanceReport(s.db, p), now });
  company.attachKpis(kpis);
  integrations = new IntegrationRegistry({ db: s.db, roster: s.roster, events: s.events, now });
  const precheck = new CapabilityPrecheck({ company, tasks, roster: s.roster, integrations, proposals, events: s.events, enabled: () => budget.constitution().capabilityPrecheckEnabled });
  const agenda = new Agenda({ roster: s.roster, tasks, schedules, company, budget, clock });
  const boardDeps = { db: s.db, events: s.events, roster: s.roster, company, tasks, plans, state, agenda, budget, proposals, quota };
  const cycle = new ManagementCycle({ events: s.events, state, company, roster: s.roster, tasks, budget, clock, board: (b) => buildBoard(boardDeps, b), now });
  const dispatcher = new Dispatcher({ events: s.events, roster: s.roster, tasks, notices, plans, company, engine, budget, pulse, clock, kpis, related: (task) => relatedMemory(index, task), precheck, cycle, now });
  const performance = { report: (p: { days?: number }) => performanceReport(s.db, { since: p.days ? now() - p.days * 86_400_000 : null, now: now() }) };
  const metrics = { report: () => officeMetrics({ db: s.db, roster: s.roster, tasks, state }, now()) };
  const approvals = new Approvals({ store: new ApprovalStore(s.db), events: s.events, notices, roster: s.roster, tasks, coordinator: () => company.coordinator(), memory, now });
  const gateContext = liveContext({ repoRoot: REPO_ROOT, dataDir: s.dataDir, home: homedir(), port: () => port, hosts: [] });
  const gate = new Gate({ approvals, events: s.events, roster: s.roster, enabled: () => budget.constitution().gateEnabled, context: gateContext, git: gateContext.git });
  new OwnerFlags({ events: s.events, notices, coordinator: () => company.coordinator(), now });
  const blueprints = new Blueprints({ company, roster: s.roster, tasks, plans, schedules, memory, store: new BlueprintStore(s.db), integrations, constitution: () => budget.constitution() });
  const api = createApi(
    {
      engine, roster: s.roster, events: s.events, quota, gate,
      mcp: { tokens, tools: officeTools({ company, roster: s.roster, tasks, characters, memory, budget, engine, plans: () => plans.list(), agenda, performance, integrations, blueprints, kpis, approvals, gate, cycle }) },
      company: { service: company, tasks, plans, memory, budget, proposals, clock, agenda, performance, metrics, integrations, blueprints, approvals, management: cycle },
    },
    { allowedOrigins: [] },
  );
  await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', resolve));
  port = (api.server.address() as AddressInfo).port;
  url = `http://127.0.0.1:${port}/mcp`;
  gateUrl = `http://127.0.0.1:${port}/gate/check`;
  // main.ts's order: recover, then the cycle (it reads the clock's last run), the dispatcher and the clock.
  engine.recover();
  const stopCycle = cycle.start();
  const stopDispatcher = dispatcher.start();
  const stopClock = clock.start();
  const stopWatch = budget.watch();
  const stop = async () => {
    stopClock();
    stopDispatcher();
    stopCycle();
    stopWatch();
    await engine.shutdown();
    await api.close();
    s.cleanup();
  };
  const spentBefore = o.spentBefore ?? 0;
  const checkCost = () => {
    const spent = spentUsd(s);
    if (spentBefore + spent > COST_CAP_USD) {
      void stop();
      throw new Error(`Maliyet tavanı aşıldı: $${spentBefore.toFixed(4)} önceki + $${spent.toFixed(4)} bu koşu > $${COST_CAP_USD}; koşu durduruldu.`);
    }
    return spent;
  };
  return {
    ...s, engine, company, budget, cycle, blueprints, memory, kpis, clock, scheduling, tokens, tasks, plans, schedules, notices, integrations, api, port, now,
    advance: (ms) => void (offset += ms), checkCost, stop,
  };
}
