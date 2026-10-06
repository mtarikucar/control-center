import { join } from 'node:path';
import { createApi } from './api.ts';
import { loadConfig } from './config.ts';
import { migrateUp, openDb } from './db.ts';
import { Engine } from './engine.ts';
import { EventStore } from './event-store.ts';
import { QuotaTracker } from './quota.ts';
import { Roster } from './roster.ts';

const config = loadConfig();
const db = openDb(join(config.dataDir, 'office.db'));
migrateUp(db);
const events = new EventStore(db);
const roster = new Roster(db, config.deskCount);
const quota = new QuotaTracker(db, events);
const engine = new Engine({ roster, events, dataDir: config.dataDir, claudeCommand: config.claudeCommand });
engine.recover();

const api = createApi({ engine, roster, events, quota }, { allowedOrigins: config.allowedOrigins });
api.server.listen(config.port, config.host, () => {
  console.log(`office-server hazır: http://${config.host}:${config.port}  (veri: ${config.dataDir})`);
});

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  console.log('office-server kapanıyor…');
  await api.close();
  await engine.shutdown();
  db.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
