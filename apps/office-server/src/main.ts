import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { createApi } from './api.ts';
import { Agenda } from './company/agenda.ts';
import { Budget } from './company/budget.ts';
import { ConstitutionStore, SpendStore } from './company/budget-store.ts';
import { manifestCharacters } from './company/characters.ts';
import { Clock } from './company/clock.ts';
import { Company } from './company/company.ts';
import { Memory } from './company/memory.ts';
import { DecisionStore, EmployeeNoteStore, NoteStore, PlaybookStore } from './company/memory-store.ts';
import { Dispatcher } from './company/dispatcher.ts';
import { CompanyStateStore, GoalStore } from './company/goal-store.ts';
import { Blueprints } from './company/blueprint.ts';
import { BlueprintStore } from './company/blueprint-store.ts';
import { IntegrationRegistry } from './company/integrations.ts';
import { officeMetrics } from './company/office-metrics.ts';
import { OnboardingStore } from './company/onboarding-store.ts';
import { ProfileStore } from './company/profile-store.ts';
import { ProposalStore } from './company/proposal-store.ts';
import { Pulse } from './company/pulse.ts';
import { dueLabel, Scheduling } from './company/scheduling.ts';
import { relatedMemory } from './company/related-memory.ts';
import { SearchIndex } from './company/search.ts';
import { NoticeStore, PlanStore, ScheduleStore, TaskStore } from './company/store.ts';
import { KpiReadings } from './company/kpi-readings.ts';
import { sessionDeny } from './company/session-deny.ts';
import { loadConfig } from './config.ts';
import { aheadOfCode, migrateUp, openDb } from './db.ts';
import { deskDir } from './desk.ts';
import { Engine } from './engine.ts';
import { EventStore } from './event-store.ts';
import { acquireLock } from './lock.ts';
import { TokenRegistry } from './mcp/tokens.ts';
import { officeTools } from './mcp/tools.ts';
import { performanceReport } from './performance.ts';
import { QuotaTracker } from './quota.ts';
import { Roster } from './roster.ts';

const config = loadConfig();
let releaseLock: () => void;
try {
  releaseLock = acquireLock(config.dataDir);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const db = openDb(join(config.dataDir, 'office.db'));
try {
  migrateUp(db);
} catch (err) {
  // A database whose migrations are not the code's (or a migration that failed): the office does not open on it.
  console.error(`office-server açılmadı: ${err instanceof Error ? err.message : String(err)} Veritabanına dokunmadan önce göç numaralarını ve birleştirme notunu kontrol et.`);
  db.close();
  releaseLock();
  process.exit(1);
}
// Ahead of the code (only the code went back, the merge notes' way): the office opens on it and says so.
const ahead = aheadOfCode(db);
if (ahead.length > 0) {
  console.warn(`Uyarı: veritabanı koddan ileride: ${ahead.map((a) => `v${a.version} “${a.name}”`).join(', ')} bu kodda yok; göç çalıştırılmadı, ofis açılıyor.`);
}
const events = new EventStore(db);
const roster = new Roster(db, config.deskCount, Date.now, (slug) => existsSync(deskDir(config.dataDir, slug)));
const quota = new QuotaTracker(db, events);
const tokens = new TokenRegistry();
let mcpUrl = '';
const engine = new Engine({
  // B9b: each session closes the employee's own list (the registry is built below; asked only when a session starts).
  sessionDeny: (e) => sessionDeny({ capabilities: e.capabilities ?? [], seen: integrations.seenToolNames(), closedServers: integrations.closedServers() }),
  roster, events, dataDir: config.dataDir, claudeCommand: config.claudeCommand, mcp: { url: () => mcpUrl, tokens },
  cacheTtlMinutes: () => budget.constitution().cacheTtlMinutes,
  modelPolicyEnabled: () => budget.constitution().modelPolicyEnabled,
});
// The memory search's one index (B11): every store that writes what it holds is given it; filled from those tables on
// the first start after v20 and whenever it is behind them.
const searchIndex = new SearchIndex(db);
searchIndex.rebuildIfStale();
const tasks = new TaskStore(db, Date.now, searchIndex);
const plans = new PlanStore(db);
const notices = new NoticeStore(db);
const schedules = new ScheduleStore(db);
const proposals = new ProposalStore(db);
const goals = new GoalStore(db);
const state = new CompanyStateStore(db);
const memory = new Memory({
  roster, events, notices, tasks, plans, dataDir: config.dataDir, index: searchIndex,
  decisions: new DecisionStore(db, Date.now, searchIndex), playbook: new PlaybookStore(db, Date.now, searchIndex), notes: new NoteStore(db, Date.now, searchIndex),
  employeeNotes: new EmployeeNoteStore(db),
});
const budget = new Budget({
  constitution: new ConstitutionStore(db), spend: new SpendStore(db), tasks, plans, roster, events, notices, quota, deskCount: config.deskCount,
});
const characters = manifestCharacters(config.assetsDir);
const company = new Company({ roster, events, tasks, plans, notices, dataDir: config.dataDir, hire: (input) => engine.hire(input), characters, reload: (id) => engine.reload(id), memory, constitution: () => budget.constitution(), proposals, goals, state, schedules, profile: new ProfileStore(db, Date.now, searchIndex), onboarding: new OnboardingStore(db) });
const pulse = new Pulse({ company, roster, goals, state, plans, tasks, notices, budget });
// The office's one timer (spec §5): built after the company (the scheduling service needs it) and attached to it, so every time change re-arms it.
const scheduling = new Scheduling({ db, tasks, schedules, notices, company, state, events, constitution: () => budget.constitution() });
const clock = new Clock({ scheduling, state, events, label: (now) => dueLabel(tasks, schedules, company, now) });
company.attachClock(clock);
// KPI measurement (B26): the office reads its own KPIs from the metrics (B4) and asks the coordinator for the rest.
const kpis = new KpiReadings({ db, goals, plans, notices, state, coordinator: () => company.coordinator(), performance: (o) => performanceReport(db, o) });
company.attachKpis(kpis);
// B12: each task message carries what the memory holds for it (the index read, no memory.searched event).
const dispatcher = new Dispatcher({ events, roster, tasks, notices, plans, company, engine, budget, pulse, clock, kpis, related: (task) => relatedMemory(searchIndex, task) });
// Who does what when (spec §6.1): reads only, for the sheet and agendaRead.
const agenda = new Agenda({ roster, tasks, schedules, company, budget, clock });

// How the work went (B4): read from the log on demand, the last `days` or all time.
const performance = { report: (o: { days?: number }) => performanceReport(db, { since: o.days ? Date.now() - o.days * 86_400_000 : null }) };
// The top bar's figures (busy, delivered in the last day, stuck): read on demand.
const metrics = { report: () => officeMetrics({ db, roster, tasks, state }, Date.now()) };
// Which connectors the office has (B3): read from the sessions' reports and the coordinator's records.
const integrations = new IntegrationRegistry({ db, roster, events });
const blueprints = new Blueprints({ company, roster, tasks, plans, schedules, memory, store: new BlueprintStore(db), integrations, constitution: () => budget.constitution() });

const api = createApi(
  {
    engine, roster, events, quota,
    mcp: { tokens, tools: officeTools({ company, roster, tasks, characters, memory, budget, engine, plans: () => plans.list(), agenda, performance, integrations, blueprints, kpis }) },
    company: { service: company, tasks, plans, memory, budget, proposals, clock, agenda, performance, metrics, integrations, blueprints },
  },
  { allowedOrigins: config.allowedOrigins, allowedHosts: config.allowedHosts, webDir: config.webDir, assetsDir: config.assetsDir },
);
api.server.on('error', (err: NodeJS.ErrnoException) => {
  console.error(
    err.code === 'EADDRINUSE'
      ? `Port ${config.port} kullanımda; OFFICE_PORT ile başka bir port seç.`
      : `office-server başlatılamadı: ${err.message}`,
  );
  releaseLock();
  process.exit(1);
});
// Stopped first on shutdown, so no tick or due run reaches a closing engine or a closed database.
let stopDispatcher: (() => void) | null = null;
let stopClock: (() => void) | null = null;
// Recover only once the port is ours, so a failed start never touches the employees.
api.server.listen(config.port, config.host, () => {
  const { port } = api.server.address() as AddressInfo;
  mcpUrl = `http://${config.host}:${port}/mcp`;
  engine.recover();
  stopDispatcher = dispatcher.start();
  stopClock = clock.start();
  budget.watch();
  console.log(`office-server hazır: http://${config.host}:${port}  (veri: ${config.dataDir})`);
});

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  console.log('office-server kapanıyor…');
  stopClock?.();
  stopDispatcher?.();
  await api.close();
  await engine.shutdown();
  db.close();
  releaseLock();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
