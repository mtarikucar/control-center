/**
 * A small shell reader for the gate (B9a; design §3.1: "a shell tokenizer, not regular expressions"): it splits a
 * Bash line into its simple commands in the order they run, with quotes removed, variables and substitutions kept as
 * parts, redirections and here-documents apart, subshells marked. It does not run or expand anything; what is only
 * known at run time is marked dynamic. Enough of POSIX sh and Bash for the gate's questions, no more.
 */

/** One piece of a word: plain text, a variable to look up, or something only known at run time. */
/** `sub`: the command a $(…) or `…` runs (what it prints stands there), for the few whose output can be told (mktemp). */
export type WordPart = { lit: string } | { var: string; def?: string } | { dyn: true; sub?: string; glob?: boolean };

export interface ShellWord {
  parts: WordPart[];
  /** An unquoted ~ at its start (home). */
  tilde: boolean;
  /** Any part of it was quoted. */
  quoted: boolean;
}

export interface ShellRedirect {
  /** '>', '>>', '>|', '&>', '&>>', '<', '<>', '<<', '<<<', '>&', '<&' */
  op: string;
  fd: number | null;
  target: ShellWord | null;
  /** A here-document's body (op '<<'). */
  body?: string;
}

export interface ShellAssign {
  name: string;
  value: ShellWord;
}

export type ShellNode =
  | { type: 'command'; words: ShellWord[]; assigns: ShellAssign[]; redirects: ShellRedirect[] }
  /** A subshell opens or closes: what it changes (cd, variables) does not outlive it. */
  | { type: 'open' }
  | { type: 'close' }
  /** A command or process substitution ($(…), `…`, <(…), >(…)): its own line, run before the command it sits in. */
  | { type: 'sub'; body: string }
  /** `for NAME in …`: NAME takes each of the words in turn (null: the positional parameters). Its body ends at `loopend`. */
  | { type: 'loopvar'; name: string; values: ShellWord[] | null }
  /** `while` / `until`: a loop whose body ends at `loopend` too (kept so a `for` around it finds its own end). */
  | { type: 'loopstart' }
  | { type: 'loopend' };

export class ShellSyntaxError extends Error {}

const OPERATOR_START = new Set([';', '&', '|', '(', ')', '<', '>', '\n']);
const RESERVED_LEAD = new Set(['!', '{', '}', 'do', 'done', 'then', 'else', 'elif', 'fi', 'if', 'while', 'until', 'time', 'esac']);

export const wordText = (w: ShellWord): string => w.parts.map((p) => ('lit' in p ? p.lit : 'var' in p ? `$${p.var}` : '\u0000')).join('');
export const isDynamic = (w: ShellWord): boolean => w.parts.some((p) => !('lit' in p));
/** The word's text when it is all plain text (no variable, no substitution), else null. */
export const literal = (w: ShellWord): string | null => (isDynamic(w) ? null : (w.tilde ? '~' : '') + w.parts.map((p) => (p as { lit: string }).lit).join(''));

interface Token {
  kind: 'word' | 'op' | 'redirect';
  word?: ShellWord;
  op?: string;
  redirect?: ShellRedirect;
}

class Lexer {
  readonly #s: string;
  #i = 0;
  readonly subs: string[][] = [];
  /** Here-documents waiting for the next newline. */
  readonly #pending: Array<{ redirect: ShellRedirect; delimiter: string; strip: boolean }> = [];

  constructor(s: string) {
    this.#s = s;
  }

  tokens(): Array<{ token: Token; subs: string[] }> {
    const out: Array<{ token: Token; subs: string[] }> = [];
    for (;;) {
      this.#skipBlanks();
      if (this.#i >= this.#s.length) break;
      const ch = this.#s[this.#i]!;
      if (ch === '#') {
        while (this.#i < this.#s.length && this.#s[this.#i] !== '\n') this.#i += 1;
        continue;
      }
      if (ch === '\\' && this.#s[this.#i + 1] === '\n') {
        this.#i += 2;
        continue;
      }
      const subs: string[] = [];
      const token = this.#token(subs);
      out.push({ token, subs });
      if (token.kind === 'op' && token.op === '\n') this.#readHeredocs();
    }
    return out;
  }

  #skipBlanks(): void {
    while (this.#i < this.#s.length && (this.#s[this.#i] === ' ' || this.#s[this.#i] === '\t' || this.#s[this.#i] === '\r')) this.#i += 1;
  }

  #token(subs: string[]): Token {
    const s = this.#s;
    const ch = s[this.#i]!;
    // A process substitution <(…) / >(…) is a word.
    if ((ch === '<' || ch === '>') && s[this.#i + 1] === '(') return { kind: 'word', word: this.#word(subs) };
    // fd-numbered redirections: 2>, 2>>, 1>&2 …
    const fd = /^(\d+)(?=[<>])/.exec(s.slice(this.#i, this.#i + 4));
    if (fd) {
      this.#i += fd[1]!.length;
      return this.#redirect(Number(fd[1]), subs);
    }
    if (ch === '<' || ch === '>') return this.#redirect(null, subs);
    if (ch === '&' && s[this.#i + 1] === '>') return this.#redirect(null, subs);
    if (OPERATOR_START.has(ch)) {
      for (const op of [';;&', ';;', ';&', '&&', '||', '|&', ';', '&', '|', '(', ')', '\n']) {
        if (s.startsWith(op, this.#i)) {
          this.#i += op.length;
          return { kind: 'op', op };
        }
      }
    }
    return { kind: 'word', word: this.#word(subs) };
  }

  #redirect(fd: number | null, subs: string[]): Token {
    const s = this.#s;
    let op = '';
    for (const o of ['&>>', '&>', '<<<', '<<-', '<<', '<>', '<&', '<', '>>', '>|', '>&', '>']) {
      if (s.startsWith(o, this.#i)) {
        op = o;
        break;
      }
    }
    this.#i += op.length;
    this.#skipBlanks();
    if (op === '<<' || op === '<<-') {
      const word = this.#word(subs);
      const delimiter = word.parts.map((p) => ('lit' in p ? p.lit : 'var' in p ? `$${p.var}` : '')).join('');
      const redirect: ShellRedirect = { op: '<<', fd, target: null };
      this.#pending.push({ redirect, delimiter, strip: op === '<<-' });
      return { kind: 'redirect', redirect };
    }
    // >&2, 2>&1, <&0: a copy of a descriptor, not a file (>&file is a file for Bash; a number or - is not).
    if ((op === '>&' || op === '<&') && /^(\d+|-)(?![^\s;&|()<>])/.test(s.slice(this.#i))) {
      this.#i += /^(\d+|-)/.exec(s.slice(this.#i))![1]!.length;
      return { kind: 'redirect', redirect: { op, fd, target: null } };
    }
    // A process substitution is a word, also as a target: `done < <(…)`.
    const substitution = (s[this.#i] === '<' || s[this.#i] === '>') && s[this.#i + 1] === '(';
    if (this.#i >= s.length || (OPERATOR_START.has(s[this.#i]!) && !substitution)) throw new ShellSyntaxError(`yönlendirmenin hedefi yok (${op})`);
    return { kind: 'redirect', redirect: { op, fd, target: this.#word(subs) } };
  }

  #readHeredocs(): void {
    const s = this.#s;
    while (this.#pending.length > 0) {
      const h = this.#pending.shift()!;
      const lines: string[] = [];
      for (;;) {
        if (this.#i >= s.length) break;
        const end = s.indexOf('\n', this.#i);
        const line = end === -1 ? s.slice(this.#i) : s.slice(this.#i, end);
        this.#i = end === -1 ? s.length : end + 1;
        const bare = h.strip ? line.replace(/^\t+/, '') : line;
        if (bare === h.delimiter) break;
        lines.push(bare);
      }
      h.redirect.body = lines.join('\n');
    }
  }

  /** Reads one word: quotes, escapes, $… and `…`; stops at an unquoted blank or operator. */
  #word(subs: string[]): ShellWord {
    const s = this.#s;
    const parts: WordPart[] = [];
    let quoted = false;
    let tilde = false;
    let lit = '';
    const flush = () => {
      if (lit) parts.push({ lit });
      lit = '';
    };
    const start = this.#i;
    if (s[this.#i] === '~' && (this.#i + 1 >= s.length || s[this.#i + 1] === '/' || /[\s;&|()<>]/.test(s[this.#i + 1]!))) {
      tilde = true;
      this.#i += 1;
    }
    while (this.#i < s.length) {
      const ch = s[this.#i]!;
      if ((ch === '<' || ch === '>') && s[this.#i + 1] === '(' && this.#i === start) {
        this.#i += 1;
        flush();
        subs.push(this.#balanced('(', ')'));
        parts.push({ dyn: true });
        continue;
      }
      if (ch === ' ' || ch === '\t' || ch === '\r' || OPERATOR_START.has(ch)) break;
      if (ch === '\\') {
        if (s[this.#i + 1] === '\n') {
          this.#i += 2;
          continue;
        }
        lit += s[this.#i + 1] ?? '';
        quoted = true;
        this.#i += 2;
        continue;
      }
      if (ch === "'") {
        const end = s.indexOf("'", this.#i + 1);
        if (end === -1) throw new ShellSyntaxError('kapanmayan tek tırnak');
        lit += s.slice(this.#i + 1, end);
        quoted = true;
        this.#i = end + 1;
        continue;
      }
      if (ch === '$' && s[this.#i + 1] === "'") {
        // ANSI-C quoting: escapes taken as the character after the backslash (enough for the gate).
        let j = this.#i + 2;
        while (j < s.length && s[j] !== "'") {
          if (s[j] === '\\') {
            const next = s[j + 1] ?? '';
            lit += next === 'n' ? '\n' : next === 't' ? '\t' : next;
            j += 2;
            continue;
          }
          lit += s[j];
          j += 1;
        }
        if (j >= s.length) throw new ShellSyntaxError('kapanmayan $\' tırnağı');
        quoted = true;
        this.#i = j + 1;
        continue;
      }
      if (ch === '"' || (ch === '$' && s[this.#i + 1] === '"')) {
        this.#i += ch === '$' ? 2 : 1;
        quoted = true;
        for (;;) {
          if (this.#i >= s.length) throw new ShellSyntaxError('kapanmayan çift tırnak');
          const c = s[this.#i]!;
          if (c === '"') {
            this.#i += 1;
            break;
          }
          if (c === '\\') {
            const next = s[this.#i + 1] ?? '';
            if ('$`"\\\n'.includes(next)) {
              if (next !== '\n') lit += next;
              this.#i += 2;
            } else {
              lit += c;
              this.#i += 1;
            }
            continue;
          }
          if (c === '$' || c === '`') {
            const before = parts.length;
            flush();
            if (!this.#dollar(parts, subs)) {
              lit += c;
              this.#i += 1;
            } else if (parts.length === before) flush();
            continue;
          }
          lit += c;
          this.#i += 1;
        }
        continue;
      }
      if (ch === '$' || ch === '`') {
        flush();
        if (!this.#dollar(parts, subs)) {
          lit += ch;
          this.#i += 1;
        }
        continue;
      }
      if (ch === '*') {
        // A glob: which names it matches is only known at run time (relative ones stay where the shell is).
        flush();
        parts.push({ dyn: true, glob: true });
        this.#i += 1;
        continue;
      }
      lit += ch;
      this.#i += 1;
    }
    flush();
    return { parts, tilde, quoted };
  }

  /** $NAME, ${NAME}, ${…}, $(…), $((…)), `…`, $1, $? …; false when the $ is just a character. */
  #dollar(parts: WordPart[], subs: string[]): boolean {
    const s = this.#s;
    if (s[this.#i] === '`') {
      let j = this.#i + 1;
      let body = '';
      while (j < s.length && s[j] !== '`') {
        if (s[j] === '\\' && j + 1 < s.length) {
          body += s[j + 1];
          j += 2;
          continue;
        }
        body += s[j];
        j += 1;
      }
      if (j >= s.length) throw new ShellSyntaxError('kapanmayan ters tırnak');
      this.#i = j + 1;
      subs.push(body);
      parts.push({ dyn: true, sub: body });
      return true;
    }
    const next = s[this.#i + 1] ?? '';
    if (next === '(' && s[this.#i + 2] === '(') {
      this.#i += 1;
      this.#balanced('(', ')');
      parts.push({ dyn: true });
      return true;
    }
    if (next === '(') {
      this.#i += 1;
      const body = this.#balanced('(', ')');
      subs.push(body);
      parts.push({ dyn: true, sub: body });
      return true;
    }
    if (next === '{') {
      this.#i += 1;
      const inner = this.#balanced('{', '}');
      // ${NAME}, and ${NAME:-word} / ${NAME:=word}: NAME's value, or the word when NAME is unset (a plain word only).
      // ${NAME:?message} stops the line when NAME is unset: NAME's value either way.
      const name = /^([A-Za-z_][A-Za-z0-9_]*)(?:$|:?[-=](.*)$|:?\?.*$)/s.exec(inner);
      const def = name?.[2];
      parts.push(name ? (def !== undefined && /^[^$`"'\\]*$/.test(def) ? { var: name[1]!, def } : def === undefined ? { var: name[1]! } : { dyn: true }) : { dyn: true });
      return true;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(this.#i + 1));
    if (name) {
      this.#i += 1 + name[0].length;
      parts.push({ var: name[0] });
      return true;
    }
    if (/^[0-9]$/.test(next)) {
      // A positional parameter: known when a script is run with arguments the line gives.
      this.#i += 2;
      parts.push({ var: next });
      return true;
    }
    if (/^[@*#?$!-]$/.test(next)) {
      this.#i += 2;
      parts.push({ dyn: true });
      return true;
    }
    return false;
  }

  /** From an opening bracket at #i to its partner (quotes and nesting respected); returns what is between. */
  #balanced(open: string, close: string): string {
    const s = this.#s;
    let depth = 0;
    const from = this.#i + 1;
    for (let j = this.#i; j < s.length; j += 1) {
      const c = s[j]!;
      if (c === '\\') {
        j += 1;
        continue;
      }
      if (c === "'" && open === '(') {
        const end = s.indexOf("'", j + 1);
        if (end === -1) throw new ShellSyntaxError('kapanmayan tek tırnak');
        j = end;
        continue;
      }
      if (c === '"') {
        let k = j + 1;
        while (k < s.length && s[k] !== '"') k += s[k] === '\\' ? 2 : 1;
        if (k >= s.length) throw new ShellSyntaxError('kapanmayan çift tırnak');
        j = k;
        continue;
      }
      if (c === open) depth += 1;
      else if (c === close) {
        depth -= 1;
        if (depth === 0) {
          this.#i = j + 1;
          return s.slice(from, j);
        }
      }
    }
    throw new ShellSyntaxError(`kapanmayan ${open}`);
  }
}

/** Splits a line into the nodes it runs, in order. Throws ShellSyntaxError on what it cannot read. */
export function parseShell(line: string): ShellNode[] {
  const tokens = new Lexer(line).tokens();
  const out: ShellNode[] = [];
  let words: ShellWord[] = [];
  let assigns: ShellAssign[] = [];
  let redirects: ShellRedirect[] = [];
  let pendingSubs: string[] = [];
  /** Inside `case … in` waiting for a pattern (up to its `)`). */
  let casePattern = false;
  /** `[[ … ]]` / `(( … ))`: skipped as a test, not a command. */
  let skipUntil: string | null = null;
  const end = () => {
    for (const body of pendingSubs) out.push({ type: 'sub', body });
    pendingSubs = [];
    if (words.length > 0 || assigns.length > 0 || redirects.length > 0) out.push({ type: 'command', words, assigns, redirects });
    words = [];
    assigns = [];
    redirects = [];
  };
  for (let k = 0; k < tokens.length; k += 1) {
    const { token, subs } = tokens[k]!;
    if (skipUntil !== null) {
      if (token.kind === 'word' && literal(token.word!) === skipUntil) skipUntil = null;
      continue;
    }
    if (casePattern) {
      if (token.kind === 'op' && token.op === ')') casePattern = false;
      if (token.kind === 'word' && literal(token.word!) === 'esac') casePattern = false;
      continue;
    }
    pendingSubs.push(...subs);
    if (token.kind === 'redirect') {
      redirects.push(token.redirect!);
      continue;
    }
    if (token.kind === 'op') {
      const op = token.op!;
      if (op === '(' && words.length === 1 && assigns.length === 0 && tokens[k + 1]?.token.op === ')') {
        // name() { … }: a function definition — its body is read as commands (they may run).
        words = [];
        k += 1;
        continue;
      }
      end();
      if (op === '(') out.push({ type: 'open' });
      else if (op === ')') out.push({ type: 'close' });
      else if (op === ';;' || op === ';&' || op === ';;&') casePattern = true;
      continue;
    }
    const w = token.word!;
    const text = literal(w);
    if (words.length === 0) {
      // Reserved words that lead a command do not change what it does; loops are marked so their bodies can be told.
      if (text !== null && !w.quoted && RESERVED_LEAD.has(text)) {
        if (text === 'while' || text === 'until') out.push({ type: 'loopstart' });
        if (text === 'done') out.push({ type: 'loopend' });
        continue;
      }
      if (text === '[[' && !w.quoted) {
        skipUntil = ']]';
        continue;
      }
      if (text === '((' && !w.quoted) {
        skipUntil = '))';
        continue;
      }
      if (text === 'for' && !w.quoted) {
        const name = tokens[k + 1]?.token.word ? literal(tokens[k + 1]!.token.word!) : null;
        // Up to the separator before `do`: the words after `in` are the values.
        const values: ShellWord[] = [];
        let listed = false;
        for (k += 1; k + 1 < tokens.length && !(tokens[k + 1]!.token.kind === 'op' && [';', '\n'].includes(tokens[k + 1]!.token.op!)); ) {
          k += 1;
          pendingSubs.push(...tokens[k]!.subs);
          const word = tokens[k]!.token.word;
          if (word && !listed && literal(word) === 'in') listed = true;
          else if (word && listed) values.push(word);
        }
        if (name) out.push({ type: 'loopvar', name, values: listed ? values : null });
        continue;
      }
      if (text === 'case' && !w.quoted) {
        while (k + 1 < tokens.length && !(tokens[k + 1]!.token.word && literal(tokens[k + 1]!.token.word!) === 'in')) k += 1;
        k += 1;
        casePattern = true;
        continue;
      }
      const assign = !w.tilde && w.parts[0] && 'lit' in w.parts[0] ? /^([A-Za-z_][A-Za-z0-9_]*)\+?=/.exec(w.parts[0].lit) : null;
      if (assign && w.parts.length === 1 && (w.parts[0] as { lit: string }).lit === assign[0] && tokens[k + 1]?.token.op === '(') {
        // An array: name=(…) — its items are words, not a subshell; its value is only known at run time.
        let depth = 0;
        for (k += 1; k < tokens.length; k += 1) {
          const op = tokens[k]!.token.op;
          pendingSubs.push(...tokens[k]!.subs);
          if (op === '(') depth += 1;
          if (op === ')' && --depth === 0) break;
        }
        assigns.push({ name: assign[1]!, value: { parts: [{ dyn: true }], tilde: false, quoted: false } });
        continue;
      }
      if (assign) {
        const first = w.parts[0] as { lit: string };
        const rest = first.lit.slice(assign[0].length);
        const valueParts: WordPart[] = [...(rest ? [{ lit: rest }] : []), ...w.parts.slice(1)];
        const tildeValue = rest.startsWith('~') && (rest.length === 1 || rest[1] === '/');
        assigns.push({ name: assign[1]!, value: { parts: tildeValue ? [{ lit: rest.slice(1) }, ...w.parts.slice(1)] : valueParts, tilde: tildeValue, quoted: w.quoted } });
        continue;
      }
    }
    words.push(w);
  }
  end();
  return out;
}
