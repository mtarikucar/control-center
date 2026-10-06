# Plan 1 — office-server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3D ekran olmadan, komut satırından/HTTP'den çalışan ofis motoru: çalışan işe alma, Claude Code oturumu başlatma, mesaj (tur ortası dahil), yan soru, durdur/devam, terminalde aç, çökme/limit/yeniden başlatma dayanıklılığı, token ve kota takibi, canlı olay akışı.

**Architecture:** Tek bir Node süreci (`apps/office-server`). Her çalışan için sürekli açık bir `claude -p --input-format stream-json --output-format stream-json` süreci; çıktısı ortak olay biçimine çevrilip SQLite'a eklenir ve WebSocket'ten yayınlanır. HTTP API yalnızca 127.0.0.1'de, Host/Origin denetimli. Testler gerçek claude yerine stream-json konuşan sahte bir `claude` (fake-claude) kullanır; gerçek claude yalnızca isteğe bağlı duman testinde. Claude'a özgü her şey `src/claude/` altında toplanır; spec §4.2'deki ayrı `EngineAdapter` arayüzü Codex eklenene kadar bilinçli olarak yazılmaz (YAGNI) — o gün `src/claude/`'un yanına ikinci bir klasör ve ortak arayüz gelir.

**Tech Stack:** Node 24 (yerleşik TypeScript tip silme + `node:sqlite`), pnpm 9 workspaces, TypeScript 5.9 (strict, `erasableSyntaxOnly`), `ws`, Vitest 3.

**Spec:** `docs/superpowers/specs/2026-10-06-office-v1-design.md` (bu plan §3, §4, §5, §6'nın yaşam döngüsü kısmı, §10 ve §11'in sunucu kısmını uygular; office-web ve Meshy skill'i ayrı planlardır).

## Global Constraints

- Node ≥ 24; `node src/main.ts` doğrudan çalışır (derleme adımı yok). TypeScript `strict`, `verbatimModuleSyntax`, `erasableSyntaxOnly`: **enum, namespace ve constructor parameter property yok**; tip importları `import type`.
- Çalışma zamanı bağımlılığı yalnızca `ws`. SQLite için `node:sqlite` (`DatabaseSync`).
- Sunucu yalnızca `127.0.0.1`'e bağlanır. `Host` başlığı `127.0.0.1:<port>` ya da `localhost:<port>` olmalı; `Origin` varsa ofisin kendi adresi ya da `OFFICE_ALLOWED_ORIGINS` (varsayılan `http://127.0.0.1:5173,http://localhost:5173`) olmalı; her `POST` `content-type: application/json` olmalı.
- Çalışma zamanı verisi `OFFICE_DATA_DIR` (varsayılan `~/.control-center`); **repo içinde olamaz** (config reddeder).
- Çalışan oturumları tam olarak `sessionArgs` (Task 4) bayraklarıyla başlar: `--setting-sources user,project,local` + `--settings {"enabledPlugins":{"superpowers@claude-plugins-official":false},"claudeMdExcludes":["<home>/.claude/CLAUDE.md"],"attribution":{"commit":"","pr":""}}` + `--permission-mode bypassPermissions`.
- Veritabanı şeması geri alınabilir up/down çiftleriyle; up → down → up gidiş-dönüşü test edilir.
- Commit mesajları sade conventional commit; **Claude/AI izi, `Co-Authored-By` satırı yok**.
- Kullanıcıya dönen hata metinleri ve sistem mesajları Türkçe.
- Kapsam dışı: office-web (3D ofis), Meshy skill'i, kuyruk/arşiv/yetkiler (spec §12).

## Review Focus

1. Sahibinin tarayıcısında açık başka bir site `127.0.0.1:4319`'a POST atar ya da WebSocket açar (CSRF / DNS rebinding) → 403; yanlış content-type → 415. (Task 9)
2. Türkçe karakterli, aynı ya da yalnızca simgeden oluşan adlar → benzersiz ASCII masa klasörleri; işten çıkarılanın klasör adı yeniden kullanılmaz. (Task 3)
3. Claude çok büyük bir araç çıktısı üretir ya da stdout'a JSON olmayan satır basar → çıktı 4000 karakterde kısaltılır, JSON olmayan satır yok sayılır, sunucu ayakta kalır. (Task 4, Task 5)
4. Süreci kapanmış ya da durdurulmuş bir çalışana mesaj gönderilir → oturum yeniden açılır, mesaj kaybolmaz. (Task 6)
5. Ofis bir tur sürerken kapanıp açılır → çalışan sonsuza dek `working` kalmaz, `interrupted` olur; "Devam" bir sistem mesajıyla işi sürdürür. (Task 7)

---

## Dosya haritası

```
package.json                     workspace kökü
pnpm-workspace.yaml
tsconfig.base.json
packages/shared/
  package.json
  tsconfig.json
  src/index.ts                   dışa aktarım
  src/employee.ts                Employee, Lifecycle, ModelAlias, HireInput
  src/events.ts                  OfficeEvent, StoredEvent, Usage, QuotaWindow, QuotaState, OfficeSnapshot, ServerMessage
apps/office-server/
  package.json
  tsconfig.json
  vitest.config.ts
  src/config.ts                  ortam değişkenlerinden ayar, repo içi veri klasörü yasağı
  src/errors.ts                  HTTP durum kodu taşıyan hata sınıfları
  src/migrations.ts              up/down SQL çiftleri
  src/db.ts                      openDb, migrateUp, migrateDown, appliedVersion
  src/event-store.ts             EventStore: append/list/lastSeq/subscribe
  src/roster.ts                  slugify, Roster: create/get/list/update
  src/desk.ts                    deskDir, roleCard, prepareDesk
  src/claude/args.ts             employeeSettings, sessionArgs, sideQuestionArgs, terminalCommand
  src/claude/normalize.ts        stream-json → OfficeEvent[]; usageOf, truncate
  src/claude/process.ts          ClaudeProcess: uzun ömürlü stream-json süreci
  src/claude/once.ts             runOnce: tek seferlik (yan soru) süreç
  src/engine.ts                  Engine: yaşam döngüsü, mesaj, durdur/devam, terminal, çökme, limit, kurtarma
  src/quota.ts                   QuotaTracker: kota pencereleri, çalışan başına kullanım
  src/api.ts                     createApi: HTTP + WebSocket, checkRequest
  src/main.ts                    bağlama ve başlatma
  test/helpers.ts                tempDir, until, waitFor, setup
  test/engine-helpers.ts         fakeEngine, readArgv
  test/fake-claude.mjs           sahte claude CLI
  test/*.test.ts
```

---

### Task 1: Workspace iskeleti, ayarlar ve geri alınabilir şema

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/employee.ts`, `packages/shared/src/events.ts`
- Create: `apps/office-server/package.json`, `apps/office-server/tsconfig.json`, `apps/office-server/vitest.config.ts`
- Create: `apps/office-server/src/config.ts`, `apps/office-server/src/errors.ts`, `apps/office-server/src/migrations.ts`, `apps/office-server/src/db.ts`
- Test: `apps/office-server/test/config.test.ts`, `apps/office-server/test/db.test.ts`

**Interfaces:**
- Produces: `@cc/shared` tipleri (aşağıda tam); `loadConfig(env): OfficeConfig`, `REPO_ROOT`; `openDb(file): Db`, `migrateUp(db): number`, `migrateDown(db, target): number`, `appliedVersion(db): number`, `type Db`; hata sınıfları `ValidationError(400)`, `ForbiddenError(403)`, `NotFoundError(404)`, `ConflictError(409)`, `UnsupportedMediaTypeError(415)`, `statusOf(err): number`.

- [ ] **Step 1: Kök workspace dosyalarını yaz**

`package.json`:
```json
{
  "name": "control-center",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - apps/*
  - packages/*
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  }
}
```

- [ ] **Step 2: `@cc/shared` paketini yaz**

`packages/shared/package.json`:
```json
{
  "name": "@cc/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "echo \"@cc/shared: test yok\""
  },
  "devDependencies": { "@types/node": "^24.0.0", "typescript": "^5.9.0" }
}
```

`packages/shared/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`packages/shared/src/employee.ts`:
```ts
export const MODEL_ALIASES = ['opus', 'sonnet', 'haiku'] as const;
export type ModelAlias = (typeof MODEL_ALIASES)[number];

export const LIFECYCLES = [
  'starting',
  'idle',
  'working',
  'stopped',
  'in_terminal',
  'limited',
  'interrupted',
  'error',
  'archived',
] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];

export interface Employee {
  id: string;
  slug: string;
  name: string;
  role: string;
  model: ModelAlias;
  characterId: string;
  deskIndex: number;
  sessionId: string;
  /** true once claude has reported the session (first `system/init`); before that we start with --session-id. */
  sessionStarted: boolean;
  lifecycle: Lifecycle;
  limitResetsAt: number | null;
  lastError: string | null;
  createdAt: number;
}

export interface HireInput {
  name: string;
  role: string;
  model?: ModelAlias;
  characterId?: string;
}
```

`packages/shared/src/events.ts`:
```ts
import type { Employee, Lifecycle } from './employee.ts';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface QuotaWindow {
  /** 0..1 */
  utilization: number;
  /** epoch milliseconds */
  resetsAt: number;
}

export type OfficeEvent =
  | { type: 'employee.hired'; name: string }
  | { type: 'employee.fired' }
  | { type: 'session.started'; model: string; mcp: { name: string; status: string }[] }
  | { type: 'turn.started' }
  | { type: 'turn.finished'; ok: boolean; subtype: string; usage: Usage; costUsd: number; numTurns: number }
  | { type: 'message.user'; text: string; source: 'owner' | 'system' }
  | { type: 'message.assistant'; text: string }
  | { type: 'tool.started'; toolUseId: string; name: string; input: unknown }
  | { type: 'tool.finished'; toolUseId: string; isError: boolean; output: string }
  | { type: 'side.question'; text: string }
  | { type: 'side.answer'; text: string; ok: boolean; usage: Usage; costUsd: number }
  | { type: 'quota.updated'; status: string; fiveHour: QuotaWindow | null; sevenDay: QuotaWindow | null }
  | { type: 'lifecycle.changed'; from: Lifecycle; to: Lifecycle; reason: string }
  | { type: 'error'; message: string };

export type OfficeEventType = OfficeEvent['type'];

export interface StoredEvent {
  seq: number;
  employeeId: string | null;
  ts: number;
  event: OfficeEvent;
}

export type UsageTotals = Usage & { costUsd: number };

export interface EmployeeUsage {
  today: UsageTotals;
  total: UsageTotals;
}

export interface QuotaState {
  status: string;
  fiveHour: QuotaWindow | null;
  sevenDay: QuotaWindow | null;
  updatedAt: number;
}

export interface OfficeSnapshot {
  employees: Employee[];
  quota: QuotaState | null;
  usage: Record<string, EmployeeUsage>;
  lastSeq: number;
}

export type ServerMessage =
  | { type: 'snapshot'; snapshot: OfficeSnapshot }
  | { type: 'event'; event: StoredEvent };
```

`packages/shared/src/index.ts`:
```ts
export * from './employee.ts';
export * from './events.ts';
```

- [ ] **Step 3: `@cc/office-server` paket dosyalarını yaz**

`apps/office-server/package.json`:
```json
{
  "name": "@cc/office-server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node src/main.ts",
    "test": "vitest run",
    "smoke": "OFFICE_SMOKE=1 vitest run test/smoke.real.test.ts",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": { "@cc/shared": "workspace:*", "ws": "^8.18.0" },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@types/ws": "^8.5.12",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

`apps/office-server/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test", "vitest.config.ts"] }
```

`apps/office-server/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'], testTimeout: 15_000, hookTimeout: 15_000 },
});
```

Run: `cd ~/Projects/control-center && pnpm install`
Expected: `node_modules` kurulur, `pnpm-lock.yaml` oluşur, hata yok.

- [ ] **Step 4: Ayar ve şema için başarısız testleri yaz**

`apps/office-server/test/config.test.ts`:
```ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, loadConfig } from '../src/config.ts';

describe('loadConfig', () => {
  it('defaults to ~/.control-center on 127.0.0.1:4319 with the real claude', () => {
    const c = loadConfig({});
    expect(c.dataDir).toBe(join(homedir(), '.control-center'));
    expect(c.host).toBe('127.0.0.1');
    expect(c.port).toBe(4319);
    expect(c.claudeCommand).toEqual(['claude']);
    expect(c.deskCount).toBe(8);
    expect(c.allowedOrigins).toEqual(['http://127.0.0.1:5173', 'http://localhost:5173']);
  });

  it('reads overrides from the environment', () => {
    const c = loadConfig({
      OFFICE_DATA_DIR: '/tmp/office-x',
      OFFICE_PORT: '5000',
      OFFICE_CLAUDE_COMMAND: '["node","fake.mjs"]',
      OFFICE_ALLOWED_ORIGINS: 'http://a.test, http://b.test',
    });
    expect(c.dataDir).toBe('/tmp/office-x');
    expect(c.port).toBe(5000);
    expect(c.claudeCommand).toEqual(['node', 'fake.mjs']);
    expect(c.allowedOrigins).toEqual(['http://a.test', 'http://b.test']);
  });

  it('refuses a data directory inside the repository', () => {
    expect(() => loadConfig({ OFFICE_DATA_DIR: join(REPO_ROOT, 'office-data') })).toThrow(/repo/);
    expect(() => loadConfig({ OFFICE_DATA_DIR: REPO_ROOT })).toThrow(/repo/);
  });

  it('rejects a bad port or claude command', () => {
    expect(() => loadConfig({ OFFICE_PORT: 'abc' })).toThrow(/OFFICE_PORT/);
    expect(() => loadConfig({ OFFICE_CLAUDE_COMMAND: 'claude' })).toThrow(/OFFICE_CLAUDE_COMMAND/);
  });
});
```

`apps/office-server/test/db.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { appliedVersion, migrateDown, migrateUp, openDb, type Db } from '../src/db.ts';

function tables(db: Db): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as unknown as { name: string }[];
  return rows.map((r) => r.name);
}

describe('migrations', () => {
  it('applies every migration up', () => {
    const db = openDb(':memory:');
    expect(migrateUp(db)).toBe(1);
    expect(tables(db)).toEqual(['employees', 'events', 'quota', 'schema_migrations']);
  });

  it('round-trips up → down → up', () => {
    const db = openDb(':memory:');
    migrateUp(db);
    expect(migrateDown(db, 0)).toBe(0);
    expect(tables(db)).toEqual(['schema_migrations']);
    expect(appliedVersion(db)).toBe(0);
    expect(migrateUp(db)).toBe(1);
    expect(tables(db)).toEqual(['employees', 'events', 'quota', 'schema_migrations']);
  });

  it('is a no-op when run twice in either direction', () => {
    const db = openDb(':memory:');
    migrateUp(db);
    expect(migrateUp(db)).toBe(1);
    migrateDown(db, 0);
    expect(migrateDown(db, 0)).toBe(0);
  });
});
```

- [ ] **Step 5: Testlerin başarısız olduğunu gör**

Run: `cd ~/Projects/control-center && pnpm --filter @cc/office-server test`
Expected: FAIL — `../src/config.ts` ve `../src/db.ts` bulunamıyor.

- [ ] **Step 6: config, errors, migrations, db'yi yaz**

`apps/office-server/src/config.ts`:
```ts
import { homedir } from 'node:os';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));

export interface OfficeConfig {
  dataDir: string;
  host: string;
  port: number;
  claudeCommand: string[];
  deskCount: number;
  /** Origins allowed besides the server's own http://127.0.0.1:<port> and http://localhost:<port>. */
  allowedOrigins: string[];
}

function insideRepo(dir: string): boolean {
  const rel = relative(REPO_ROOT, resolve(dir));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OfficeConfig {
  const dataDir = env.OFFICE_DATA_DIR ?? join(homedir(), '.control-center');
  if (insideRepo(dataDir)) {
    throw new Error(`OFFICE_DATA_DIR repo içinde olamaz (${dataDir}); çalışanlar reponun talimatlarını devralırdı.`);
  }
  const port = Number(env.OFFICE_PORT ?? '4319');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`OFFICE_PORT geçersiz: ${env.OFFICE_PORT}`);
  let claudeCommand = ['claude'];
  if (env.OFFICE_CLAUDE_COMMAND !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(env.OFFICE_CLAUDE_COMMAND);
    } catch {
      parsed = null;
    }
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((p) => typeof p === 'string')) {
      throw new Error('OFFICE_CLAUDE_COMMAND bir JSON dizi olmalı, örn. ["claude"]');
    }
    claudeCommand = parsed;
  }
  const allowedOrigins = env.OFFICE_ALLOWED_ORIGINS
    ? env.OFFICE_ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : ['http://127.0.0.1:5173', 'http://localhost:5173'];
  return { dataDir, host: '127.0.0.1', port, claudeCommand, deskCount: 8, allowedOrigins };
}
```

`apps/office-server/src/errors.ts`:
```ts
export class ValidationError extends Error {
  readonly status = 400;
}
export class ForbiddenError extends Error {
  readonly status = 403;
}
export class NotFoundError extends Error {
  readonly status = 404;
}
export class ConflictError extends Error {
  readonly status = 409;
}
export class UnsupportedMediaTypeError extends Error {
  readonly status = 415;
}

export function statusOf(err: unknown): number {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : 500;
}
```

`apps/office-server/src/migrations.ts`:
```ts
export interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'core tables',
    up: `
      CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        model TEXT NOT NULL,
        character_id TEXT NOT NULL,
        desk_index INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        session_started INTEGER NOT NULL DEFAULT 0,
        lifecycle TEXT NOT NULL,
        limit_resets_at INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id TEXT,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_employee_seq ON events (employee_id, seq);
      CREATE INDEX IF NOT EXISTS events_type_ts ON events (type, ts);
      CREATE TABLE IF NOT EXISTS quota (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        status TEXT NOT NULL,
        five_hour TEXT,
        seven_day TEXT,
        updated_at INTEGER NOT NULL
      );`,
    down: `
      DROP TABLE IF EXISTS quota;
      DROP INDEX IF EXISTS events_type_ts;
      DROP INDEX IF EXISTS events_employee_seq;
      DROP TABLE IF EXISTS events;
      DROP TABLE IF EXISTS employees;`,
  },
];
```

`apps/office-server/src/db.ts`:
```ts
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, type Migration } from './migrations.ts';

export type Db = DatabaseSync;

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  return db;
}

export function appliedVersion(db: Db): number {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)',
  );
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as unknown as { v: number | null };
  return row.v ?? 0;
}

function inTransaction(db: Db, work: () => void): void {
  db.exec('BEGIN');
  try {
    work();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function migrateUp(db: Db, migrations: Migration[] = MIGRATIONS): number {
  const current = appliedVersion(db);
  for (const m of migrations.filter((x) => x.version > current).sort((a, b) => a.version - b.version)) {
    inTransaction(db, () => {
      db.exec(m.up);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, Date.now());
    });
  }
  return appliedVersion(db);
}

export function migrateDown(db: Db, target: number, migrations: Migration[] = MIGRATIONS): number {
  const current = appliedVersion(db);
  const toRevert = migrations.filter((m) => m.version > target && m.version <= current).sort((a, b) => b.version - a.version);
  for (const m of toRevert) {
    inTransaction(db, () => {
      db.exec(m.down);
      db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(m.version);
    });
  }
  return appliedVersion(db);
}
```

- [ ] **Step 7: Testlerin geçtiğini ve tiplerin doğru olduğunu gör**

Run: `cd ~/Projects/control-center && pnpm --filter @cc/office-server test && pnpm typecheck`
Expected: config ve db testleri PASS; typecheck hatasız.

- [ ] **Step 8: Commit**

```bash
cd ~/Projects/control-center
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json packages apps
git commit -m "feat(server): add workspace, config and reversible schema"
```

---

### Task 2: Olay kaydı (EventStore)

**Files:**
- Create: `apps/office-server/src/event-store.ts`
- Create: `apps/office-server/test/helpers.ts`
- Test: `apps/office-server/test/event-store.test.ts`

**Interfaces:**
- Consumes: `Db`, `openDb`, `migrateUp` (Task 1); `OfficeEvent`, `StoredEvent` (`@cc/shared`).
- Produces: `class EventStore { constructor(db: Db, now?: () => number); append(employeeId: string | null, event: OfficeEvent): StoredEvent; list(opts?: { after?: number; employeeId?: string; limit?: number }): StoredEvent[]; lastSeq(): number; subscribe(listener: (e: StoredEvent) => void): () => void }`; test yardımcıları `tempDir(prefix?)`, `until(check, timeoutMs?)`, `waitFor(events, predicate, { after?, timeoutMs? })`.

- [ ] **Step 1: Test yardımcılarını yaz**

`apps/office-server/test/helpers.ts`:
```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StoredEvent } from '@cc/shared';
import type { EventStore } from '../src/event-store.ts';

export function tempDir(prefix = 'cc-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export async function until(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) throw new Error('until: zaman aşımı');
    await new Promise((r) => setTimeout(r, 20));
  }
}

export function waitFor(
  events: EventStore,
  predicate: (e: StoredEvent) => boolean,
  opts: { after?: number; timeoutMs?: number } = {},
): Promise<StoredEvent> {
  const after = opts.after ?? 0;
  const match = (e: StoredEvent) => e.seq > after && predicate(e);
  const existing = events.list({ after, limit: 5000 }).find(match);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error('waitFor: zaman aşımı'));
    }, opts.timeoutMs ?? 5000);
    const off = events.subscribe((e) => {
      if (!match(e)) return;
      clearTimeout(timer);
      off();
      resolve(e);
    });
  });
}
```

- [ ] **Step 2: Başarısız testi yaz**

`apps/office-server/test/event-store.test.ts`:
```ts
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrateUp, openDb } from '../src/db.ts';
import { EventStore } from '../src/event-store.ts';
import { tempDir } from './helpers.ts';

function store(now?: () => number) {
  const db = openDb(':memory:');
  migrateUp(db);
  return new EventStore(db, now);
}

describe('EventStore', () => {
  it('appends with increasing seq and lists after a seq', () => {
    const s = store(() => 1000);
    const a = s.append('e1', { type: 'turn.started' });
    const b = s.append('e1', { type: 'message.assistant', text: 'merhaba' });
    expect(b.seq).toBeGreaterThan(a.seq);
    expect(a.ts).toBe(1000);
    expect(s.list({ after: a.seq })).toEqual([b]);
  });

  it('filters by employee and respects the limit', () => {
    const s = store();
    s.append('e1', { type: 'turn.started' });
    s.append('e2', { type: 'turn.started' });
    s.append(null, { type: 'error', message: 'genel' });
    s.append('e1', { type: 'turn.started' });
    expect(s.list({ employeeId: 'e1' }).map((e) => e.employeeId)).toEqual(['e1', 'e1']);
    expect(s.list({ limit: 2 })).toHaveLength(2);
  });

  it('notifies subscribers and a throwing subscriber does not break append', () => {
    const s = store();
    const seen: number[] = [];
    s.subscribe(() => {
      throw new Error('kötü dinleyici');
    });
    const off = s.subscribe((e) => seen.push(e.seq));
    const first = s.append('e1', { type: 'turn.started' });
    off();
    s.append('e1', { type: 'turn.started' });
    expect(seen).toEqual([first.seq]);
  });

  it('reports lastSeq, 0 when empty', () => {
    const s = store();
    expect(s.lastSeq()).toBe(0);
    const e = s.append('e1', { type: 'turn.started' });
    expect(s.lastSeq()).toBe(e.seq);
  });

  it('keeps events across reopening the database file', () => {
    const file = join(tempDir(), 'office.db');
    const db = openDb(file);
    migrateUp(db);
    new EventStore(db).append('e1', { type: 'message.user', text: 'kalıcı', source: 'owner' });
    db.close();
    const reopened = openDb(file);
    expect(new EventStore(reopened).list()[0]?.event).toEqual({ type: 'message.user', text: 'kalıcı', source: 'owner' });
  });
});
```

- [ ] **Step 3: Testin başarısız olduğunu gör**

Run: `pnpm --filter @cc/office-server test -- event-store`
Expected: FAIL — `../src/event-store.ts` bulunamıyor.

- [ ] **Step 4: EventStore'u yaz**

`apps/office-server/src/event-store.ts`:
```ts
import type { OfficeEvent, StoredEvent } from '@cc/shared';
import type { Db } from './db.ts';

export type EventListener = (event: StoredEvent) => void;

interface Row {
  seq: number;
  employee_id: string | null;
  ts: number;
  payload: string;
}

function toStored(row: Row): StoredEvent {
  return { seq: row.seq, employeeId: row.employee_id, ts: row.ts, event: JSON.parse(row.payload) as OfficeEvent };
}

export class EventStore {
  readonly #db: Db;
  readonly #now: () => number;
  readonly #listeners = new Set<EventListener>();

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  append(employeeId: string | null, event: OfficeEvent): StoredEvent {
    const ts = this.#now();
    const result = this.#db
      .prepare('INSERT INTO events (employee_id, ts, type, payload) VALUES (?, ?, ?, ?)')
      .run(employeeId, ts, event.type, JSON.stringify(event));
    const stored: StoredEvent = { seq: Number(result.lastInsertRowid), employeeId, ts, event };
    for (const listener of this.#listeners) {
      try {
        listener(stored);
      } catch (err) {
        console.error('olay dinleyicisi hata verdi', err);
      }
    }
    return stored;
  }

  list(opts: { after?: number; employeeId?: string; limit?: number } = {}): StoredEvent[] {
    const after = opts.after ?? 0;
    const limit = Math.max(1, Math.min(opts.limit ?? 500, 5000));
    const rows = (
      opts.employeeId === undefined
        ? this.#db.prepare('SELECT seq, employee_id, ts, payload FROM events WHERE seq > ? ORDER BY seq LIMIT ?').all(after, limit)
        : this.#db
            .prepare('SELECT seq, employee_id, ts, payload FROM events WHERE seq > ? AND employee_id = ? ORDER BY seq LIMIT ?')
            .all(after, opts.employeeId, limit)
    ) as unknown as Row[];
    return rows.map(toStored);
  }

  lastSeq(): number {
    const row = this.#db.prepare('SELECT MAX(seq) AS s FROM events').get() as unknown as { s: number | null };
    return row.s ?? 0;
  }

  subscribe(listener: EventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
```

- [ ] **Step 5: Testin geçtiğini gör**

Run: `pnpm --filter @cc/office-server test -- event-store && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/office-server/src/event-store.ts apps/office-server/test/helpers.ts apps/office-server/test/event-store.test.ts
git commit -m "feat(server): add append-only event store"
```

---

### Task 3: Kadro (Roster) ve masa

**Files:**
- Create: `apps/office-server/src/roster.ts`, `apps/office-server/src/desk.ts`
- Modify: `apps/office-server/test/helpers.ts` (sona `setup` ekle)
- Test: `apps/office-server/test/roster.test.ts`, `apps/office-server/test/desk.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 1), `EventStore` (Task 2), hata sınıfları (Task 1), `Employee`, `HireInput`, `MODEL_ALIASES` (`@cc/shared`).
- Produces: `slugify(name: string): string`; `class Roster { constructor(db: Db, deskCount: number, now?: () => number); create(input: HireInput): Employee; get(id: string): Employee; list(opts?: { includeArchived?: boolean }): Employee[]; update(id: string, patch: Partial<Pick<Employee, 'lifecycle' | 'sessionStarted' | 'limitResetsAt' | 'lastError'>>): Employee }`; `deskDir(dataDir: string, slug: string): string`; `roleCard(e: Pick<Employee, 'name' | 'role'>): string`; `prepareDesk(dataDir: string, e: Employee): string`; test yardımcısı `interface TestSetup { dataDir; db; events; roster; cleanup() }`, `setup(deskCount?): TestSetup`.

- [ ] **Step 1: `setup` yardımcısını ekle**

`apps/office-server/test/helpers.ts` dosyasının en üstündeki importlara ekle:
```ts
import { rmSync } from 'node:fs';
import { migrateUp, openDb, type Db } from '../src/db.ts';
import { EventStore } from '../src/event-store.ts';
import { Roster } from '../src/roster.ts';
```
ve `import type { EventStore } from '../src/event-store.ts';` satırını sil (artık değer olarak import ediliyor). Dosyanın sonuna ekle:
```ts
export interface TestSetup {
  dataDir: string;
  db: Db;
  events: EventStore;
  roster: Roster;
  cleanup: () => void;
}

export function setup(deskCount = 8): TestSetup {
  const dataDir = tempDir();
  const db = openDb(':memory:');
  migrateUp(db);
  const events = new EventStore(db);
  const roster = new Roster(db, deskCount);
  return { dataDir, db, events, roster, cleanup: () => rmSync(dataDir, { recursive: true, force: true }) };
}
```

- [ ] **Step 2: Başarısız testleri yaz**

`apps/office-server/test/roster.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '../src/errors.ts';
import { Roster, slugify } from '../src/roster.ts';
import { setup } from './helpers.ts';

describe('slugify', () => {
  it('turns Turkish names into ASCII slugs', () => {
    expect(slugify('Ayşe Çınar')).toBe('ayse-cinar');
    expect(slugify('İLKER Işık')).toBe('ilker-isik');
    expect(slugify('Ada  Lovelace!')).toBe('ada-lovelace');
    expect(slugify('Zoë Ğüler')).toBe('zoe-guler');
  });

  it('falls back when nothing usable is left', () => {
    expect(slugify('!!!')).toBe('calisan');
    expect(slugify('   ')).toBe('calisan');
  });
});

describe('Roster', () => {
  it('creates with defaults and assigns the lowest free desk', () => {
    const { roster } = setup();
    const a = roster.create({ name: 'Ada', role: 'Yazılımcı' });
    const b = roster.create({ name: 'Can', role: 'Tasarımcı', model: 'opus', characterId: 'designer' });
    expect(a).toMatchObject({ slug: 'ada', model: 'sonnet', characterId: 'coder', deskIndex: 0, lifecycle: 'stopped', sessionStarted: false, limitResetsAt: null, lastError: null });
    expect(b).toMatchObject({ model: 'opus', characterId: 'designer', deskIndex: 1 });
    expect(a.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(roster.get(a.id)).toEqual(a);
  });

  it('validates input', () => {
    const { roster } = setup();
    expect(() => roster.create({ name: '', role: 'r' })).toThrow(ValidationError);
    expect(() => roster.create({ name: 'Ada', role: '   ' })).toThrow(ValidationError);
    expect(() => roster.create({ name: 'Ada', role: 'r', model: 'gpt' as never })).toThrow(ValidationError);
    expect(() => roster.create({ name: 42 as never, role: 'r' })).toThrow(ValidationError);
    expect(() => roster.create({ name: 'x'.repeat(61), role: 'r' })).toThrow(ValidationError);
  });

  it('refuses when every desk is taken and frees a desk on archive', () => {
    const { db } = setup();
    const roster = new Roster(db, 2);
    const a = roster.create({ name: 'Ada', role: 'r' });
    roster.create({ name: 'Can', role: 'r' });
    expect(() => roster.create({ name: 'Ece', role: 'r' })).toThrow(ConflictError);
    roster.update(a.id, { lifecycle: 'archived' });
    expect(roster.create({ name: 'Ece', role: 'r' }).deskIndex).toBe(0);
  });

  it('review focus: duplicate names get unique slugs and archived slugs are not reused', () => {
    const { roster } = setup();
    const first = roster.create({ name: 'Ayşe', role: 'r' });
    expect(roster.create({ name: 'AYŞE', role: 'r' }).slug).toBe('ayse-2');
    roster.update(first.id, { lifecycle: 'archived' });
    expect(roster.create({ name: 'Ayşe', role: 'r' }).slug).toBe('ayse-3');
  });

  it('updates and persists fields', () => {
    const { roster } = setup();
    const a = roster.create({ name: 'Ada', role: 'r' });
    const updated = roster.update(a.id, { lifecycle: 'limited', sessionStarted: true, limitResetsAt: 123, lastError: 'x' });
    expect(updated).toMatchObject({ lifecycle: 'limited', sessionStarted: true, limitResetsAt: 123, lastError: 'x' });
    expect(roster.get(a.id)).toEqual(updated);
  });

  it('throws NotFoundError for an unknown id', () => {
    const { roster } = setup();
    expect(() => roster.get('00000000-0000-0000-0000-000000000000')).toThrow(NotFoundError);
  });

  it('hides archived employees unless asked', () => {
    const { roster } = setup();
    const a = roster.create({ name: 'Ada', role: 'r' });
    roster.create({ name: 'Can', role: 'r' });
    roster.update(a.id, { lifecycle: 'archived' });
    expect(roster.list().map((e) => e.name)).toEqual(['Can']);
    expect(roster.list({ includeArchived: true }).map((e) => e.name).sort()).toEqual(['Ada', 'Can']);
  });
});
```

`apps/office-server/test/desk.test.ts`:
```ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deskDir, prepareDesk, roleCard } from '../src/desk.ts';
import { setup } from './helpers.ts';

describe('desk', () => {
  it('creates the desk folder with a role card', () => {
    const { roster, dataDir } = setup();
    const e = roster.create({ name: 'Ada', role: 'Testleri yazan yazılımcı.' });
    const dir = prepareDesk(dataDir, e);
    expect(dir).toBe(join(dataDir, 'desks', 'ada'));
    expect(dir).toBe(deskDir(dataDir, 'ada'));
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe(roleCard(e));
    expect(roleCard(e)).toContain('Testleri yazan yazılımcı.');
  });

  it('never overwrites a role card the owner edited', () => {
    const { roster, dataDir } = setup();
    const e = roster.create({ name: 'Ada', role: 'r' });
    const dir = prepareDesk(dataDir, e);
    writeFileSync(join(dir, 'CLAUDE.md'), 'elle düzenlendi');
    prepareDesk(dataDir, e);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe('elle düzenlendi');
    expect(existsSync(join(dir, '.claude'))).toBe(false);
  });
});
```

- [ ] **Step 3: Testlerin başarısız olduğunu gör**

Run: `pnpm --filter @cc/office-server test -- roster desk`
Expected: FAIL — `../src/roster.ts`, `../src/desk.ts` bulunamıyor.

- [ ] **Step 4: Roster ve desk'i yaz**

`apps/office-server/src/roster.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { MODEL_ALIASES, type Employee, type HireInput, type ModelAlias } from '@cc/shared';
import type { Db } from './db.ts';
import { ConflictError, NotFoundError, ValidationError } from './errors.ts';

const TURKISH: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };

export function slugify(name: string): string {
  const lowered = [...name.toLocaleLowerCase('tr-TR')].map((ch) => TURKISH[ch] ?? ch).join('');
  const slug = lowered
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'calisan';
}

interface Row {
  id: string;
  slug: string;
  name: string;
  role: string;
  model: string;
  character_id: string;
  desk_index: number;
  session_id: string;
  session_started: number;
  lifecycle: string;
  limit_resets_at: number | null;
  last_error: string | null;
  created_at: number;
}

function fromRow(r: Row): Employee {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    role: r.role,
    model: r.model as ModelAlias,
    characterId: r.character_id,
    deskIndex: r.desk_index,
    sessionId: r.session_id,
    sessionStarted: r.session_started === 1,
    lifecycle: r.lifecycle as Employee['lifecycle'],
    limitResetsAt: r.limit_resets_at,
    lastError: r.last_error,
    createdAt: r.created_at,
  };
}

export type EmployeePatch = Partial<Pick<Employee, 'lifecycle' | 'sessionStarted' | 'limitResetsAt' | 'lastError'>>;

export class Roster {
  readonly #db: Db;
  readonly #deskCount: number;
  readonly #now: () => number;

  constructor(db: Db, deskCount: number, now: () => number = Date.now) {
    this.#db = db;
    this.#deskCount = deskCount;
    this.#now = now;
  }

  create(input: HireInput): Employee {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const role = typeof input.role === 'string' ? input.role.trim() : '';
    if (!name) throw new ValidationError('Ad boş olamaz.');
    if (name.length > 60) throw new ValidationError('Ad en fazla 60 karakter olabilir.');
    if (!role) throw new ValidationError('Rol tanımı boş olamaz.');
    const model = input.model === undefined ? 'sonnet' : input.model;
    if (!(MODEL_ALIASES as readonly unknown[]).includes(model)) throw new ValidationError(`Bilinmeyen model: ${String(model)}`);
    const characterId = typeof input.characterId === 'string' && input.characterId.trim() ? input.characterId.trim() : 'coder';

    const used = new Set(this.list().map((e) => e.deskIndex));
    let deskIndex = -1;
    for (let i = 0; i < this.#deskCount; i += 1) {
      if (!used.has(i)) {
        deskIndex = i;
        break;
      }
    }
    if (deskIndex < 0) throw new ConflictError(`Ofis dolu: ${this.#deskCount} masanın hepsi dolu.`);

    const employee: Employee = {
      id: randomUUID(),
      slug: this.#uniqueSlug(slugify(name)),
      name,
      role,
      model: model as ModelAlias,
      characterId,
      deskIndex,
      sessionId: randomUUID(),
      sessionStarted: false,
      lifecycle: 'stopped',
      limitResetsAt: null,
      lastError: null,
      createdAt: this.#now(),
    };
    this.#db
      .prepare(
        `INSERT INTO employees (id, slug, name, role, model, character_id, desk_index, session_id, session_started,
           lifecycle, limit_resets_at, last_error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        employee.id,
        employee.slug,
        employee.name,
        employee.role,
        employee.model,
        employee.characterId,
        employee.deskIndex,
        employee.sessionId,
        0,
        employee.lifecycle,
        null,
        null,
        employee.createdAt,
      );
    return employee;
  }

  /** Slugs are unique across archived employees too, because desk folders are never deleted. */
  #uniqueSlug(base: string): string {
    let slug = base;
    for (let n = 2; this.#db.prepare('SELECT 1 FROM employees WHERE slug = ?').get(slug) !== undefined; n += 1) {
      slug = `${base}-${n}`;
    }
    return slug;
  }

  get(id: string): Employee {
    const row = this.#db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as unknown as Row | undefined;
    if (!row) throw new NotFoundError(`Çalışan bulunamadı: ${id}`);
    return fromRow(row);
  }

  list(opts: { includeArchived?: boolean } = {}): Employee[] {
    const rows = (
      opts.includeArchived
        ? this.#db.prepare('SELECT * FROM employees ORDER BY desk_index, created_at').all()
        : this.#db.prepare("SELECT * FROM employees WHERE lifecycle != 'archived' ORDER BY desk_index").all()
    ) as unknown as Row[];
    return rows.map(fromRow);
  }

  update(id: string, patch: EmployeePatch): Employee {
    const next = { ...this.get(id), ...patch };
    this.#db
      .prepare('UPDATE employees SET lifecycle = ?, session_started = ?, limit_resets_at = ?, last_error = ? WHERE id = ?')
      .run(next.lifecycle, next.sessionStarted ? 1 : 0, next.limitResetsAt, next.lastError, id);
    return next;
  }
}
```

`apps/office-server/src/desk.ts`:
```ts
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Employee } from '@cc/shared';

export function deskDir(dataDir: string, slug: string): string {
  return join(dataDir, 'desks', slug);
}

export function roleCard(e: Pick<Employee, 'name' | 'role'>): string {
  return `# ${e.name}

Sen bu ofiste çalışan ${e.name} adlı bir çalışansın. Bu klasör senin masan: dosyalarını burada tutar,
işlerini burada yaparsın. Ofisin sahibi seninle ofis ekranından konuşur.

## Rolün

${e.role}
`;
}

/** Idempotent: creates the desk and its role card once; never overwrites a card the owner edited. */
export function prepareDesk(dataDir: string, e: Employee): string {
  const dir = deskDir(dataDir, e.slug);
  mkdirSync(dir, { recursive: true });
  const card = join(dir, 'CLAUDE.md');
  if (!existsSync(card)) writeFileSync(card, roleCard(e));
  return dir;
}
```

- [ ] **Step 5: Testlerin geçtiğini gör**

Run: `pnpm --filter @cc/office-server test -- roster desk event-store && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/office-server/src/roster.ts apps/office-server/src/desk.ts apps/office-server/test
git commit -m "feat(server): add roster with Turkish-safe slugs and desks"
```

---

### Task 4: Claude bayrakları ve stream-json çevirici

**Files:**
- Create: `apps/office-server/src/claude/args.ts`, `apps/office-server/src/claude/normalize.ts`
- Test: `apps/office-server/test/args.test.ts`, `apps/office-server/test/normalize.test.ts`

**Interfaces:**
- Consumes: `ModelAlias`, `OfficeEvent`, `QuotaWindow`, `Usage` (`@cc/shared`).
- Produces: `employeeSettings(home?: string)`; `sessionArgs(o: { model: ModelAlias; sessionId: string; resume: boolean; home?: string }): string[]`; `sideQuestionArgs(o: { model: ModelAlias; sessionId: string; home?: string }): string[]`; `terminalCommand(deskPath: string, sessionId: string): string`; `normalize(raw: unknown): OfficeEvent[]`; `usageOf(raw: unknown): Usage`; `truncate(text: string, limit?: number): string`; `TOOL_OUTPUT_LIMIT = 4000`.

- [ ] **Step 1: Başarısız testleri yaz**

`apps/office-server/test/args.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { employeeSettings, sessionArgs, sideQuestionArgs, terminalCommand } from '../src/claude/args.ts';

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

describe('claude args', () => {
  it('starts a new session in stream-json with the employee settings', () => {
    const args = sessionArgs({ model: 'haiku', sessionId: 'sid-1', resume: false, home: '/home/test' });
    expect(args.slice(0, 6)).toEqual(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']);
    expect(flag(args, '--model')).toBe('haiku');
    expect(flag(args, '--permission-mode')).toBe('bypassPermissions');
    expect(flag(args, '--setting-sources')).toBe('user,project,local');
    expect(flag(args, '--session-id')).toBe('sid-1');
    expect(args).not.toContain('--resume');
    expect(JSON.parse(flag(args, '--settings') ?? '')).toEqual(employeeSettings('/home/test'));
  });

  it('employee settings disable superpowers, the personal CLAUDE.md and Claude attribution', () => {
    expect(employeeSettings('/home/test')).toEqual({
      enabledPlugins: { 'superpowers@claude-plugins-official': false },
      claudeMdExcludes: ['/home/test/.claude/CLAUDE.md'],
      attribution: { commit: '', pr: '' },
    });
  });

  it('resumes an existing session', () => {
    const args = sessionArgs({ model: 'sonnet', sessionId: 'sid-2', resume: true, home: '/home/test' });
    expect(flag(args, '--resume')).toBe('sid-2');
    expect(args).not.toContain('--session-id');
  });

  it('asks side questions on a tool-less fork with JSON output', () => {
    const args = sideQuestionArgs({ model: 'haiku', sessionId: 'sid-3', home: '/home/test' });
    expect(flag(args, '--output-format')).toBe('json');
    expect(flag(args, '--resume')).toBe('sid-3');
    expect(args).toContain('--fork-session');
    expect(args).toContain('--strict-mcp-config');
    expect(args.slice(-2)).toEqual(['--tools', '']);
    expect(args).not.toContain('--input-format');
  });

  it('builds a shell-safe terminal command', () => {
    expect(terminalCommand("/tmp/o'k/desks/ada", 'sid-4')).toBe(`cd '/tmp/o'\\''k/desks/ada' && claude --resume sid-4`);
  });
});
```

`apps/office-server/test/normalize.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { TOOL_OUTPUT_LIMIT, normalize, truncate } from '../src/claude/normalize.ts';

// Shapes copied from a real `claude -p --output-format stream-json --verbose` run (2026-10-06), trimmed.
const INIT = {
  type: 'system',
  subtype: 'init',
  session_id: 's1',
  model: 'claude-haiku-4-5-20251001',
  cwd: '/d',
  permissionMode: 'bypassPermissions',
  mcp_servers: [
    { name: 'office', status: 'connected', source: 'dynamic' },
    { name: 'claude.ai Gmail', status: 'needs-auth' },
  ],
  tools: [],
};
const assistant = (content: unknown[]) => ({
  type: 'assistant',
  session_id: 's1',
  parent_tool_use_id: null,
  message: { id: 'msg_1', role: 'assistant', content },
});
const TOOL_USE = assistant([{ type: 'tool_use', id: 'toolu_01Q', name: 'Bash', input: { command: 'sleep 4', description: 'Sleep for 4 seconds' } }]);
const toolResult = (content: unknown, isError = false) => ({
  type: 'user',
  session_id: 's1',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01Q', is_error: isError, content }] },
  tool_use_result: { stdout: '', stderr: '' },
});
const RATE = {
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'allowed',
    resetsAt: 1791290400,
    rateLimitType: 'five_hour',
    overageStatus: 'rejected',
    isUsingOverage: false,
    unifiedWindows: { five_hour: { utilization: 0.01, resetsAt: 1791290400 }, seven_day: { utilization: 0, resetsAt: 1791878400 } },
  },
  session_id: 's1',
};
const RESULT = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  num_turns: 4,
  total_cost_usd: 0.0216893,
  usage: { input_tokens: 18, cache_creation_input_tokens: 8115, cache_read_input_tokens: 35213, output_tokens: 384 },
  result: '7 × 6 = 42.',
  session_id: 's1',
};

describe('normalize', () => {
  it('maps init to session.started with the MCP connection states', () => {
    expect(normalize(INIT)).toEqual([
      {
        type: 'session.started',
        model: 'claude-haiku-4-5-20251001',
        mcp: [
          { name: 'office', status: 'connected' },
          { name: 'claude.ai Gmail', status: 'needs-auth' },
        ],
      },
    ]);
  });

  it('maps tool_use, text and drops thinking blocks', () => {
    expect(normalize(TOOL_USE)).toEqual([
      { type: 'tool.started', toolUseId: 'toolu_01Q', name: 'Bash', input: { command: 'sleep 4', description: 'Sleep for 4 seconds' } },
    ]);
    expect(normalize(assistant([{ type: 'text', text: 'WORK-DONE' }]))).toEqual([{ type: 'message.assistant', text: 'WORK-DONE' }]);
    expect(normalize(assistant([{ type: 'thinking', thinking: '...' }]))).toEqual([]);
  });

  it('maps tool results given as a string or as text blocks', () => {
    expect(normalize(toolResult('(Bash completed with no output)'))).toEqual([
      { type: 'tool.finished', toolUseId: 'toolu_01Q', isError: false, output: '(Bash completed with no output)' },
    ]);
    expect(normalize(toolResult([{ type: 'text', text: 'line1' }, { type: 'text', text: 'line2' }], true))).toEqual([
      { type: 'tool.finished', toolUseId: 'toolu_01Q', isError: true, output: 'line1\nline2' },
    ]);
  });

  it('review focus: truncates huge tool output', () => {
    const [event] = normalize(toolResult('x'.repeat(10_000)));
    expect(event?.type).toBe('tool.finished');
    const output = (event as { output: string }).output;
    expect(output.startsWith('x'.repeat(TOOL_OUTPUT_LIMIT))).toBe(true);
    expect(output).toContain('(6000 karakter kısaltıldı)');
    expect(truncate('kısa')).toBe('kısa');
  });

  it('maps rate_limit_event windows to milliseconds', () => {
    expect(normalize(RATE)).toEqual([
      {
        type: 'quota.updated',
        status: 'allowed',
        fiveHour: { utilization: 0.01, resetsAt: 1791290400000 },
        sevenDay: { utilization: 0, resetsAt: 1791878400000 },
      },
    ]);
  });

  it('falls back to resetsAt when unifiedWindows is missing', () => {
    const raw = { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 100, rateLimitType: 'seven_day' } };
    expect(normalize(raw)).toEqual([{ type: 'quota.updated', status: 'rejected', fiveHour: null, sevenDay: { utilization: 1, resetsAt: 100_000 } }]);
  });

  it('maps result to turn.finished, including an interrupted turn', () => {
    expect(normalize(RESULT)).toEqual([
      {
        type: 'turn.finished',
        ok: true,
        subtype: 'success',
        usage: { inputTokens: 18, outputTokens: 384, cacheReadTokens: 35213, cacheCreationTokens: 8115 },
        costUsd: 0.0216893,
        numTurns: 4,
      },
    ]);
    const interrupted = { type: 'result', subtype: 'error_during_execution', is_error: true, num_turns: 1, result: null };
    expect(normalize(interrupted)).toEqual([
      {
        type: 'turn.finished',
        ok: false,
        subtype: 'error_during_execution',
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
        costUsd: 0,
        numTurns: 1,
      },
    ]);
  });

  it('ignores everything else', () => {
    expect(normalize({ type: 'control_response', response: { subtype: 'success' } })).toEqual([]);
    expect(normalize({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 50 })).toEqual([]);
    expect(normalize({ type: 'user', message: { role: 'user', content: 'düz metin' } })).toEqual([]);
    expect(normalize(null)).toEqual([]);
    expect(normalize('metin')).toEqual([]);
    expect(normalize([1, 2])).toEqual([]);
  });
});
```

- [ ] **Step 2: Testlerin başarısız olduğunu gör**

Run: `pnpm --filter @cc/office-server test -- args normalize`
Expected: FAIL — modüller bulunamıyor.

- [ ] **Step 3: args ve normalize'ı yaz**

`apps/office-server/src/claude/args.ts`:
```ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ModelAlias } from '@cc/shared';

/** Keeps every connection the owner has, but not superpowers, the personal CLAUDE.md or Claude attribution. */
export function employeeSettings(home: string = homedir()) {
  return {
    enabledPlugins: { 'superpowers@claude-plugins-official': false },
    claudeMdExcludes: [join(home, '.claude', 'CLAUDE.md')],
    attribution: { commit: '', pr: '' },
  };
}

function settingsArgs(home: string | undefined): string[] {
  return ['--setting-sources', 'user,project,local', '--settings', JSON.stringify(employeeSettings(home ?? homedir()))];
}

export function sessionArgs(o: { model: ModelAlias; sessionId: string; resume: boolean; home?: string }): string[] {
  return [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    o.model,
    '--permission-mode',
    'bypassPermissions',
    ...settingsArgs(o.home),
    ...(o.resume ? ['--resume', o.sessionId] : ['--session-id', o.sessionId]),
  ];
}

/** The question goes on stdin; `--tools` is last because it swallows following arguments. */
export function sideQuestionArgs(o: { model: ModelAlias; sessionId: string; home?: string }): string[] {
  return [
    '-p',
    '--output-format',
    'json',
    '--model',
    o.model,
    '--resume',
    o.sessionId,
    '--fork-session',
    ...settingsArgs(o.home),
    '--strict-mcp-config',
    '--tools',
    '',
  ];
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function terminalCommand(deskPath: string, sessionId: string): string {
  return `cd ${shellQuote(deskPath)} && claude --resume ${sessionId}`;
}
```

`apps/office-server/src/claude/normalize.ts`:
```ts
import type { OfficeEvent, QuotaWindow, Usage } from '@cc/shared';

export const TOOL_OUTPUT_LIMIT = 4000;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function usageOf(raw: unknown): Usage {
  const u = isObj(raw) ? raw : {};
  return {
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheReadTokens: num(u.cache_read_input_tokens),
    cacheCreationTokens: num(u.cache_creation_input_tokens),
  };
}

export function truncate(text: string, limit = TOOL_OUTPUT_LIMIT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n… (${text.length - limit} karakter kısaltıldı)`;
}

function windowOf(raw: unknown): QuotaWindow | null {
  if (!isObj(raw) || typeof raw.resetsAt !== 'number') return null;
  return { utilization: num(raw.utilization), resetsAt: raw.resetsAt * 1000 };
}

function blocks(message: unknown): Obj[] {
  if (!isObj(message) || !Array.isArray(message.content)) return [];
  return message.content.filter(isObj);
}

function toolOutput(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(isObj)
    .map((b) => str(b.text))
    .filter(Boolean)
    .join('\n');
}

export function normalize(raw: unknown): OfficeEvent[] {
  if (!isObj(raw)) return [];
  switch (raw.type) {
    case 'system': {
      if (raw.subtype !== 'init') return [];
      const servers = Array.isArray(raw.mcp_servers) ? raw.mcp_servers.filter(isObj) : [];
      return [{ type: 'session.started', model: str(raw.model), mcp: servers.map((m) => ({ name: str(m.name), status: str(m.status) })) }];
    }
    case 'assistant':
      return blocks(raw.message).flatMap((b): OfficeEvent[] => {
        if (b.type === 'text' && str(b.text)) return [{ type: 'message.assistant', text: str(b.text) }];
        if (b.type === 'tool_use') return [{ type: 'tool.started', toolUseId: str(b.id), name: str(b.name), input: b.input ?? null }];
        return [];
      });
    case 'user':
      return blocks(raw.message).flatMap((b): OfficeEvent[] =>
        b.type === 'tool_result'
          ? [{ type: 'tool.finished', toolUseId: str(b.tool_use_id), isError: b.is_error === true, output: truncate(toolOutput(b.content)) }]
          : [],
      );
    case 'result':
      return [
        {
          type: 'turn.finished',
          ok: raw.subtype === 'success' && raw.is_error !== true,
          subtype: str(raw.subtype),
          usage: usageOf(raw.usage),
          costUsd: num(raw.total_cost_usd),
          numTurns: num(raw.num_turns),
        },
      ];
    case 'rate_limit_event': {
      const info = isObj(raw.rate_limit_info) ? raw.rate_limit_info : {};
      const windows = isObj(info.unifiedWindows) ? info.unifiedWindows : {};
      let fiveHour = windowOf(windows.five_hour);
      let sevenDay = windowOf(windows.seven_day);
      if (!fiveHour && !sevenDay && typeof info.resetsAt === 'number') {
        const fallback = { utilization: info.status === 'rejected' ? 1 : num(info.utilization), resetsAt: info.resetsAt * 1000 };
        if (info.rateLimitType === 'seven_day') sevenDay = fallback;
        else fiveHour = fallback;
      }
      return [{ type: 'quota.updated', status: str(info.status), fiveHour, sevenDay }];
    }
    default:
      return [];
  }
}
```

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `pnpm --filter @cc/office-server test -- args normalize && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/office-server/src/claude apps/office-server/test/args.test.ts apps/office-server/test/normalize.test.ts
git commit -m "feat(server): add claude flags and stream-json normalizer"
```

---

### Task 5: Sahte claude ve süreç sarmalayıcıları

**Files:**
- Create: `apps/office-server/test/fake-claude.mjs`
- Create: `apps/office-server/src/claude/process.ts`, `apps/office-server/src/claude/once.ts`
- Test: `apps/office-server/test/process.test.ts`

**Interfaces:**
- Consumes: `usageOf` (Task 4), `tempDir`, `until` (Task 2).
- Produces: `class ClaudeProcess { constructor(opts: { command: string[]; args: string[]; cwd: string; env?: NodeJS.ProcessEnv }, handlers: { onJson(obj: unknown): void; onExit(code: number | null, signal: NodeJS.Signals | null, stderrTail: string): void }); readonly exited: boolean; readonly stderrTail: string; sendUser(text: string): void; interrupt(): void; close(graceMs?: number): Promise<void> }`; `runOnce(o: { command: string[]; args: string[]; cwd: string; env?: NodeJS.ProcessEnv; input: string; timeoutMs: number }): Promise<{ ok: boolean; text: string; usage: Usage; costUsd: number }>`; test sabiti `FAKE_CLAUDE` (helpers.ts'e eklenir).

Sahte claude'un davranışı (testler buna dayanır):

| Girdi | Çıktı |
|---|---|
| ilk kullanıcı mesajı | önce `system/init` |
| metin `SLOW` içerir | `tool_use` → ~1 sn bekler → `tool_result` → `slow-done[ saw:<arada gelen mesajlar>]` → sonuç; bu arada `interrupt` gelirse hemen `error_during_execution` sonucu |
| metin `LIMIT` içerir | `rate_limit_event` `rejected` (sıfırlanma `FAKE_CLAUDE_LIMIT_RESET_SEC`, varsayılan 2 sn) → `error_during_execution` sonucu |
| metin `CRASH` içerir | stderr'e `boom: fake crash` yazar, kod 3 ile çıkar |
| metin `WHAT DID I SAY` içerir | `you said: <bir önceki mesaj>` (oturum geçmişi `FAKE_CLAUDE_STATE/<sessionId>.json`'da, `--resume` ile korunur) |
| diğer | `echo: <metin>` + `rate_limit_event allowed` + başarılı sonuç |
| `--output-format json` | stdin'deki soruyu okur, tek satır `{"result":"side:<soru>|history:<n>"}` basar |
| `FAKE_CLAUDE_NOISE=1` | başta JSON olmayan iki satır basar |
| her başlatma | `FAKE_CLAUDE_ARGV_LOG` dosyasına `{"args":[…],"cwd":"…"}` satırı ekler |

- [ ] **Step 1: Sahte claude'u yaz**

`apps/office-server/test/fake-claude.mjs`:
```js
#!/usr/bin/env node
// Test double for the `claude` CLI: speaks the subset of stream-json that office-server relies on.
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const stateDir = process.env.FAKE_CLAUDE_STATE ?? join(process.cwd(), '.fake-claude');
mkdirSync(stateDir, { recursive: true });
if (process.env.FAKE_CLAUDE_ARGV_LOG) appendFileSync(process.env.FAKE_CLAUDE_ARGV_LOG, `${JSON.stringify({ args, cwd: process.cwd() })}\n`);

const sessionId = opt('--resume') ?? opt('--session-id') ?? randomUUID();
const historyFile = join(stateDir, `${sessionId}.json`);
const history = existsSync(historyFile) ? JSON.parse(readFileSync(historyFile, 'utf8')) : [];
const remember = (text) => {
  history.push(text);
  writeFileSync(historyFile, JSON.stringify(history));
};
const out = (obj) => process.stdout.write(`${JSON.stringify({ ...obj, session_id: sessionId })}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 };
const result = (extra = {}) =>
  out({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, total_cost_usd: 0.01, usage, result: '', ...extra });
const rateLimit = (status, resetsInSec) => {
  const resetsAt = Math.floor(Date.now() / 1000) + resetsInSec;
  out({
    type: 'rate_limit_event',
    rate_limit_info: {
      status,
      resetsAt,
      rateLimitType: 'five_hour',
      unifiedWindows: {
        five_hour: { utilization: status === 'rejected' ? 1 : 0.25, resetsAt },
        seven_day: { utilization: 0.1, resetsAt: resetsAt + 86_400 },
      },
    },
  });
};
const say = (text) => out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });

if (opt('--output-format') === 'json') {
  let prompt = '';
  for await (const chunk of process.stdin) prompt += chunk;
  process.stdout.write(
    `${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: `side:${prompt.trim()}|history:${history.length}`, usage, total_cost_usd: 0.002, session_id: randomUUID() })}\n`,
  );
  process.exit(0);
}

if (process.env.FAKE_CLAUDE_NOISE) process.stdout.write('Warning: something odd\n{not json\n');

let initSent = false;
let busy = null;

async function turn(text) {
  if (!initSent) {
    out({ type: 'system', subtype: 'init', model: 'fake-model', cwd: process.cwd(), permissionMode: 'bypassPermissions', mcp_servers: [{ name: 'office', status: 'connected' }] });
    initSent = true;
  }
  remember(text);
  if (text.includes('CRASH')) {
    process.stderr.write('boom: fake crash\n');
    process.exit(3);
  }
  if (text.includes('LIMIT')) {
    rateLimit('rejected', Number(process.env.FAKE_CLAUDE_LIMIT_RESET_SEC ?? '2'));
    result({ subtype: 'error_during_execution', is_error: true, result: 'usage limit reached' });
    return;
  }
  if (text.includes('SLOW')) {
    busy = { interrupted: false, injected: [] };
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_fake1', name: 'Bash', input: { command: 'sleep 1' } }] } });
    for (let i = 0; i < 20 && !busy.interrupted; i += 1) await sleep(50);
    const { interrupted, injected } = busy;
    busy = null;
    if (interrupted) {
      result({ subtype: 'error_during_execution', is_error: true, result: null });
      return;
    }
    out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_fake1', is_error: false, content: 'done' }] } });
    say(`slow-done${injected.length ? ` saw:${injected.join(',')}` : ''}`);
    rateLimit('allowed', 3600);
    result({ num_turns: 2, result: 'slow-done' });
    return;
  }
  if (text.includes('WHAT DID I SAY')) {
    say(`you said: ${history[history.length - 2] ?? 'nothing'}`);
    result();
    return;
  }
  say(`echo: ${text}`);
  rateLimit('allowed', 3600);
  result({ result: `echo: ${text}` });
}

let chain = Promise.resolve();
createInterface({ input: process.stdin })
  .on('line', (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.type === 'control_request' && msg.request?.subtype === 'interrupt') {
      out({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response: {} } });
      if (busy) busy.interrupted = true;
      return;
    }
    if (msg.type !== 'user') return;
    const text = typeof msg.message?.content === 'string' ? msg.message.content : '';
    if (busy) {
      busy.injected.push(text);
      remember(text);
      return;
    }
    chain = chain.then(() => turn(text));
  })
  .on('close', () => {
    chain.then(() => process.exit(0));
  });
```

`apps/office-server/test/helpers.ts` dosyasına ekle (importların altına):
```ts
import { fileURLToPath } from 'node:url';

export const FAKE_CLAUDE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
```

- [ ] **Step 2: Başarısız testi yaz**

`apps/office-server/test/process.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { runOnce } from '../src/claude/once.ts';
import { ClaudeProcess } from '../src/claude/process.ts';
import { FAKE_CLAUDE, tempDir, until } from './helpers.ts';

type Line = { type?: string; subtype?: string };

function spawnFake(extraEnv: Record<string, string> = {}) {
  const lines: Line[] = [];
  const exits: Array<{ code: number | null; signal: string | null; stderr: string }> = [];
  const proc = new ClaudeProcess(
    { command: [process.execPath, FAKE_CLAUDE], args: ['--session-id', crypto.randomUUID()], cwd: tempDir(), env: { ...process.env, FAKE_CLAUDE_STATE: tempDir(), ...extraEnv } },
    { onJson: (o) => lines.push(o as Line), onExit: (code, signal, stderr) => exits.push({ code, signal, stderr }) },
  );
  return { proc, lines, exits };
}

describe('ClaudeProcess', () => {
  it('sends a user message and emits parsed JSON lines, then closes cleanly', async () => {
    const { proc, lines, exits } = spawnFake();
    proc.sendUser('merhaba');
    await until(() => lines.some((l) => l.type === 'result'));
    expect(lines.map((l) => l.type)).toEqual(['system', 'assistant', 'rate_limit_event', 'result']);
    await proc.close();
    expect(proc.exited).toBe(true);
    expect(exits).toEqual([{ code: 0, signal: null, stderr: '' }]);
    expect(() => proc.sendUser('x')).toThrow(/kapalı/);
  });

  it('interrupt ends a running turn and the process stays usable', async () => {
    const { proc, lines } = spawnFake();
    proc.sendUser('SLOW job');
    await until(() => lines.some((l) => l.type === 'assistant'));
    proc.interrupt();
    await until(() => lines.some((l) => l.type === 'result'));
    expect(lines.find((l) => l.type === 'result')).toMatchObject({ subtype: 'error_during_execution' });
    expect(lines.some((l) => l.type === 'control_response')).toBe(true);
    proc.sendUser('sonra');
    await until(() => lines.filter((l) => l.type === 'result').length === 2);
    await proc.close();
  });

  it('review focus: ignores non-JSON stdout lines', async () => {
    const { proc, lines } = spawnFake({ FAKE_CLAUDE_NOISE: '1' });
    proc.sendUser('merhaba');
    await until(() => lines.some((l) => l.type === 'result'));
    expect(lines[0]?.type).toBe('system');
    await proc.close();
  });

  it('reports an unexpected exit with the stderr tail', async () => {
    const { proc, exits } = spawnFake();
    proc.sendUser('CRASH');
    await until(() => exits.length === 1);
    expect(exits[0]).toMatchObject({ code: 3 });
    expect(exits[0]?.stderr).toContain('boom: fake crash');
    expect(proc.exited).toBe(true);
  });

  it('reports a missing binary as an exit instead of throwing', async () => {
    const exits: string[] = [];
    const proc = new ClaudeProcess(
      { command: ['/nonexistent/claude-binary'], args: [], cwd: tempDir() },
      { onJson: () => {}, onExit: (_c, _s, stderr) => exits.push(stderr) },
    );
    await until(() => exits.length === 1);
    expect(exits[0]).toContain('ENOENT');
    expect(proc.exited).toBe(true);
  });
});

describe('runOnce', () => {
  it('feeds the input on stdin and parses the JSON result', async () => {
    const r = await runOnce({ command: [process.execPath, FAKE_CLAUDE], args: ['--output-format', 'json'], cwd: tempDir(), env: { ...process.env, FAKE_CLAUDE_STATE: tempDir() }, input: 'ne yapıyorsun?', timeoutMs: 5000 });
    expect(r).toEqual({ ok: true, text: 'side:ne yapıyorsun?|history:0', usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 100, cacheCreationTokens: 50 }, costUsd: 0.002 });
  });

  it('reports failure when the command cannot run', async () => {
    const r = await runOnce({ command: ['/nonexistent/claude-binary'], args: [], cwd: tempDir(), input: 'x', timeoutMs: 5000 });
    expect(r.ok).toBe(false);
    expect(r.text).toContain('ENOENT');
  });
});
```

- [ ] **Step 3: Testin başarısız olduğunu gör**

Run: `pnpm --filter @cc/office-server test -- process`
Expected: FAIL — `../src/claude/process.ts` bulunamıyor.

- [ ] **Step 4: process ve once'ı yaz**

`apps/office-server/src/claude/process.ts`:
```ts
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface ProcessOptions {
  command: string[];
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

export interface ProcessHandlers {
  onJson: (obj: unknown) => void;
  onExit: (code: number | null, signal: NodeJS.Signals | null, stderrTail: string) => void;
}

const STDERR_TAIL = 4000;

/** One long-lived `claude -p --input-format stream-json` process. */
export class ClaudeProcess {
  readonly #child: ChildProcessWithoutNullStreams;
  #stderr = '';
  #exited = false;
  #requests = 0;

  constructor(opts: ProcessOptions, handlers: ProcessHandlers) {
    const [command, ...prefix] = opts.command;
    if (!command) throw new Error('claude komutu boş');
    this.#child = spawn(command, [...prefix, ...opts.args], { cwd: opts.cwd, env: opts.env ?? process.env });
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (this.#exited) return;
      this.#exited = true;
      handlers.onExit(code, signal, this.#stderr);
    };
    createInterface({ input: this.#child.stdout }).on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return;
      }
      handlers.onJson(parsed);
    });
    this.#child.stderr.on('data', (chunk: Buffer) => {
      this.#stderr = (this.#stderr + chunk.toString('utf8')).slice(-STDERR_TAIL);
    });
    this.#child.stdin.on('error', () => {
      // EPIPE after the process is gone; the exit itself is reported through 'close'.
    });
    this.#child.on('error', (err) => {
      this.#stderr = `${this.#stderr}\n${err.message}`.slice(-STDERR_TAIL);
      if (this.#child.pid === undefined) finish(null, null);
    });
    this.#child.on('close', (code, signal) => finish(code, signal));
  }

  get exited(): boolean {
    return this.#exited;
  }

  get stderrTail(): string {
    return this.#stderr;
  }

  sendUser(text: string): void {
    this.#write({ type: 'user', message: { role: 'user', content: text } });
  }

  interrupt(): void {
    this.#requests += 1;
    this.#write({ type: 'control_request', request_id: `interrupt-${this.#requests}`, request: { subtype: 'interrupt' } });
  }

  /** Ends stdin so claude exits after the current turn; SIGTERM after `graceMs`. */
  close(graceMs = 5000): Promise<void> {
    if (this.#exited) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.#child.kill('SIGTERM'), graceMs);
      this.#child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      this.#child.stdin.end();
    });
  }

  #write(message: unknown): void {
    if (this.#exited || !this.#child.stdin.writable) throw new Error('claude süreci kapalı');
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }
}
```

`apps/office-server/src/claude/once.ts`:
```ts
import { spawn } from 'node:child_process';
import type { Usage } from '@cc/shared';
import { usageOf } from './normalize.ts';

export interface OnceResult {
  ok: boolean;
  text: string;
  usage: Usage;
  costUsd: number;
}

export interface OnceOptions {
  command: string[];
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  input: string;
  timeoutMs: number;
}

/** Runs `claude -p --output-format json` once with `input` on stdin. Never rejects. */
export function runOnce(o: OnceOptions): Promise<OnceResult> {
  const fail = (text: string): OnceResult => ({ ok: false, text, usage: usageOf(undefined), costUsd: 0 });
  const [command, ...prefix] = o.command;
  if (!command) return Promise.resolve(fail('claude komutu boş'));
  return new Promise((resolve) => {
    const child = spawn(command, [...prefix, ...o.args], { cwd: o.cwd, env: o.env ?? process.env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), o.timeoutMs);
    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString('utf8');
    });
    child.stderr.on('data', (c: Buffer) => {
      stderr = (stderr + c.toString('utf8')).slice(-2000);
    });
    child.stdin.on('error', () => {});
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve(fail(err.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const line = stdout
        .trim()
        .split('\n')
        .reverse()
        .find((l) => l.trim().startsWith('{'));
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = line ? (JSON.parse(line) as Record<string, unknown>) : null;
      } catch {
        parsed = null;
      }
      if (!parsed) {
        resolve(fail(stderr.trim() || `claude ${code ?? '-'} koduyla çıktı`));
        return;
      }
      resolve({
        ok: code === 0 && parsed.is_error !== true,
        text: typeof parsed.result === 'string' ? parsed.result : '',
        usage: usageOf(parsed.usage),
        costUsd: typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : 0,
      });
    });
    child.stdin.end(o.input);
  });
}
```

- [ ] **Step 5: Testin geçtiğini gör**

Run: `pnpm --filter @cc/office-server test -- process && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/office-server/src/claude/process.ts apps/office-server/src/claude/once.ts apps/office-server/test
git commit -m "feat(server): add claude process wrappers and a fake claude for tests"
```

---

### Task 6: Motor — işe alma, mesaj, durdur, devam, terminal, çıkarma

**Files:**
- Create: `apps/office-server/src/engine.ts`
- Create: `apps/office-server/test/engine-helpers.ts`
- Test: `apps/office-server/test/engine.test.ts`

**Interfaces:**
- Consumes: `Roster` (Task 3), `EventStore` (Task 2), `prepareDesk`, `deskDir` (Task 3), `sessionArgs`, `sideQuestionArgs`, `terminalCommand`, `normalize` (Task 4), `ClaudeProcess`, `runOnce` (Task 5), hata sınıfları (Task 1).
- Produces: `interface EngineOptions { roster; events; dataDir; claudeCommand: string[]; env?; home?; now?; crashWindowMs?; limitGraceMs?; stopTimeoutMs?; sideQuestionTimeoutMs? }`; `class Engine { hire(input: HireInput): Employee; send(id: string, text: string, source?: 'owner' | 'system'): void; sideQuestion(id: string, text: string): Promise<{ ok: boolean; answer: string }>; stop(id: string): Promise<Employee>; resume(id: string): Employee; openInTerminal(id: string): Promise<{ command: string; employee: Employee }>; returnFromTerminal(id: string): Employee; fire(id: string): Promise<void>; recover(): void; shutdown(): Promise<void> }`; sabitler `CONTINUE_AFTER_LIMIT`, `CONTINUE_AFTER_RESTART`, `CONTINUE_AFTER_CRASH`; test yardımcıları `fakeEngine(s, opts?)`, `readArgv(file, atLeast, timeoutMs?)`.

Bu görev motorun tamamını yazar; dayanıklılık davranışlarının (çökme, limit, kurtarma, yan soru) testleri Task 7'dedir.

- [ ] **Step 1: Motor test yardımcılarını yaz**

`apps/office-server/test/engine-helpers.ts`:
```ts
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Engine, type EngineOptions } from '../src/engine.ts';
import { FAKE_CLAUDE, tempDir, until, type TestSetup } from './helpers.ts';

export interface FakeEngine {
  engine: Engine;
  argvLog: string;
  state: string;
  cleanup: () => Promise<void>;
}

export function fakeEngine(s: TestSetup, opts: { env?: Record<string, string>; engine?: Partial<EngineOptions> } = {}): FakeEngine {
  const state = tempDir('fake-claude-');
  const argvLog = join(state, 'argv.jsonl');
  const engine = new Engine({
    roster: s.roster,
    events: s.events,
    dataDir: s.dataDir,
    claudeCommand: [process.execPath, FAKE_CLAUDE],
    env: { ...process.env, FAKE_CLAUDE_STATE: state, FAKE_CLAUDE_ARGV_LOG: argvLog, ...opts.env },
    home: '/home/test',
    ...opts.engine,
  });
  return {
    engine,
    argvLog,
    state,
    cleanup: async () => {
      await engine.shutdown();
      rmSync(state, { recursive: true, force: true });
    },
  };
}

export interface ArgvEntry {
  args: string[];
  cwd: string;
}

export async function readArgv(file: string, atLeast: number, timeoutMs = 5000): Promise<ArgvEntry[]> {
  const read = (): ArgvEntry[] =>
    existsSync(file)
      ? readFileSync(file, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l) as ArgvEntry)
      : [];
  await until(() => read().length >= atLeast, timeoutMs);
  return read();
}
```

- [ ] **Step 2: Başarısız testi yaz**

`apps/office-server/test/engine.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConflictError } from '../src/errors.ts';
import { fakeEngine, readArgv } from './engine-helpers.ts';
import { setup, waitFor } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make() {
  const s = setup();
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  return { ...s, ...f };
}

describe('Engine — core', () => {
  it('hire creates the desk, starts a session and is idle', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'Yazılımcı', model: 'haiku' });
    expect(t.roster.get(e.id).lifecycle).toBe('idle');
    expect(readFileSync(join(t.dataDir, 'desks', 'ada', 'CLAUDE.md'), 'utf8')).toContain('Yazılımcı');
    const [first] = await readArgv(t.argvLog, 1);
    expect(first?.cwd).toBe(join(t.dataDir, 'desks', 'ada'));
    expect(first?.args).toEqual(expect.arrayContaining(['--session-id', e.sessionId, '--model', 'haiku', '--permission-mode', 'bypassPermissions']));
    expect(t.events.list().map((x) => x.event.type)).toContain('employee.hired');
  });

  it('delivers a message, streams the reply and returns to idle', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    t.engine.send(e.id, '  merhaba  ');
    expect(t.roster.get(e.id).lifecycle).toBe('working');
    const reply = await waitFor(t.events, (x) => x.event.type === 'message.assistant');
    expect(reply.event).toEqual({ type: 'message.assistant', text: 'echo: merhaba' });
    await waitFor(t.events, (x) => x.event.type === 'turn.finished');
    expect(t.roster.get(e.id)).toMatchObject({ lifecycle: 'idle', sessionStarted: true });
    expect(t.events.list().find((x) => x.event.type === 'message.user')?.event).toEqual({ type: 'message.user', text: 'merhaba', source: 'owner' });
  });

  it('rejects an empty message', () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    expect(() => t.engine.send(e.id, '   ')).toThrow(/boş/);
  });

  it('a message sent mid-turn reaches the running turn without starting a new one', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    t.engine.send(e.id, 'SLOW job');
    await waitFor(t.events, (x) => x.event.type === 'tool.started');
    t.engine.send(e.id, 'ara soru');
    const done = await waitFor(t.events, (x) => x.event.type === 'message.assistant');
    expect(done.event).toEqual({ type: 'message.assistant', text: 'slow-done saw:ara soru' });
    expect(t.events.list().filter((x) => x.event.type === 'turn.started')).toHaveLength(1);
  });

  it('stop interrupts the running turn and leaves the employee stopped', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    t.engine.send(e.id, 'SLOW job');
    await waitFor(t.events, (x) => x.event.type === 'tool.started');
    const stopped = await t.engine.stop(e.id);
    expect(stopped.lifecycle).toBe('stopped');
    const finished = await waitFor(t.events, (x) => x.event.type === 'turn.finished');
    expect(finished.event).toMatchObject({ ok: false, subtype: 'error_during_execution' });
  });

  it('resume reopens the same session with --resume and keeps context', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    t.engine.send(e.id, 'gizli kelime PAPATYA');
    const first = await waitFor(t.events, (x) => x.event.type === 'turn.finished');
    await t.engine.stop(e.id);
    expect(t.engine.resume(e.id).lifecycle).toBe('idle');
    t.engine.send(e.id, 'WHAT DID I SAY');
    const answer = await waitFor(t.events, (x) => x.event.type === 'message.assistant', { after: first.seq });
    expect(answer.event).toEqual({ type: 'message.assistant', text: 'you said: gizli kelime PAPATYA' });
    const argvs = await readArgv(t.argvLog, 2);
    expect(argvs[1]?.args).toEqual(expect.arrayContaining(['--resume', e.sessionId]));
    expect(argvs[1]?.args).not.toContain('--session-id');
  });

  it('review focus: a message to a stopped employee restarts the session and is delivered', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    await t.engine.stop(e.id);
    t.engine.send(e.id, 'yeniden');
    const reply = await waitFor(t.events, (x) => x.event.type === 'message.assistant');
    expect(reply.event).toEqual({ type: 'message.assistant', text: 'echo: yeniden' });
    await waitFor(t.events, (x) => x.event.type === 'turn.finished');
    expect(t.roster.get(e.id).lifecycle).toBe('idle');
  });

  it('terminal hand-off refuses messages while in the terminal and gives the resume command', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    await expect(t.engine.openInTerminal(e.id)).rejects.toThrow(ConflictError);
    t.engine.send(e.id, 'merhaba');
    await waitFor(t.events, (x) => x.event.type === 'turn.finished');
    const { command, employee } = await t.engine.openInTerminal(e.id);
    expect(employee.lifecycle).toBe('in_terminal');
    expect(command).toBe(`cd '${join(t.dataDir, 'desks', 'ada')}' && claude --resume ${e.sessionId}`);
    expect(() => t.engine.send(e.id, 'x')).toThrow(ConflictError);
    expect(() => t.engine.resume(e.id)).toThrow(ConflictError);
    expect(t.engine.returnFromTerminal(e.id).lifecycle).toBe('stopped');
    expect(() => t.engine.returnFromTerminal(e.id)).toThrow(ConflictError);
  });

  it('fire archives the employee and frees the desk', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    await t.engine.fire(e.id);
    expect(t.roster.get(e.id).lifecycle).toBe('archived');
    expect(() => t.engine.send(e.id, 'x')).toThrow(ConflictError);
    expect(t.engine.hire({ name: 'Can', role: 'r' }).deskIndex).toBe(e.deskIndex);
    expect(t.events.list().map((x) => x.event.type)).toContain('employee.fired');
  });
});
```

- [ ] **Step 3: Testin başarısız olduğunu gör**

Run: `pnpm --filter @cc/office-server test -- engine`
Expected: FAIL — `../src/engine.ts` bulunamıyor.

- [ ] **Step 4: Motoru yaz**

`apps/office-server/src/engine.ts`:
```ts
import type { Employee, HireInput, Lifecycle, OfficeEvent, QuotaWindow } from '@cc/shared';
import { sessionArgs, sideQuestionArgs, terminalCommand } from './claude/args.ts';
import { normalize } from './claude/normalize.ts';
import { runOnce } from './claude/once.ts';
import { ClaudeProcess } from './claude/process.ts';
import { deskDir, prepareDesk } from './desk.ts';
import { ConflictError, ValidationError } from './errors.ts';
import type { EventStore } from './event-store.ts';
import type { Roster } from './roster.ts';

export const CONTINUE_AFTER_LIMIT = 'Limit açıldı, kaldığın yerden devam et.';
export const CONTINUE_AFTER_RESTART = 'Ofis yeniden başladı; yarım kalan işine kaldığın yerden devam et.';
export const CONTINUE_AFTER_CRASH =
  'Oturumun beklenmedik şekilde kapandı ve yeniden açıldı; yarım kalan işine kaldığın yerden devam et.';

export interface EngineOptions {
  roster: Roster;
  events: EventStore;
  dataDir: string;
  claudeCommand: string[];
  env?: NodeJS.ProcessEnv;
  home?: string;
  now?: () => number;
  crashWindowMs?: number;
  limitGraceMs?: number;
  stopTimeoutMs?: number;
  sideQuestionTimeoutMs?: number;
}

interface Runtime {
  proc: ClaudeProcess | null;
  turnActive: boolean;
  expectingExit: boolean;
  crashes: number[];
  quotaStatus: string;
  windows: { fiveHour: QuotaWindow | null; sevenDay: QuotaWindow | null };
  limitTimer: NodeJS.Timeout | null;
  turnWaiters: Array<() => void>;
}

export class Engine {
  readonly #roster: Roster;
  readonly #events: EventStore;
  readonly #dataDir: string;
  readonly #command: string[];
  readonly #env: NodeJS.ProcessEnv | undefined;
  readonly #home: string | undefined;
  readonly #now: () => number;
  readonly #crashWindowMs: number;
  readonly #limitGraceMs: number;
  readonly #stopTimeoutMs: number;
  readonly #sideQuestionTimeoutMs: number;
  readonly #runtimes = new Map<string, Runtime>();

  constructor(o: EngineOptions) {
    this.#roster = o.roster;
    this.#events = o.events;
    this.#dataDir = o.dataDir;
    this.#command = o.claudeCommand;
    this.#env = o.env;
    this.#home = o.home;
    this.#now = o.now ?? Date.now;
    this.#crashWindowMs = o.crashWindowMs ?? 120_000;
    this.#limitGraceMs = o.limitGraceMs ?? 30_000;
    this.#stopTimeoutMs = o.stopTimeoutMs ?? 10_000;
    this.#sideQuestionTimeoutMs = o.sideQuestionTimeoutMs ?? 120_000;
  }

  hire(input: HireInput): Employee {
    const employee = this.#roster.create(input);
    this.#emit(employee.id, { type: 'employee.hired', name: employee.name });
    return this.#start(employee, 'işe alındı');
  }

  send(id: string, text: string, source: 'owner' | 'system' = 'owner'): void {
    const message = text.trim();
    if (!message) throw new ValidationError('Mesaj boş olamaz.');
    const employee = this.#roster.get(id);
    this.#assertReachable(employee);
    const rt = this.#runtime(id);
    if (!rt.proc || rt.proc.exited) this.#start(employee, 'mesaj geldi');
    this.#clearLimitTimer(rt);
    const proc = rt.proc;
    if (!proc) throw new ConflictError('Çalışanın oturumu açılamadı.');
    proc.sendUser(message);
    this.#emit(id, { type: 'message.user', text: message, source });
    if (!rt.turnActive) {
      rt.turnActive = true;
      this.#emit(id, { type: 'turn.started' });
      this.#setLifecycle(this.#roster.get(id), 'working', source === 'owner' ? 'sahibinden mesaj' : 'sistem mesajı');
    }
  }

  async sideQuestion(id: string, text: string): Promise<{ ok: boolean; answer: string }> {
    const question = text.trim();
    if (!question) throw new ValidationError('Soru boş olamaz.');
    const employee = this.#roster.get(id);
    if (employee.lifecycle === 'archived') throw new ConflictError('Bu çalışan işten çıkarıldı.');
    if (!employee.sessionStarted) throw new ConflictError('Bu çalışan henüz hiç konuşmadı; önce normal bir mesaj gönder.');
    this.#emit(id, { type: 'side.question', text: question });
    const result = await runOnce({
      command: this.#command,
      args: sideQuestionArgs({ model: employee.model, sessionId: employee.sessionId, home: this.#home }),
      cwd: prepareDesk(this.#dataDir, employee),
      env: this.#env,
      input: question,
      timeoutMs: this.#sideQuestionTimeoutMs,
    });
    this.#emit(id, { type: 'side.answer', text: result.text, ok: result.ok, usage: result.usage, costUsd: result.costUsd });
    return { ok: result.ok, answer: result.text };
  }

  async stop(id: string): Promise<Employee> {
    const employee = this.#roster.get(id);
    this.#assertReachable(employee);
    await this.#halt(id);
    return this.#setLifecycle(this.#roster.update(id, { limitResetsAt: null }), 'stopped', 'sahibi durdurdu');
  }

  resume(id: string): Employee {
    const employee = this.#roster.get(id);
    this.#assertReachable(employee);
    const wasInterrupted = employee.lifecycle === 'interrupted';
    this.#runtime(id).crashes = [];
    this.#start(this.#roster.update(id, { lastError: null }), 'sahibi devam ettirdi');
    if (wasInterrupted) this.send(id, CONTINUE_AFTER_RESTART, 'system');
    return this.#roster.get(id);
  }

  async openInTerminal(id: string): Promise<{ command: string; employee: Employee }> {
    const employee = this.#roster.get(id);
    this.#assertReachable(employee);
    if (!employee.sessionStarted) throw new ConflictError('Bu çalışan henüz hiç konuşmadı; terminalde açılacak bir oturum yok.');
    await this.#halt(id);
    const updated = this.#setLifecycle(this.#roster.get(id), 'in_terminal', 'terminalde açıldı');
    return { command: terminalCommand(deskDir(this.#dataDir, employee.slug), employee.sessionId), employee: updated };
  }

  returnFromTerminal(id: string): Employee {
    const employee = this.#roster.get(id);
    if (employee.lifecycle !== 'in_terminal') throw new ConflictError('Bu çalışan terminalde değil.');
    return this.#setLifecycle(employee, 'stopped', 'terminalden ofise döndü');
  }

  async fire(id: string): Promise<void> {
    const employee = this.#roster.get(id);
    if (employee.lifecycle === 'archived') return;
    await this.#halt(id);
    this.#setLifecycle(this.#roster.get(id), 'archived', 'işten çıkarıldı');
    this.#emit(id, { type: 'employee.fired' });
  }

  /** Call once after the office process starts, before serving requests. */
  recover(): void {
    for (const employee of this.#roster.list()) {
      if (employee.lifecycle === 'working') this.#setLifecycle(employee, 'interrupted', 'ofis kapanırken iş sürüyordu');
      else if (employee.lifecycle === 'idle' || employee.lifecycle === 'starting') this.#start(employee, 'ofis açıldı');
      else if (employee.lifecycle === 'limited' && employee.limitResetsAt !== null) this.#scheduleLimitContinue(employee.id, employee.limitResetsAt);
    }
  }

  /** Closes every session but keeps lifecycles, so the next `recover()` can pick up where we left. */
  async shutdown(): Promise<void> {
    await Promise.all(
      [...this.#runtimes.values()].map(async (rt) => {
        this.#clearLimitTimer(rt);
        const proc = rt.proc;
        if (!proc || proc.exited) return;
        rt.expectingExit = true;
        await proc.close(2000);
        rt.proc = null;
      }),
    );
  }

  #start(employee: Employee, reason: string): Employee {
    const rt = this.#runtime(employee.id);
    if (rt.proc && !rt.proc.exited) return this.#roster.get(employee.id);
    rt.expectingExit = false;
    rt.turnActive = false;
    rt.proc = new ClaudeProcess(
      {
        command: this.#command,
        args: sessionArgs({ model: employee.model, sessionId: employee.sessionId, resume: employee.sessionStarted, home: this.#home }),
        cwd: prepareDesk(this.#dataDir, employee),
        env: this.#env,
      },
      {
        onJson: (obj) => this.#onJson(employee.id, obj),
        onExit: (code, signal, stderr) => this.#onExit(employee.id, code, signal, stderr),
      },
    );
    return this.#setLifecycle(this.#roster.get(employee.id), 'idle', reason);
  }

  #onJson(id: string, raw: unknown): void {
    const rt = this.#runtime(id);
    for (const event of normalize(raw)) {
      if (event.type === 'session.started' && !this.#roster.get(id).sessionStarted) this.#roster.update(id, { sessionStarted: true });
      if (event.type === 'quota.updated') {
        rt.quotaStatus = event.status;
        rt.windows = { fiveHour: event.fiveHour ?? rt.windows.fiveHour, sevenDay: event.sevenDay ?? rt.windows.sevenDay };
      }
      this.#emit(id, event);
      if (event.type === 'turn.finished') this.#onTurnFinished(id, event.ok);
    }
  }

  #onTurnFinished(id: string, ok: boolean): void {
    const rt = this.#runtime(id);
    rt.turnActive = false;
    for (const resolve of rt.turnWaiters.splice(0)) resolve();
    if (rt.expectingExit) return;
    const employee = this.#roster.get(id);
    if (employee.lifecycle !== 'working') return;
    if (!ok && rt.quotaStatus === 'rejected') {
      const resetsAt = this.#limitResetTime(rt);
      this.#setLifecycle(this.#roster.update(id, { limitResetsAt: resetsAt }), 'limited', 'abonelik limiti doldu');
      this.#scheduleLimitContinue(id, resetsAt);
      return;
    }
    this.#setLifecycle(employee, 'idle', ok ? 'iş bitti' : 'iş hatayla bitti');
  }

  #onExit(id: string, code: number | null, signal: NodeJS.Signals | null, stderr: string): void {
    const rt = this.#runtime(id);
    const wasTurnActive = rt.turnActive;
    rt.proc = null;
    rt.turnActive = false;
    for (const resolve of rt.turnWaiters.splice(0)) resolve();
    if (rt.expectingExit) {
      rt.expectingExit = false;
      return;
    }
    const employee = this.#roster.get(id);
    if (employee.lifecycle === 'archived' || employee.lifecycle === 'in_terminal' || employee.lifecycle === 'stopped') return;
    const now = this.#now();
    rt.crashes = rt.crashes.filter((t) => now - t < this.#crashWindowMs).concat(now);
    const tail = stderr.trim().slice(-500);
    const message = `claude süreci beklenmedik şekilde kapandı (kod ${code ?? '-'}, sinyal ${signal ?? '-'}).${tail ? ` ${tail}` : ''}`;
    this.#emit(id, { type: 'error', message });
    if (rt.crashes.length >= 2) {
      this.#setLifecycle(this.#roster.update(id, { lastError: message }), 'error', 'süreç kısa sürede tekrar kapandı');
      return;
    }
    this.#start(employee, 'çökme sonrası yeniden açıldı');
    if (wasTurnActive) this.send(id, CONTINUE_AFTER_CRASH, 'system');
  }

  async #halt(id: string): Promise<void> {
    const rt = this.#runtime(id);
    this.#clearLimitTimer(rt);
    const proc = rt.proc;
    if (!proc || proc.exited) {
      rt.proc = null;
      return;
    }
    rt.expectingExit = true;
    if (rt.turnActive) {
      const finished = new Promise<void>((resolve) => rt.turnWaiters.push(resolve));
      try {
        proc.interrupt();
      } catch {
        // The process is already going away; close() below finishes the job.
      }
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([finished, new Promise<void>((resolve) => (timer = setTimeout(resolve, this.#stopTimeoutMs)))]);
      clearTimeout(timer);
    }
    await proc.close();
    rt.proc = null;
  }

  #limitResetTime(rt: Runtime): number {
    const windows = [rt.windows.fiveHour, rt.windows.sevenDay].filter((w): w is QuotaWindow => w !== null);
    const full = windows.filter((w) => w.utilization >= 1);
    const candidates = (full.length > 0 ? full : windows.slice(0, 1)).map((w) => w.resetsAt);
    return candidates.length > 0 ? Math.max(...candidates) : this.#now() + 60 * 60_000;
  }

  #scheduleLimitContinue(id: string, resetsAt: number): void {
    const rt = this.#runtime(id);
    this.#clearLimitTimer(rt);
    const delay = Math.max(0, resetsAt - this.#now()) + this.#limitGraceMs;
    const timer = setTimeout(() => {
      rt.limitTimer = null;
      if (this.#roster.get(id).lifecycle !== 'limited') return;
      this.#roster.update(id, { limitResetsAt: null });
      try {
        this.send(id, CONTINUE_AFTER_LIMIT, 'system');
      } catch (err) {
        this.#emit(id, { type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    }, delay);
    timer.unref();
    rt.limitTimer = timer;
  }

  #clearLimitTimer(rt: Runtime): void {
    if (rt.limitTimer) clearTimeout(rt.limitTimer);
    rt.limitTimer = null;
  }

  #assertReachable(employee: Employee): void {
    if (employee.lifecycle === 'archived') throw new ConflictError('Bu çalışan işten çıkarıldı.');
    if (employee.lifecycle === 'in_terminal') throw new ConflictError('Bu çalışan şu an terminalde; önce ofise geri al.');
  }

  #setLifecycle(employee: Employee, to: Lifecycle, reason: string): Employee {
    if (employee.lifecycle === to) return employee;
    const updated = this.#roster.update(employee.id, { lifecycle: to });
    this.#emit(employee.id, { type: 'lifecycle.changed', from: employee.lifecycle, to, reason });
    return updated;
  }

  #emit(id: string, event: OfficeEvent): void {
    this.#events.append(id, event);
  }

  #runtime(id: string): Runtime {
    let rt = this.#runtimes.get(id);
    if (!rt) {
      rt = {
        proc: null,
        turnActive: false,
        expectingExit: false,
        crashes: [],
        quotaStatus: '',
        windows: { fiveHour: null, sevenDay: null },
        limitTimer: null,
        turnWaiters: [],
      };
      this.#runtimes.set(id, rt);
    }
    return rt;
  }
}
```

- [ ] **Step 5: Testin geçtiğini gör**

Run: `pnpm --filter @cc/office-server test -- engine && pnpm typecheck`
Expected: `Engine — core` testlerinin hepsi PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/office-server/src/engine.ts apps/office-server/test/engine-helpers.ts apps/office-server/test/engine.test.ts
git commit -m "feat(server): add engine for hiring, messaging, stop/resume and terminal hand-off"
```

---

### Task 7: Motor dayanıklılığı — çökme, limit, kurtarma, yan soru

**Files:**
- Test: `apps/office-server/test/engine-resilience.test.ts`
- Modify (yalnızca test başarısız olursa): `apps/office-server/src/engine.ts`

**Interfaces:**
- Consumes: `Engine`, `CONTINUE_AFTER_CRASH`, `CONTINUE_AFTER_LIMIT`, `CONTINUE_AFTER_RESTART` (Task 6), `fakeEngine`, `readArgv` (Task 6), `setup`, `waitFor` (Task 2–3).
- Produces: davranış güvencesi; yeni dışa aktarım yok.

- [ ] **Step 1: Testleri yaz**

`apps/office-server/test/engine-resilience.test.ts`:
```ts
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CONTINUE_AFTER_CRASH, CONTINUE_AFTER_LIMIT, CONTINUE_AFTER_RESTART } from '../src/engine.ts';
import { ConflictError } from '../src/errors.ts';
import { fakeEngine, readArgv } from './engine-helpers.ts';
import { setup, waitFor, type TestSetup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make(opts: Parameters<typeof fakeEngine>[1] = {}) {
  const s = setup();
  const f = fakeEngine(s, opts);
  cleanups.push(f.cleanup, s.cleanup);
  return { ...s, ...f };
}

function another(s: TestSetup) {
  const f = fakeEngine(s);
  cleanups.unshift(f.cleanup);
  return f;
}

describe('Engine — resilience', () => {
  it('restarts once after a crash mid-turn and continues the work', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    t.engine.send(e.id, 'CRASH now');
    const cont = await waitFor(t.events, (x) => x.event.type === 'message.user' && x.event.source === 'system');
    expect(cont.event).toEqual({ type: 'message.user', text: CONTINUE_AFTER_CRASH, source: 'system' });
    await waitFor(t.events, (x) => x.event.type === 'turn.finished', { after: cont.seq });
    expect(t.roster.get(e.id).lifecycle).toBe('idle');
    const error = t.events.list().find((x) => x.event.type === 'error');
    expect((error?.event as { message: string }).message).toContain('boom: fake crash');
  });

  it('goes to error when the session crashes twice within the window, and resume clears it', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    t.engine.send(e.id, 'CRASH one');
    await waitFor(t.events, (x) => x.event.type === 'message.user' && x.event.source === 'system');
    t.engine.send(e.id, 'CRASH two');
    await waitFor(t.events, (x) => x.event.type === 'lifecycle.changed' && x.event.to === 'error');
    expect(t.roster.get(e.id).lastError).toMatch(/beklenmedik/);
    const resumed = t.engine.resume(e.id);
    expect(resumed).toMatchObject({ lifecycle: 'idle', lastError: null });
  });

  it('on a usage limit goes limited and continues by itself when the window resets', async () => {
    const t = make({ env: { FAKE_CLAUDE_LIMIT_RESET_SEC: '1' }, engine: { limitGraceMs: 0 } });
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    t.engine.send(e.id, 'LIMIT hit');
    await waitFor(t.events, (x) => x.event.type === 'lifecycle.changed' && x.event.to === 'limited');
    expect(t.roster.get(e.id).limitResetsAt).toBeGreaterThan(Date.now() - 2000);
    const cont = await waitFor(t.events, (x) => x.event.type === 'message.user' && x.event.text === CONTINUE_AFTER_LIMIT, { timeoutMs: 6000 });
    expect(cont.event).toMatchObject({ source: 'system' });
    await waitFor(t.events, (x) => x.event.type === 'turn.finished', { after: cont.seq });
    expect(t.roster.get(e.id)).toMatchObject({ lifecycle: 'idle', limitResetsAt: null });
  });

  it('review focus: after an office restart a running turn becomes interrupted and resume continues it', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    t.engine.send(e.id, 'SLOW job');
    await waitFor(t.events, (x) => x.event.type === 'tool.started');
    await t.engine.shutdown();
    expect(t.roster.get(e.id).lifecycle).toBe('working');

    const second = another(t);
    second.engine.recover();
    expect(t.roster.get(e.id).lifecycle).toBe('interrupted');
    second.engine.resume(e.id);
    const cont = await waitFor(t.events, (x) => x.event.type === 'message.user' && x.event.text === CONTINUE_AFTER_RESTART);
    expect(cont.event).toMatchObject({ source: 'system' });
    await waitFor(t.events, (x) => x.event.type === 'turn.finished', { after: cont.seq });
    expect(t.roster.get(e.id).lifecycle).toBe('idle');
  });

  it('recover restarts idle employees and leaves stopped ones alone', async () => {
    const t = make();
    t.engine.hire({ name: 'Ada', role: 'r' });
    const can = t.engine.hire({ name: 'Can', role: 'r' });
    await t.engine.stop(can.id);
    await t.engine.shutdown();

    const second = another(t);
    second.engine.recover();
    const argvs = await readArgv(second.argvLog, 1);
    expect(argvs.map((a) => a.cwd)).toEqual([join(t.dataDir, 'desks', 'ada')]);
    expect(t.roster.get(can.id).lifecycle).toBe('stopped');
  });

  it('side question runs on a tool-less fork without touching the main session', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    await expect(t.engine.sideQuestion(e.id, 'ne yapıyorsun?')).rejects.toThrow(ConflictError);
    t.engine.send(e.id, 'merhaba');
    await waitFor(t.events, (x) => x.event.type === 'turn.finished');
    await expect(t.engine.sideQuestion(e.id, '   ')).rejects.toThrow(/boş/);
    expect(await t.engine.sideQuestion(e.id, 'ne yapıyorsun?')).toEqual({ ok: true, answer: 'side:ne yapıyorsun?|history:1' });
    const argvs = await readArgv(t.argvLog, 2);
    expect(argvs[1]?.args).toEqual(expect.arrayContaining(['--fork-session', '--resume', e.sessionId, '--output-format', 'json']));
    const answer = t.events.list().find((x) => x.event.type === 'side.answer');
    expect(answer?.event).toMatchObject({ ok: true, costUsd: 0.002 });
    expect(t.roster.get(e.id).lifecycle).toBe('idle');
  });
});
```

- [ ] **Step 2: Testleri çalıştır**

Run: `pnpm --filter @cc/office-server test -- engine-resilience`
Expected: PASS (davranış Task 6'da yazıldı). Bir test başarısız olursa, hatayı `engine.ts`'te düzelt — testi gevşetme — ve tekrar çalıştır.

- [ ] **Step 3: Tüm testleri ve tipleri çalıştır**

Run: `pnpm --filter @cc/office-server test && pnpm typecheck`
Expected: Hepsi PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/office-server/test/engine-resilience.test.ts apps/office-server/src/engine.ts
git commit -m "test(server): cover crash, usage-limit, restart recovery and side questions"
```

---

### Task 8: Kota ve kullanım takibi

**Files:**
- Create: `apps/office-server/src/quota.ts`
- Test: `apps/office-server/test/quota.test.ts`

**Interfaces:**
- Consumes: `Db`, `EventStore` (Task 1–2); `QuotaState`, `EmployeeUsage`, `UsageTotals`, `StoredEvent` (`@cc/shared`).
- Produces: `class QuotaTracker { constructor(db: Db, events: EventStore, now?: () => number); state(): QuotaState | null; usage(employeeId: string): EmployeeUsage; usageAll(ids: string[]): Record<string, EmployeeUsage> }`.

- [ ] **Step 1: Başarısız testi yaz**

`apps/office-server/test/quota.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Usage } from '@cc/shared';
import { migrateUp, openDb } from '../src/db.ts';
import { EventStore } from '../src/event-store.ts';
import { QuotaTracker } from '../src/quota.ts';

const TODAY_NOON = new Date(2026, 9, 6, 12, 0, 0).getTime();
const YESTERDAY = TODAY_NOON - 24 * 60 * 60 * 1000;

function make() {
  let clock = TODAY_NOON;
  const db = openDb(':memory:');
  migrateUp(db);
  const events = new EventStore(db, () => clock);
  const quota = new QuotaTracker(db, events, () => clock);
  return { events, quota, setClock: (t: number) => (clock = t) };
}

const usage = (n: number): Usage => ({ inputTokens: n, outputTokens: n * 2, cacheReadTokens: n * 10, cacheCreationTokens: n * 5 });

describe('QuotaTracker', () => {
  it('has no state before any quota event', () => {
    expect(make().quota.state()).toBeNull();
  });

  it('keeps the latest windows and keeps a window an update omits', () => {
    const { events, quota } = make();
    events.append('e1', { type: 'quota.updated', status: 'allowed', fiveHour: { utilization: 0.2, resetsAt: 1000 }, sevenDay: { utilization: 0.1, resetsAt: 2000 } });
    events.append('e2', { type: 'quota.updated', status: 'allowed_warning', fiveHour: { utilization: 0.8, resetsAt: 1000 }, sevenDay: null });
    expect(quota.state()).toEqual({
      status: 'allowed_warning',
      fiveHour: { utilization: 0.8, resetsAt: 1000 },
      sevenDay: { utilization: 0.1, resetsAt: 2000 },
      updatedAt: TODAY_NOON,
    });
  });

  it('sums usage per employee for today and in total, including side answers', () => {
    const { events, quota, setClock } = make();
    setClock(YESTERDAY);
    events.append('e1', { type: 'turn.finished', ok: true, subtype: 'success', usage: usage(100), costUsd: 1, numTurns: 1 });
    setClock(TODAY_NOON);
    events.append('e1', { type: 'turn.finished', ok: true, subtype: 'success', usage: usage(10), costUsd: 0.5, numTurns: 1 });
    events.append('e1', { type: 'side.answer', text: 'x', ok: true, usage: usage(1), costUsd: 0.1 });
    events.append('e2', { type: 'turn.finished', ok: true, subtype: 'success', usage: usage(7), costUsd: 9, numTurns: 1 });
    events.append('e1', { type: 'message.assistant', text: 'sayılmaz' });

    const e1 = quota.usage('e1');
    expect(e1.today).toMatchObject({ inputTokens: 11, outputTokens: 22, cacheReadTokens: 110, cacheCreationTokens: 55 });
    expect(e1.today.costUsd).toBeCloseTo(0.6);
    expect(e1.total).toMatchObject({ inputTokens: 111, outputTokens: 222 });
    expect(e1.total.costUsd).toBeCloseTo(1.6);
    expect(quota.usageAll(['e1', 'e2', 'nobody']).nobody).toEqual({
      today: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 },
      total: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 },
    });
  });
});
```

- [ ] **Step 2: Testin başarısız olduğunu gör**

Run: `pnpm --filter @cc/office-server test -- quota`
Expected: FAIL — `../src/quota.ts` bulunamıyor.

- [ ] **Step 3: QuotaTracker'ı yaz**

`apps/office-server/src/quota.ts`:
```ts
import type { EmployeeUsage, QuotaState, QuotaWindow, StoredEvent, UsageTotals } from '@cc/shared';
import type { Db } from './db.ts';
import type { EventStore } from './event-store.ts';

const parseWindow = (raw: string | null): QuotaWindow | null => (raw ? (JSON.parse(raw) as QuotaWindow) : null);

export class QuotaTracker {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, events: EventStore, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
    events.subscribe((stored) => this.#onEvent(stored));
  }

  #onEvent(stored: StoredEvent): void {
    const event = stored.event;
    if (event.type !== 'quota.updated') return;
    this.#db
      .prepare(
        `INSERT INTO quota (id, status, five_hour, seven_day, updated_at) VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           five_hour = COALESCE(excluded.five_hour, quota.five_hour),
           seven_day = COALESCE(excluded.seven_day, quota.seven_day),
           updated_at = excluded.updated_at`,
      )
      .run(
        event.status,
        event.fiveHour ? JSON.stringify(event.fiveHour) : null,
        event.sevenDay ? JSON.stringify(event.sevenDay) : null,
        stored.ts,
      );
  }

  state(): QuotaState | null {
    const row = this.#db.prepare('SELECT status, five_hour, seven_day, updated_at FROM quota WHERE id = 1').get() as unknown as
      | { status: string; five_hour: string | null; seven_day: string | null; updated_at: number }
      | undefined;
    if (!row) return null;
    return { status: row.status, fiveHour: parseWindow(row.five_hour), sevenDay: parseWindow(row.seven_day), updatedAt: row.updated_at };
  }

  usage(employeeId: string): EmployeeUsage {
    const startOfDay = new Date(this.#now());
    startOfDay.setHours(0, 0, 0, 0);
    return { today: this.#sum(employeeId, startOfDay.getTime()), total: this.#sum(employeeId, 0) };
  }

  usageAll(ids: string[]): Record<string, EmployeeUsage> {
    return Object.fromEntries(ids.map((id) => [id, this.usage(id)]));
  }

  #sum(employeeId: string, since: number): UsageTotals {
    const row = this.#db
      .prepare(
        `SELECT
           COALESCE(SUM(json_extract(payload, '$.usage.inputTokens')), 0) AS input,
           COALESCE(SUM(json_extract(payload, '$.usage.outputTokens')), 0) AS output,
           COALESCE(SUM(json_extract(payload, '$.usage.cacheReadTokens')), 0) AS cacheRead,
           COALESCE(SUM(json_extract(payload, '$.usage.cacheCreationTokens')), 0) AS cacheCreation,
           COALESCE(SUM(json_extract(payload, '$.costUsd')), 0) AS cost
         FROM events
         WHERE employee_id = ? AND ts >= ? AND type IN ('turn.finished', 'side.answer')`,
      )
      .get(employeeId, since) as unknown as { input: number; output: number; cacheRead: number; cacheCreation: number; cost: number };
    return {
      inputTokens: row.input,
      outputTokens: row.output,
      cacheReadTokens: row.cacheRead,
      cacheCreationTokens: row.cacheCreation,
      costUsd: row.cost,
    };
  }
}
```

- [ ] **Step 4: Testin geçtiğini gör**

Run: `pnpm --filter @cc/office-server test -- quota && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/office-server/src/quota.ts apps/office-server/test/quota.test.ts
git commit -m "feat(server): track subscription windows and per-employee usage"
```

---

### Task 9: HTTP + WebSocket API

**Files:**
- Create: `apps/office-server/src/api.ts`
- Test: `apps/office-server/test/api.test.ts`

**Interfaces:**
- Consumes: `Engine` (Task 6), `Roster` (Task 3), `EventStore` (Task 2), `QuotaTracker` (Task 8), hata sınıfları (Task 1); `HireInput`, `OfficeSnapshot`, `ServerMessage` (`@cc/shared`).
- Produces: `interface ApiDeps { engine; roster; events; quota }`; `interface Api { server: Server; close(): Promise<void> }`; `createApi(deps: ApiDeps, opts: { allowedOrigins: string[] }): Api`; `snapshot(deps): OfficeSnapshot`; `checkRequest(req, port, allowedOrigins): void`.

Rotalar (hepsi JSON; `POST` gövdesiz olsa da `content-type: application/json` ister):

| Yöntem ve yol | Başarı |
|---|---|
| `GET /api/office` | 200 `OfficeSnapshot` |
| `POST /api/employees` `{name, role, model?, characterId?}` | 201 `Employee` |
| `DELETE /api/employees/:id` | 204 |
| `POST /api/employees/:id/messages` `{text}` | 202 `{ok:true}` |
| `POST /api/employees/:id/side-questions` `{text}` | 200 `{ok, answer}` |
| `POST /api/employees/:id/stop` | 200 `Employee` |
| `POST /api/employees/:id/resume` | 200 `Employee` |
| `POST /api/employees/:id/terminal` | 200 `{command, employee}` |
| `DELETE /api/employees/:id/terminal` | 200 `Employee` |
| `GET /api/employees/:id/events?after=&limit=` | 200 `StoredEvent[]` |
| `GET /ws?after=<seq>` (WebSocket) | önce `{type:'snapshot'}`, sonra `{type:'event'}` |

Hatalar: 400 doğrulama, 403 Host/Origin, 404 bilinmeyen çalışan/yol, 409 çakışma, 415 content-type; gövde `{error: "<Türkçe mesaj>"}`.

- [ ] **Step 1: Başarısız testi yaz**

`apps/office-server/test/api.test.ts`:
```ts
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createApi } from '../src/api.ts';
import { QuotaTracker } from '../src/quota.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup, until, waitFor } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function start() {
  const s = setup();
  const f = fakeEngine(s);
  const quota = new QuotaTracker(s.db, s.events);
  const api = createApi({ engine: f.engine, roster: s.roster, events: s.events, quota }, { allowedOrigins: ['http://127.0.0.1:5173'] });
  await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', resolve));
  const port = (api.server.address() as AddressInfo).port;
  cleanups.push(() => api.close(), f.cleanup, s.cleanup);
  return { s, port };
}

interface Reply {
  status: number;
  body: any;
}

function call(port: number, method: string, path: string, opts: { body?: unknown; headers?: Record<string, string> } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const headers: Record<string, string> = { ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...opts.headers };
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function openWs(port: number, path: string, origin?: string) {
  const messages: any[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, origin ? { origin } : {});
  ws.on('message', (data) => messages.push(JSON.parse(String(data))));
  const opened = new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
    ws.on('unexpected-response', (_req, res) => reject(new Error(`ws reddedildi: ${res.statusCode}`)));
  });
  cleanups.push(() => ws.terminate());
  const waitUntil = async (done: (ms: any[]) => boolean): Promise<any[]> => {
    await until(() => done(messages));
    return messages;
  };
  return { messages, opened, waitUntil };
}

describe('API', () => {
  it('hires, lists and messages an employee, then returns its events', async () => {
    const { s, port } = await start();
    const hired = await call(port, 'POST', '/api/employees', { body: { name: 'Ada', role: 'Yazılımcı', model: 'haiku' } });
    expect(hired.status).toBe(201);
    expect(hired.body).toMatchObject({ name: 'Ada', lifecycle: 'idle' });

    const office = await call(port, 'GET', '/api/office');
    expect(office.status).toBe(200);
    expect(office.body.employees.map((e: { name: string }) => e.name)).toEqual(['Ada']);
    expect(office.body.usage[hired.body.id].total.inputTokens).toBe(0);

    expect((await call(port, 'POST', `/api/employees/${hired.body.id}/messages`, { body: { text: 'merhaba' } })).status).toBe(202);
    await waitFor(s.events, (x) => x.event.type === 'turn.finished');
    const events = await call(port, 'GET', `/api/employees/${hired.body.id}/events?after=0`);
    expect(events.body.map((x: { event: { type: string } }) => x.event.type)).toContain('message.assistant');

    const after = await call(port, 'GET', '/api/office');
    expect(after.body.quota.status).toBe('allowed');
    expect(after.body.usage[hired.body.id].total.inputTokens).toBe(10);
  });

  it('runs side questions, stop, resume and the terminal hand-off', async () => {
    const { s, port } = await start();
    const { body: e } = await call(port, 'POST', '/api/employees', { body: { name: 'Ada', role: 'r' } });
    await call(port, 'POST', `/api/employees/${e.id}/messages`, { body: { text: 'merhaba' } });
    await waitFor(s.events, (x) => x.event.type === 'turn.finished');
    expect((await call(port, 'POST', `/api/employees/${e.id}/side-questions`, { body: { text: 'durum?' } })).body).toEqual({ ok: true, answer: 'side:durum?|history:1' });
    expect((await call(port, 'POST', `/api/employees/${e.id}/stop`)).body.lifecycle).toBe('stopped');
    expect((await call(port, 'POST', `/api/employees/${e.id}/resume`)).body.lifecycle).toBe('idle');
    const terminal = await call(port, 'POST', `/api/employees/${e.id}/terminal`);
    expect(terminal.body.command).toContain(`claude --resume ${e.sessionId}`);
    expect((await call(port, 'POST', `/api/employees/${e.id}/messages`, { body: { text: 'x' } })).status).toBe(409);
    expect((await call(port, 'DELETE', `/api/employees/${e.id}/terminal`)).body.lifecycle).toBe('stopped');
    expect((await call(port, 'DELETE', `/api/employees/${e.id}`)).status).toBe(204);
  });

  it('maps errors to status codes with Turkish messages', async () => {
    const { port } = await start();
    const bad = await call(port, 'POST', '/api/employees', { body: { name: '', role: 'r' } });
    expect(bad).toEqual({ status: 400, body: { error: 'Ad boş olamaz.' } });
    expect((await call(port, 'POST', '/api/employees', { headers: { 'content-type': 'application/json' }, body: undefined })).status).toBe(400);
    expect((await call(port, 'GET', '/api/employees/00000000-0000-0000-0000-000000000000/events')).status).toBe(404);
    expect((await call(port, 'GET', '/api/nope')).status).toBe(404);
  });

  it('review focus: rejects cross-site, rebinding and non-JSON requests', async () => {
    const { port } = await start();
    const hire = { body: { name: 'X', role: 'r' } };
    expect((await call(port, 'POST', '/api/employees', { ...hire, headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await call(port, 'GET', '/api/office', { headers: { host: `evil.example:${port}` } })).status).toBe(403);
    expect((await call(port, 'POST', '/api/employees', { ...hire, headers: { 'content-type': 'text/plain' } })).status).toBe(415);
    expect((await call(port, 'POST', '/api/employees', { ...hire, headers: { origin: 'http://127.0.0.1:5173' } })).status).toBe(201);
    expect((await call(port, 'POST', '/api/employees', { body: { name: 'Y', role: 'r' }, headers: { origin: `http://localhost:${port}` } })).status).toBe(201);
    await expect(openWs(port, '/ws', 'https://evil.example').opened).rejects.toThrow(/403|reddedildi/);
  });

  it('streams a snapshot and then live events over WebSocket', async () => {
    const { port } = await start();
    const ws = openWs(port, '/ws');
    await ws.opened;
    await ws.waitUntil((ms) => ms.length > 0);
    await call(port, 'POST', '/api/employees', { body: { name: 'Ada', role: 'r' } });
    const messages = await ws.waitUntil((ms) => ms.some((m) => m.type === 'event' && m.event.event.type === 'employee.hired'));
    expect(messages[0].type).toBe('snapshot');
    expect(messages[0].snapshot.employees).toEqual([]);
  });

  it('replays missed events when reconnecting with ?after=', async () => {
    const { s, port } = await start();
    const { body: e } = await call(port, 'POST', '/api/employees', { body: { name: 'Ada', role: 'r' } });
    const before = s.events.lastSeq();
    await call(port, 'POST', `/api/employees/${e.id}/messages`, { body: { text: 'merhaba' } });
    await waitFor(s.events, (x) => x.event.type === 'turn.finished');
    const messages = await openWs(port, `/ws?after=${before}`).waitUntil((ms) => ms.some((m) => m.type === 'event' && m.event.event.type === 'turn.finished'));
    expect(messages[0].type).toBe('snapshot');
    const replayed = messages.filter((m) => m.type === 'event');
    expect(replayed.length).toBeGreaterThan(0);
    expect(replayed.every((m) => m.event.seq > before)).toBe(true);
  });
});
```

- [ ] **Step 2: Testin başarısız olduğunu gör**

Run: `pnpm --filter @cc/office-server test -- api`
Expected: FAIL — `../src/api.ts` bulunamıyor.

- [ ] **Step 3: API'yi yaz**

`apps/office-server/src/api.ts`:
```ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import type { HireInput, OfficeSnapshot, ServerMessage } from '@cc/shared';
import type { Engine } from './engine.ts';
import { ForbiddenError, UnsupportedMediaTypeError, ValidationError, statusOf } from './errors.ts';
import type { EventStore } from './event-store.ts';
import type { QuotaTracker } from './quota.ts';
import type { Roster } from './roster.ts';

export interface ApiDeps {
  engine: Engine;
  roster: Roster;
  events: EventStore;
  quota: QuotaTracker;
}

export interface ApiOptions {
  allowedOrigins: string[];
}

export interface Api {
  server: Server;
  close: () => Promise<void>;
}

const MAX_BODY_BYTES = 1_000_000;
const WS_OPEN = 1;
const EMPLOYEE_ROUTE =
  /^\/api\/employees\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/(messages|side-questions|stop|resume|terminal|events))?$/;

export function snapshot(d: ApiDeps): OfficeSnapshot {
  const employees = d.roster.list();
  return { employees, quota: d.quota.state(), usage: d.quota.usageAll(employees.map((e) => e.id)), lastSeq: d.events.lastSeq() };
}

/** Blocks DNS rebinding (Host) and cross-site requests from other pages in the owner's browser (Origin). */
export function checkRequest(req: IncomingMessage, port: number, allowedOrigins: string[]): void {
  const host = req.headers.host ?? '';
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) throw new ForbiddenError('Geçersiz Host başlığı.');
  const origin = req.headers.origin;
  if (origin === undefined) return;
  const allowed = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...allowedOrigins];
  if (!allowed.includes(origin)) throw new ForbiddenError('Bu kaynaktan gelen isteklere izin yok.');
}

function portOf(server: Server): number {
  return (server.address() as AddressInfo).port;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new ValidationError('İstek gövdesi çok büyük.');
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError('Geçersiz JSON.');
  }
}

function textOf(body: unknown): string {
  const text = (body as { text?: unknown } | null)?.text;
  return typeof text === 'string' ? text : '';
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function sendEmpty(res: ServerResponse, status: number): void {
  res.writeHead(status);
  res.end();
}

async function route(d: ApiDeps, opts: ApiOptions, server: Server, req: IncomingMessage, res: ServerResponse): Promise<void> {
  checkRequest(req, portOf(server), opts.allowedOrigins);
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (method === 'POST' && !(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new UnsupportedMediaTypeError('İstek gövdesi application/json olmalı.');
  }
  if (method === 'GET' && url.pathname === '/api/office') return sendJson(res, 200, snapshot(d));
  if (method === 'POST' && url.pathname === '/api/employees') return sendJson(res, 201, d.engine.hire((await readJson(req)) as HireInput));

  const match = EMPLOYEE_ROUTE.exec(url.pathname);
  if (match) {
    const id = match[1] ?? '';
    const action = match[2];
    if (method === 'DELETE' && action === undefined) {
      await d.engine.fire(id);
      return sendEmpty(res, 204);
    }
    if (method === 'POST' && action === 'messages') {
      d.engine.send(id, textOf(await readJson(req)));
      return sendJson(res, 202, { ok: true });
    }
    if (method === 'POST' && action === 'side-questions') return sendJson(res, 200, await d.engine.sideQuestion(id, textOf(await readJson(req))));
    if (method === 'POST' && action === 'stop') return sendJson(res, 200, await d.engine.stop(id));
    if (method === 'POST' && action === 'resume') return sendJson(res, 200, d.engine.resume(id));
    if (method === 'POST' && action === 'terminal') return sendJson(res, 200, await d.engine.openInTerminal(id));
    if (method === 'DELETE' && action === 'terminal') return sendJson(res, 200, d.engine.returnFromTerminal(id));
    if (method === 'GET' && action === 'events') {
      d.roster.get(id);
      const after = Number(url.searchParams.get('after') ?? '0') || 0;
      const limit = Number(url.searchParams.get('limit') ?? '500') || 500;
      return sendJson(res, 200, d.events.list({ employeeId: id, after, limit }));
    }
  }
  sendJson(res, 404, { error: 'Bulunamadı.' });
}

function attach(d: ApiDeps, ws: WebSocket, after: number): void {
  const send = (message: ServerMessage) => {
    if (ws.readyState === WS_OPEN) ws.send(JSON.stringify(message));
  };
  const snap = snapshot(d);
  send({ type: 'snapshot', snapshot: snap });
  let last = after > 0 ? after : snap.lastSeq;
  if (after > 0) {
    for (;;) {
      const page = d.events.list({ after: last, limit: 5000 });
      for (const event of page) {
        send({ type: 'event', event });
        last = event.seq;
      }
      if (page.length < 5000) break;
    }
  }
  const unsubscribe = d.events.subscribe((event) => {
    if (event.seq <= last) return;
    last = event.seq;
    send({ type: 'event', event });
  });
  ws.on('close', unsubscribe);
}

export function createApi(d: ApiDeps, opts: ApiOptions): Api {
  const server = createServer((req, res) => {
    route(d, opts, server, req, res).catch((err: unknown) => {
      sendJson(res, statusOf(err), { error: err instanceof Error ? err.message : String(err) });
    });
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname !== '/ws') throw new ForbiddenError('Bilinmeyen adres.');
      checkRequest(req, portOf(server), opts.allowedOrigins);
    } catch {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => attach(d, ws, Number(url.searchParams.get('after') ?? '0') || 0));
  });
  return {
    server,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
```

- [ ] **Step 4: Testin geçtiğini gör**

Run: `pnpm --filter @cc/office-server test -- api && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/office-server/src/api.ts apps/office-server/test/api.test.ts
git commit -m "feat(server): add localhost-only HTTP and WebSocket API"
```

---

### Task 10: Başlatma, gerçek claude ile duman testi, kabul

**Files:**
- Create: `apps/office-server/src/main.ts`
- Create: `apps/office-server/test/smoke.real.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: hepsi (Task 1–9).
- Produces: `pnpm --filter @cc/office-server start` ile çalışan sunucu; `pnpm --filter @cc/office-server smoke` ile gerçek claude doğrulaması.

- [ ] **Step 1: main.ts'i yaz**

`apps/office-server/src/main.ts`:
```ts
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
```

- [ ] **Step 2: Gerçek claude duman testini yaz**

`apps/office-server/test/smoke.real.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine.ts';
import { setup, waitFor } from './helpers.ts';

const enabled = process.env.OFFICE_SMOKE === '1';

describe.skipIf(!enabled)('smoke with the real claude CLI (haiku)', () => {
  it('hire → message → side question → stop → resume keeps context', async () => {
    const s = setup();
    const engine = new Engine({ roster: s.roster, events: s.events, dataDir: s.dataDir, claudeCommand: ['claude'] });
    const textsAfter = (seq: number) =>
      s.events
        .list({ after: seq, limit: 5000 })
        .filter((x) => x.event.type === 'message.assistant')
        .map((x) => (x.event as { text: string }).text)
        .join(' ');
    try {
      const e = engine.hire({ name: 'Smoke', role: 'Tek kelimelik cevaplar veren bir test çalışanısın.', model: 'haiku' });
      engine.send(e.id, 'Reply with exactly one word: PONG');
      const first = await waitFor(s.events, (x) => x.event.type === 'turn.finished', { timeoutMs: 120_000 });
      expect(first.event).toMatchObject({ ok: true });
      expect(textsAfter(0)).toMatch(/PONG/);
      expect(s.events.list({ limit: 5000 }).some((x) => x.event.type === 'quota.updated')).toBe(true);
      expect(s.roster.get(e.id).sessionStarted).toBe(true);

      const side = await engine.sideQuestion(e.id, 'Which single word did you reply with? Answer with that word only.');
      expect(side.ok).toBe(true);
      expect(side.answer).toMatch(/PONG/i);

      expect((await engine.stop(e.id)).lifecycle).toBe('stopped');
      engine.resume(e.id);
      engine.send(e.id, 'Repeat your first reply, one word only.');
      const second = await waitFor(s.events, (x) => x.event.type === 'turn.finished', { after: first.seq, timeoutMs: 120_000 });
      expect(second.event).toMatchObject({ ok: true });
      expect(textsAfter(first.seq)).toMatch(/PONG/);
    } finally {
      await engine.shutdown();
      s.cleanup();
    }
  }, 300_000);
});
```

- [ ] **Step 3: Sahte testlerin hepsini ve tipleri çalıştır**

Run: `cd ~/Projects/control-center && pnpm test && pnpm typecheck`
Expected: Tüm testler PASS; duman testi "skipped" görünür.

- [ ] **Step 4: Duman testini gerçek claude ile çalıştır**

Run: `pnpm --filter @cc/office-server smoke`
Expected: 1 test PASS (Haiku ile birkaç kuruşluk kullanım). Başarısız olursa çıktıdaki ilk farkı (`--session-id` kabul edilmedi, yan soru boş döndü vb.) düzelt; bu adım gerçek CLI ile sözleşmenin tek doğrulamasıdır.

- [ ] **Step 5: Sunucuyu elle kabul et**

Terminal 1:
```bash
cd ~/Projects/control-center && OFFICE_DATA_DIR=/tmp/cc-acceptance pnpm --filter @cc/office-server start
```
Expected: `office-server hazır: http://127.0.0.1:4319  (veri: /tmp/cc-acceptance)`

Terminal 2:
```bash
B=http://127.0.0.1:4319; J='content-type: application/json'
ID=$(curl -s -X POST $B/api/employees -H "$J" -d '{"name":"Deneme","role":"Kısa cevap veren test çalışanı.","model":"haiku"}' | jq -r .id); echo $ID
curl -s -X POST $B/api/employees/$ID/messages -H "$J" -d '{"text":"Bir kelimeyle merhaba de."}'
sleep 15; curl -s "$B/api/employees/$ID/events?after=0" | jq -r '.[] | .event.type + "  " + (.event.text // .event.to // "")'
curl -s -X POST $B/api/employees/$ID/side-questions -H "$J" -d '{"text":"Az önce ne dedin?"}' | jq
curl -s $B/api/office | jq '{employees: [.employees[] | {name, lifecycle}], quota, usage}'
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/api/employees -H "$J" -H 'origin: https://evil.example' -d '{"name":"X","role":"r"}'
curl -s -X DELETE $B/api/employees/$ID -o /dev/null -w '%{http_code}\n'
```
Expected: id yazılır; olaylarda `message.user`, `message.assistant`, `turn.finished`, `lifecycle.changed`; yan soru `{"ok":true,"answer":…}`; office çıktısında `quota.fiveHour.utilization` ve sıfırdan büyük `usage`; evil origin `403`; silme `204`. Sonra Terminal 1'de Ctrl+C → `office-server kapanıyor…`.

- [ ] **Step 6: README'yi güncelle**

`README.md` içeriğini şununla değiştir:
````markdown
# control-center

Claude Code oturumlarını rol tanımı verilmiş çalışanlar olarak, canlı bir 3D ofiste çalıştıran platform.
Tasarım: `docs/superpowers/specs/2026-10-06-office-v1-design.md`.

## office-server

Gereken: Node 24+, pnpm 9, giriş yapılmış `claude` CLI.

```bash
pnpm install
pnpm --filter @cc/office-server start     # http://127.0.0.1:4319, veri: ~/.control-center
pnpm test                                  # sahte claude ile tüm testler
pnpm --filter @cc/office-server smoke      # gerçek claude (Haiku) ile duman testi
```

Ortam değişkenleri: `OFFICE_DATA_DIR` (repo içinde olamaz), `OFFICE_PORT`, `OFFICE_ALLOWED_ORIGINS`
(virgülle), `OFFICE_CLAUDE_COMMAND` (JSON dizi).

Çalışanlar onay istemeden ve sahibinin bütün bağlantılarıyla çalışır; ofis API'si yalnızca
`127.0.0.1`'den ve izin verilen kaynaklardan gelen istekleri kabul eder.
````

- [ ] **Step 7: Commit**

```bash
git add apps/office-server/src/main.ts apps/office-server/test/smoke.real.test.ts README.md
git commit -m "feat(server): add entry point, real-claude smoke test and run docs"
```
