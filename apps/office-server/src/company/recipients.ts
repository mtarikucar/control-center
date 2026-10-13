import { fold, OUTBOX_SUMMARY_CHARS } from '@cc/shared';

/**
 * Whom a connector call is for and whether one of the owner's special contacts is in it, read from its input without
 * understanding it (spec 2026-10-13-capabilities-autonomy §6): the gate's rules and the outbox use these. Pure.
 */

/** Fields that name recipients, at any depth (compared folded, `_` and `-` ignored). */
const RECIPIENT_FIELDS = new Set(['to', 'cc', 'bcc', 'recipient', 'recipients', 'attendee', 'attendees', 'guests', 'invitees', 'participants', 'emails', 'phone', 'phones', 'phonenumbers', 'numbers', 'contacts', 'contactids', 'leadids', 'audience']);
/** In an object of a recipients list, the field that says who. */
const WHO_FIELDS = ['email', 'address', 'phone', 'number', 'id', 'name'];
const keyOf = (k: string) => fold(k).replace(/[_-]/g, '');

function who(value: unknown): string[] {
  if (typeof value === 'string') return value.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
  if (typeof value === 'number' && Number.isFinite(value)) return [String(value)];
  if (Array.isArray(value)) return value.flatMap(who);
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const field = WHO_FIELDS.find((f) => typeof o[f] === 'string' || typeof o[f] === 'number');
    return field ? who(o[field]) : [];
  }
  return [];
}

/** Each recipient once (folded), in the order met. */
export function recipientsOf(input: unknown): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (!RECIPIENT_FIELDS.has(keyOf(k))) {
        walk(x);
        continue;
      }
      for (const r of who(x)) {
        if (seen.has(fold(r))) continue;
        seen.add(fold(r));
        found.push(r);
      }
    }
  };
  walk(input);
  return found;
}

export type ContactKey = { kind: 'email' | 'phone' | 'handle'; value: string };

/** How a special contact is compared: an e-mail folded, a phone by its digits, anything else as a user name or a name folded without its @ (runs of whitespace as one space). */
export function contactKey(raw: string): ContactKey | null {
  const x = raw.trim();
  if (!x) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)) return { kind: 'email', value: fold(x) };
  const digits = x.replace(/\D/g, '');
  if (/^\+?[\d\s().-]+$/.test(x) && digits.length >= 7) return { kind: 'phone', value: digits };
  const handle = fold(x).replace(/\s+/g, ' ').replace(/^@+/, '');
  return handle ? { kind: 'handle', value: handle } : null;
}

/** One person's number when the digits agree, or their last ten do (a country code or a leading 0 apart). */
const samePhone = (a: string, b: string) => a === b || (a.length >= 10 && b.length >= 10 && a.slice(-10) === b.slice(-10));
const EMAIL = /[^\s<>()"',;:]+@[^\s<>()"',;:]+\.[^\s<>()"',;:]+/g;
const PHONE = /\+?\d[\d\s().-]{5,}\d/g;

const wordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** `phrase` in `text` (both folded, whitespace collapsed) as whole words: "ahmet yilmaz" is not in "ahmet yilmazoglu". */
function hasPhrase(text: string, phrase: string): boolean {
  for (let i = text.indexOf(phrase); i !== -1; i = text.indexOf(phrase, i + 1)) {
    if (!wordChar(text[i - 1]) && !wordChar(text[i + phrase.length])) return true;
  }
  return false;
}

function texts(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (typeof v === 'number' && Number.isFinite(v)) return [String(v)];
  if (Array.isArray(v)) return v.flatMap(texts);
  if (v && typeof v === 'object') return Object.values(v as Record<string, unknown>).flatMap(texts);
  return [];
}

/** The first special contact (as the owner wrote it) found anywhere in the call's input; null when none is. */
export function specialContact(input: unknown, contacts: readonly string[]): string | null {
  if (contacts.length === 0) return null;
  const all = texts(input);
  const emails = all.flatMap((t) => (t.match(EMAIL) ?? []).map((e) => fold(e.replace(/\.+$/, ''))));
  const phones = all.flatMap((t) => (t.match(PHONE) ?? []).map((p) => p.replace(/\D/g, '')));
  // A user name is a whole word: "@aliveli" and "aliveli," are it, "aliveli2" is not.
  const words = all.flatMap((t) => fold(t).split(/[\s,;:<>()"'!?]+/).map((w) => w.replace(/^@+/, '').replace(/\.+$/, '')).filter(Boolean));
  // A name with spaces ("Ahmet Yılmaz", "ACME Ltd.") is a phrase, searched in each string on its own (not across fields).
  const folded = all.map((t) => fold(t).replace(/\s+/g, ' '));
  for (const raw of contacts) {
    const key = contactKey(raw);
    if (!key) continue;
    const phrase = key.kind === 'handle' && key.value.includes(' ') ? key.value.replace(/[^\p{L}\p{N}]+$/u, '') : '';
    const hit = key.kind === 'email' ? emails.includes(key.value) : key.kind === 'phone' ? phones.some((p) => samePhone(p, key.value)) : phrase ? folded.some((t) => hasPhrase(t, phrase)) : words.includes(key.value);
    if (hit) return raw.trim();
  }
  return null;
}

const SECRET = /token|secret|password|passwd|api[_-]?key|authorization|cookie|credential|private[_-]?key/i;

/** The call's input as the outbox keeps it: JSON without secret-looking fields, its first `max` characters (code points). */
export function callSummary(input: unknown, max = OUTBOX_SUMMARY_CHARS): string {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !SECRET.test(k)).map(([k, x]) => [k, strip(x)]));
    return v;
  };
  const text = typeof input === 'string' ? input : (JSON.stringify(strip(input)) ?? '');
  // A code point is at most two code units: the first 2·max hold the first max whole, without spreading a long input.
  return Array.from(text.slice(0, 2 * max)).slice(0, max).join('');
}
