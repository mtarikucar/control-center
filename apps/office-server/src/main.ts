import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { createApi } from './api.ts';
import { Budget } from './company/budget.ts';
import { ConstitutionStore, SpendStore } from './company/budget-store.ts';
import { manifestCharacters } from './company/characters.ts';
import { Company } from './company/company.ts';
import { Memory } from './company/memory.ts';
import { DecisionStore, EmployeeNoteStore, NoteStore, PlaybookStore } from './company/memory-store.ts';
import { Dispatcher } from './company/dispatcher.ts';
import { ProposalStore } from './company/proposal-store.ts';
import { NoticeStore, PlanStore, TaskStore } from './company/store.ts';
import { loadConfig } from './config.ts';
import { migrateUp, openDb } from './db.ts';
import { deskDir } from './desk.ts';
import { Engine } from './engine.ts';
import { EventStore } from './event-store.ts';
import { acquireLock } from './lock.ts';
import { TokenRegistry } from './mcp/tokens.ts';
import { officeTools } from './mcp/tools.ts';
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
migrateUp(db);
const events = new EventStore(db);
const roster = new Roster(db, config.deskCount, Date.now, (slug) => existsSync(deskDir(config.dataDir, slug)));
const quota = new QuotaTracker(db, events);
const tokens = new TokenRegistry();
let mcpUrl = '';
const engine = new Engine({
  roster, events, dataDir: config.dataDir, claudeCommand: config.claudeCommand, mcp: { url: () => mcpUrl, tokens },
  cacheTtlMinutes: () => budget.constitution().cacheTtlMinutes,
  modelPolicyEnabled: () => budget.constitution().modelPolicyEnabled,
});
const tasks = new TaskStore(db);
const plans = new PlanStore(db);
const notices = new NoticeStore(db);
const proposals = new ProposalStore(db);
const memory = new Memory({
  roster, events, notices, tasks, plans, dataDir: config.dataDir,
  decisions: new DecisionStore(db), playbook: new PlaybookStore(db), notes: new NoteStore(db), employeeNotes: new EmployeeNoteStore(db),
});
const budget = new Budget({
  constitution: new ConstitutionStore(db), spend: new SpendStore(db), tasks, plans, roster, events, notices, quota, deskCount: config.deskCount,
});
const characters = manifestCharacters(config.assetsDir);
const company = new Company({ roster, events, tasks, plans, notices, dataDir: config.dataDir, hire: (input) => engine.hire(input), characters, reload: (id) => engine.reload(id), memory, constitution: () => budget.constitution(), proposals });
const dispatcher = new Dispatcher({ events, roster, tasks, notices, plans, company, engine, budget });

const api = createApi(
  { engine, roster, events, quota, mcp: { tokens, tools: officeTools({ company, roster, tasks, characters, memory, budget, engine }) }, company: { service: company, tasks, plans, memory, budget, proposals } },
  { allowedOrigins: config.allowedOrigins, webDir: config.webDir, assetsDir: config.assetsDir },
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
// Recover only once the port is ours, so a failed start never touches the employees.
api.server.listen(config.port, config.host, () => {
  const { port } = api.server.address() as AddressInfo;
  mcpUrl = `http://${config.host}:${port}/mcp`;
  engine.recover();
  dispatcher.start();
  budget.watch();
  console.log(`office-server hazır: http://${config.host}:${port}  (veri: ${config.dataDir})`);
});

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  console.log('office-server kapanıyor…');
  await api.close();
  await engine.shutdown();
  db.close();
  releaseLock();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
