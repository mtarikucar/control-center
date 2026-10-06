import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Character ids in assets/3d/manifest.json, read each time (the owner may add models while the office runs). */
export function manifestCharacters(assetsDir: string | undefined): () => string[] {
  return () => {
    if (!assetsDir) return [];
    try {
      const manifest = JSON.parse(readFileSync(join(assetsDir, 'manifest.json'), 'utf8')) as { items?: unknown };
      if (!Array.isArray(manifest.items)) return [];
      return manifest.items
        .filter((i): i is { kind: string; id: string } => typeof i === 'object' && i !== null && (i as { kind?: unknown }).kind === 'character' && typeof (i as { id?: unknown }).id === 'string')
        .map((i) => i.id);
    } catch {
      return [];
    }
  };
}
