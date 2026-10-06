import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { createApi } from './api.ts';
import { loadConfig } from './config.ts';
import { migrateUp, openDb } from './db.ts';
import { deskDir } from './desk.ts';
import { Engine } from './engine.ts';
import { EventStore } from './event-store.ts';
import { acquireLock } from './lock.ts';
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
const engine = new Engine({ roster, events, dataDir: config.dataDir, claudeCommand: config.claudeCommand });

const api = createApi(
  { engine, roster, events, quota },
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
  engine.recover();
  const { port } = api.server.address() as AddressInfo;
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
