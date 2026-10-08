import type { Task } from '@cc/shared';
import { hitLine, queryWords, type SearchIndex } from './search.ts';
import { fold } from './text.ts';

/**
 * The task message's related memory (B12; pilot-hazirlik-analizi C5-6, pilot A9): the office searches its memory with
 * the task's title and definition of done and puts the first records under the message, so the brand guide or the
 * client note comes with the task instead of waiting to be searched for. Reads the index only: no memory.searched
 * event — the searches the office makes for itself do not count in the employees' empty-answer KPI.
 */

export const RELATED_HEADING = '## İlgili hafıza';
/** How many records the section shows. */
export const RELATED_LIMIT = 3;
/** The whole section's characters at most (the heading and its line included): a task message stays short. */
export const RELATED_BUDGET = 900;
const INTRO = 'Bu işe en yakın kayıtlar (görevin başlığı ve bitti maddeleriyle arandı; devamı memorySearch ile):';
/** Words that find everything and say nothing about the task. */
const STOP = new Set(['ve', 'ile', 'bir', 'icin', 'bu', 'su', 'da', 'de', 'en', 'cok', 'her', 'gibi', 'olarak', 'mi', 'ya', 'veya', 'ama', 'ki', 'ne', 'kadar', 'daha', 'olan', 'sonra', 'once', 'yok', 'var', 'the', 'and', 'for']);

/** The query a task is searched by: its title's words, then its definition of done's — the first 8 that say something. */
export function relatedQuery(task: Pick<Task, 'title' | 'done'>): string {
  const picked: string[] = [];
  for (const w of fold([task.title, ...task.done].join(' ')).split(/[^\p{L}\p{N}]+/u)) {
    // A word of three letters or more, or a code like B7 or R10; never a bare number.
    const says = (w.length >= 3 && !/^\d+$/.test(w)) || (/\p{L}/u.test(w) && /\d/.test(w));
    if (!says || STOP.has(w) || picked.includes(w)) continue;
    picked.push(w);
    if (picked.length === 8) break;
  }
  return picked.join(' ');
}

/** The section for a task message, starting with a blank line; '' when nothing in the memory is related. */
export function relatedMemory(index: SearchIndex, task: Pick<Task, 'title' | 'done'>, o: { limit?: number; budget?: number } = {}): string {
  const query = relatedQuery(task);
  if (!query) return '';
  const { hits } = index.search(query, { limit: o.limit ?? RELATED_LIMIT });
  if (hits.length === 0) return '';
  const head = `\n\n${RELATED_HEADING}\n${INTRO}`;
  const total = queryWords(query).length;
  // Each line gets an equal share of what the heading leaves; a longer one is cut and ends with "…".
  const share = Math.floor(((o.budget ?? RELATED_BUDGET) - head.length) / hits.length) - 1;
  const lines = hits.map((h) => {
    const line = hitLine(h, total);
    return line.length <= share ? line : `${line.slice(0, share - 1).trimEnd()}…`;
  });
  return `${head}\n${lines.join('\n')}`;
}
