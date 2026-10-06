# Plan 2 — office-web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tarayıcıda açılan, yaşayan 3D voksel ofis: çalışanlar duruma göre masa / server odası / kahve köşesi / oturma alanı arasında yürür, üstlerinde ad-durum-token-maliyet görünür; karaktere tıklayınca canlı oturum akışı, mesaj, yan soru, durdur / devam / terminalde aç / işten çıkar; köşede abonelik kotası; "Çalışan al" formu. office-server derlenmiş arayüzü ve `assets/3d`'yi aynı adresten sunar.

**Architecture:** `apps/office-web` — Vite + React 19 + React Three Fiber. Saf mantık (manifest, API istemcisi, canlı bağlantı, durum indirgeyicileri, davranış kuralları, yerleşim + A* yol bulma, hareket, klip seçimi, biçimlendirme) ayrı dosyalarda ve birim testli; 3D bileşenler bu mantığın üstünde ince bir katman ve başsız Chrome ekran görüntüsüyle doğrulanır. office-server'a statik dosya sunma ve "son N olay" sorgusu eklenir.

**Tech Stack:** React 19.3, three 0.186, @react-three/fiber 9, @react-three/drei 10, zustand 5, Vite 7, Vitest 3 + jsdom + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-10-06-office-v1-design.md` (§6 durum → davranış, §7 office-web, §8 manifest, §4.5 güvenlik, §10 "model eksik → voksel kutu").

## Global Constraints

- Ofis tek adresten çalışır: `pnpm --filter @cc/office-web build` sonrası office-server `http://127.0.0.1:4319`'da arayüzü (`apps/office-web/dist`) ve modelleri (`/assets3d/` → `assets/3d/`) sunar; bu durumda Origin ayarı gerekmez.
- Geliştirme sunucusu `127.0.0.1:5180` (`strictPort`), `/api`, `/ws`, `/assets3d`'yi 4319'a aktarır; office-server'ın `OFFICE_ALLOWED_ORIGINS=http://127.0.0.1:5180,http://localhost:5180` ile açılması gerekir. Origin başlığı hiçbir yerde silinmez.
- Statik sunucu kök dışına çıkamaz (`..`, `%2f`, NUL reddedilir); bilinmeyen arayüz yolları `index.html`'e düşer (SPA); `/api/*` JSON 404 olarak kalır.
- Model yoksa ya da yüklenemezse sahne voksel kutu / voksel figür gösterir ve çalışmaya devam eder.
- Arayüz metinleri Türkçe. Commit'lerde Claude/AI izi yok.
- Meshy ve model üretimi bu planın konusu değildir (spec §9).

## Review Focus

1. Statik dosya yolunda dizin dışına çıkma denemesi (`/assets3d/..%2f..%2f.env`) → 404, dosya sızmaz. (Task 1)
2. Canlı bağlantı koparsa istemci geri bağlanır ve kaçırdığı olayları `?after=<lastSeq>` ile alır; aynı olay iki kez gelse de akışta bir kez görünür. (Task 3, Task 4)
3. Sayfa yeniden yüklendiğinde boştaki eski çalışanlar masada donup kalmaz (boşta geçen süre `createdAt`'ten hesaplanır); yeni işe alınan masada başlar. (Task 5)
4. Bir çalışan server odasından masasına giderken duvarın içinden değil kapıdan geçer; hiçbir yol engelli hücreden geçmez. (Task 6)
5. Uzun / zararlı araç çıktısı ya da çalışan metni panelde HTML olarak yorumlanmaz, düz metin görünür. (Task 9)

---

## Dosya haritası

```
apps/office-server/src/static.ts           resolveInside, sendFile (yeni)
apps/office-server/src/api.ts              statik yollar, ?tail= (değişir)
apps/office-server/src/event-store.ts      list({ tail }) (değişir)
apps/office-server/src/config.ts           webDir, assetsDir (değişir)
apps/office-server/src/main.ts             yeni seçenekleri geçirir (değişir)
apps/office-web/
  package.json, tsconfig.json, vite.config.ts, index.html
  src/main.tsx                             giriş
  src/App.tsx                              bağlama
  src/styles.css                           tasarım belirteçleri ve bileşen stilleri
  src/assets/manifest.ts                   manifest tipleri, ayrıştırma, yükleme
  src/net/api.ts                           HTTP istemcisi
  src/net/live.ts                          WebSocket + geri bağlanma
  src/store/reducers.ts                    saf durum indirgeyicileri
  src/store/office.ts                      zustand deposu
  src/office/behavior.ts                   durum → bölge/etkinlik/işaret
  src/office/grid.ts                       ızgara + A*
  src/office/layout.ts                     ofis yerleşimi verisi
  src/office/motion.ts                     yol boyunca adım
  src/scene/fit.ts                         modeli boyuna ölçekleme
  src/scene/clips.ts                       klip seçimi, yerinde yürüme
  src/scene/ErrorBoundary.tsx
  src/scene/Room.tsx, FurnitureLayer.tsx, VoxelFigure.tsx, CharacterModel.tsx, Character.tsx, CharactersLayer.tsx, OfficeScene.tsx
  src/ui/format.ts, labels.ts              biçimlendirme, Türkçe etiketler, araç girdisi özeti
  src/ui/TopBar.tsx, QuotaHud.tsx, HireDialog.tsx, Panel.tsx, EventItem.tsx
```

---

### Task 1: office-server — arayüzü ve modelleri sunma, son N olay

**Files:**
- Create: `apps/office-server/src/static.ts`
- Modify: `apps/office-server/src/event-store.ts`, `apps/office-server/src/api.ts`, `apps/office-server/src/config.ts`, `apps/office-server/src/main.ts`
- Test: `apps/office-server/test/static.test.ts`, `apps/office-server/test/event-store.test.ts`, `apps/office-server/test/config.test.ts`

**Interfaces:**
- Produces: `EventStore.list(opts: { after?; employeeId?; limit?; tail?: boolean })` (tail: son `limit` olay, artan sırada); `GET /api/employees/:id/events?tail=N`; `ApiOptions { allowedOrigins; webDir?: string; assetsDir?: string }`; `OfficeConfig.webDir`, `OfficeConfig.assetsDir` (varsayılan `<repo>/apps/office-web/dist`, `<repo>/assets/3d`; `OFFICE_WEB_DIR`, `OFFICE_ASSETS_DIR`); `resolveInside(root, urlPath): string | null`.

- [ ] **Step 1: Başarısız testleri yaz**

`apps/office-server/test/event-store.test.ts` içine, `it('reports lastSeq, 0 when empty'` testinden önce ekle:
```ts
  it('returns the last N events in ascending order with tail', () => {
    const s = store();
    for (let i = 0; i < 5; i += 1) s.append('e1', { type: 'turn.started' });
    s.append('e2', { type: 'turn.started' });
    const tail = s.list({ employeeId: 'e1', tail: true, limit: 2 });
    expect(tail.map((e) => e.seq)).toEqual([4, 5]);
    expect(s.list({ tail: true, limit: 1 }).map((e) => e.seq)).toEqual([6]);
  });

```

`apps/office-server/test/config.test.ts` içindeki ilk testin sonuna (son `expect`'ten sonra) ekle:
```ts
    expect(c.webDir).toBe(join(REPO_ROOT, 'apps', 'office-web', 'dist'));
    expect(c.assetsDir).toBe(join(REPO_ROOT, 'assets', '3d'));
```
ve `reads overrides from the environment` testindeki `loadConfig({...})` nesnesine `OFFICE_WEB_DIR: '/tmp/web', OFFICE_ASSETS_DIR: '/tmp/assets',` ekleyip testin sonuna:
```ts
    expect(c.webDir).toBe('/tmp/web');
    expect(c.assetsDir).toBe('/tmp/assets');
```

`apps/office-server/test/static.test.ts`:
```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/api.ts';
import { QuotaTracker } from '../src/quota.ts';
import { resolveInside } from '../src/static.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup, tempDir } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function get(port: number, path: string): Promise<{ status: number; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method: 'GET', path }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function start(withWeb = true) {
  const s = setup();
  const f = fakeEngine(s);
  const web = tempDir('cc-web-');
  writeFileSync(join(web, 'index.html'), '<!doctype html><title>ofis</title>');
  mkdirSync(join(web, 'assets'));
  writeFileSync(join(web, 'assets', 'app.js'), 'console.log(1)');
  const root = tempDir('cc-assets-');
  const assets = join(root, 'assets');
  mkdirSync(join(assets, 'furniture'), { recursive: true });
  writeFileSync(join(assets, 'manifest.json'), '{"items":[]}');
  writeFileSync(join(assets, 'furniture', 'desk.glb'), 'glTF');
  writeFileSync(join(root, 'secret.txt'), 'gizli');
  const api = createApi(
    { engine: f.engine, roster: s.roster, events: s.events, quota: new QuotaTracker(s.db, s.events) },
    { allowedOrigins: [], webDir: withWeb ? web : join(web, 'missing'), assetsDir: assets },
  );
  await new Promise<void>((r) => api.server.listen(0, '127.0.0.1', r));
  cleanups.push(() => api.close(), f.cleanup, s.cleanup);
  return (api.server.address() as AddressInfo).port;
}

describe('resolveInside', () => {
  it('keeps paths inside the root and rejects everything else', () => {
    expect(resolveInside('/srv/web', '/assets/app.js')).toBe('/srv/web/assets/app.js');
    expect(resolveInside('/srv/web', '/')).toBe('/srv/web');
    expect(resolveInside('/srv/web', '/../etc/passwd')).toBeNull();
    expect(resolveInside('/srv/web', '/..%2f..%2fetc%2fpasswd')).toBeNull();
    expect(resolveInside('/srv/web', '/a%00b')).toBeNull();
    expect(resolveInside('/srv/web', '/%E0%A4%A')).toBeNull();
  });
});

describe('static serving', () => {
  it('serves the built office, its assets and falls back to index.html for app routes', async () => {
    const port = await start();
    const index = await get(port, '/');
    expect(index).toMatchObject({ status: 200, type: 'text/html; charset=utf-8' });
    expect(index.body).toContain('<title>ofis</title>');
    expect(await get(port, '/assets/app.js')).toMatchObject({ status: 200, type: 'text/javascript; charset=utf-8' });
    expect((await get(port, '/calisan/ada')).body).toContain('<title>ofis</title>');
  });

  it('serves models from the assets directory', async () => {
    const port = await start();
    expect(await get(port, '/assets3d/manifest.json')).toMatchObject({ status: 200, type: 'application/json; charset=utf-8', body: '{"items":[]}' });
    expect(await get(port, '/assets3d/furniture/desk.glb')).toMatchObject({ status: 200, type: 'model/gltf-binary' });
    expect((await get(port, '/assets3d/nope.glb')).status).toBe(404);
  });

  it('review focus: never leaves the assets or web directory', async () => {
    const port = await start();
    const escaped = await get(port, '/assets3d/..%2fsecret.txt');
    expect(escaped.status).toBe(404);
    expect(escaped.body).not.toContain('gizli');
    expect((await get(port, '/..%2f..%2fsecret.txt')).body).not.toContain('gizli');
  });

  it('keeps API 404s as JSON and explains a missing build', async () => {
    const port = await start(false);
    const api = await get(port, '/api/nope');
    expect(api).toMatchObject({ status: 404, type: 'application/json; charset=utf-8' });
    const page = await get(port, '/');
    expect(page.status).toBe(404);
    expect(page.body).toContain('pnpm --filter @cc/office-web build');
  });
});
```

- [ ] **Step 2: Testlerin başarısız olduğunu gör**

Run: `cd ~/Projects/control-center && pnpm --filter @cc/office-server test`
Expected: FAIL — `../src/static.ts` yok, `tail` / `webDir` / `assetsDir` beklentileri tutmuyor.

- [ ] **Step 3: static.ts'i yaz**

`apps/office-server/src/static.ts`:
```ts
import { createReadStream, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** The absolute file for `urlPath` under `root`, or null when it is malformed or would leave `root`. */
export function resolveInside(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const base = resolve(root);
  const full = resolve(base, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`);
  return full === base || full.startsWith(base + sep) ? full : null;
}

/** Streams a regular file; false when it does not exist (caller decides what 404 looks like). */
export function sendFile(res: ServerResponse, file: string): boolean {
  let size: number;
  try {
    const st = statSync(file);
    if (!st.isFile()) return false;
    size = st.size;
  } catch {
    return false;
  }
  res.writeHead(200, {
    'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': size,
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-cache',
  });
  createReadStream(file).pipe(res);
  return true;
}
```

- [ ] **Step 4: EventStore tail, config, api ve main'i değiştir**

`apps/office-server/src/event-store.ts` içinde `list` metodunu şununla değiştir:
```ts
  list(opts: { after?: number; employeeId?: string; limit?: number; tail?: boolean } = {}): StoredEvent[] {
    const after = opts.after ?? 0;
    const limit = Math.max(1, Math.min(opts.limit ?? 500, 5000));
    const order = opts.tail ? 'DESC' : 'ASC';
    const rows = (
      opts.employeeId === undefined
        ? this.#db.prepare(`SELECT seq, employee_id, ts, payload FROM events WHERE seq > ? ORDER BY seq ${order} LIMIT ?`).all(after, limit)
        : this.#db
            .prepare(`SELECT seq, employee_id, ts, payload FROM events WHERE seq > ? AND employee_id = ? ORDER BY seq ${order} LIMIT ?`)
            .all(after, opts.employeeId, limit)
    ) as unknown as Row[];
    const events = rows.map(toStored);
    return opts.tail ? events.reverse() : events;
  }
```

`apps/office-server/src/config.ts`: `OfficeConfig` arayüzüne
```ts
  /** Built office-web (served at /). */
  webDir: string;
  /** Models and manifest (served at /assets3d/). */
  assetsDir: string;
```
ekle; `loadConfig`'in `return` satırını şununla değiştir:
```ts
  const webDir = env.OFFICE_WEB_DIR ?? join(REPO_ROOT, 'apps', 'office-web', 'dist');
  const assetsDir = env.OFFICE_ASSETS_DIR ?? join(REPO_ROOT, 'assets', '3d');
  return { dataDir, host: '127.0.0.1', port, claudeCommand, deskCount: 8, allowedOrigins, webDir, assetsDir };
```

`apps/office-server/src/api.ts`:
- importlara `import { resolveInside, sendFile } from './static.ts';` ekle;
- `ApiOptions` arayüzünü şu olsun:
```ts
export interface ApiOptions {
  allowedOrigins: string[];
  /** Built office-web; omitted → only the API is served. */
  webDir?: string;
  /** Models + manifest served under /assets3d/. */
  assetsDir?: string;
}
```
- `route` içinde `if (method === 'GET' && action === 'events') { ... }` bloğunu şununla değiştir:
```ts
    if (method === 'GET' && action === 'events') {
      d.roster.get(id);
      const tail = Number(url.searchParams.get('tail') ?? '0') || 0;
      if (tail > 0) return sendJson(res, 200, d.events.list({ employeeId: id, tail: true, limit: tail }));
      const after = Number(url.searchParams.get('after') ?? '0') || 0;
      const limit = Number(url.searchParams.get('limit') ?? '500') || 500;
      return sendJson(res, 200, d.events.list({ employeeId: id, after, limit }));
    }
```
- `route`'un en sonundaki `sendJson(res, 404, { error: 'Bulunamadı.' });` satırını şununla değiştir:
```ts
  if (method === 'GET' && !url.pathname.startsWith('/api/')) return serveStatic(opts, url.pathname, res);
  sendJson(res, 404, { error: 'Bulunamadı.' });
}

function serveStatic(opts: ApiOptions, pathname: string, res: ServerResponse): void {
  if (pathname.startsWith('/assets3d/')) {
    const file = opts.assetsDir ? resolveInside(opts.assetsDir, pathname.slice('/assets3d'.length)) : null;
    if (file && sendFile(res, file)) return;
    return sendJson(res, 404, { error: 'Model bulunamadı.' });
  }
  if (opts.webDir) {
    const file = resolveInside(opts.webDir, pathname === '/' ? '/index.html' : pathname);
    if (file && sendFile(res, file)) return;
    const index = resolveInside(opts.webDir, '/index.html');
    if (index && sendFile(res, index)) return;
  }
  sendJson(res, 404, { error: 'Arayüz derlenmemiş: önce `pnpm --filter @cc/office-web build` çalıştır.' });
```
  (Bir sonraki satırdaki eski kapanış `}` artık `serveStatic`'i kapatır.)

`apps/office-server/src/main.ts` içinde `createApi(...)` çağrısını şununla değiştir:
```ts
const api = createApi(
  { engine, roster, events, quota },
  { allowedOrigins: config.allowedOrigins, webDir: config.webDir, assetsDir: config.assetsDir },
);
```

- [ ] **Step 5: Testlerin geçtiğini gör**

Run: `pnpm --filter @cc/office-server test && pnpm typecheck`
Expected: Hepsi PASS (önceki 80 + yeni testler).

- [ ] **Step 6: Commit**

```bash
git add apps/office-server
git commit -m "feat(server): serve the built office, models and the latest events"
```

---

### Task 2: office-web iskeleti ve manifest

**Files:**
- Create: `apps/office-web/package.json`, `apps/office-web/tsconfig.json`, `apps/office-web/vite.config.ts`, `apps/office-web/index.html`, `apps/office-web/src/main.tsx`, `apps/office-web/src/App.tsx` (geçici), `apps/office-web/src/assets/manifest.ts`
- Test: `apps/office-web/src/assets/manifest.test.ts`
- Modify: kök `package.json` (scripts)

**Interfaces:**
- Produces: `type ClipRole = 'idle' | 'walk' | 'sit' | 'sitDown' | 'typing' | 'talkSeated' | 'drink' | 'talk'`; `CLIP_ROLES`; `FurnitureAsset { id; kind: 'furniture'; file; height }`; `CharacterAsset { id; kind: 'character'; name; file; height; clips: Partial<Record<ClipRole, string>> }`; `AssetManifest { items }`; `EMPTY_MANIFEST`; `parseManifest(raw)`; `loadManifest(fetchFn?)`; `assetUrl(file)`; `furnitureAsset(m, id)`; `characterAssets(m)`; `characterAsset(m, id)`.

- [ ] **Step 1: Paket dosyalarını yaz**

`apps/office-web/package.json`:
```json
{
  "name": "@cc/office-web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@cc/shared": "workspace:*",
    "@react-three/drei": "^10.7.0",
    "@react-three/fiber": "^9.4.0",
    "react": "^19.3.0",
    "react-dom": "^19.3.0",
    "three": "^0.186.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@testing-library/react": "^16.3.0",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@types/three": "^0.186.0",
    "@vitejs/plugin-react": "^5.0.0",
    "jsdom": "^26.0.0",
    "typescript": "^5.9.0",
    "vite": "^7.3.0",
    "vitest": "^3.2.0"
  }
}
```

`apps/office-web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`apps/office-web/vite.config.ts`:
```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const office = 'http://127.0.0.1:4319';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
    proxy: { '/api': office, '/assets3d': office, '/ws': { target: office, ws: true } },
  },
  build: { chunkSizeWarningLimit: 2000 },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});
```

`apps/office-web/index.html`:
```html
<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>control-center</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/office-web/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
```

`apps/office-web/src/App.tsx` (Task 10'da yeniden yazılır):
```tsx
export function App() {
  return <div className="app">control-center</div>;
}
```

`apps/office-web/src/styles.css` (Task 10'da genişler):
```css
html, body, #root { height: 100%; margin: 0; }
```

Kök `package.json` `scripts` alanına ekle:
```json
    "office": "pnpm --filter @cc/office-web build && pnpm --filter @cc/office-server start",
```

Run: `cd ~/Projects/control-center && pnpm install`
Expected: bağımlılıklar kurulur, hata yok.

- [ ] **Step 2: Manifest için başarısız testi yaz**

`apps/office-web/src/assets/manifest.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { assetUrl, characterAsset, characterAssets, furnitureAsset, loadManifest, parseManifest } from './manifest.ts';

const RAW = {
  version: 1,
  items: [
    { id: 'work_desk', kind: 'furniture', file: 'furniture/work_desk.glb', height: 0.75 },
    { id: 'coder', kind: 'character', name: 'Kodcu', file: 'characters/coder/base.glb', height: 1.7, clips: { walk: 'characters/coder/walk.glb', typing: 'characters/coder/typing.glb', dance: 'x.glb' } },
    { id: 'bad-path', kind: 'furniture', file: '../.env', height: 1 },
    { id: 'abs-path', kind: 'furniture', file: '/etc/passwd', height: 1 },
    { id: 'no-height', kind: 'furniture', file: 'a.glb' },
    { id: 'unknown-kind', kind: 'lamp', file: 'a.glb', height: 1 },
    'çöp',
  ],
};

describe('manifest', () => {
  it('keeps valid furniture and characters with known clip roles only', () => {
    const m = parseManifest(RAW);
    expect(m.items.map((i) => i.id)).toEqual(['work_desk', 'coder']);
    expect(characterAsset(m, 'coder')).toEqual({
      id: 'coder',
      kind: 'character',
      name: 'Kodcu',
      file: 'characters/coder/base.glb',
      height: 1.7,
      clips: { walk: 'characters/coder/walk.glb', typing: 'characters/coder/typing.glb' },
    });
    expect(furnitureAsset(m, 'work_desk')?.height).toBe(0.75);
    expect(furnitureAsset(m, 'coder')).toBeNull();
    expect(characterAssets(m)).toHaveLength(1);
    expect(assetUrl('furniture/work_desk.glb')).toBe('/assets3d/furniture/work_desk.glb');
  });

  it('returns an empty manifest for anything unusable', async () => {
    expect(parseManifest(null).items).toEqual([]);
    expect(parseManifest({ items: 'x' }).items).toEqual([]);
    expect((await loadManifest(vi.fn(async () => new Response('', { status: 404 })))).items).toEqual([]);
    expect((await loadManifest(vi.fn(async () => { throw new Error('ağ yok'); }))).items).toEqual([]);
    const ok = await loadManifest(vi.fn(async () => new Response(JSON.stringify(RAW), { status: 200 })));
    expect(ok.items).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Testin başarısız olduğunu gör**

Run: `pnpm --filter @cc/office-web test`
Expected: FAIL — `./manifest.ts` yok.

- [ ] **Step 4: manifest.ts'i yaz**

`apps/office-web/src/assets/manifest.ts`:
```ts
export type ClipRole = 'idle' | 'walk' | 'sit' | 'sitDown' | 'typing' | 'talkSeated' | 'drink' | 'talk';
export const CLIP_ROLES: readonly ClipRole[] = ['idle', 'walk', 'sit', 'sitDown', 'typing', 'talkSeated', 'drink', 'talk'];

export interface FurnitureAsset {
  id: string;
  kind: 'furniture';
  file: string;
  height: number;
}

export interface CharacterAsset {
  id: string;
  kind: 'character';
  name: string;
  file: string;
  height: number;
  clips: Partial<Record<ClipRole, string>>;
}

export type Asset = FurnitureAsset | CharacterAsset;

export interface AssetManifest {
  items: Asset[];
}

export const ASSET_BASE = '/assets3d/';
export const EMPTY_MANIFEST: AssetManifest = { items: [] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const safeFile = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && !v.includes('..') && !v.startsWith('/') && !v.includes('\\');

export function parseManifest(raw: unknown): AssetManifest {
  if (!isObj(raw) || !Array.isArray(raw.items)) return EMPTY_MANIFEST;
  const items: Asset[] = [];
  for (const it of raw.items) {
    if (!isObj(it) || typeof it.id !== 'string' || !safeFile(it.file) || typeof it.height !== 'number' || !(it.height > 0)) continue;
    if (it.kind === 'furniture') {
      items.push({ id: it.id, kind: 'furniture', file: it.file, height: it.height });
    } else if (it.kind === 'character') {
      const clips: Partial<Record<ClipRole, string>> = {};
      if (isObj(it.clips)) {
        for (const role of CLIP_ROLES) {
          const file = it.clips[role];
          if (safeFile(file)) clips[role] = file;
        }
      }
      const name = typeof it.name === 'string' && it.name ? it.name : it.id;
      items.push({ id: it.id, kind: 'character', name, file: it.file, height: it.height, clips });
    }
  }
  return { items };
}

export async function loadManifest(fetchFn: typeof fetch = fetch): Promise<AssetManifest> {
  try {
    const res = await fetchFn(`${ASSET_BASE}manifest.json`);
    return res.ok ? parseManifest(await res.json()) : EMPTY_MANIFEST;
  } catch {
    return EMPTY_MANIFEST;
  }
}

export const assetUrl = (file: string): string => `${ASSET_BASE}${file}`;

export function furnitureAsset(m: AssetManifest, id: string): FurnitureAsset | null {
  return m.items.find((i): i is FurnitureAsset => i.kind === 'furniture' && i.id === id) ?? null;
}

export function characterAssets(m: AssetManifest): CharacterAsset[] {
  return m.items.filter((i): i is CharacterAsset => i.kind === 'character');
}

export function characterAsset(m: AssetManifest, id: string): CharacterAsset | null {
  return characterAssets(m).find((c) => c.id === id) ?? null;
}
```

- [ ] **Step 5: Testlerin ve tiplerin geçtiğini gör**

Run: `pnpm --filter @cc/office-web test && pnpm --filter @cc/office-web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml apps/office-web
git commit -m "feat(web): scaffold office-web and parse the asset manifest"
```

---

### Task 3: HTTP istemcisi ve canlı bağlantı

**Files:**
- Create: `apps/office-web/src/net/api.ts`, `apps/office-web/src/net/live.ts`
- Test: `apps/office-web/src/net/api.test.ts`, `apps/office-web/src/net/live.test.ts`

**Interfaces:**
- Produces: `class ApiError extends Error { status: number }`; `api.{ office(); hire(input); fire(id); send(id, text); sideQuestion(id, text); stop(id); resume(id); openTerminal(id); closeTerminal(id); events(id, tail?) }`; `connectLive(o: { onMessage(m: ServerMessage); onStatus(connected: boolean); getAfter(): number; url?(after): string; WebSocketImpl?; minDelayMs?; maxDelayMs? }): () => void`; `interface WebSocketLike`.

- [ ] **Step 1: Başarısız testleri yaz**

`apps/office-web/src/net/api.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api.ts';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(body === undefined ? '' : JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('api', () => {
  it('sends JSON with the right method and path', async () => {
    const fetchFn = stubFetch(202, { ok: true });
    await api.send('e1', 'merhaba');
    expect(fetchFn).toHaveBeenCalledWith('/api/employees/e1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'merhaba' }),
    });
  });

  it('sends an empty JSON body for body-less POSTs and none for GET/DELETE', async () => {
    const fetchFn = stubFetch(200, {});
    await api.stop('e1');
    expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', body: '{}' });
    await api.events('e1', 50);
    expect(fetchFn.mock.calls[1]?.[0]).toBe('/api/employees/e1/events?tail=50');
    expect(fetchFn.mock.calls[1]?.[1]).toMatchObject({ method: 'GET', body: undefined });
    stubFetch(204, undefined);
    await expect(api.fire('e1')).resolves.toBeNull();
  });

  it('turns error responses into ApiError with the server message', async () => {
    stubFetch(409, { error: 'Bu çalışan şu an terminalde; önce ofise geri al.' });
    const err = await api.send('e1', 'x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, message: 'Bu çalışan şu an terminalde; önce ofise geri al.' });
  });
});
```

`apps/office-web/src/net/live.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectLive, type WebSocketLike } from './live.ts';

class FakeSocket implements WebSocketLike {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  close() {
    this.closed = true;
    this.onclose?.();
  }
}

beforeEach(() => {
  FakeSocket.all = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('connectLive', () => {
  it('passes the last seen seq, forwards messages and ignores garbage', () => {
    const messages: unknown[] = [];
    const statuses: boolean[] = [];
    let after = 7;
    connectLive({ onMessage: (m) => messages.push(m), onStatus: (s) => statuses.push(s), getAfter: () => after, url: (a) => `ws://x/ws?after=${a}`, WebSocketImpl: FakeSocket });
    const ws = FakeSocket.all[0]!;
    expect(ws.url).toBe('ws://x/ws?after=7');
    ws.onopen?.();
    ws.onmessage?.({ data: JSON.stringify({ type: 'snapshot', snapshot: {} }) });
    ws.onmessage?.({ data: '{bozuk' });
    expect(messages).toEqual([{ type: 'snapshot', snapshot: {} }]);
    expect(statuses).toEqual([true]);
    after = 42;
    ws.onclose?.();
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.all[1]?.url).toBe('ws://x/ws?after=42');
  });

  it('backs off between reconnects and stops for good when closed', () => {
    const stop = connectLive({ onMessage: () => {}, onStatus: () => {}, getAfter: () => 0, url: () => 'ws://x', WebSocketImpl: FakeSocket, minDelayMs: 100, maxDelayMs: 300 });
    FakeSocket.all[0]!.onclose?.();
    vi.advanceTimersByTime(99);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.all[1]!.onclose?.();
    vi.advanceTimersByTime(200);
    expect(FakeSocket.all).toHaveLength(3);
    FakeSocket.all[2]!.onclose?.();
    vi.advanceTimersByTime(300);
    expect(FakeSocket.all).toHaveLength(4);
    stop();
    expect(FakeSocket.all[3]!.closed).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(FakeSocket.all).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Testlerin başarısız olduğunu gör**

Run: `pnpm --filter @cc/office-web test`
Expected: FAIL — `./api.ts`, `./live.ts` yok.

- [ ] **Step 3: api.ts ve live.ts'i yaz**

`apps/office-web/src/net/api.ts`:
```ts
import type { Employee, HireInput, OfficeSnapshot, StoredEvent } from '@cc/shared';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const init: RequestInit =
    method === 'POST'
      ? { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? '{}' : JSON.stringify(body) }
      : { method, body: undefined };
  const res = await fetch(path, init);
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const message = (data as { error?: unknown } | null)?.error;
    throw new ApiError(res.status, typeof message === 'string' ? message : `İstek başarısız (HTTP ${res.status}).`);
  }
  return data as T;
}

const employee = (id: string) => `/api/employees/${encodeURIComponent(id)}`;

export const api = {
  office: () => request<OfficeSnapshot>('GET', '/api/office'),
  hire: (input: HireInput) => request<Employee>('POST', '/api/employees', input),
  fire: (id: string) => request<null>('DELETE', employee(id)),
  send: (id: string, text: string) => request<{ ok: true }>('POST', `${employee(id)}/messages`, { text }),
  sideQuestion: (id: string, text: string) => request<{ ok: boolean; answer: string }>('POST', `${employee(id)}/side-questions`, { text }),
  stop: (id: string) => request<Employee>('POST', `${employee(id)}/stop`),
  resume: (id: string) => request<Employee>('POST', `${employee(id)}/resume`),
  openTerminal: (id: string) => request<{ command: string; employee: Employee }>('POST', `${employee(id)}/terminal`),
  closeTerminal: (id: string) => request<Employee>('DELETE', `${employee(id)}/terminal`),
  events: (id: string, tail = 500) => request<StoredEvent[]>('GET', `${employee(id)}/events?tail=${tail}`),
};
```

`apps/office-web/src/net/live.ts`:
```ts
import type { ServerMessage } from '@cc/shared';

export interface WebSocketLike {
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  close(): void;
}

export interface LiveOptions {
  onMessage: (m: ServerMessage) => void;
  onStatus: (connected: boolean) => void;
  /** The last seq the client has applied; the server replays everything after it. */
  getAfter: () => number;
  url?: (after: number) => string;
  WebSocketImpl?: new (url: string) => WebSocketLike;
  minDelayMs?: number;
  maxDelayMs?: number;
}

function defaultUrl(after: number): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws?after=${after}`;
}

/** Opens the live feed and keeps it open with exponential backoff. Returns a function that stops it. */
export function connectLive(o: LiveOptions): () => void {
  const Impl = o.WebSocketImpl ?? (WebSocket as unknown as new (url: string) => WebSocketLike);
  const minDelay = o.minDelayMs ?? 1000;
  const maxDelay = o.maxDelayMs ?? 10_000;
  const url = o.url ?? defaultUrl;
  let delay = minDelay;
  let stopped = false;
  let socket: WebSocketLike | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    timer = null;
    const ws = new Impl(url(o.getAfter()));
    socket = ws;
    ws.onopen = () => {
      delay = minDelay;
      o.onStatus(true);
    };
    ws.onmessage = (ev) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      o.onMessage(message);
    };
    ws.onclose = () => {
      o.onStatus(false);
      if (stopped) return;
      timer = setTimeout(open, delay);
      delay = Math.min(delay * 2, maxDelay);
    };
  };

  open();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    socket?.close();
  };
}
```

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `pnpm --filter @cc/office-web test && pnpm --filter @cc/office-web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/office-web/src/net
git commit -m "feat(web): add the office API client and a self-healing live feed"
```

---

### Task 4: Durum indirgeyicileri ve depo

**Files:**
- Create: `apps/office-web/src/store/reducers.ts`, `apps/office-web/src/store/office.ts`
- Test: `apps/office-web/src/store/reducers.test.ts`

**Interfaces:**
- Consumes: `api` (Task 3), `AssetManifest`, `EMPTY_MANIFEST` (Task 2), `@cc/shared` tipleri.
- Produces: `MAX_EVENTS = 500`; `interface EmployeeView { employee; events: StoredEvent[]; openTools: Record<string, number>; lastTurnFinishedAt: number | null; eventsLoaded: boolean }`; `interface OfficeData { lastSeq; quota; usage; views: Record<string, EmployeeView> }`; `EMPTY_DATA`; `applySnapshot(d, snap)`; `applyEvent(d, stored)`; `mergeEvents(view, loaded)`; `needsRefresh(stored)`; `openToolSince(view)`; zustand `useOffice` (`OfficeStore` = `OfficeData` + `connected; selectedId; manifest; typingAt; terminalCommands; hireOpen; receive(m); setConnected(c); refresh(); select(id); loadEvents(id); markTyping(id); setManifest(m); setTerminalCommand(id, cmd | null); setHireOpen(open)`).

- [ ] **Step 1: Başarısız testi yaz**

`apps/office-web/src/store/reducers.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Employee, OfficeEvent, OfficeSnapshot, StoredEvent } from '@cc/shared';
import { EMPTY_DATA, MAX_EVENTS, applyEvent, applySnapshot, mergeEvents, needsRefresh, openToolSince } from './reducers.ts';

const employee = (over: Partial<Employee> = {}): Employee => ({
  id: 'e1', slug: 'ada', name: 'Ada', role: 'r', model: 'haiku', characterId: 'coder', deskIndex: 0,
  sessionId: 's1', sessionStarted: false, lifecycle: 'idle', limitResetsAt: null, lastError: null, createdAt: 1, ...over,
});
const snapshot = (over: Partial<OfficeSnapshot> = {}): OfficeSnapshot => ({ employees: [employee()], quota: null, usage: {}, lastSeq: 10, ...over });
let seq = 10;
const stored = (event: OfficeEvent, employeeId: string | null = 'e1', ts = 1000): StoredEvent => ({ seq: ++seq, employeeId, ts, event });
const usage = { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0 };

describe('applySnapshot', () => {
  it('builds views and keeps loaded events of known employees', () => {
    const first = applySnapshot(EMPTY_DATA, snapshot());
    const withEvent = applyEvent(first, stored({ type: 'turn.started' }));
    const again = applySnapshot(withEvent, snapshot({ lastSeq: 5, employees: [employee({ lifecycle: 'working' })] }));
    expect(again.views.e1?.events).toHaveLength(1);
    expect(again.views.e1?.employee.lifecycle).toBe('working');
    expect(again.lastSeq).toBe(withEvent.lastSeq);
  });

  it('drops employees that are no longer in the snapshot', () => {
    const d = applySnapshot(applySnapshot(EMPTY_DATA, snapshot()), snapshot({ employees: [] }));
    expect(d.views).toEqual({});
  });
});

describe('applyEvent', () => {
  const base = () => applySnapshot(EMPTY_DATA, snapshot());

  it('follows lifecycle, tools, turns and session start', () => {
    let d = base();
    d = applyEvent(d, stored({ type: 'lifecycle.changed', from: 'idle', to: 'working', reason: 'x' }));
    d = applyEvent(d, stored({ type: 'session.started', model: 'm', mcp: [] }));
    d = applyEvent(d, stored({ type: 'tool.started', toolUseId: 't1', name: 'Bash', input: {} }, 'e1', 2000));
    expect(d.views.e1?.employee).toMatchObject({ lifecycle: 'working', sessionStarted: true });
    expect(openToolSince(d.views.e1!)).toBe(2000);
    d = applyEvent(d, stored({ type: 'tool.finished', toolUseId: 't1', isError: false, output: '' }));
    expect(openToolSince(d.views.e1!)).toBeNull();
    d = applyEvent(d, stored({ type: 'turn.finished', ok: true, subtype: 'success', usage, costUsd: 0.01, numTurns: 1, queuedTurns: 0, sessionUsage: null, sessionCostUsd: 0.01 }, 'e1', 3000));
    expect(d.views.e1?.lastTurnFinishedAt).toBe(3000);
    expect(d.usage.e1?.today).toMatchObject({ inputTokens: 10, outputTokens: 20, costUsd: 0.01 });
    d = applyEvent(d, stored({ type: 'side.answer', text: 'a', ok: true, usage, costUsd: 0.002 }));
    expect(d.usage.e1?.total.costUsd).toBeCloseTo(0.012);
  });

  it('keeps the turn open while claude has queued turns', () => {
    let d = applyEvent(base(), stored({ type: 'tool.started', toolUseId: 't1', name: 'Bash', input: {} }, 'e1', 2000));
    d = applyEvent(d, stored({ type: 'turn.finished', ok: true, subtype: 'success', usage, costUsd: 0, numTurns: 1, queuedTurns: 1, sessionUsage: null, sessionCostUsd: 0 }, 'e1', 3000));
    expect(d.views.e1?.lastTurnFinishedAt).toBeNull();
    expect(openToolSince(d.views.e1!)).toBe(2000);
  });

  it('review focus: ignores a replayed event it already has', () => {
    const e = stored({ type: 'message.assistant', text: 'bir kez' });
    const d = applyEvent(applyEvent(base(), e), e);
    expect(d.views.e1?.events).toHaveLength(1);
  });

  it('updates the quota but keeps a window the update omits', () => {
    let d = applyEvent(base(), stored({ type: 'quota.updated', status: 'allowed', fiveHour: { utilization: 0.1, resetsAt: 5 }, sevenDay: { utilization: 0.2, resetsAt: 6 } }, null, 7));
    d = applyEvent(d, stored({ type: 'quota.updated', status: 'allowed_warning', fiveHour: { utilization: 0.9, resetsAt: 5 }, sevenDay: null }, null, 8));
    expect(d.quota).toEqual({ status: 'allowed_warning', fiveHour: { utilization: 0.9, resetsAt: 5 }, sevenDay: { utilization: 0.2, resetsAt: 6 }, updatedAt: 8 });
  });

  it('caps the event list and ignores unknown employees', () => {
    let d = base();
    for (let i = 0; i < MAX_EVENTS + 5; i += 1) d = applyEvent(d, stored({ type: 'turn.started' }));
    expect(d.views.e1?.events).toHaveLength(MAX_EVENTS);
    const before = d.views;
    d = applyEvent(d, stored({ type: 'turn.started' }, 'ghost'));
    expect(d.views).toBe(before);
  });

  it('asks for a refresh when someone is hired or fired', () => {
    expect(needsRefresh(stored({ type: 'employee.hired', name: 'x' }))).toBe(true);
    expect(needsRefresh(stored({ type: 'employee.fired' }))).toBe(true);
    expect(needsRefresh(stored({ type: 'turn.started' }))).toBe(false);
  });
});

describe('mergeEvents', () => {
  it('merges history with live events in seq order and derives turn state', () => {
    let d = applySnapshot(EMPTY_DATA, snapshot());
    const live = stored({ type: 'message.assistant', text: 'canlı' }, 'e1', 9000);
    d = applyEvent(d, live);
    const history = [
      { seq: 1, employeeId: 'e1', ts: 100, event: { type: 'tool.started', toolUseId: 'old', name: 'Bash', input: {} } },
      { seq: 2, employeeId: 'e1', ts: 200, event: { type: 'turn.finished', ok: true, subtype: 'success', usage, costUsd: 0, numTurns: 1, queuedTurns: 0, sessionUsage: null, sessionCostUsd: 0 } },
      live,
    ] as StoredEvent[];
    const view = mergeEvents(d.views.e1!, history);
    expect(view.events.map((e) => e.seq)).toEqual([1, 2, live.seq]);
    expect(view.eventsLoaded).toBe(true);
    expect(view.lastTurnFinishedAt).toBe(200);
    expect(openToolSince(view)).toBeNull();
  });
});
```

- [ ] **Step 2: Testin başarısız olduğunu gör**

Run: `pnpm --filter @cc/office-web test`
Expected: FAIL — `./reducers.ts` yok.

- [ ] **Step 3: reducers.ts ve office.ts'i yaz**

`apps/office-web/src/store/reducers.ts`:
```ts
import type { Employee, EmployeeUsage, OfficeSnapshot, QuotaState, StoredEvent, Usage, UsageTotals } from '@cc/shared';

export const MAX_EVENTS = 500;

export interface EmployeeView {
  employee: Employee;
  events: StoredEvent[];
  /** toolUseId → when it started; a tool is open until its result arrives or the turn ends. */
  openTools: Record<string, number>;
  lastTurnFinishedAt: number | null;
  eventsLoaded: boolean;
}

export interface OfficeData {
  lastSeq: number;
  quota: QuotaState | null;
  usage: Record<string, EmployeeUsage>;
  views: Record<string, EmployeeView>;
}

export const EMPTY_DATA: OfficeData = { lastSeq: 0, quota: null, usage: {}, views: {} };

const ZERO: UsageTotals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 };

function addTo(t: UsageTotals, u: Usage, cost: number): UsageTotals {
  return {
    inputTokens: t.inputTokens + u.inputTokens,
    outputTokens: t.outputTokens + u.outputTokens,
    cacheReadTokens: t.cacheReadTokens + u.cacheReadTokens,
    cacheCreationTokens: t.cacheCreationTokens + u.cacheCreationTokens,
    costUsd: t.costUsd + cost,
  };
}

function addUsage(current: EmployeeUsage | undefined, u: Usage, cost: number): EmployeeUsage {
  return { today: addTo(current?.today ?? ZERO, u, cost), total: addTo(current?.total ?? ZERO, u, cost) };
}

export function applySnapshot(d: OfficeData, s: OfficeSnapshot): OfficeData {
  const views: Record<string, EmployeeView> = {};
  for (const employee of s.employees) {
    const prev = d.views[employee.id];
    views[employee.id] = prev
      ? { ...prev, employee }
      : { employee, events: [], openTools: {}, lastTurnFinishedAt: null, eventsLoaded: false };
  }
  return { lastSeq: Math.max(d.lastSeq, s.lastSeq), quota: s.quota, usage: s.usage, views };
}

export function applyEvent(d: OfficeData, s: StoredEvent): OfficeData {
  const ev = s.event;
  let quota = d.quota;
  if (ev.type === 'quota.updated') {
    quota = { status: ev.status, fiveHour: ev.fiveHour ?? d.quota?.fiveHour ?? null, sevenDay: ev.sevenDay ?? d.quota?.sevenDay ?? null, updatedAt: s.ts };
  }
  const next: OfficeData = { ...d, lastSeq: Math.max(d.lastSeq, s.seq), quota };
  const id = s.employeeId;
  const view = id ? d.views[id] : undefined;
  if (!id || !view) return next;
  if (view.events.some((x) => x.seq === s.seq)) return next;

  let v: EmployeeView = { ...view, events: [...view.events, s].slice(-MAX_EVENTS) };
  let usage = d.usage;
  switch (ev.type) {
    case 'lifecycle.changed':
      v = { ...v, employee: { ...v.employee, lifecycle: ev.to } };
      break;
    case 'session.started':
      v = { ...v, employee: { ...v.employee, sessionStarted: true } };
      break;
    case 'tool.started':
      v = { ...v, openTools: { ...v.openTools, [ev.toolUseId]: s.ts } };
      break;
    case 'tool.finished': {
      const openTools = { ...v.openTools };
      delete openTools[ev.toolUseId];
      v = { ...v, openTools };
      break;
    }
    case 'turn.finished':
      if (ev.queuedTurns === 0) v = { ...v, openTools: {}, lastTurnFinishedAt: s.ts };
      usage = { ...usage, [id]: addUsage(usage[id], ev.usage, ev.costUsd) };
      break;
    case 'side.answer':
      usage = { ...usage, [id]: addUsage(usage[id], ev.usage, ev.costUsd) };
      break;
    default:
      break;
  }
  return { ...next, usage, views: { ...d.views, [id]: v } };
}

/** Folds loaded history into a view (dedupe by seq) and re-derives the turn state from it. */
export function mergeEvents(view: EmployeeView, loaded: StoredEvent[]): EmployeeView {
  const bySeq = new Map<number, StoredEvent>();
  for (const e of [...loaded, ...view.events]) bySeq.set(e.seq, e);
  const events = [...bySeq.values()].sort((a, b) => a.seq - b.seq).slice(-MAX_EVENTS);
  let lastTurnFinishedAt = view.lastTurnFinishedAt;
  let openTools: Record<string, number> = {};
  for (const e of events) {
    if (e.event.type === 'tool.started') openTools = { ...openTools, [e.event.toolUseId]: e.ts };
    else if (e.event.type === 'tool.finished') {
      openTools = { ...openTools };
      delete openTools[e.event.toolUseId];
    } else if (e.event.type === 'turn.finished' && e.event.queuedTurns === 0) {
      openTools = {};
      lastTurnFinishedAt = Math.max(lastTurnFinishedAt ?? 0, e.ts);
    }
  }
  return { ...view, events, openTools, lastTurnFinishedAt, eventsLoaded: true };
}

export function needsRefresh(s: StoredEvent): boolean {
  return s.event.type === 'employee.hired' || s.event.type === 'employee.fired';
}

export function openToolSince(v: EmployeeView): number | null {
  const starts = Object.values(v.openTools);
  return starts.length > 0 ? Math.min(...starts) : null;
}
```

`apps/office-web/src/store/office.ts`:
```ts
import { create } from 'zustand';
import type { ServerMessage } from '@cc/shared';
import { EMPTY_MANIFEST, type AssetManifest } from '../assets/manifest.ts';
import { api } from '../net/api.ts';
import { EMPTY_DATA, applyEvent, applySnapshot, mergeEvents, needsRefresh, type OfficeData } from './reducers.ts';

export interface OfficeStore extends OfficeData {
  connected: boolean;
  selectedId: string | null;
  manifest: AssetManifest;
  /** employeeId → when the owner last typed to them (drives the "turns to you" pose). */
  typingAt: Record<string, number>;
  terminalCommands: Record<string, string>;
  hireOpen: boolean;
  receive: (m: ServerMessage) => void;
  setConnected: (connected: boolean) => void;
  refresh: () => Promise<void>;
  select: (id: string | null) => void;
  loadEvents: (id: string) => Promise<void>;
  markTyping: (id: string) => void;
  setManifest: (m: AssetManifest) => void;
  setTerminalCommand: (id: string, command: string | null) => void;
  setHireOpen: (open: boolean) => void;
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export const useOffice = create<OfficeStore>()((set, get) => ({
  ...EMPTY_DATA,
  connected: false,
  selectedId: null,
  manifest: EMPTY_MANIFEST,
  typingAt: {},
  terminalCommands: {},
  hireOpen: false,

  receive(m) {
    if (m.type === 'snapshot') {
      set((s) => applySnapshot(s, m.snapshot));
      return;
    }
    set((s) => applyEvent(s, m.event));
    if (needsRefresh(m.event)) {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void get().refresh(), 150);
    }
  },
  setConnected: (connected) => set({ connected }),
  async refresh() {
    try {
      const snapshot = await api.office();
      set((s) => applySnapshot(s, snapshot));
    } catch {
      // The next live snapshot brings the office back in sync.
    }
  },
  select(id) {
    set({ selectedId: id });
    const view = id ? get().views[id] : undefined;
    if (id && view && !view.eventsLoaded) void get().loadEvents(id);
  },
  async loadEvents(id) {
    const loaded = await api.events(id, 500).catch(() => null);
    if (!loaded) return;
    set((s) => {
      const view = s.views[id];
      return view ? { views: { ...s.views, [id]: mergeEvents(view, loaded) } } : {};
    });
  },
  markTyping: (id) => set((s) => ({ typingAt: { ...s.typingAt, [id]: Date.now() } })),
  setManifest: (manifest) => set({ manifest }),
  setTerminalCommand: (id, command) =>
    set((s) => {
      const terminalCommands = { ...s.terminalCommands };
      if (command) terminalCommands[id] = command;
      else delete terminalCommands[id];
      return { terminalCommands };
    }),
  setHireOpen: (hireOpen) => set({ hireOpen }),
}));
```

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `pnpm --filter @cc/office-web test && pnpm --filter @cc/office-web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/office-web/src/store
git commit -m "feat(web): add the office store and its pure reducers"
```

---

### Task 5: Durum → davranış kuralları

**Files:**
- Create: `apps/office-web/src/office/behavior.ts`
- Test: `apps/office-web/src/office/behavior.test.ts`

**Interfaces:**
- Consumes: `Lifecycle` (`@cc/shared`).
- Produces: `type Zone = 'desk' | 'server' | 'coffee' | 'lounge'`; `type Activity = 'typing' | 'sit' | 'talkSeated' | 'idle' | 'drink'`; `type Marker = 'none' | 'alert' | 'faded' | 'terminal'`; `interface Behavior { zone; activity; marker }`; `LONG_TOOL_MS = 30_000`, `IDLE_WANDER_MS = 60_000`, `TYPING_FRESH_MS = 5_000`; `behaviorOf(i: { lifecycle; openToolSince: number | null; idleSince: number; ownerTypingAt: number | null; now: number; wanderSeed: number }): Behavior`.

- [ ] **Step 1: Başarısız testi yaz**

`apps/office-web/src/office/behavior.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Lifecycle } from '@cc/shared';
import { IDLE_WANDER_MS, LONG_TOOL_MS, TYPING_FRESH_MS, behaviorOf } from './behavior.ts';

const NOW = 1_000_000;
const input = (lifecycle: Lifecycle, over: Partial<Parameters<typeof behaviorOf>[0]> = {}) =>
  behaviorOf({ lifecycle, openToolSince: null, idleSince: NOW, ownerTypingAt: null, now: NOW, wanderSeed: 0, ...over });

describe('behaviorOf (spec §6)', () => {
  it('working: types at the desk, goes to the server room for a long tool', () => {
    expect(input('working')).toEqual({ zone: 'desk', activity: 'typing', marker: 'none' });
    expect(input('working', { openToolSince: NOW - LONG_TOOL_MS + 1 })).toEqual({ zone: 'desk', activity: 'typing', marker: 'none' });
    expect(input('working', { openToolSince: NOW - LONG_TOOL_MS - 1 })).toEqual({ zone: 'server', activity: 'idle', marker: 'none' });
  });

  it('turns to the owner while they type', () => {
    const typing = { ownerTypingAt: NOW - TYPING_FRESH_MS + 1 };
    expect(input('working', typing)).toEqual({ zone: 'desk', activity: 'talkSeated', marker: 'none' });
    expect(input('idle', { ...typing, idleSince: NOW - IDLE_WANDER_MS * 5 })).toEqual({ zone: 'desk', activity: 'talkSeated', marker: 'none' });
    expect(input('working', { ownerTypingAt: NOW - TYPING_FRESH_MS - 1 }).activity).toBe('typing');
  });

  it('idle: stays at the desk for a minute, then coffee or lounge', () => {
    expect(input('idle', { idleSince: NOW - IDLE_WANDER_MS + 1 })).toEqual({ zone: 'desk', activity: 'sit', marker: 'none' });
    expect(input('idle', { idleSince: NOW - IDLE_WANDER_MS - 1, wanderSeed: 2 })).toEqual({ zone: 'coffee', activity: 'drink', marker: 'none' });
    expect(input('idle', { idleSince: NOW - IDLE_WANDER_MS - 1, wanderSeed: 3 })).toEqual({ zone: 'lounge', activity: 'idle', marker: 'none' });
    expect(input('starting').zone).toBe('desk');
  });

  it('review focus: an employee idle since long before the page loaded wanders off, a fresh hire sits down', () => {
    expect(input('idle', { idleSince: NOW - 3 * 60 * 60 * 1000 }).zone).not.toBe('desk');
    expect(input('idle', { idleSince: NOW - 2000 }).zone).toBe('desk');
  });

  it('marks trouble, stop and terminal at the desk', () => {
    for (const l of ['limited', 'error', 'interrupted'] as const) expect(input(l)).toEqual({ zone: 'desk', activity: 'sit', marker: 'alert' });
    expect(input('stopped')).toEqual({ zone: 'desk', activity: 'sit', marker: 'faded' });
    expect(input('in_terminal')).toEqual({ zone: 'desk', activity: 'sit', marker: 'terminal' });
  });
});
```

- [ ] **Step 2: Testin başarısız olduğunu gör**

Run: `pnpm --filter @cc/office-web test`
Expected: FAIL — `./behavior.ts` yok.

- [ ] **Step 3: behavior.ts'i yaz**

`apps/office-web/src/office/behavior.ts`:
```ts
import type { Lifecycle } from '@cc/shared';

export type Zone = 'desk' | 'server' | 'coffee' | 'lounge';
export type Activity = 'typing' | 'sit' | 'talkSeated' | 'idle' | 'drink';
export type Marker = 'none' | 'alert' | 'faded' | 'terminal';

export interface Behavior {
  zone: Zone;
  activity: Activity;
  marker: Marker;
}

export const LONG_TOOL_MS = 30_000;
export const IDLE_WANDER_MS = 60_000;
export const TYPING_FRESH_MS = 5_000;

export interface BehaviorInput {
  lifecycle: Lifecycle;
  /** Start of the oldest tool still running, if any. */
  openToolSince: number | null;
  /** When the employee last became idle: the last finished turn, or when they were hired. */
  idleSince: number;
  ownerTypingAt: number | null;
  now: number;
  /** Stable per employee (desk index) so the same person keeps wandering to the same place. */
  wanderSeed: number;
}

const at = (zone: Zone, activity: Activity, marker: Marker = 'none'): Behavior => ({ zone, activity, marker });

/** Spec §6: what the character does for a given employee state. Pure, so the scene only renders it. */
export function behaviorOf(i: BehaviorInput): Behavior {
  const ownerTyping = i.ownerTypingAt !== null && i.now - i.ownerTypingAt < TYPING_FRESH_MS;
  switch (i.lifecycle) {
    case 'working':
      if (ownerTyping) return at('desk', 'talkSeated');
      if (i.openToolSince !== null && i.now - i.openToolSince > LONG_TOOL_MS) return at('server', 'idle');
      return at('desk', 'typing');
    case 'idle':
    case 'starting':
      if (ownerTyping) return at('desk', 'talkSeated');
      if (i.now - i.idleSince < IDLE_WANDER_MS) return at('desk', 'sit');
      return i.wanderSeed % 2 === 0 ? at('coffee', 'drink') : at('lounge', 'idle');
    case 'limited':
    case 'error':
    case 'interrupted':
      return at('desk', 'sit', 'alert');
    case 'in_terminal':
      return at('desk', 'sit', 'terminal');
    default:
      return at('desk', 'sit', 'faded');
  }
}
```

- [ ] **Step 4: Testin geçtiğini gör**

Run: `pnpm --filter @cc/office-web test && pnpm --filter @cc/office-web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/office-web/src/office/behavior.ts apps/office-web/src/office/behavior.test.ts
git commit -m "feat(web): map employee state to where the character is and what it does"
```

---

### Task 6: Yerleşim, ızgara, A* ve hareket

**Files:**
- Create: `apps/office-web/src/office/grid.ts`, `apps/office-web/src/office/layout.ts`, `apps/office-web/src/office/motion.ts`
- Test: `apps/office-web/src/office/grid.test.ts`, `apps/office-web/src/office/layout.test.ts`, `apps/office-web/src/office/motion.test.ts`

**Interfaces:**
- Consumes: `Zone` (Task 5).
- Produces: `interface Pt { x; z }`; `interface Rect { x1; z1; x2; z2 }`; `interface Grid { cell; nx; nz; blocked: Uint8Array }`; `buildGrid(width, depth, cell, obstacles: Rect[]): Grid`; `cellOf(g, p): [number, number]`; `isFreeAt(g, p): boolean`; `findPath(g, from: Pt, to: Pt): Pt[]` (başlangıç hariç, `to` ile biter); `interface Wall { x1; z1; x2; z2; height; kind: 'solid' | 'window' | 'glass' | 'low' }`; `interface Placement { assetId; x; z; y; rotY; w; d; h; color; blocks }`; `interface Spot { x; z; rotY }`; `interface Carpet { x1; z1; x2; z2; color }`; `interface Layout { width; depth; cell; walls; furniture; carpets; seats; coffeeSpots; loungeSpots; serverSpots }`; `LAYOUT`; `obstaclesOf(layout): Rect[]`; `GRID`; `spotFor(layout, zone, index): Spot`; `stepAlong(path, pos, heading, speed, dt): { path; pos; heading; arrived }`.

- [ ] **Step 1: Başarısız testleri yaz**

`apps/office-web/src/office/grid.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildGrid, cellOf, findPath, isFreeAt } from './grid.ts';

// 10 × 6 m room, a wall around x = 5 (covering two cell columns) with a door between z = 2.5 and 3.5.
const grid = buildGrid(10, 6, 0.5, [
  { x1: 4.6, z1: 0, x2: 5.4, z2: 2.5 },
  { x1: 4.6, z1: 3.5, x2: 5.4, z2: 6 },
]);

describe('grid + A*', () => {
  it('marks cells inside obstacles as blocked', () => {
    expect(isFreeAt(grid, { x: 5, z: 1 })).toBe(false);
    expect(isFreeAt(grid, { x: 5, z: 3 })).toBe(true);
    expect(cellOf(grid, { x: 9.99, z: 0.01 })).toEqual([19, 0]);
    expect(cellOf(grid, { x: 50, z: -3 })).toEqual([19, 0]);
  });

  it('goes through the door and never through a blocked cell', () => {
    const path = findPath(grid, { x: 1, z: 1 }, { x: 9, z: 1 });
    expect(path.at(-1)).toEqual({ x: 9, z: 1 });
    expect(path.every((p) => isFreeAt(grid, p))).toBe(true);
    const pts = [{ x: 1, z: 1 }, ...path];
    let crossings = 0;
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      if ((a.x - 5) * (b.x - 5) < 0) {
        crossings += 1;
        const z = a.z + ((5 - a.x) / (b.x - a.x)) * (b.z - a.z);
        expect(z).toBeGreaterThan(2.5);
        expect(z).toBeLessThan(3.5);
      }
    }
    expect(crossings).toBe(1);
  });

  it('returns just the goal for the same cell or an unreachable goal', () => {
    expect(findPath(grid, { x: 1, z: 1 }, { x: 1.1, z: 1.1 })).toEqual([{ x: 1.1, z: 1.1 }]);
    const sealed = buildGrid(4, 4, 0.5, [{ x1: 1.6, z1: 0, x2: 2.4, z2: 4 }]);
    expect(findPath(sealed, { x: 0.5, z: 0.5 }, { x: 3.5, z: 0.5 })).toEqual([{ x: 3.5, z: 0.5 }]);
  });

  it('starts from the nearest free cell when standing in a blocked one', () => {
    const path = findPath(grid, { x: 5, z: 1 }, { x: 1, z: 1 });
    expect(path.at(-1)).toEqual({ x: 1, z: 1 });
    expect(path.slice(0, -1).every((p) => isFreeAt(grid, p))).toBe(true);
  });
});
```

`apps/office-web/src/office/layout.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { findPath, isFreeAt } from './grid.ts';
import { GRID, LAYOUT, spotFor } from './layout.ts';

const allSpots = [...LAYOUT.seats, ...LAYOUT.coffeeSpots, ...LAYOUT.loungeSpots, ...LAYOUT.serverSpots];

describe('office layout', () => {
  it('has eight desks and every spot stands on a free cell', () => {
    expect(LAYOUT.seats).toHaveLength(8);
    for (const s of allSpots) expect(isFreeAt(GRID, s), `${s.x},${s.z}`).toBe(true);
  });

  it('review focus: every seat reaches every other place through free cells only', () => {
    for (const seat of LAYOUT.seats) {
      for (const target of [...LAYOUT.coffeeSpots, ...LAYOUT.loungeSpots, ...LAYOUT.serverSpots]) {
        const path = findPath(GRID, seat, target);
        expect(path.at(-1)).toEqual({ x: target.x, z: target.z });
        expect(path.every((p) => isFreeAt(GRID, p)), `${seat.x},${seat.z} → ${target.x},${target.z}`).toBe(true);
      }
    }
  });

  it('review focus: leaves the server room through its door, not its wall', () => {
    const path = findPath(GRID, LAYOUT.serverSpots[0]!, LAYOUT.seats[0]!);
    const pts = [LAYOUT.serverSpots[0]!, ...path];
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      if ((a.x - 19.5) * (b.x - 19.5) < 0) {
        const z = a.z + ((19.5 - a.x) / (b.x - a.x)) * (b.z - a.z);
        expect(z, 'crossing the server room wall').toBeGreaterThan(5.2);
        expect(z).toBeLessThan(6.4);
      }
    }
  });

  it('maps zones to spots by desk index', () => {
    expect(spotFor(LAYOUT, 'desk', 3)).toBe(LAYOUT.seats[3]);
    expect(spotFor(LAYOUT, 'desk', 11)).toBe(LAYOUT.seats[3]);
    expect(spotFor(LAYOUT, 'coffee', 4)).toBe(LAYOUT.coffeeSpots[4 % LAYOUT.coffeeSpots.length]);
    expect(spotFor(LAYOUT, 'server', 1)).toBe(LAYOUT.serverSpots[1]);
    expect(spotFor(LAYOUT, 'lounge', 0)).toBe(LAYOUT.loungeSpots[0]);
  });
});
```

`apps/office-web/src/office/motion.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { stepAlong } from './motion.ts';

describe('stepAlong', () => {
  it('moves the right distance, turns toward the next point and arrives exactly', () => {
    const path = [{ x: 0, z: 2 }, { x: 2, z: 2 }];
    let s = stepAlong(path, { x: 0, z: 0 }, 0, 1, 1);
    expect(s.pos.x).toBeCloseTo(0);
    expect(s.pos.z).toBeCloseTo(1);
    expect(s.heading).toBeCloseTo(0);
    expect(s.arrived).toBe(false);
    s = stepAlong(s.path, s.pos, s.heading, 1, 1.5);
    expect(s.pos.x).toBeCloseTo(0.5);
    expect(s.pos.z).toBeCloseTo(2);
    expect(s.heading).toBeCloseTo(Math.PI / 2);
    s = stepAlong(s.path, s.pos, s.heading, 1, 10);
    expect(s).toMatchObject({ pos: { x: 2, z: 2 }, path: [], arrived: true });
  });

  it('is already there with an empty path', () => {
    expect(stepAlong([], { x: 1, z: 1 }, 0.5, 1, 1)).toEqual({ path: [], pos: { x: 1, z: 1 }, heading: 0.5, arrived: true });
  });
});
```

- [ ] **Step 2: Testlerin başarısız olduğunu gör**

Run: `pnpm --filter @cc/office-web test`
Expected: FAIL — `./grid.ts`, `./layout.ts`, `./motion.ts` yok.

- [ ] **Step 3: grid.ts, motion.ts ve layout.ts'i yaz**

`apps/office-web/src/office/grid.ts`:
```ts
export interface Pt {
  x: number;
  z: number;
}

export interface Rect {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export interface Grid {
  cell: number;
  nx: number;
  nz: number;
  blocked: Uint8Array;
}

export function buildGrid(width: number, depth: number, cell: number, obstacles: Rect[]): Grid {
  const nx = Math.round(width / cell);
  const nz = Math.round(depth / cell);
  const blocked = new Uint8Array(nx * nz);
  for (let k = 0; k < nz; k += 1) {
    for (let i = 0; i < nx; i += 1) {
      const cx = (i + 0.5) * cell;
      const cz = (k + 0.5) * cell;
      if (obstacles.some((r) => cx > r.x1 && cx < r.x2 && cz > r.z1 && cz < r.z2)) blocked[k * nx + i] = 1;
    }
  }
  return { cell, nx, nz, blocked };
}

export function cellOf(g: Grid, p: Pt): [number, number] {
  const i = Math.min(g.nx - 1, Math.max(0, Math.floor(p.x / g.cell)));
  const k = Math.min(g.nz - 1, Math.max(0, Math.floor(p.z / g.cell)));
  return [i, k];
}

const free = (g: Grid, i: number, k: number) => i >= 0 && k >= 0 && i < g.nx && k < g.nz && g.blocked[k * g.nx + i] === 0;

export function isFreeAt(g: Grid, p: Pt): boolean {
  const [i, k] = cellOf(g, p);
  return free(g, i, k);
}

const centerOf = (g: Grid, i: number, k: number): Pt => ({ x: (i + 0.5) * g.cell, z: (k + 0.5) * g.cell });

function nearestFree(g: Grid, i0: number, k0: number): [number, number] | null {
  if (free(g, i0, k0)) return [i0, k0];
  const seen = new Uint8Array(g.nx * g.nz);
  const queue: Array<[number, number]> = [[i0, k0]];
  seen[k0 * g.nx + i0] = 1;
  while (queue.length > 0) {
    const [i, k] = queue.shift()!;
    for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = i + di;
      const nk = k + dk;
      if (ni < 0 || nk < 0 || ni >= g.nx || nk >= g.nz || seen[nk * g.nx + ni]) continue;
      if (free(g, ni, nk)) return [ni, nk];
      seen[nk * g.nx + ni] = 1;
      queue.push([ni, nk]);
    }
  }
  return null;
}

/** A* over the grid (8-way, no corner cutting). Waypoints exclude the start and end exactly at `to`. */
export function findPath(g: Grid, from: Pt, to: Pt): Pt[] {
  const s0 = cellOf(g, from);
  const g0 = cellOf(g, to);
  const start = nearestFree(g, s0[0], s0[1]);
  const goal = nearestFree(g, g0[0], g0[1]);
  if (!start || !goal) return [to];
  const startIdx = start[1] * g.nx + start[0];
  const goalIdx = goal[1] * g.nx + goal[0];
  if (startIdx === goalIdx) return [to];

  const n = g.nx * g.nz;
  const gScore = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const h = (idx: number) => {
    const dx = Math.abs((idx % g.nx) - goal[0]);
    const dz = Math.abs(Math.floor(idx / g.nx) - goal[1]);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  };
  const open: Array<[number, number]> = [[h(startIdx), startIdx]];
  gScore[startIdx] = 0;

  while (open.length > 0) {
    let best = 0;
    for (let j = 1; j < open.length; j += 1) if (open[j]![0] < open[best]![0]) best = j;
    const [, current] = open.splice(best, 1)[0]!;
    if (current === goalIdx) break;
    if (closed[current]) continue;
    closed[current] = 1;
    const ci = current % g.nx;
    const ck = Math.floor(current / g.nx);
    for (let dk = -1; dk <= 1; dk += 1) {
      for (let di = -1; di <= 1; di += 1) {
        if (di === 0 && dk === 0) continue;
        const ni = ci + di;
        const nk = ck + dk;
        if (!free(g, ni, nk)) continue;
        if (di !== 0 && dk !== 0 && (!free(g, ci + di, ck) || !free(g, ci, ck + dk))) continue;
        const next = nk * g.nx + ni;
        const tentative = gScore[current]! + (di !== 0 && dk !== 0 ? Math.SQRT2 : 1);
        if (tentative < gScore[next]!) {
          gScore[next] = tentative;
          came[next] = current;
          open.push([tentative + h(next), next]);
        }
      }
    }
  }
  if (came[goalIdx] === -1) return [to];

  const cells: number[] = [];
  for (let c = goalIdx; c !== startIdx; c = came[c]!) cells.push(c);
  cells.reverse();
  // Keep only the corners of the route, then end exactly at the requested point.
  const pts = cells.map((c) => centerOf(g, c % g.nx, Math.floor(c / g.nx)));
  const corners: Pt[] = [];
  for (let j = 0; j < pts.length - 1; j += 1) {
    const prev = j === 0 ? centerOf(g, start[0], start[1]) : pts[j - 1]!;
    const here = pts[j]!;
    const next = pts[j + 1]!;
    const sameDirection = Math.sign(here.x - prev.x) === Math.sign(next.x - here.x) && Math.sign(here.z - prev.z) === Math.sign(next.z - here.z);
    if (!sameDirection) corners.push(here);
  }
  corners.push(to);
  return corners;
}
```

`apps/office-web/src/office/motion.ts`:
```ts
import type { Pt } from './grid.ts';

export interface Step {
  path: Pt[];
  pos: Pt;
  heading: number;
  arrived: boolean;
}

/** Walks `speed * dt` metres along `path`. Heading follows the walking direction (models face +Z). */
export function stepAlong(path: Pt[], pos: Pt, heading: number, speed: number, dt: number): Step {
  let remaining = speed * dt;
  let p = pos;
  let h = heading;
  const rest = [...path];
  while (remaining > 0 && rest.length > 0) {
    const target = rest[0]!;
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 1e-6) h = Math.atan2(dx, dz);
    if (dist <= remaining) {
      p = { x: target.x, z: target.z };
      remaining -= dist;
      rest.shift();
    } else {
      p = { x: p.x + (dx / dist) * remaining, z: p.z + (dz / dist) * remaining };
      remaining = 0;
    }
  }
  return { path: rest, pos: p, heading: h, arrived: rest.length === 0 };
}
```

`apps/office-web/src/office/layout.ts`:
```ts
import type { Zone } from './behavior.ts';
import { buildGrid, type Rect } from './grid.ts';

export interface Wall {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  height: number;
  kind: 'solid' | 'window' | 'glass' | 'low';
}

/** w/d/h are the item's own size before rotation; (x, z) is its centre on the floor, y lifts it onto a surface. */
export interface Placement {
  assetId: string;
  x: number;
  z: number;
  y: number;
  rotY: number;
  w: number;
  d: number;
  h: number;
  color: string;
  blocks: boolean;
}

export interface Spot {
  x: number;
  z: number;
  rotY: number;
}

export interface Carpet {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  color: string;
}

export interface Layout {
  width: number;
  depth: number;
  cell: number;
  walls: Wall[];
  furniture: Placement[];
  carpets: Carpet[];
  seats: Spot[];
  coffeeSpots: Spot[];
  loungeSpots: Spot[];
  serverSpots: Spot[];
}

const PI = Math.PI;
const item = (assetId: string, x: number, z: number, rotY: number, w: number, d: number, h: number, color: string, extra: Partial<Placement> = {}): Placement => ({
  assetId, x, z, y: 0, rotY, w, d, h, color, blocks: true, ...extra,
});

// Open workspace: four columns of back-to-back desk pairs (row 0 faces south, row 1 faces north).
const DESK_XS = [3.5, 6.2, 8.9, 11.6];
const desks: Placement[] = [];
const seats: Spot[] = [];
for (const [row, deskZ, chairZ, rotY] of [[0, 9.6, 8.75, 0], [1, 10.4, 11.25, PI]] as const) {
  DESK_XS.forEach((x, col) => {
    desks.push(item('work_desk', x, deskZ, rotY, 1.5, 0.8, 0.75, '#d8a96a'));
    desks.push(item((row + col) % 2 === 0 ? 'desktop_monitor' : 'laptop', x, deskZ + (row === 0 ? 0.15 : -0.15), rotY + PI, 0.6, 0.25, 0.45, '#2d3138', { y: 0.75, blocks: false }));
    desks.push(item('ergonomic_chair', x, chairZ, rotY, 0.6, 0.6, 1.0, '#3a3f47', { blocks: false }));
    seats.push({ x, z: chairZ, rotY });
  });
}

export const LAYOUT: Layout = {
  width: 24,
  depth: 18,
  cell: 0.5,
  walls: [
    { x1: 0, z1: 0, x2: 24, z2: 0, height: 3, kind: 'window' },
    { x1: 24, z1: 0, x2: 24, z2: 18, height: 3, kind: 'solid' },
    { x1: 0, z1: 18, x2: 24, z2: 18, height: 0.5, kind: 'low' },
    { x1: 0, z1: 0, x2: 0, z2: 18, height: 0.5, kind: 'low' },
    // Server room (north-east) with a door at z 5.2–6.4.
    { x1: 19.5, z1: 0, x2: 19.5, z2: 5.2, height: 3, kind: 'solid' },
    { x1: 19.5, z1: 6.4, x2: 19.5, z2: 7, height: 3, kind: 'solid' },
    { x1: 19.5, z1: 7, x2: 24, z2: 7, height: 3, kind: 'solid' },
    // Glass meeting room (north) with a door at x 11.8–13.2.
    { x1: 9, z1: 0, x2: 9, z2: 6, height: 2.6, kind: 'glass' },
    { x1: 16, z1: 0, x2: 16, z2: 6, height: 2.6, kind: 'glass' },
    { x1: 9, z1: 6, x2: 11.8, z2: 6, height: 2.6, kind: 'glass' },
    { x1: 13.2, z1: 6, x2: 16, z2: 6, height: 2.6, kind: 'glass' },
  ],
  furniture: [
    ...desks,
    item('filing_pedestal', 13.2, 10.0, 0, 0.5, 0.6, 0.7, '#e7e2da'),
    item('meeting_table_chairs', 12.5, 3.0, 0, 3.2, 2.2, 1.0, '#c99a5b'),
    item('whiteboard', 12.5, 0.3, 0, 2.0, 0.1, 1.3, '#f5f5f2', { y: 0.8, blocks: false }),
    item('server_rack', 23.3, 1.1, -PI / 2, 0.7, 0.9, 2.0, '#23262c'),
    item('server_rack', 23.3, 2.5, -PI / 2, 0.7, 0.9, 2.0, '#23262c'),
    item('server_rack', 23.3, 3.9, -PI / 2, 0.7, 0.9, 2.0, '#23262c'),
    item('coffee_counter_sink', 22.9, 9.6, -PI / 2, 3.0, 0.9, 1.0, '#e9e4dc'),
    item('espresso_machine', 22.9, 8.9, -PI / 2, 0.5, 0.4, 0.45, '#454a52', { y: 1.0, blocks: false }),
    item('orange_bar_stool', 21.9, 8.6, PI / 2, 0.45, 0.45, 0.75, '#e07a3a'),
    item('orange_bar_stool', 21.9, 9.6, PI / 2, 0.45, 0.45, 0.75, '#e07a3a'),
    item('orange_bar_stool', 21.9, 10.6, PI / 2, 0.45, 0.45, 0.75, '#e07a3a'),
    item('teal_lounge_sofa', 3.2, 16.8, PI, 3.0, 1.1, 0.9, '#3d8a8f'),
    item('lounge_coffee_table', 3.2, 15.1, 0, 1.4, 0.8, 0.45, '#c9a06a'),
    item('floor_lamp', 0.9, 16.9, 0, 0.4, 0.4, 1.7, '#efe7d2'),
    item('reception_desk', 14.5, 16.3, PI, 2.6, 1.0, 1.1, '#d3a46a'),
    item('low_credenza', 19.2, 17.4, PI, 2.0, 0.5, 0.7, '#cfa36d'),
    item('geometric_wall_art', 23.85, 14.5, -PI / 2, 1.2, 0.1, 1.2, '#e3a35c', { y: 1.2, blocks: false }),
    item('bookshelf', 0.4, 6.0, PI / 2, 2.4, 0.5, 2.0, '#c99a5b'),
    item('large_plant_pot', 0.8, 1.2, 0, 0.6, 0.6, 1.3, '#5f9a4a'),
    item('large_plant_pot', 8.4, 6.8, 0, 0.6, 0.6, 1.3, '#5f9a4a'),
    item('large_plant_pot', 17.6, 7.6, 0, 0.6, 0.6, 1.3, '#5f9a4a'),
    item('large_plant_pot', 0.8, 12.2, 0, 0.6, 0.6, 1.3, '#5f9a4a'),
    item('large_plant_pot', 7.6, 17.3, 0, 0.6, 0.6, 1.3, '#5f9a4a'),
    item('large_plant_pot', 18.8, 12.6, 0, 0.6, 0.6, 1.3, '#5f9a4a'),
  ],
  carpets: [
    { x1: 0.6, z1: 13.4, x2: 6.8, z2: 17.6, color: '#eadfcd' },
    { x1: 9.6, z1: 0.8, x2: 15.4, z2: 5.6, color: '#3f7f86' },
    { x1: 12.2, z1: 14.6, x2: 16.8, z2: 17.6, color: '#dccdb4' },
  ],
  seats,
  coffeeSpots: [
    { x: 20.9, z: 8.6, rotY: PI / 2 },
    { x: 20.9, z: 9.6, rotY: PI / 2 },
    { x: 20.9, z: 10.6, rotY: PI / 2 },
  ],
  loungeSpots: [
    { x: 5.4, z: 14.6, rotY: -PI / 2 },
    { x: 1.4, z: 14.4, rotY: PI / 2 },
    { x: 5.4, z: 16.0, rotY: -PI / 2 },
  ],
  serverSpots: [
    { x: 21.8, z: 1.8, rotY: PI / 2 },
    { x: 21.8, z: 3.2, rotY: PI / 2 },
  ],
};

const WALL_MARGIN = 0.35;
const ITEM_MARGIN = 0.2;

export function obstaclesOf(layout: Layout): Rect[] {
  const rects: Rect[] = layout.walls.map((w) => ({
    x1: Math.min(w.x1, w.x2) - WALL_MARGIN,
    z1: Math.min(w.z1, w.z2) - WALL_MARGIN,
    x2: Math.max(w.x1, w.x2) + WALL_MARGIN,
    z2: Math.max(w.z1, w.z2) + WALL_MARGIN,
  }));
  for (const p of layout.furniture) {
    if (!p.blocks) continue;
    const quarter = Math.abs(Math.round(p.rotY / (PI / 2))) % 2 === 1;
    const w = quarter ? p.d : p.w;
    const d = quarter ? p.w : p.d;
    rects.push({ x1: p.x - w / 2 - ITEM_MARGIN, z1: p.z - d / 2 - ITEM_MARGIN, x2: p.x + w / 2 + ITEM_MARGIN, z2: p.z + d / 2 + ITEM_MARGIN });
  }
  return rects;
}

export const GRID = buildGrid(LAYOUT.width, LAYOUT.depth, LAYOUT.cell, obstaclesOf(LAYOUT));

export function spotFor(layout: Layout, zone: Zone, index: number): Spot {
  const list = zone === 'desk' ? layout.seats : zone === 'coffee' ? layout.coffeeSpots : zone === 'lounge' ? layout.loungeSpots : layout.serverSpots;
  return list[((index % list.length) + list.length) % list.length]!;
}
```

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `pnpm --filter @cc/office-web test && pnpm --filter @cc/office-web typecheck`
Expected: PASS. Bir nokta engelli hücreye düşerse yerleşimdeki koordinatı (testin yazdığı `x,z`) düzelt — engel kurallarını gevşetme.

- [ ] **Step 5: Commit**

```bash
git add apps/office-web/src/office
git commit -m "feat(web): lay out the office and find walking routes with A*"
```

---

### Task 7: Biçimlendirme, etiketler, model ölçekleme ve klipler

**Files:**
- Create: `apps/office-web/src/ui/format.ts`, `apps/office-web/src/ui/labels.ts`, `apps/office-web/src/scene/fit.ts`, `apps/office-web/src/scene/clips.ts`
- Test: `apps/office-web/src/ui/format.test.ts`, `apps/office-web/src/scene/fit.test.ts`, `apps/office-web/src/scene/clips.test.ts`

**Interfaces:**
- Consumes: `ClipRole` (Task 2), `Lifecycle`, `UsageTotals` (`@cc/shared`), `Activity` (Task 5).
- Produces: `formatTokens(n)`, `formatCost(usd)`, `formatPercent(utilization)`, `formatReset(ms, now)`, `formatClock(ms)`, `tokensOf(totals | undefined)`, `summarizeToolInput(name, input)`; `lifecycleLabel(l)`, `canStop(l)`, `canResume(l)`; `fitToHeight(bounds, height): { scale; offset: [x, y, z] }`, `boundsOf(object)`; `pickClip(available: Partial<Record<ClipRole, unknown>>, role): ClipRole | null`, `inPlace(clip): AnimationClip`, `roleFor(activity, moving): ClipRole`.

- [ ] **Step 1: Başarısız testleri yaz**

`apps/office-web/src/ui/format.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formatClock, formatCost, formatPercent, formatReset, formatTokens, summarizeToolInput, tokensOf } from './format.ts';
import { canResume, canStop, lifecycleLabel } from './labels.ts';

describe('format', () => {
  it('formats tokens, cost and percent compactly', () => {
    expect(formatTokens(0)).toBe('0 tok');
    expect(formatTokens(950)).toBe('950 tok');
    expect(formatTokens(12_345)).toBe('12,3k tok');
    expect(formatTokens(2_500_000)).toBe('2,5M tok');
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(0.0406)).toBe('$0.04');
    expect(formatCost(12.5)).toBe('$12.50');
    expect(formatPercent(0.04)).toBe('%4');
    expect(formatPercent(1)).toBe('%100');
    expect(tokensOf(undefined)).toBe(0);
    expect(tokensOf({ inputTokens: 10, outputTokens: 20, cacheReadTokens: 99, cacheCreationTokens: 99, costUsd: 0 })).toBe(30);
  });

  it('formats reset times relative to now', () => {
    const now = new Date(2026, 9, 6, 14, 0).getTime();
    expect(formatReset(new Date(2026, 9, 6, 15, 40).getTime(), now)).toBe('15:40');
    expect(formatReset(new Date(2026, 9, 8, 9, 5).getTime(), now)).toBe('Per 09:05');
    expect(formatClock(new Date(2026, 9, 6, 8, 7, 3).getTime())).toBe('08:07');
  });

  it('summarizes tool input by tool', () => {
    expect(summarizeToolInput('Bash', { command: 'ls -la', description: 'list' })).toBe('ls -la');
    expect(summarizeToolInput('Read', { file_path: '/a/b.ts' })).toBe('/a/b.ts');
    expect(summarizeToolInput('Grep', { pattern: 'TODO' })).toBe('TODO');
    expect(summarizeToolInput('WebFetch', { url: 'https://x.test' })).toBe('https://x.test');
    expect(summarizeToolInput('Other', { a: 'x'.repeat(300) }).length).toBeLessThanOrEqual(120);
    expect(summarizeToolInput('Bash', null)).toBe('');
  });
});

describe('labels', () => {
  it('names every lifecycle in Turkish and knows which buttons apply', () => {
    expect(lifecycleLabel('working')).toBe('Çalışıyor');
    expect(lifecycleLabel('in_terminal')).toBe('Terminalde');
    expect(canStop('working')).toBe(true);
    expect(canStop('stopped')).toBe(false);
    expect(canResume('stopped')).toBe(true);
    expect(canResume('interrupted')).toBe(true);
    expect(canResume('working')).toBe(false);
  });
});
```

`apps/office-web/src/scene/fit.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { BoxGeometry, Mesh, Object3D } from 'three';
import { boundsOf, fitToHeight } from './fit.ts';

describe('fitToHeight', () => {
  it('scales to the wanted height and puts the base on the floor, centred', () => {
    const fit = fitToHeight({ min: { x: 1, y: -1, z: 2 }, max: { x: 3, y: 3, z: 4 } }, 2);
    expect(fit.scale).toBeCloseTo(0.5);
    expect(fit.offset[0]).toBeCloseTo(-1);
    expect(fit.offset[1]).toBeCloseTo(0.5);
    expect(fit.offset[2]).toBeCloseTo(-1.5);
  });

  it('leaves a flat model unscaled and reads bounds from an object', () => {
    expect(fitToHeight({ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 0, z: 1 } }, 2).scale).toBe(1);
    const root = new Object3D();
    root.add(new Mesh(new BoxGeometry(2, 4, 6)));
    const b = boundsOf(root);
    expect(b.max.y - b.min.y).toBeCloseTo(4);
  });
});
```

`apps/office-web/src/scene/clips.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three';
import { inPlace, pickClip, roleFor } from './clips.ts';

describe('clips', () => {
  it('falls back to a close clip when a role is missing', () => {
    expect(pickClip({ typing: 1, sit: 1, idle: 1 }, 'typing')).toBe('typing');
    expect(pickClip({ sit: 1, idle: 1 }, 'typing')).toBe('sit');
    expect(pickClip({ idle: 1 }, 'talkSeated')).toBe('idle');
    expect(pickClip({ idle: 1 }, 'walk')).toBe('idle');
    expect(pickClip({}, 'drink')).toBeNull();
  });

  it('keeps the hips in place horizontally for walking, keeps the bob and other tracks', () => {
    const hips = new VectorKeyframeTrack('Hips.position', [0, 1], [1, 2, 3, 5, 2.5, 9]);
    const spin = new QuaternionKeyframeTrack('Spine.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);
    const clip = inPlace(new AnimationClip('walk', 1, [hips, spin]));
    expect(Array.from(clip.tracks[0]!.values)).toEqual([1, 2, 3, 1, 2.5, 3]);
    expect(clip.tracks[1]!.name).toBe('Spine.quaternion');
    expect(Array.from(clip.tracks[1]!.values)).toEqual(Array.from(spin.values));
    expect(Array.from(hips.values)).toEqual([1, 2, 3, 5, 2.5, 9]);
  });

  it('walks while moving, otherwise does the activity', () => {
    expect(roleFor('typing', true)).toBe('walk');
    expect(roleFor('drink', false)).toBe('drink');
  });
});
```

- [ ] **Step 2: Testlerin başarısız olduğunu gör**

Run: `pnpm --filter @cc/office-web test`
Expected: FAIL — modüller yok.

- [ ] **Step 3: format.ts, labels.ts, fit.ts, clips.ts'i yaz**

`apps/office-web/src/ui/format.ts`:
```ts
import type { UsageTotals } from '@cc/shared';

const trNumber = (n: number, digits: number) => n.toFixed(digits).replace('.', ',');

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${trNumber(n / 1_000_000, 1)}M tok`;
  if (n >= 1_000) return `${trNumber(n / 1_000, 1)}k tok`;
  return `${Math.round(n)} tok`;
}

export const formatCost = (usd: number): string => `$${usd.toFixed(2)}`;
export const formatPercent = (utilization: number): string => `%${Math.round(utilization * 100)}`;
export const tokensOf = (t: UsageTotals | undefined): number => (t ? t.inputTokens + t.outputTokens : 0);

const pad = (n: number) => String(n).padStart(2, '0');
const DAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "15:40" for today, "Per 09:05" for another day. */
export function formatReset(ms: number, now: number): string {
  const d = new Date(ms);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  return sameDay ? formatClock(ms) : `${DAYS[d.getDay()]} ${formatClock(ms)}`;
}

const KEY_BY_TOOL: Record<string, string> = {
  Bash: 'command',
  Read: 'file_path',
  Write: 'file_path',
  Edit: 'file_path',
  NotebookEdit: 'notebook_path',
  Grep: 'pattern',
  Glob: 'pattern',
  WebFetch: 'url',
  WebSearch: 'query',
};

export function summarizeToolInput(name: string, input: unknown): string {
  if (typeof input !== 'object' || input === null) return '';
  const record = input as Record<string, unknown>;
  const key = KEY_BY_TOOL[name];
  const preferred = key ? record[key] : undefined;
  const text = typeof preferred === 'string' ? preferred : JSON.stringify(record);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}
```

`apps/office-web/src/ui/labels.ts`:
```ts
import type { Lifecycle } from '@cc/shared';

const LABELS: Record<Lifecycle, string> = {
  starting: 'Başlıyor',
  idle: 'Boşta',
  working: 'Çalışıyor',
  stopped: 'Durduruldu',
  in_terminal: 'Terminalde',
  limited: 'Limit doldu',
  interrupted: 'Kesildi',
  error: 'Hata',
  archived: 'İşten çıkarıldı',
};

export const lifecycleLabel = (l: Lifecycle): string => LABELS[l] ?? l;
export const canStop = (l: Lifecycle): boolean => l === 'idle' || l === 'working' || l === 'limited' || l === 'starting';
export const canResume = (l: Lifecycle): boolean => l === 'stopped' || l === 'interrupted' || l === 'error' || l === 'limited';
```

`apps/office-web/src/scene/fit.ts`:
```ts
import { Box3, type Object3D } from 'three';

interface Bounds {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

/** Uniform scale to `height` metres, base on the floor, centred on x/z. The source file's own scale is ignored. */
export function fitToHeight(b: Bounds, height: number): { scale: number; offset: [number, number, number] } {
  const sizeY = b.max.y - b.min.y;
  const scale = sizeY > 1e-6 ? height / sizeY : 1;
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  return { scale, offset: [-cx * scale, -b.min.y * scale, -cz * scale] };
}

export function boundsOf(object: Object3D): Bounds {
  const box = new Box3().setFromObject(object);
  return { min: box.min, max: box.max };
}
```

`apps/office-web/src/scene/clips.ts`:
```ts
import { AnimationClip, VectorKeyframeTrack } from 'three';
import type { ClipRole } from '../assets/manifest.ts';
import type { Activity } from '../office/behavior.ts';

const FALLBACK: Record<ClipRole, ClipRole[]> = {
  typing: ['typing', 'sit', 'idle'],
  sit: ['sit', 'idle'],
  talkSeated: ['talkSeated', 'sit', 'idle'],
  idle: ['idle'],
  drink: ['drink', 'idle'],
  walk: ['walk', 'idle'],
  sitDown: ['sitDown', 'sit', 'idle'],
  talk: ['talk', 'idle'],
};

export function pickClip(available: Partial<Record<ClipRole, unknown>>, role: ClipRole): ClipRole | null {
  for (const candidate of FALLBACK[role]) if (available[candidate] !== undefined) return candidate;
  return null;
}

/** Walking clips may carry root motion; the scene moves the character itself, so pin the hips on x/z. */
export function inPlace(clip: AnimationClip): AnimationClip {
  const out = clip.clone();
  out.tracks = out.tracks.map((track) => {
    if (!(track instanceof VectorKeyframeTrack) || !/Hips\.position$/.test(track.name)) return track;
    const values = Array.from(track.values);
    const x0 = values[0] ?? 0;
    const z0 = values[2] ?? 0;
    for (let i = 0; i < values.length; i += 3) {
      values[i] = x0;
      values[i + 2] = z0;
    }
    return new VectorKeyframeTrack(track.name, Array.from(track.times), values);
  });
  return out;
}

export const roleFor = (activity: Activity, moving: boolean): ClipRole => (moving ? 'walk' : activity);
```

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `pnpm --filter @cc/office-web test && pnpm --filter @cc/office-web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/office-web/src/ui/format.ts apps/office-web/src/ui/labels.ts apps/office-web/src/ui/format.test.ts apps/office-web/src/scene
git commit -m "feat(web): add formatting, Turkish labels, model fitting and clip selection"
```

---

### Task 8: 3D sahne — oda, eşyalar, karakterler

**Files:**
- Create: `apps/office-web/src/scene/ErrorBoundary.tsx`, `Room.tsx`, `FurnitureLayer.tsx`, `VoxelFigure.tsx`, `CharacterModel.tsx`, `Character.tsx`, `CharactersLayer.tsx`, `OfficeScene.tsx` (hepsi `apps/office-web/src/scene/` altında)
- Test: yok (WebGL); doğrulama Task 10'daki başsız Chrome ekran görüntüsüyle.

**Interfaces:**
- Consumes: `LAYOUT`, `GRID`, `spotFor`, `findPath`, `stepAlong` (Task 6), `behaviorOf` (Task 5), `useOffice`, `openToolSince` (Task 4), `assetUrl`, `furnitureAsset`, `characterAsset`, `characterAssets`, `CharacterAsset`, `ClipRole` (Task 2), `fitToHeight`, `boundsOf`, `pickClip`, `inPlace`, `roleFor` (Task 7), `formatTokens`, `formatCost`, `tokensOf` (Task 7).
- Produces: `<OfficeScene />`.

- [ ] **Step 1: Hata sınırı, oda ve eşyalar**

`apps/office-web/src/scene/ErrorBoundary.tsx`:
```tsx
import { Component, type ReactNode } from 'react';

/** A model that fails to load falls back to its voxel stand-in instead of taking the scene down. */
export class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn('model yüklenemedi, voksel yer tutucu gösteriliyor', error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
```

`apps/office-web/src/scene/Room.tsx`:
```tsx
import { LAYOUT, type Wall } from '../office/layout.ts';

const FRAME = '#2b2f36';
const WALL = '#f1ede6';

function WallMesh({ wall }: { wall: Wall }) {
  const dx = wall.x2 - wall.x1;
  const dz = wall.z2 - wall.z1;
  const len = Math.hypot(dx, dz);
  const rot = -Math.atan2(dz, dx);
  const cx = (wall.x1 + wall.x2) / 2;
  const cz = (wall.z1 + wall.z2) / 2;
  if (wall.kind === 'glass') {
    return (
      <group position={[cx, 0, cz]} rotation={[0, rot, 0]}>
        <mesh position={[0, wall.height / 2, 0]}>
          <boxGeometry args={[len, wall.height, 0.04]} />
          <meshStandardMaterial color="#bfe3ef" transparent opacity={0.22} />
        </mesh>
        <mesh position={[0, wall.height, 0]}>
          <boxGeometry args={[len, 0.08, 0.1]} />
          <meshStandardMaterial color={FRAME} />
        </mesh>
        <mesh position={[0, 0.04, 0]}>
          <boxGeometry args={[len, 0.08, 0.1]} />
          <meshStandardMaterial color={FRAME} />
        </mesh>
      </group>
    );
  }
  if (wall.kind === 'window') {
    const mullions = Math.max(1, Math.round(len / 1.5));
    return (
      <group position={[cx, 0, cz]} rotation={[0, rot, 0]}>
        <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
          <boxGeometry args={[len, 0.9, 0.25]} />
          <meshStandardMaterial color={WALL} />
        </mesh>
        <mesh position={[0, 1.9, 0]}>
          <boxGeometry args={[len, 2.0, 0.04]} />
          <meshStandardMaterial color="#a9d4ee" transparent opacity={0.35} />
        </mesh>
        <mesh position={[0, wall.height - 0.1, 0]} castShadow>
          <boxGeometry args={[len, 0.2, 0.25]} />
          <meshStandardMaterial color={WALL} />
        </mesh>
        {Array.from({ length: mullions + 1 }, (_, i) => (
          <mesh key={i} position={[-len / 2 + (i * len) / mullions, 1.9, 0]}>
            <boxGeometry args={[0.08, 2.0, 0.12]} />
            <meshStandardMaterial color={FRAME} />
          </mesh>
        ))}
      </group>
    );
  }
  return (
    <mesh position={[cx, wall.height / 2, cz]} rotation={[0, rot, 0]} castShadow receiveShadow>
      <boxGeometry args={[len + 0.2, wall.height, 0.2]} />
      <meshStandardMaterial color={wall.kind === 'low' ? '#9a958c' : WALL} />
    </mesh>
  );
}

export function Room() {
  return (
    <group>
      <mesh position={[LAYOUT.width / 2, -0.1, LAYOUT.depth / 2]} receiveShadow>
        <boxGeometry args={[LAYOUT.width + 0.4, 0.2, LAYOUT.depth + 0.4]} />
        <meshStandardMaterial color="#d5cfc5" />
      </mesh>
      {LAYOUT.carpets.map((c, i) => (
        <mesh key={i} position={[(c.x1 + c.x2) / 2, 0.012, (c.z1 + c.z2) / 2]} receiveShadow>
          <boxGeometry args={[c.x2 - c.x1, 0.024, c.z2 - c.z1]} />
          <meshStandardMaterial color={c.color} />
        </mesh>
      ))}
      {LAYOUT.walls.map((w, i) => (
        <WallMesh key={i} wall={w} />
      ))}
    </group>
  );
}
```

`apps/office-web/src/scene/FurnitureLayer.tsx`:
```tsx
import { useGLTF } from '@react-three/drei';
import { Suspense, useEffect, useMemo } from 'react';
import type { Mesh } from 'three';
import { assetUrl, furnitureAsset } from '../assets/manifest.ts';
import { LAYOUT, type Placement } from '../office/layout.ts';
import { useOffice } from '../store/office.ts';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { boundsOf, fitToHeight } from './fit.ts';

function VoxelBox({ p }: { p: Placement }) {
  return (
    <mesh position={[0, p.h / 2, 0]} castShadow receiveShadow>
      <boxGeometry args={[p.w, p.h, p.d]} />
      <meshStandardMaterial color={p.color} />
    </mesh>
  );
}

function AssetModel({ url, height }: { url: string; height: number }) {
  const { scene } = useGLTF(url);
  const object = useMemo(() => scene.clone(true), [scene]);
  const fit = useMemo(() => fitToHeight(boundsOf(object), height), [object, height]);
  useEffect(() => {
    object.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }, [object]);
  return <primitive object={object} scale={fit.scale} position={fit.offset} />;
}

export function FurnitureLayer() {
  const manifest = useOffice((s) => s.manifest);
  return (
    <group>
      {LAYOUT.furniture.map((p, i) => {
        const asset = furnitureAsset(manifest, p.assetId);
        const fallback = <VoxelBox p={p} />;
        return (
          <group key={i} position={[p.x, p.y, p.z]} rotation={[0, p.rotY, 0]}>
            {asset ? (
              <ErrorBoundary fallback={fallback}>
                <Suspense fallback={fallback}>
                  <AssetModel url={assetUrl(asset.file)} height={p.h} />
                </Suspense>
              </ErrorBoundary>
            ) : (
              fallback
            )}
          </group>
        );
      })}
    </group>
  );
}
```

- [ ] **Step 2: Karakterler**

`apps/office-web/src/scene/VoxelFigure.tsx`:
```tsx
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type { Group } from 'three';
import type { ClipRole } from '../assets/manifest.ts';

const SHIRTS = ['#2f6fdf', '#5b7f45', '#e07a3a', '#283a6b', '#8a4fbf', '#c0392b', '#1f8a8a', '#7a5c3e'];

function hash(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

/** Stand-in when no character model is available: a small voxel person that sits, walks and types. */
export function VoxelFigure({ seed, role, faded }: { seed: string; role: ClipRole; faded: boolean }) {
  const shirt = useMemo(() => SHIRTS[hash(seed) % SHIRTS.length]!, [seed]);
  const body = useRef<Group>(null);
  const seated = role === 'sit' || role === 'typing' || role === 'talkSeated';
  useFrame(({ clock }) => {
    const b = body.current;
    if (!b) return;
    const t = clock.getElapsedTime();
    b.position.y = (seated ? -0.35 : 0) + (role === 'walk' ? Math.abs(Math.sin(t * 8)) * 0.05 : 0);
    b.rotation.x = role === 'typing' ? Math.sin(t * 12) * 0.02 : 0;
  });
  const material = (color: string) => <meshStandardMaterial color={color} transparent={faded} opacity={faded ? 0.45 : 1} />;
  return (
    <group ref={body}>
      <mesh position={[-0.1, 0.4, seated ? 0.2 : 0]} castShadow>
        <boxGeometry args={[0.16, seated ? 0.3 : 0.8, seated ? 0.5 : 0.18]} />
        {material('#24272d')}
      </mesh>
      <mesh position={[0.1, 0.4, seated ? 0.2 : 0]} castShadow>
        <boxGeometry args={[0.16, seated ? 0.3 : 0.8, seated ? 0.5 : 0.18]} />
        {material('#24272d')}
      </mesh>
      <mesh position={[0, 1.1, 0]} castShadow>
        <boxGeometry args={[0.5, 0.6, 0.28]} />
        {material(shirt)}
      </mesh>
      <mesh position={[0, 1.6, 0]} castShadow>
        <boxGeometry args={[0.36, 0.36, 0.36]} />
        {material('#f0c39a')}
      </mesh>
      <mesh position={[0, 1.82, -0.02]} castShadow>
        <boxGeometry args={[0.4, 0.12, 0.4]} />
        {material('#2a1d17')}
      </mesh>
    </group>
  );
}
```

`apps/office-web/src/scene/CharacterModel.tsx`:
```tsx
import { useAnimations, useGLTF } from '@react-three/drei';
import { useEffect, useMemo, useRef } from 'react';
import type { AnimationAction, AnimationClip, Group, Material, Mesh } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { assetUrl, type CharacterAsset, type ClipRole } from '../assets/manifest.ts';
import { inPlace, pickClip } from './clips.ts';
import { boundsOf, fitToHeight } from './fit.ts';

export function CharacterModel({ asset, role, faded }: { asset: CharacterAsset; role: ClipRole; faded: boolean }) {
  const roles = useMemo(() => Object.keys(asset.clips) as ClipRole[], [asset]);
  const urls = useMemo(() => [assetUrl(asset.file), ...roles.map((r) => assetUrl(asset.clips[r]!))], [asset, roles]);
  const loaded = useGLTF(urls);
  const [base, ...clipFiles] = loaded;

  const model = useMemo(() => {
    const copy = cloneSkinned(base!.scene);
    copy.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : (mesh.material as Material).clone();
    });
    return copy;
  }, [base]);
  const fit = useMemo(() => fitToHeight(boundsOf(model), asset.height), [model, asset.height]);

  const clips = useMemo(() => {
    const out: Partial<Record<ClipRole, AnimationClip>> = {};
    roles.forEach((r, i) => {
      const source = clipFiles[i]?.animations[0];
      if (!source) return;
      const clip = r === 'walk' ? inPlace(source) : source.clone();
      clip.name = r;
      out[r] = clip;
    });
    return out;
  }, [roles, clipFiles]);

  const root = useRef<Group>(null);
  const { actions } = useAnimations(Object.values(clips) as AnimationClip[], root);
  const current = useRef<ClipRole | null>(null);

  useEffect(() => {
    const target = pickClip(clips, role);
    if (!target || target === current.current) return;
    const next = actions[target] as AnimationAction | null | undefined;
    if (!next) return;
    const previous = current.current ? (actions[current.current] as AnimationAction | null | undefined) : null;
    next.reset().fadeIn(0.25).play();
    previous?.fadeOut(0.25);
    current.current = target;
  }, [role, actions, clips]);

  useEffect(() => {
    model.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        m.transparent = faded;
        m.opacity = faded ? 0.45 : 1;
        m.needsUpdate = true;
      }
    });
  }, [model, faded]);

  return (
    <group ref={root}>
      <primitive object={model} scale={fit.scale} position={fit.offset} />
    </group>
  );
}
```

`apps/office-web/src/scene/Character.tsx`:
```tsx
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useRef, useState } from 'react';
import type { Group } from 'three';
import type { Employee, EmployeeUsage } from '@cc/shared';
import type { CharacterAsset } from '../assets/manifest.ts';
import type { Behavior } from '../office/behavior.ts';
import { findPath, type Pt } from '../office/grid.ts';
import { GRID, type Spot } from '../office/layout.ts';
import { stepAlong } from '../office/motion.ts';
import { useOffice } from '../store/office.ts';
import { formatCost, formatTokens, tokensOf } from '../ui/format.ts';
import { CharacterModel } from './CharacterModel.tsx';
import { roleFor } from './clips.ts';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { VoxelFigure } from './VoxelFigure.tsx';

const WALK_SPEED = 1.4;

interface Props {
  employee: Employee;
  behavior: Behavior;
  spot: Spot;
  asset: CharacterAsset | null;
  usage: EmployeeUsage | undefined;
  selected: boolean;
}

export function Character({ employee, behavior, spot, asset, usage, selected }: Props) {
  const select = useOffice((s) => s.select);
  const group = useRef<Group>(null);
  const motion = useRef<{ pos: Pt; heading: number; path: Pt[]; moving: boolean; goal: string }>({
    pos: { x: spot.x, z: spot.z },
    heading: spot.rotY,
    path: [],
    moving: false,
    goal: '',
  });
  const [moving, setMoving] = useState(false);
  const goal = `${spot.x},${spot.z},${spot.rotY}`;

  useEffect(() => {
    const m = motion.current;
    if (m.goal === goal) return;
    const first = m.goal === '';
    m.goal = goal;
    if (first) return;
    m.path = findPath(GRID, m.pos, { x: spot.x, z: spot.z });
    m.moving = true;
  }, [goal, spot.x, spot.z]);

  useFrame((_, dt) => {
    const m = motion.current;
    const g = group.current;
    if (!g) return;
    if (m.moving) {
      const step = stepAlong(m.path, m.pos, m.heading, WALK_SPEED, Math.min(dt, 0.1));
      m.pos = step.pos;
      m.heading = step.heading;
      m.path = step.path;
      if (step.arrived) {
        m.moving = false;
        m.heading = spot.rotY;
      }
    }
    g.position.set(m.pos.x, 0, m.pos.z);
    g.rotation.y = m.heading;
    if (m.moving !== moving) setMoving(m.moving);
  });

  const role = roleFor(behavior.activity, moving);
  const faded = behavior.marker === 'faded' || behavior.marker === 'terminal';
  const figure = <VoxelFigure seed={employee.name} role={role} faded={faded} />;
  const today = usage?.today;

  return (
    <group
      ref={group}
      onClick={(e) => {
        e.stopPropagation();
        select(employee.id);
      }}
    >
      {asset ? (
        <ErrorBoundary fallback={figure}>
          <Suspense fallback={figure}>
            <CharacterModel asset={asset} role={role} faded={faded} />
          </Suspense>
        </ErrorBoundary>
      ) : (
        figure
      )}
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.45, 0.56, 40]} />
          <meshBasicMaterial color="#f08a3c" />
        </mesh>
      )}
      <Html position={[0, 2.25, 0]} center zIndexRange={[20, 0]}>
        <button type="button" className={`tag ${behavior.marker} ${selected ? 'selected' : ''}`} onClick={() => select(employee.id)}>
          <span className={`dot ${employee.lifecycle}`} aria-hidden="true" />
          <strong>{employee.name}</strong>
          <span className="tag-usage">
            {formatTokens(tokensOf(today))} · {formatCost(today?.costUsd ?? 0)}
          </span>
          {behavior.marker === 'alert' && <span aria-label="dikkat">⚠</span>}
          {behavior.marker === 'terminal' && <span aria-label="terminalde">⌨</span>}
        </button>
      </Html>
    </group>
  );
}
```

`apps/office-web/src/scene/CharactersLayer.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { characterAsset, characterAssets } from '../assets/manifest.ts';
import { behaviorOf } from '../office/behavior.ts';
import { LAYOUT, spotFor } from '../office/layout.ts';
import { useOffice } from '../store/office.ts';
import { openToolSince } from '../store/reducers.ts';
import { Character } from './Character.tsx';

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function CharactersLayer() {
  const views = useOffice((s) => s.views);
  const usage = useOffice((s) => s.usage);
  const manifest = useOffice((s) => s.manifest);
  const typingAt = useOffice((s) => s.typingAt);
  const selectedId = useOffice((s) => s.selectedId);
  const now = useNow(1000);
  const fallbackAsset = characterAssets(manifest)[0] ?? null;

  return (
    <group>
      {Object.values(views)
        .filter((v) => v.employee.lifecycle !== 'archived')
        .map((v) => {
          const e = v.employee;
          const behavior = behaviorOf({
            lifecycle: e.lifecycle,
            openToolSince: openToolSince(v),
            idleSince: v.lastTurnFinishedAt ?? e.createdAt,
            ownerTypingAt: typingAt[e.id] ?? null,
            now,
            wanderSeed: e.deskIndex,
          });
          return (
            <Character
              key={e.id}
              employee={e}
              behavior={behavior}
              spot={spotFor(LAYOUT, behavior.zone, e.deskIndex)}
              asset={characterAsset(manifest, e.characterId) ?? fallbackAsset}
              usage={usage[e.id]}
              selected={selectedId === e.id}
            />
          );
        })}
    </group>
  );
}
```

`apps/office-web/src/scene/OfficeScene.tsx`:
```tsx
import { MapControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { LAYOUT } from '../office/layout.ts';
import { useOffice } from '../store/office.ts';
import { CharactersLayer } from './CharactersLayer.tsx';
import { FurnitureLayer } from './FurnitureLayer.tsx';
import { Room } from './Room.tsx';

export function OfficeScene() {
  const select = useOffice((s) => s.select);
  return (
    <Canvas
      className="scene"
      orthographic
      shadows
      dpr={[1, 2]}
      camera={{ position: [22, 26, 22], zoom: 34, near: -200, far: 400 }}
      onPointerMissed={() => select(null)}
    >
      <color attach="background" args={['#e6e9ef']} />
      <hemisphereLight args={['#ffffff', '#9aa0aa', 1.25]} />
      <directionalLight
        position={[12, 28, 10]}
        intensity={1.8}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
      />
      {/* The office's centre sits at the origin so the camera, light and controls all aim at it. */}
      <group position={[-LAYOUT.width / 2, 0, -LAYOUT.depth / 2]}>
        <Room />
        <FurnitureLayer />
        <CharactersLayer />
      </group>
      <MapControls makeDefault target={[0, 0, 0]} enableDamping maxPolarAngle={Math.PI / 2.6} minPolarAngle={Math.PI / 6} minZoom={16} maxZoom={140} />
    </Canvas>
  );
}
```

- [ ] **Step 3: Tipleri kontrol et**

Run: `pnpm --filter @cc/office-web typecheck && pnpm --filter @cc/office-web test`
Expected: tip hatası yok, testler PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/office-web/src/scene
git commit -m "feat(web): render the voxel office, its furniture and walking characters"
```

---

### Task 9: Arayüz — üst çubuk, kota, işe alma, panel

**Files:**
- Create: `apps/office-web/src/ui/QuotaHud.tsx`, `TopBar.tsx`, `HireDialog.tsx`, `EventItem.tsx`, `Panel.tsx` (hepsi `apps/office-web/src/ui/` altında)
- Test: `apps/office-web/src/ui/Panel.test.tsx`, `apps/office-web/src/ui/HireDialog.test.tsx`

**Interfaces:**
- Consumes: `api` (Task 3), `useOffice` (Task 4), `characterAssets` (Task 2), `format.ts`, `labels.ts` (Task 7).
- Produces: `<TopBar />`, `<QuotaHud quota now />`, `<HireDialog />`, `<Panel id />`, `<EventItem stored />`.

- [ ] **Step 1: Başarısız testleri yaz**

`apps/office-web/src/ui/Panel.test.tsx`:
```tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Employee, StoredEvent } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { Panel } from './Panel.tsx';

vi.mock('../net/api.ts', () => ({
  api: {
    send: vi.fn(async () => ({ ok: true })),
    sideQuestion: vi.fn(async () => ({ ok: true, answer: 'tamam' })),
    stop: vi.fn(async () => ({})),
    resume: vi.fn(async () => ({})),
    openTerminal: vi.fn(async () => ({ command: "cd '/d/ada' && claude --resume s1", employee: {} })),
    closeTerminal: vi.fn(async () => ({})),
    fire: vi.fn(async () => null),
    events: vi.fn(async () => []),
    office: vi.fn(async () => ({ employees: [], quota: null, usage: {}, lastSeq: 0 })),
  },
}));
const { api } = await import('../net/api.ts');

const employee: Employee = {
  id: 'e1', slug: 'ada', name: 'Ada', role: 'Testleri yazan yazılımcı', model: 'haiku', characterId: 'coder', deskIndex: 0,
  sessionId: 's1', sessionStarted: true, lifecycle: 'working', limitResetsAt: null, lastError: null, createdAt: 1,
};
const events: StoredEvent[] = [
  { seq: 1, employeeId: 'e1', ts: 1000, event: { type: 'message.user', text: 'merhaba', source: 'owner' } },
  { seq: 2, employeeId: 'e1', ts: 1100, event: { type: 'tool.started', toolUseId: 't', name: 'Bash', input: { command: 'ls -la' } } },
  { seq: 3, employeeId: 'e1', ts: 1200, event: { type: 'message.assistant', text: '<img src=x onerror=alert(1)> bitti' } },
];

beforeEach(() => {
  useOffice.setState({
    views: { e1: { employee, events, openTools: {}, lastTurnFinishedAt: null, eventsLoaded: true } },
    usage: { e1: { today: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.04 }, total: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.04 } } },
    selectedId: 'e1',
    terminalCommands: {},
    typingAt: {},
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Panel', () => {
  it('shows who, how much and the live stream', () => {
    render(<Panel id="e1" />);
    expect(screen.getByRole('heading', { name: 'Ada' })).toBeTruthy();
    expect(screen.getByText('Çalışıyor')).toBeTruthy();
    expect(screen.getByText('merhaba')).toBeTruthy();
    expect(screen.getByText('ls -la')).toBeTruthy();
    expect(screen.getByText(/1,5k tok/)).toBeTruthy();
  });

  it('review focus: shows employee text as plain text, never as HTML', () => {
    const { container } = render(<Panel id="e1" />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)> bitti')).toBeTruthy();
  });

  it('sends a message on Enter and marks the owner as typing', async () => {
    render(<Panel id="e1" />);
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'yeni iş' } });
    expect(useOffice.getState().typingAt.e1).toBeGreaterThan(0);
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(api.send).toHaveBeenCalledWith('e1', 'yeni iş'));
  });

  it('routes to a side question when the switch is on', async () => {
    render(<Panel id="e1" />);
    fireEvent.click(screen.getByLabelText('Yan soru'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ne durumdasın?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gönder' }));
    await waitFor(() => expect(api.sideQuestion).toHaveBeenCalledWith('e1', 'ne durumdasın?'));
    expect(api.send).not.toHaveBeenCalled();
  });

  it('stops, and shows the terminal command to copy', async () => {
    render(<Panel id="e1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Durdur' }));
    await waitFor(() => expect(api.stop).toHaveBeenCalledWith('e1'));
    fireEvent.click(screen.getByRole('button', { name: 'Terminalde aç' }));
    await waitFor(() => expect(screen.getByText("cd '/d/ada' && claude --resume s1")).toBeTruthy());
  });

  it('shows an API error instead of failing silently', async () => {
    vi.mocked(api.send).mockRejectedValueOnce(new Error('Bu çalışan şu an terminalde; önce ofise geri al.'));
    render(<Panel id="e1" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gönder' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Bu çalışan şu an terminalde; önce ofise geri al.');
  });
});
```

`apps/office-web/src/ui/HireDialog.test.tsx`:
```tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOffice } from '../store/office.ts';
import { HireDialog } from './HireDialog.tsx';

vi.mock('../net/api.ts', () => ({ api: { hire: vi.fn(async () => ({ id: 'new-id' })), events: vi.fn(async () => []) } }));
const { api } = await import('../net/api.ts');

beforeEach(() => {
  useOffice.setState({
    hireOpen: true,
    selectedId: null,
    manifest: { items: [{ id: 'designer', kind: 'character', name: 'Tasarımcı', file: 'c/base.glb', height: 1.7, clips: {} }] },
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('HireDialog', () => {
  it('hires with the chosen model and character, then selects the new employee', async () => {
    render(<HireDialog />);
    fireEvent.change(screen.getByLabelText('Ad'), { target: { value: 'Ece' } });
    fireEvent.change(screen.getByLabelText('Rol tanımı'), { target: { value: 'Arayüz tasarımcısı' } });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'opus' } });
    fireEvent.change(screen.getByLabelText('Karakter'), { target: { value: 'designer' } });
    fireEvent.click(screen.getByRole('button', { name: 'İşe al' }));
    await waitFor(() => expect(api.hire).toHaveBeenCalledWith({ name: 'Ece', role: 'Arayüz tasarımcısı', model: 'opus', characterId: 'designer' }));
    await waitFor(() => expect(useOffice.getState().hireOpen).toBe(false));
    expect(useOffice.getState().selectedId).toBe('new-id');
  });

  it('keeps the dialog open and shows why when hiring fails', async () => {
    vi.mocked(api.hire).mockRejectedValueOnce(new Error('Ofis dolu: 8 masanın hepsi dolu.'));
    render(<HireDialog />);
    fireEvent.change(screen.getByLabelText('Ad'), { target: { value: 'Ece' } });
    fireEvent.change(screen.getByLabelText('Rol tanımı'), { target: { value: 'r' } });
    fireEvent.click(screen.getByRole('button', { name: 'İşe al' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Ofis dolu: 8 masanın hepsi dolu.');
    expect(useOffice.getState().hireOpen).toBe(true);
  });
});
```

- [ ] **Step 2: Testlerin başarısız olduğunu gör**

Run: `pnpm --filter @cc/office-web test`
Expected: FAIL — `./Panel.tsx`, `./HireDialog.tsx` yok.

- [ ] **Step 3: Bileşenleri yaz**

`apps/office-web/src/ui/QuotaHud.tsx`:
```tsx
import type { QuotaState, QuotaWindow } from '@cc/shared';
import { formatPercent, formatReset } from './format.ts';

function Meter({ label, window, now }: { label: string; window: QuotaWindow | null; now: number }) {
  const value = window ? Math.min(1, Math.max(0, window.utilization)) : 0;
  return (
    <div className="meter" title={window ? `Sıfırlanma: ${formatReset(window.resetsAt, now)}` : 'Henüz okunmadı'}>
      <span className="meter-label">{label}</span>
      <span className="meter-track" aria-hidden="true">
        <span className={`meter-fill ${value >= 0.8 ? 'hot' : ''}`} style={{ width: `${value * 100}%` }} />
      </span>
      <span className="meter-value">{window ? formatPercent(window.utilization) : '—'}</span>
      {window && <span className="meter-reset">{formatReset(window.resetsAt, now)}</span>}
    </div>
  );
}

export function QuotaHud({ quota, now }: { quota: QuotaState | null; now: number }) {
  return (
    <div className="quota" aria-label="Abonelik kotası">
      <Meter label="5 saat" window={quota?.fiveHour ?? null} now={now} />
      <Meter label="7 gün" window={quota?.sevenDay ?? null} now={now} />
    </div>
  );
}
```

`apps/office-web/src/ui/TopBar.tsx`:
```tsx
import { useOffice } from '../store/office.ts';
import { QuotaHud } from './QuotaHud.tsx';

export function TopBar() {
  const connected = useOffice((s) => s.connected);
  const quota = useOffice((s) => s.quota);
  const count = useOffice((s) => Object.keys(s.views).length);
  const setHireOpen = useOffice((s) => s.setHireOpen);
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-name">control-center</span>
        <span className={`conn ${connected ? 'on' : 'off'}`}>{connected ? 'canlı' : 'bağlantı yok'}</span>
        <span className="muted">{count} çalışan</span>
      </div>
      <QuotaHud quota={quota} now={Date.now()} />
      <button type="button" className="primary" onClick={() => setHireOpen(true)}>
        + Çalışan al
      </button>
    </header>
  );
}
```

`apps/office-web/src/ui/HireDialog.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import { MODEL_ALIASES, type ModelAlias } from '@cc/shared';
import { characterAssets } from '../assets/manifest.ts';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';

export function HireDialog() {
  const manifest = useOffice((s) => s.manifest);
  const setHireOpen = useOffice((s) => s.setHireOpen);
  const select = useOffice((s) => s.select);
  const characters = characterAssets(manifest);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [model, setModel] = useState<ModelAlias>('sonnet');
  const [character, setCharacter] = useState(characters[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const hired = await api.hire({ name, role, model, ...(character ? { characterId: character } : {}) });
      setHireOpen(false);
      select(hired.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onClick={() => setHireOpen(false)}>
      <form className="dialog" role="dialog" aria-label="Çalışan al" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <h2>Çalışan al</h2>
        <div className="field">
          <label htmlFor="hire-name">Ad</label>
          <input id="hire-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="hire-role">Rol tanımı</label>
          <textarea id="hire-role" value={role} onChange={(e) => setRole(e.target.value)} rows={5} required placeholder="Ne iş yapacak, nasıl çalışacak?" />
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="hire-model">Model</label>
            <select id="hire-model" value={model} onChange={(e) => setModel(e.target.value as ModelAlias)}>
              {MODEL_ALIASES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="hire-character">Karakter</label>
            <select id="hire-character" value={character} onChange={(e) => setCharacter(e.target.value)}>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="">Voksel figür</option>
            </select>
          </div>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row end">
          <button type="button" onClick={() => setHireOpen(false)}>
            Vazgeç
          </button>
          <button type="submit" className="primary" disabled={busy}>
            İşe al
          </button>
        </div>
      </form>
    </div>
  );
}
```

`apps/office-web/src/ui/EventItem.tsx`:
```tsx
import type { StoredEvent } from '@cc/shared';
import { formatClock, formatCost, formatTokens, summarizeToolInput } from './format.ts';
import { lifecycleLabel } from './labels.ts';

export function EventItem({ stored }: { stored: StoredEvent }) {
  const e = stored.event;
  const time = <time>{formatClock(stored.ts)}</time>;
  switch (e.type) {
    case 'message.user':
      return (
        <div className={`msg ${e.source}`}>
          <span className="who">{e.source === 'owner' ? 'Sen' : 'Ofis'}</span>
          <p>{e.text}</p>
          {time}
        </div>
      );
    case 'message.assistant':
      return (
        <div className="msg assistant">
          <p>{e.text}</p>
          {time}
        </div>
      );
    case 'tool.started':
      return (
        <div className="tool">
          <span className="tool-name">⚙ {e.name}</span> <code>{summarizeToolInput(e.name, e.input)}</code>
        </div>
      );
    case 'tool.finished':
      return (
        <details className={`tool-out ${e.isError ? 'err' : ''}`}>
          <summary>{e.isError ? 'Araç hatası' : 'Araç çıktısı'}</summary>
          <pre>{e.output}</pre>
        </details>
      );
    case 'side.question':
      return (
        <div className="msg side">
          <span className="who">Yan soru</span>
          <p>{e.text}</p>
        </div>
      );
    case 'side.answer':
      return (
        <div className="msg side answer">
          <span className="who">Yan cevap</span>
          <p>{e.text}</p>
        </div>
      );
    case 'lifecycle.changed':
      return (
        <div className="note">
          {lifecycleLabel(e.from)} → {lifecycleLabel(e.to)} · {e.reason}
        </div>
      );
    case 'turn.finished':
      return (
        <div className="note">
          Tur bitti · {formatTokens(e.usage.inputTokens + e.usage.outputTokens)} · {formatCost(e.costUsd)}
        </div>
      );
    case 'error':
      return <div className="note error">{e.message}</div>;
    case 'session.started': {
      const failed = e.mcp.filter((m) => m.status === 'failed');
      return failed.length > 0 ? <div className="note warn">Bağlanamayan bağlantılar: {failed.map((m) => m.name).join(', ')}</div> : null;
    }
    default:
      return null;
  }
}
```

`apps/office-web/src/ui/Panel.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';
import { EventItem } from './EventItem.tsx';
import { formatCost, formatTokens, tokensOf } from './format.ts';
import { canResume, canStop, lifecycleLabel } from './labels.ts';

export function Panel({ id }: { id: string }) {
  const view = useOffice((s) => s.views[id]);
  const usage = useOffice((s) => s.usage[id]);
  const command = useOffice((s) => s.terminalCommands[id]);
  const select = useOffice((s) => s.select);
  const loadEvents = useOffice((s) => s.loadEvents);
  const markTyping = useOffice((s) => s.markTyping);
  const setTerminalCommand = useOffice((s) => s.setTerminalCommand);
  const [text, setText] = useState('');
  const [side, setSide] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stream = useRef<HTMLDivElement>(null);
  const exists = view !== undefined;
  const loaded = view?.eventsLoaded ?? false;
  const count = view?.events.length ?? 0;

  useEffect(() => {
    if (exists && !loaded) void loadEvents(id);
  }, [id, exists, loaded, loadEvents]);
  useEffect(() => {
    const el = stream.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  if (!view) {
    return (
      <aside className="panel">
        <p className="muted">Çalışan yükleniyor…</p>
      </aside>
    );
  }
  const e = view.employee;

  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const submit = () => {
    const message = text.trim();
    if (!message || busy) return;
    void run(async () => {
      if (side) await api.sideQuestion(id, message);
      else await api.send(id, message);
      setText('');
    });
  };

  return (
    <aside className="panel" aria-label={`${e.name} paneli`}>
      <header className="panel-head">
        <div>
          <h2>{e.name}</h2>
          <span className={`badge ${e.lifecycle}`}>{lifecycleLabel(e.lifecycle)}</span>
          <span className="muted"> {e.model}</span>
        </div>
        <button type="button" className="icon" aria-label="Paneli kapat" onClick={() => select(null)}>
          ×
        </button>
      </header>
      <p className="role">{e.role}</p>
      <p className="usage">
        Bugün {formatTokens(tokensOf(usage?.today))} · {formatCost(usage?.today.costUsd ?? 0)} — toplam {formatTokens(tokensOf(usage?.total))} ·{' '}
        {formatCost(usage?.total.costUsd ?? 0)}
      </p>
      <div className="actions">
        {canStop(e.lifecycle) && (
          <button type="button" disabled={busy} onClick={() => void run(() => api.stop(id))}>
            Durdur
          </button>
        )}
        {canResume(e.lifecycle) && (
          <button type="button" disabled={busy} onClick={() => void run(() => api.resume(id))}>
            Devam
          </button>
        )}
        {e.lifecycle !== 'in_terminal' && e.sessionStarted && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const opened = await api.openTerminal(id);
                setTerminalCommand(id, opened.command);
              })
            }
          >
            Terminalde aç
          </button>
        )}
        {e.lifecycle === 'in_terminal' && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api.closeTerminal(id);
                setTerminalCommand(id, null);
              })
            }
          >
            Ofise geri al
          </button>
        )}
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`${e.name} işten çıkarılsın mı?`)) {
              void run(async () => {
                await api.fire(id);
                select(null);
              });
            }
          }}
        >
          İşten çıkar
        </button>
      </div>
      {command && (
        <div className="terminal">
          <code>{command}</code>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(command)}>
            Kopyala
          </button>
        </div>
      )}
      {e.lastError && <p className="error">{e.lastError}</p>}
      <div className="stream" ref={stream}>
        {view.events.map((stored) => (
          <EventItem key={stored.seq} stored={stored} />
        ))}
      </div>
      <form
        className="composer"
        onSubmit={(ev) => {
          ev.preventDefault();
          submit();
        }}
      >
        <textarea
          value={text}
          rows={3}
          disabled={e.lifecycle === 'in_terminal'}
          placeholder={side ? 'Yan soru: işini bölmeden cevaplar' : `${e.name}'a yaz…`}
          onChange={(ev) => {
            setText(ev.target.value);
            markTyping(id);
          }}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' && !ev.shiftKey) {
              ev.preventDefault();
              submit();
            }
          }}
        />
        <div className="row">
          <label className="switch">
            <input type="checkbox" checked={side} onChange={(ev) => setSide(ev.target.checked)} />
            Yan soru
          </label>
          <button type="submit" className="primary" disabled={busy || !text.trim()}>
            Gönder
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </aside>
  );
}
```

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `pnpm --filter @cc/office-web test && pnpm --filter @cc/office-web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/office-web/src/ui
git commit -m "feat(web): add the top bar, quota meters, hiring dialog and employee panel"
```

---

### Task 10: Bağlama, stiller ve uçtan uca kabul

**Files:**
- Modify: `apps/office-web/src/App.tsx`, `apps/office-web/src/styles.css`, `README.md`

**Interfaces:**
- Consumes: hepsi.
- Produces: `pnpm office` ile çalışan ofis.

- [ ] **Step 1: App.tsx ve styles.css'i yaz**

`apps/office-web/src/App.tsx`:
```tsx
import { useEffect } from 'react';
import { loadManifest } from './assets/manifest.ts';
import { connectLive } from './net/live.ts';
import { OfficeScene } from './scene/OfficeScene.tsx';
import { useOffice } from './store/office.ts';
import { HireDialog } from './ui/HireDialog.tsx';
import { Panel } from './ui/Panel.tsx';
import { TopBar } from './ui/TopBar.tsx';

export function App() {
  const selectedId = useOffice((s) => s.selectedId);
  const hireOpen = useOffice((s) => s.hireOpen);

  useEffect(() => {
    const store = useOffice.getState();
    void loadManifest().then(store.setManifest);
    void store.refresh();
    const preselected = new URLSearchParams(location.search).get('employee');
    if (preselected) store.select(preselected);
    return connectLive({
      onMessage: (m) => useOffice.getState().receive(m),
      onStatus: (connected) => useOffice.getState().setConnected(connected),
      getAfter: () => useOffice.getState().lastSeq,
    });
  }, []);

  return (
    <div className="app">
      <OfficeScene />
      <TopBar />
      {selectedId && <Panel id={selectedId} />}
      {hireOpen && <HireDialog />}
    </div>
  );
}
```

`apps/office-web/src/styles.css`:
```css
:root {
  --bg: #e6e9ef;
  --surface: #ffffff;
  --surface-2: #f4f5f8;
  --text: #1d2230;
  --muted: #6b7385;
  --line: #dfe3ea;
  --accent: #f08a3c;
  --accent-ink: #ffffff;
  --ok: #2e9e5b;
  --warn: #d9a21a;
  --bad: #d64545;
  --info: #3b7be0;
  --radius: 10px;
  --shadow: 0 8px 28px rgba(20, 28, 45, 0.14);
  font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: var(--text);
}

* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; background: var(--bg); }
button, input, select, textarea { font: inherit; color: inherit; }

.app { position: relative; height: 100%; overflow: hidden; }
.scene { position: absolute !important; inset: 0; }

.topbar {
  position: absolute; top: 12px; left: 12px; right: 12px; display: flex; align-items: center; gap: 16px;
  padding: 10px 14px; background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow);
}
.brand { display: flex; align-items: center; gap: 10px; }
.brand-name { font-weight: 700; letter-spacing: 0.2px; }
.conn { font-size: 12px; padding: 2px 8px; border-radius: 99px; background: var(--surface-2); }
.conn.on { color: var(--ok); }
.conn.off { color: var(--bad); }
.muted { color: var(--muted); font-size: 13px; }

.quota { display: flex; gap: 18px; margin-left: auto; }
.meter { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.meter-label { color: var(--muted); }
.meter-track { width: 90px; height: 6px; background: var(--surface-2); border-radius: 99px; overflow: hidden; }
.meter-fill { display: block; height: 100%; background: var(--info); }
.meter-fill.hot { background: var(--bad); }
.meter-value { font-variant-numeric: tabular-nums; font-weight: 600; }
.meter-reset { color: var(--muted); }

button { border: 1px solid var(--line); background: var(--surface); padding: 6px 12px; border-radius: 8px; cursor: pointer; }
button:hover:not(:disabled) { background: var(--surface-2); }
button:disabled { opacity: 0.5; cursor: default; }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 600; }
button.primary:hover:not(:disabled) { filter: brightness(0.95); background: var(--accent); }
button.danger { color: var(--bad); }
button.icon { border: none; font-size: 22px; line-height: 1; padding: 2px 8px; }

.tag {
  display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; padding: 3px 8px; font-size: 12px;
  background: rgba(255, 255, 255, 0.95); border: 1px solid var(--line); border-radius: 99px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}
.tag.selected { border-color: var(--accent); }
.tag.faded, .tag.terminal { opacity: 0.6; }
.tag.alert { border-color: var(--bad); }
.tag-usage { color: var(--muted); font-variant-numeric: tabular-nums; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.dot.working { background: var(--ok); }
.dot.idle, .dot.starting { background: var(--info); }
.dot.limited, .dot.error, .dot.interrupted { background: var(--bad); }
.dot.in_terminal { background: var(--warn); }

.panel {
  position: absolute; top: 76px; right: 12px; bottom: 12px; width: min(420px, calc(100% - 24px)); display: flex; flex-direction: column;
  gap: 8px; padding: 14px; background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow);
}
.panel-head { display: flex; justify-content: space-between; align-items: flex-start; }
.panel-head h2 { margin: 0 8px 0 0; font-size: 18px; display: inline; }
.badge { font-size: 12px; padding: 2px 8px; border-radius: 99px; background: var(--surface-2); }
.badge.working { color: var(--ok); }
.badge.limited, .badge.error, .badge.interrupted { color: var(--bad); }
.role { margin: 0; font-size: 13px; color: var(--muted); max-height: 3.2em; overflow: hidden; }
.usage { margin: 0; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; }
.terminal { display: flex; gap: 6px; align-items: center; background: #1d2230; color: #e8ebf2; padding: 8px; border-radius: 8px; }
.terminal code { flex: 1; font-size: 12px; overflow-x: auto; white-space: nowrap; }
.terminal button { background: transparent; color: inherit; border-color: #4a5266; }

.stream { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 4px; }
.msg { padding: 8px 10px; border-radius: 8px; background: var(--surface-2); font-size: 14px; }
.msg p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.msg .who { display: block; font-size: 11px; color: var(--muted); margin-bottom: 2px; }
.msg time { display: block; font-size: 10px; color: var(--muted); margin-top: 4px; text-align: right; }
.msg.owner { background: #fff1e6; align-self: flex-end; max-width: 90%; }
.msg.system { background: #eef3fc; }
.msg.assistant { background: var(--surface-2); }
.msg.side { background: #f1ecfb; }
.tool { font-size: 12px; color: var(--muted); }
.tool code { color: var(--text); overflow-wrap: anywhere; }
.tool-out { font-size: 12px; }
.tool-out pre { max-height: 220px; overflow: auto; background: #1d2230; color: #e8ebf2; padding: 8px; border-radius: 6px; white-space: pre-wrap; }
.tool-out.err summary { color: var(--bad); }
.note { font-size: 11px; color: var(--muted); }
.note.error, .error { color: var(--bad); }
.note.warn { color: var(--warn); }

.composer { display: flex; flex-direction: column; gap: 6px; }
.composer textarea { resize: vertical; padding: 8px; border: 1px solid var(--line); border-radius: 8px; }
.row { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
.row.end { justify-content: flex-end; }
.switch { display: flex; gap: 6px; align-items: center; font-size: 13px; }

.dialog-backdrop { position: absolute; inset: 0; background: rgba(20, 26, 40, 0.35); display: grid; place-items: center; }
.dialog { width: min(460px, calc(100% - 32px)); display: flex; flex-direction: column; gap: 10px; padding: 18px; background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); }
.dialog h2 { margin: 0 0 4px; font-size: 18px; }
.dialog .field { display: flex; flex-direction: column; gap: 4px; flex: 1; }
.dialog .field label { font-size: 13px; color: var(--muted); }
.dialog input, .dialog textarea, .dialog select { padding: 8px; border: 1px solid var(--line); border-radius: 8px; color: var(--text); }

@media (max-width: 720px) {
  .quota { display: none; }
  .panel { top: auto; height: 60%; }
}
```

- [ ] **Step 2: Derle ve bütün testleri çalıştır**

Run: `cd ~/Projects/control-center && pnpm test && pnpm typecheck && pnpm --filter @cc/office-web build`
Expected: testler PASS, tip hatası yok, `apps/office-web/dist/index.html` oluşur.

- [ ] **Step 3: Gerçek claude ile uçtan uca kabul ve ekran görüntüsü**

Terminal 1 (geçici veri klasörüyle; port 4319):
```bash
cd ~/Projects/control-center && OFFICE_DATA_DIR=<scratchpad>/cc-web-acceptance pnpm --filter @cc/office-server start
```
Terminal 2:
```bash
B=http://127.0.0.1:4319; J='content-type: application/json'
A=$(curl -s -X POST $B/api/employees -H "$J" -d '{"name":"Ada","role":"Kısa cevap veren yazılımcı.","model":"haiku","characterId":"coder"}' | jq -r .id)
C=$(curl -s -X POST $B/api/employees -H "$J" -d '{"name":"Can","role":"Kısa cevap veren tasarımcı.","model":"haiku","characterId":"designer"}' | jq -r .id)
curl -s -X POST $B/api/employees/$A/messages -H "$J" -d '{"text":"Bir kelimeyle merhaba de."}'
/opt/google/chrome/chrome --headless=new --no-sandbox --enable-unsafe-swiftshader --use-angle=swiftshader --hide-scrollbars --window-size=1600,1000 --virtual-time-budget=60000 --screenshot=<scratchpad>/office.png "$B/"
/opt/google/chrome/chrome --headless=new --no-sandbox --enable-unsafe-swiftshader --use-angle=swiftshader --hide-scrollbars --window-size=1600,1000 --virtual-time-budget=60000 --screenshot=<scratchpad>/office-panel.png "$B/?employee=$A"
```
Expected: `office.png`'de voksel ofis (duvarlar, cam toplantı odası, server odası, masalar), iki karakter masalarında, üstlerinde ad ve token/maliyet etiketi, üst çubukta kota; `office-panel.png`'de Ada'nın paneli, akışta mesaj ve "Merhaba" cevabı. Görüntüleri aç ve bak; kayma/eksik varsa düzelt ve tekrar çek. Sonra Terminal 1'de Ctrl+C.

- [ ] **Step 4: README'yi güncelle**

`README.md`'deki "## office-server" bölümünün üstüne ekle:
````markdown
## Ofisi açmak

```bash
pnpm install
pnpm office          # arayüzü derler ve office-server'ı başlatır
```

Sonra tarayıcıda **http://127.0.0.1:4319** adresini aç. Modeller `assets/3d/` altında ve `assets/3d/manifest.json`
ile tanımlıdır; eksik bir model yerine voksel kutu / figür görünür.

Arayüz geliştirme (anlık yenileme):

```bash
OFFICE_ALLOWED_ORIGINS=http://127.0.0.1:5180,http://localhost:5180 pnpm --filter @cc/office-server start
pnpm --filter @cc/office-web dev     # http://127.0.0.1:5180
```
````

- [ ] **Step 5: Commit**

```bash
git add apps/office-web README.md
git commit -m "feat(web): wire up the office, style it and document how to open it"
```
