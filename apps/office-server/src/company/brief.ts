import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The file every desk imports from its role card (headless claude does not load imports from outside the desk). */
export const BRIEF_FILE = 'company-brief.md';

export const DEFAULT_BRIEF = `# Şirket özeti

Henüz yazılmadı. Koordinatör burada şirketin misyonunu, süren planları, kimin ne yaptığını ve temel kuralları tutar.
`;

export function briefPath(dataDir: string): string {
  return join(dataDir, 'company', 'brief.md');
}

export function readBrief(dataDir: string): string {
  const file = briefPath(dataDir);
  return existsSync(file) ? readFileSync(file, 'utf8') : DEFAULT_BRIEF;
}

/** Writes the brief and the copy on every desk given. */
export function writeBrief(dataDir: string, text: string, deskDirs: string[]): void {
  mkdirSync(join(dataDir, 'company'), { recursive: true });
  writeFileSync(briefPath(dataDir), text);
  for (const dir of deskDirs) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, BRIEF_FILE), text);
  }
}
