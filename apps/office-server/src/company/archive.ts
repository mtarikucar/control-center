import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import type { Task, TaskResult } from '@cc/shared';
import { slugify } from '../roster.ts';

/** What one hand-in may copy into the archive; the rest stays where it is and teslim.md says so. */
export const ARCHIVE_LIMIT_BYTES = 100 * 1024 * 1024;

/** Bytes under `path`, counting no further than `budget` (links count as nothing: they are copied as links). */
function sizeOf(path: string, budget: number): number {
  const st = lstatSync(path);
  if (!st.isDirectory()) return st.isSymbolicLink() ? 0 : st.size;
  let total = 0;
  for (const entry of readdirSync(path)) {
    total += sizeOf(join(path, entry), budget - total);
    if (total > budget) break;
  }
  return total;
}

/** Inside a copied folder, only files, folders and links (never a device or pipe). */
function copyable(path: string): boolean {
  try {
    const st = lstatSync(path);
    return st.isFile() || st.isDirectory() || st.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Copies a hand-in's outputs to company/archive/<plan or "plansiz">/<date>-<task id>-<title>/ and writes teslim.md:
 * what was done, what was learned, and what happened to each output. Never throws for an output it cannot copy.
 */
export function archiveTask(o: { dataDir: string; desk: string; task: Task; result: TaskResult; planTitle: string | null; by: string; now: number; limitBytes?: number }): string {
  const limit = o.limitBytes ?? ARCHIVE_LIMIT_BYTES;
  const day = new Date(o.now).toISOString().slice(0, 10);
  const dir = join(o.dataDir, 'company', 'archive', o.planTitle ? slugify(o.planTitle) : 'plansiz', `${day}-${o.task.id.slice(0, 8)}-${slugify(o.task.title)}`);
  mkdirSync(dir, { recursive: true });
  let budget = limit;
  const used = new Set<string>(['teslim.md']);
  const report: string[] = [];
  for (const output of o.result.outputs) {
    const src = isAbsolute(output) ? output : resolve(o.desk, output);
    if (!existsSync(src)) {
      report.push(`- ${output} — bulunamadı`);
      continue;
    }
    const kind = lstatSync(src);
    if (!kind.isFile() && !kind.isDirectory() && !kind.isSymbolicLink()) {
      // A device or pipe would never finish copying (and stall the whole office): leave it where it is.
      report.push(`- ${output} — dosya ya da klasör değil, kopyalanmadı`);
      continue;
    }
    let size: number;
    try {
      size = sizeOf(src, budget);
    } catch {
      report.push(`- ${output} — okunamadı`);
      continue;
    }
    if (size > budget) {
      report.push(`- ${output} — arşive sığmadı (bir teslimde en fazla ${Math.round(limit / 1024 / 1024) || limit} ${limit >= 1024 * 1024 ? 'MB' : 'bayt'}); yerinde: ${src}`);
      continue;
    }
    const base = basename(src) || 'cikti';
    let name = base;
    for (let n = 2; used.has(name); n += 1) name = `${n}-${base}`;
    used.add(name);
    try {
      cpSync(src, join(dir, name), { recursive: true, dereference: false, force: true, filter: copyable });
      budget -= size;
      report.push(`- ${output} → ${name}`);
    } catch (err) {
      report.push(`- ${output} — kopyalanamadı: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const body = [
    `# ${o.task.title}`,
    '',
    `Teslim eden: ${o.by} · ${new Date(o.now).toISOString()}`,
    `Plan: ${o.planTitle ?? '—'}`,
    `Görev no: ${o.task.id}`,
    '',
    '## Özet',
    '',
    o.result.summary,
    '',
    ...(o.result.learned ? ['## Öğrenilenler', '', o.result.learned, ''] : []),
    '## Çıktılar',
    '',
    ...(report.length ? report : ['- (yok)']),
    '',
  ];
  writeFileSync(join(dir, 'teslim.md'), body.join('\n'));
  return dir;
}
