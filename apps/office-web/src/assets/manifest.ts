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
