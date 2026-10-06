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
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseManifest(null).items).toEqual([]);
    expect(parseManifest({ items: 'x' }).items).toEqual([]);
    expect((await loadManifest(vi.fn(async () => new Response('', { status: 404 })))).items).toEqual([]);
    expect((await loadManifest(vi.fn(async () => { throw new Error('ağ yok'); }))).items).toEqual([]);
    const ok = await loadManifest(vi.fn(async () => new Response(JSON.stringify(RAW), { status: 200 })));
    expect(ok.items).toHaveLength(2);
  });

  it('says in the console why the office shows no models', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await loadManifest(vi.fn(async () => new Response('', { status: 404 })));
    await loadManifest(vi.fn(async () => { throw new Error('ağ yok'); }));
    await loadManifest(vi.fn(async () => new Response('{bozuk', { status: 200 })));
    expect(warn).toHaveBeenCalledTimes(3);
    for (const call of warn.mock.calls) expect(String(call[0])).toMatch(/manifest/);
    warn.mockRestore();
  });
});
