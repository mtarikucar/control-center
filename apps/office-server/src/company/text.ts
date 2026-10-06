import { ValidationError } from '../errors.ts';

export function clean(value: string | undefined, label: string, max: number, required: boolean): string {
  const text = (value ?? '').trim();
  if (required && !text) throw new ValidationError(`${label} boş olamaz.`);
  if (text.length > max) throw new ValidationError(`${label} en fazla ${max} karakter olabilir.`);
  return text;
}

export function lines(items: string[] | undefined, label: string, maxItems: number, itemMax: number): string[] {
  const out = (items ?? []).map((s) => String(s).trim()).filter(Boolean);
  if (out.length > maxItems) throw new ValidationError(`${label} en fazla ${maxItems} madde olabilir.`);
  for (const item of out) if (item.length > itemMax) throw new ValidationError(`${label} maddeleri en fazla ${itemMax} karakter olabilir.`);
  return out;
}

/** Turkish-aware case and diacritic folding for matching in code ("İSTANBUL", "istanbul", "Türkçe" ≈ "turkce"). */
export function fold(s: string): string {
  return s.toLocaleLowerCase('tr').normalize('NFD').replace(/\p{M}/gu, '').replace(/ı/g, 'i');
}

export function words(s: string): string[] {
  return fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 8);
}

/** About `width` characters of `text` around the first word of `ws` (folded words, as from `words()`). */
export function snippetOf(text: string, ws: string[], width = 180): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const at = Math.max(0, fold(flat).indexOf(ws[0] ?? ''));
  const start = Math.max(0, at - 50);
  return `${start > 0 ? '…' : ''}${flat.slice(start, start + width)}${start + width < flat.length ? '…' : ''}`;
}
