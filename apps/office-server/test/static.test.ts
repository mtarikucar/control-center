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
