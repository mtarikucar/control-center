import { chmodSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
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

function get(port: number, path: string, method = 'GET', headers: Record<string, string> = {}): Promise<{ status: number; type: string; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), body, headers: res.headers }));
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
  writeFileSync(join(assets, 'locked.glb'), 'glTF');
  chmodSync(join(assets, 'locked.glb'), 0o000);
  writeFileSync(join(assets, 'big.glb'), Buffer.alloc(8 * 1024 * 1024, 1));
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

  it('answers 404 for a file it may not read and keeps running', async () => {
    const port = await start();
    expect((await get(port, '/assets3d/locked.glb')).status).toBe(404);
    expect((await get(port, '/assets3d/manifest.json')).status).toBe(200);
  });

  it('closes the file when a download is aborted', async () => {
    const port = await start();
    const openFiles = () => readdirSync('/proc/self/fd').length;
    const before = openFiles();
    for (let i = 0; i < 10; i += 1) {
      await new Promise<void>((resolve) => {
        const req = httpRequest({ host: '127.0.0.1', port, method: 'GET', path: '/assets3d/big.glb' }, (res) => {
          res.once('data', () => {
            req.destroy();
            resolve();
          });
        });
        req.on('error', () => resolve());
        req.end();
      });
    }
    await new Promise((r) => setTimeout(r, 300));
    expect(openFiles() - before).toBeLessThanOrEqual(2);
  });

  it('answers HEAD and lets the browser reuse an unchanged model', async () => {
    const port = await start();
    const head = await get(port, '/assets3d/furniture/desk.glb', 'HEAD');
    expect(head).toMatchObject({ status: 200, type: 'model/gltf-binary', body: '' });
    expect(head.headers['content-length']).toBe('4');
    const etag = String(head.headers.etag ?? '');
    expect(etag).not.toBe('');
    expect((await get(port, '/assets3d/furniture/desk.glb', 'GET', { 'if-none-match': etag })).status).toBe(304);
  });
});
