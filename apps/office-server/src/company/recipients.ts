import { fold, OUTBOX_SUMMARY_CHARS } from '@cc/shared';

/**
 * Whom a connector call is for and whether one of the owner's special contacts is in it, read from its input without
 * understanding it (spec 2026-10-13-capabilities-autonomy §6): the gate's rules and the outbox use these. Pure.
 *
 * The input is an employee's, so every step is linear in its size (review C1: no pattern that backtracks over it) and
 * none recurses into it (I5): an input deeper or bigger than the caps is not read to its end, and the rules hold it.
 */

/** Fields that name recipients, at any depth (compared folded, `_` and `-` ignored). */
const RECIPIENT_FIELDS = new Set(['to', 'cc', 'bcc', 'recipient', 'recipients', 'attendee', 'attendees', 'guests', 'invitees', 'participants', 'emails', 'phone', 'phones', 'phonenumbers', 'numbers', 'contacts', 'contactids', 'leadids', 'audience']);
/** In an object under a recipient field, the fields that say who, in this order: the first one filled is the recipient. */
const WHO_FIELDS = ['email', 'address', 'phone', 'number', 'id', 'name'];
const keyOf = (k: string) => fold(k).replace(/[_-]/g, '');

/** Levels below the input, and values in all, that are read; beyond either the input is unreadable (review I5). */
const MAX_DEPTH = 64;
const MAX_VALUES = 10_000;

const filled = (v: unknown) => (typeof v === 'string' && v.trim() !== '') || (typeof v === 'number' && Number.isFinite(v));

/**
 * The input's texts and numbers, in their order, each marked when it names a recipient: a value under a recipient
 * field, or — in an object there — under the first who-field filled (else under any field: `recipients: { to, cc }`,
 * `to: [{ emailAddress: { address } }]`). Iterative; `whole` false when it stopped at a cap.
 */
function read(input: unknown): { leaves: Array<{ text: string; who: boolean }>; whole: boolean } {
  const leaves: Array<{ text: string; who: boolean }> = [];
  const stack: Array<{ v: unknown; depth: number; who: boolean }> = [{ v: input, depth: 0, who: false }];
  // Values taken off the stack; with the stack's, never more than the cap: a child is counted before it is walked into.
  let values = 0;
  const cut = { leaves, whole: false };
  while (stack.length > 0) {
    const { v, depth, who } = stack.pop()!;
    values += 1;
    if (depth > MAX_DEPTH) return cut;
    if (typeof v === 'string') leaves.push({ text: v, who });
    else if (typeof v === 'number' && Number.isFinite(v)) leaves.push({ text: String(v), who });
    else if (Array.isArray(v)) {
      if (values + stack.length + v.length > MAX_VALUES) return cut;
      for (let i = v.length - 1; i >= 0; i -= 1) stack.push({ v: v[i], depth: depth + 1, who });
    } else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const entries = Object.entries(o);
      if (values + stack.length + entries.length > MAX_VALUES) return cut;
      const field = who ? WHO_FIELDS.find((f) => filled(o[f])) : undefined;
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const [k, x] = entries[i]!;
        stack.push({ v: x, depth: depth + 1, who: who ? field === undefined || k === field : RECIPIENT_FIELDS.has(keyOf(k)) });
      }
    }
  }
  return { leaves, whole: true };
}

/** Whether the input is read to its end: no deeper than 64 levels, no more than 10 000 values (review I5). */
export function readable(input: unknown): boolean {
  return read(input).whole;
}

/** Each recipient once (folded), in the order met; a text names several split on `,` `;` and newlines. */
export function recipientsOf(input: unknown): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const { text, who } of read(input).leaves) {
    if (!who) continue;
    for (const raw of text.split(/[,;\n]/)) {
      const r = raw.trim();
      const key = fold(r);
      if (!r || seen.has(key)) continue;
      seen.add(key);
      found.push(r);
    }
  }
  return found;
}

export type ContactKey = { kind: 'email' | 'phone' | 'handle'; value: string };

/** something@something.something, without whitespace or a second @ — the shape the owner writes an e-mail in. */
function isEmail(x: string): boolean {
  const at = x.indexOf('@');
  if (at < 1 || x.indexOf('@', at + 1) !== -1 || /\s/.test(x)) return false;
  const dot = x.indexOf('.', at + 2);
  return dot !== -1 && dot < x.length - 1;
}

/** How a special contact is compared: an e-mail folded, a phone by its digits, anything else as a user name or a name folded without its @ (runs of whitespace as one space). */
export function contactKey(raw: string): ContactKey | null {
  const x = raw.trim();
  if (!x) return null;
  if (isEmail(x)) return { kind: 'email', value: fold(x) };
  const digits = x.replace(/\D/g, '');
  if (/^\+?[\d\s().-]+$/.test(x) && digits.length >= 7) return { kind: 'phone', value: digits };
  const handle = fold(x).replace(/\s+/g, ' ').replace(/^@+/, '');
  return handle ? { kind: 'handle', value: handle } : null;
}

const wordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const letter = (c: string | undefined) => c !== undefined && /\p{L}/u.test(c);

/** Every place `needle` stands in `text` (both folded) where `fits` says its neighbours end it; indexOf only, linear. */
function standsAlone(text: string, needle: string, fits: (before: number, after: number) => boolean): boolean {
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
    if (fits(i - 1, i + needle.length)) return true;
  }
  return false;
}

/**
 * An e-mail ends where no address could go on (review I2): not after a letter, digit or `._%+-@` ("xali@…",
 * "veli.ali@…"), not before a letter or digit, nor before a `.` and a letter ("….company", "….com.tr"); beside `!?[]*“”/`,
 * in "mailto:…?subject=" or "?to=…&", or at a sentence's end, it is the address.
 */
const ADDRESS_CHARS = '._%+-@';
const hasEmail = (text: string, email: string) =>
  standsAlone(text, email, (b, a) => {
    const before = text[b];
    const opens = before === undefined || (!wordChar(before) && !ADDRESS_CHARS.includes(before));
    return opens && !wordChar(text[a]) && !(text[a] === '.' && letter(text[a + 1]));
  });

/**
 * A user name is a whole word (minor 8): not inside a longer one ("aliveli2", "aliveli_bot", "ipekyolu"), nor joined to
 * one by a `.` or `-` ("veli.aliveli", "aliveli.tr", "ipek-ali") or to an address by an `@` after it; quotes, emphasis,
 * brackets, a slash, an apostrophe and its suffix ("İpek’e") or a dash ("ipek—ali") end it.
 */
const joins = (c: string | undefined, next: string | undefined) => (c === '.' || c === '-') && wordChar(next);
const hasHandle = (text: string, handle: string) =>
  standsAlone(text, handle, (b, a) => !wordChar(text[b]) && text[b] !== '_' && !joins(text[b], text[b - 1]) && !wordChar(text[a]) && text[a] !== '_' && !joins(text[a], text[a + 1]) && !(text[a] === '@' && wordChar(text[a + 1])));

/** A name with spaces as whole words: "ahmet yilmaz" is not in "ahmet yilmazoglu" (text and name whitespace-collapsed). */
const hasPhrase = (text: string, phrase: string) => standsAlone(text, phrase, (b, a) => !wordChar(text[b]) && !wordChar(text[a]));

/** Between a phone's digit groups: spaces (never a newline), brackets, dots and dashes — as "+90 (532) 111-22.33" writes it. */
const PHONE_GAP = /[\p{Zs}\t().-]/u;

/**
 * What a special phone is compared with (review I3), each line's runs of digit groups read once: for every group a
 * run ends with, the last ten digits up to it (a number with a country code or a leading 0, and one followed by
 * another number on the line, "… 22 33 2 kez", "… 22 33 14:30"), and every sequence of whole groups of 7 to 9 digits
 * (a number without its area code). A newline or any other text ends a run, so two numbers are never merged.
 */
function phoneKeys(texts: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (const text of texts) {
    let digits = '';
    const starts: number[] = [];
    const end = () => {
      for (const [g, start] of starts.entries()) {
        const stop = g + 1 < starts.length ? starts[g + 1]! : digits.length;
        // The group's end: its last ten when ten are there.
        if (stop >= 10) keys.add(digits.slice(stop - 10, stop));
        // Whole groups from this one on, while they are short of ten digits.
        for (let h = g; h < starts.length; h += 1) {
          const to = h + 1 < starts.length ? starts[h + 1]! : digits.length;
          if (to - start > 9) break;
          if (to - start >= 7) keys.add(digits.slice(start, to));
        }
      }
      digits = '';
      starts.length = 0;
    };
    for (let i = 0; i < text.length; ) {
      const c = text[i]!;
      if (c >= '0' && c <= '9') {
        starts.push(digits.length);
        while (i < text.length && text[i]! >= '0' && text[i]! <= '9') digits += text[i++];
      } else {
        if (!PHONE_GAP.test(c)) end();
        i += 1;
      }
    }
    end();
  }
  return keys;
}

/** One person's number when the digits agree, or their last ten do (a country code or a leading 0 apart). */
const phoneIn = (keys: Set<string>, phone: string) => keys.has(phone.length >= 10 ? phone.slice(-10) : phone);

/**
 * The first special contact (as the owner wrote it) found anywhere in the call's input, each string on its own; null
 * when none is. Each string is folded once, and its phone groups read once, only when a contact of that kind is asked.
 */
export function specialContact(input: unknown, contacts: readonly string[]): string | null {
  if (contacts.length === 0) return null;
  const all = read(input).leaves.map((l) => l.text);
  let folded: string[] | null = null;
  let phones: Set<string> | null = null;
  for (const raw of contacts) {
    const key = contactKey(raw);
    if (!key) continue;
    let hit: boolean;
    if (key.kind === 'phone') hit = phoneIn((phones ??= phoneKeys(all)), key.value);
    else {
      folded ??= all.map((t) => fold(t).replace(/\s+/g, ' '));
      // A name's trailing punctuation is not searched for: "ACME Ltd." is also "acme ltd".
      const phrase = key.kind === 'handle' && key.value.includes(' ') ? key.value.replace(/[^\p{L}\p{N}]+$/u, '') : '';
      const value = key.value;
      hit = key.kind === 'email' ? folded.some((t) => hasEmail(t, value)) : phrase ? folded.some((t) => hasPhrase(t, phrase)) : folded.some((t) => hasHandle(t, value));
    }
    if (hit) return raw.trim();
  }
  return null;
}

const SECRET = /token|secret|password|passwd|api[_-]?key|authorization|cookie|credential|private[_-]?key/i;

/**
 * The call's input as the outbox keeps it: JSON without secret-looking fields, its first `max` characters (code
 * points). Below 64 levels a value is "…": a deep input would overflow the stack (review I5).
 */
export function callSummary(input: unknown, max = OUTBOX_SUMMARY_CHARS): string {
  const strip = (v: unknown, depth: number): unknown => {
    if (v && typeof v === 'object' && depth >= MAX_DEPTH) return '…';
    if (Array.isArray(v)) return v.map((x) => strip(x, depth + 1));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !SECRET.test(k)).map(([k, x]) => [k, strip(x, depth + 1)]));
    return v;
  };
  const text = typeof input === 'string' ? input : (JSON.stringify(strip(input, 0)) ?? '');
  // A code point is at most two code units: the first 2·max hold the first max whole, without spreading a long input.
  return Array.from(text.slice(0, 2 * max)).slice(0, max).join('');
}
