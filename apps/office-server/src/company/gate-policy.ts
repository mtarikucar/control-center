import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { ApprovalKind, ApprovalScope } from '@cc/shared';
import { toolClass } from './capabilities.ts';
import { literal, parseShell, ShellSyntaxError, type ShellAssign, type ShellNode, type ShellWord } from './shell.ts';

/**
 * The gate's policy (B9a; design tasarim-b9-kanca-onay.md §3, §3.1): which tool calls wait for the owner, as what, and
 * on what coarse target. A pure function of the call and the context; the context's few questions to the disk (a
 * folder's repository, the live checkout's worktrees and whether they hold uncommitted work, a script's text) are
 * given, so tests fake them. Nothing here runs a command.
 */

export interface GateContext {
  home: string;
  /** The live checkout (REPO_ROOT). */
  repoRoot: string;
  /** The office's data folder (~/.control-center). */
  dataDir: string;
  /** The caller's desk. */
  deskDir: string;
  officePort: number;
  /** Host names the office answers besides the loopback ones (OFFICE_ALLOWED_HOSTS). */
  officeHosts: string[];
  /** The free deletion area besides the desk: /tmp and os.tmpdir(). */
  tmpDirs: string[];
  /** The top folder of the git repository a path is in (git rev-parse --show-toplevel), or null. */
  toplevel(path: string): string | null;
  /** The live checkout's registered worktrees (git worktree list), the live checkout itself left out or not. */
  worktrees(): string[];
  /** A worktree holds uncommitted work (git status --porcelain --untracked-files=all is not empty). */
  dirty(worktree: string): boolean;
  /** A script's text (for `bash file`, `source file`), or null when it cannot be read. */
  readScript(path: string): string | null;
  /** Symbolic links resolved, as far as the path exists. */
  realpath(path: string): string;
}

export interface GatePart {
  kind: ApprovalKind;
  /** The coarse target the owner reads and an approval matches (§4 madde 4). */
  target: string;
  /** Why it is held, in Turkish, for the model and the owner. */
  why: string;
}

export interface GateVerdict {
  gated: boolean;
  parts: GatePart[];
  /** 'task' for browser actions (one approval for the task), else 'call'. */
  scope: ApprovalScope;
}

/** sha256(tool|kind|target): the same call, the same print; the kind keeps a plain push from passing as a forced one. */
export function fingerprint(tool: string, part: Pick<GatePart, 'kind' | 'target'>): string {
  return createHash('sha256').update(`${tool}|${part.kind}|${part.target}`).digest('hex');
}

/** For approvals of a task's scope: calls of the same server (or the same command word) count as the same family. */
export function toolFamily(tool: string, target: string): string {
  if (tool.startsWith('mcp__')) return tool.slice(0, tool.indexOf('__', 5) + 2);
  if (tool === 'Bash' || tool === 'Monitor') return `shell:${target.split(' ')[0] ?? ''}`;
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') return 'file';
  return tool;
}

/** The connector capabilities that do something outside, by what they do (§3 Y1). */
const KIND_BY_CAPABILITY: Record<string, ApprovalKind> = {
  'email.send': 'send', 'calendar.write': 'send', 'messages.send': 'send', 'calls.make': 'send',
  'social.publish': 'publish', 'web.publish': 'publish',
  'payments.charge': 'pay', 'ads.manage': 'pay', 'media.generate': 'pay', 'automation.run': 'pay',
  'email.delete': 'delete',
};

/** Playwright's tools that only look (§3 Y3); every other browser_ tool acts and waits for an approval of the task. */
const BROWSER_READ = new Set(['browser_navigate', 'browser_navigate_back', 'browser_snapshot', 'browser_take_screenshot', 'browser_find', 'browser_console_messages', 'browser_network_requests', 'browser_tabs', 'browser_wait_for', 'browser_resize', 'browser_hover', 'browser_close']);

/** GET on these office API paths only reads (§3 Y2); any other request to the office is held. */
const OFFICE_READS = new Set(['/api/office', '/api/metrics', '/api/agenda', '/api/performance', '/api/integrations', '/api/capabilities']);
const officeRead = (path: string) => OFFICE_READS.has(path) || path === '/api/memory' || path.startsWith('/api/memory/') || /^\/api\/employees\/[^/]+\/events$/.test(path);

/** git subcommands that rewrite a working tree or the branch it is on (§3.1 (b)); only held at the live checkout. */
const GIT_REWRITE = new Set(['checkout', 'switch', 'reset', 'restore', 'stash', 'apply', 'am', 'merge', 'pull', 'rebase', 'cherry-pick', 'revert', 'clean', 'rm', 'mv', 'commit']);
const PACKAGE_WRITES = new Set(['install', 'i', 'ci', 'add', 'remove', 'rm', 'uninstall', 'un', 'update', 'up', 'upgrade', 'build', 'link', 'unlink', 'prune', 'dedupe', 'rebuild']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const INTERPRETERS = new Set(['node', 'python', 'python3', 'perl', 'ruby', 'deno', 'bun', 'tsx', 'ts-node']);
const DEPLOY_CLIS = new Set(['gcloud', 'aws', 'az', 'vercel', 'netlify', 'fly', 'flyctl', 'firebase', 'heroku', 'wrangler', 'railway', 'render', 'surge']);
const PAY_CLIS = new Set(['stripe', 'iyzico', 'paypal']);
const MAIL_CLIS = new Set(['mail', 'mailx', 'sendmail', 'mutt']);
const RO_MARK = /readOnly\s*:\s*true|mode=ro|immutable=1|-readonly/;
const DYN = '\u0000';
const MAX_DEPTH = 6;

const KIND_WHY: Record<ApprovalKind, string> = {
  publish: 'dışarıda yayımlar', send: 'dışarıya gönderir', pay: 'para harcar', delete: 'geri alınamaz siler', browser: 'tarayıcıda iş yapar', self: 'ofisin kendisine dokunur', other: 'ne yaptığı bilinmiyor',
};

const under = (p: string, root: string) => p === root || p.startsWith(root.endsWith('/') ? root : `${root}/`);

/** Claude Code keeps a working folder's memory under ~/.claude/projects/<the folder, every other character a dash>. */
const projectKey = (dir: string) => dir.replace(/[^A-Za-z0-9]/g, '-');

/** Why writing at `path` is held (§3.1), or null; `recursive`: also when it holds a protected folder (rm -r, mv). */
export function protectedWhy(path: string, ctx: GateContext, recursive = false): string | null {
  const p = ctx.realpath(path);
  const { home } = ctx;
  if (under(p, `${home}/.ssh`) || under(p, `${home}/.config/gh`)) return 'kimlik dosyaları';
  if (under(p, `${home}/.claude`)) return under(p, `${home}/.claude/projects/${projectKey(ctx.deskDir)}`) ? null : 'sahibinin Claude ayarları';
  if (under(p, ctx.repoRoot)) return 'canlı checkout (kapının ve ofisin kodu)';
  if (under(p, ctx.deskDir)) return under(p, `${ctx.deskDir}/.claude`) ? 'masanın Claude ayarları (.claude)' : null;
  if (under(p, `${ctx.dataDir}/desks`)) return p === `${ctx.dataDir}/desks` ? 'masalar' : 'başkasının masası';
  if (under(p, ctx.dataDir)) return 'ofisin veri dizini (veritabanı, şirket hafızası)';
  if (recursive) {
    for (const root of [`${home}/.ssh`, `${home}/.config/gh`, `${home}/.claude`, ctx.repoRoot, ctx.dataDir]) if (under(root, p)) return 'korunan bir klasörü içine alıyor';
  }
  return null;
}

const freeToDelete = (p: string, ctx: GateContext) => ctx.tmpDirs.some((t) => under(p, t)) || under(p, ctx.deskDir);

/** A path against the live checkout's worktrees: inside or around one with uncommitted work, inside or at a clean one, or none. */
function worktreeOf(p: string, ctx: GateContext): 'dirty' | 'clean' | null {
  let found: 'clean' | null = null;
  for (const wt of ctx.worktrees()) {
    if (wt === ctx.repoRoot) continue;
    if (under(p, wt) || under(wt, p)) {
      if (ctx.dirty(wt)) return 'dirty';
      if (under(p, wt)) found = 'clean';
    }
  }
  return found;
}

// ---------------------------------------------------------------------------------------------------------------------
// The shell: state while a line runs, and how a word becomes a path.

interface ShellState {
  /** null: only known at run time (cd "$UNKNOWN"). */
  cwd: string | null;
  vars: Map<string, string | null>;
  dirs: Array<string | null>;
}

const copyState = (st: ShellState): ShellState => ({ cwd: st.cwd, vars: new Map(st.vars), dirs: [...st.dirs] });
/** A script started with VAR=value in front sees those variables. */
const withEnv = (st: ShellState, env: Map<string, string | null>): ShellState => {
  if (env.size === 0) return st;
  const next = copyState(st);
  for (const [k, v] of env) next.vars.set(k, v);
  return next;
};

function expand(w: ShellWord, st: ShellState, ctx: GateContext, env?: Map<string, string | null>): string {
  let out = w.tilde ? ctx.home : '';
  for (const part of w.parts) {
    if ('lit' in part) out += part.lit;
    else if ('var' in part) {
      const name = part.var;
      const known = env?.has(name) ? env.get(name) : st.vars.has(name) ? st.vars.get(name) : name === 'HOME' ? ctx.home : name === 'PWD' ? st.cwd : name === 'TMPDIR' ? (ctx.tmpDirs[ctx.tmpDirs.length - 1] ?? null) : null;
      // ${NAME:-word} with NAME not set in this line: the word (a variable exported in an earlier call is not seen; §8).
      const def = 'def' in part && part.def !== undefined && !(env?.has(name) || st.vars.has(name)) ? part.def.replace(/^~(?=\/|$)/, ctx.home) : undefined;
      out += known ?? def ?? DYN;
    } else out += part.sub ? (tempOf(part.sub, ctx) ?? DYN) : DYN;
  }
  return out;
}

/** What `mktemp` prints is known up to its last part: a new name in its folder (-p, a template's folder, or the temp folder). */
function tempOf(sub: string, ctx: GateContext): string | null {
  const words = sub.trim().split(/\s+/);
  if (words[0] !== 'mktemp') return null;
  let dir: string | null = null;
  let template: string | null = null;
  for (let i = 1; i < words.length; i += 1) {
    const w = words[i]!;
    if (w === '-p' || w === '--tmpdir') dir = words[++i] ?? null;
    else if (w.startsWith('--tmpdir=')) dir = w.slice(9);
    else if (!w.startsWith('-')) template = w;
  }
  const base = template?.includes('/') ? posix.dirname(template) : (dir ?? ctx.tmpDirs[ctx.tmpDirs.length - 1] ?? '/tmp');
  if (/[$`"']/.test(base) || !base.startsWith('/')) return null;
  return `${posix.resolve(base.replace(/^~(?=\/|$)/, ctx.home))}/${DYN}`;
}

const textOf = (w: ShellWord | undefined, st: ShellState, ctx: GateContext) => (w ? expand(w, st, ctx) : '');
const shown = (s: string) => s.replace(/\u0000/g, '?');

/**
 * A word as a path: resolved against the effective cwd; when only its last part is known at run time, its folder
 * (`partial`); null when it is not known (an unknown variable in front, an unknown cwd for a relative path).
 */
function pathOf(w: ShellWord, st: ShellState, ctx: GateContext): { path: string; partial: boolean } | null {
  const t = expand(w, st, ctx);
  const at = t.indexOf(DYN);
  const resolve = (s: string) => (s.startsWith('/') ? posix.resolve(s) : st.cwd ? posix.resolve(st.cwd, s) : null);
  if (at === -1) {
    const path = resolve(t);
    return path ? { path, partial: false } : null;
  }
  // Known only in its last part (a glob, $(basename …), run-$1.txt): its folder is. Known up to a folder that can hold
  // nothing protected ("$D/out.txt" with D=/tmp/<mktemp>): that folder is. Unknown from its start: nothing is.
  if (t.startsWith(DYN)) return null;
  const slash = t.lastIndexOf('/', at);
  const path = resolve(slash === -1 ? '.' : t.slice(0, slash) || '/');
  if (!path) return null;
  if (t.indexOf('/', at) !== -1 && protectedWhy(path, ctx, true)) return null;
  return { path, partial: true };
}

const flag = (t: string) => t.startsWith('-') && t.length > 1;

// ---------------------------------------------------------------------------------------------------------------------
// HTTP: curl, wget, httpie; and the office's own API.

/**
 * The office's own address, in every form a client takes for it (review round 1, Kerem): hosts the URL parser has
 * normalised (127.1, 0x7f000001 → 127.0.0.1), the loopback names (localhost, *.localhost, ::1, ::ffff:127.x), names that
 * resolve back to it (127.0.0.1.nip.io, 127-0-0-1.sslip.io), the hosts the office answers, and its port on any host.
 */
const LOOPBACK = /^(localhost|.+\.localhost|127(?:\.\d+){3}|\[?::1\]?|\[::ffff:(?:127\.[\d.]+|7f[0-9a-f]{2}:[0-9a-f]{1,4})\]|0\.0\.0\.0|0|\[::\])$/i;
const REBINDS = /(^|[.-])127[.-]0[.-]0[.-]1([.-]|$)/;
const isOffice = (host: string, port: number, ctx: GateContext) => LOOPBACK.test(host) || REBINDS.test(host) || ctx.officeHosts.includes(host) || port === ctx.officePort;
const portOf = (url: URL) => (url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80);

interface Request {
  method: string;
  url: string;
}

/** A word a client would take as a URL (curl takes scheme-less hosts); null if it is not one. */
function urlOf(t: string): URL | null {
  if (t.includes(DYN)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : /^(\[[0-9a-f:]+\]|[\w-]+(\.[\w-]+)*)(:\d+)?([/?#]|$)/i.test(t) && (t.includes('.') || t.includes(':') || /^localhost/i.test(t)) ? `http://${t}` : null;
  if (!withScheme) return null;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

function httpParts(cmd: string, reqs: Request[], ctx: GateContext): GatePart[] {
  const out: GatePart[] = [];
  for (const r of reqs) {
    const method = r.method.toUpperCase();
    const reads = method === 'GET' || method === 'HEAD';
    const url = urlOf(r.url);
    if (!url) {
      // Not known until it runs: a request that writes is held; a read is held only if it looks like the office.
      if (!reads) out.push({ kind: 'send', target: `${cmd} ?`, why: `${KIND_WHY.send} (adres çalışınca belli olur)` });
      else if (/\/api\/|\/gate\/|\/mcp\b|localhost|127\.0\.0\.1/.test(r.url)) out.push({ kind: 'self', target: `${cmd} ${method} ${shown(r.url)}`, why: 'ofisin API’sine gidiyor olabilir (adres çalışınca belli olur)' });
      continue;
    }
    const host = url.hostname.toLowerCase();
    if (isOffice(host, portOf(url), ctx)) {
      if (reads && officeRead(url.pathname)) continue;
      out.push({ kind: 'self', target: `${cmd} ${method} ${url.pathname}`, why: 'ofisin kendi API’si (yalnız okuma izin listesi serbest; onay ve sahibi uçları kapıda)' });
      continue;
    }
    if (!reads) out.push({ kind: 'send', target: `${cmd} ${host}`, why: KIND_WHY.send });
  }
  return out;
}

const CURL_BOOL = new Set(['--silent', '--show-error', '--fail', '--fail-with-body', '--location', '--insecure', '--compressed', '--verbose', '--include', '--head', '--get', '--globoff', '--no-buffer', '--progress-bar', '--http1.0', '--http1.1', '--http2', '--http3', '--ipv4', '--ipv6', '--remote-name', '--remote-name-all', '--create-dirs', '--raw', '--no-progress-meter', '--retry-all-errors', '--location-trusted', '--fail-early', '--no-keepalive', '--tcp-nodelay', '--disable', '--anyauth', '--basic', '--digest', '--ntlm', '--negotiate', '--compressed-ssh', '--tr-encoding', '--remote-time', '--styled-output', '--no-styled-output']);
const CURL_SHORT_VALUE = new Set([...'AbcCdDeEFHKmoPQrtTuUwxXyYz']);

function curlRequests(args: string[]): Request[] {
  let method: string | null = null;
  let data = false;
  let get = false;
  let head = false;
  const urls: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const t = args[i]!;
    if (t.startsWith('--')) {
      const [name, inline] = t.includes('=') ? [t.slice(0, t.indexOf('=')), t.slice(t.indexOf('=') + 1)] : [t, null];
      const value = () => inline ?? args[++i] ?? '';
      if (name === '--request') method = value();
      else if (name === '--url') urls.push(value());
      else if (name.startsWith('--data') || name === '--json' || name === '--form' || name === '--form-string' || name === '--upload-file') {
        data = true;
        value();
      } else if (name === '--get') get = true;
      else if (name === '--head') head = true;
      else if (!CURL_BOOL.has(name) && inline === null) i += 1;
      continue;
    }
    if (flag(t)) {
      for (let j = 1; j < t.length; j += 1) {
        const c = t[j]!;
        if (c === 'G') get = true;
        if (c === 'I') head = true;
        if (CURL_SHORT_VALUE.has(c)) {
          const value = t.slice(j + 1) || args[++i] || '';
          if (c === 'X') method = value;
          if (c === 'd' || c === 'F' || c === 'T') data = true;
          break;
        }
      }
      continue;
    }
    urls.push(t);
  }
  const m = method ?? (data && !get ? 'POST' : head ? 'HEAD' : 'GET');
  return urls.filter((u) => urlOf(u) || u.includes(DYN)).map((url) => ({ method: m, url }));
}

function wgetRequests(args: string[]): Request[] {
  let method = 'GET';
  const urls: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const t = args[i]!;
    if (t.startsWith('--')) {
      const name = t.includes('=') ? t.slice(0, t.indexOf('=')) : t;
      if (['--post-data', '--post-file', '--body-data', '--body-file'].includes(name)) {
        method = method === 'GET' ? 'POST' : method;
        if (!t.includes('=')) i += 1;
      }
      if (name === '--method') method = t.includes('=') ? t.slice(t.indexOf('=') + 1) : (args[++i] ?? method);
      continue;
    }
    if (flag(t)) {
      if (/^-[OoPUetTwlDQ]$/.test(t)) i += 1;
      continue;
    }
    urls.push(t);
  }
  return urls.filter((u) => urlOf(u) || u.includes(DYN)).map((url) => ({ method, url }));
}

function httpieRequests(args: string[]): Request[] {
  const positional = args.filter((t) => !flag(t));
  let method: string | null = null;
  if (positional[0] && /^[A-Z]+$/.test(positional[0])) method = positional.shift()!;
  const url = positional.shift();
  if (!url) return [];
  const items = positional;
  const writes = items.some((x) => /^[^=:@]+(:=|=(?!=)|@)/.test(x));
  const full = url.startsWith(':') ? `localhost${url}` : url;
  return [{ method: method ?? (writes ? 'POST' : 'GET'), url: full }];
}

// ---------------------------------------------------------------------------------------------------------------------
// The commands.

interface Run {
  ctx: GateContext;
  parts: GatePart[];
  depth: number;
  /** Files the line itself writes from a here-document (cat > f <<EOF): what a later `node f` or `bash f` reads. */
  written: Map<string, string>;
}

function add(run: Run, part: GatePart): void {
  if (!run.parts.some((p) => p.kind === part.kind && p.target === part.target)) run.parts.push(part);
}

/**
 * A loop variable over literal words: when they all lie in one folder, it is "a name in that folder" (known up to its
 * last part); else, or over anything known only at run time, unknown.
 */
function loopValue(values: ShellWord[] | null, st: ShellState, ctx: GateContext): string | null {
  if (!values || values.length === 0) return null;
  const texts = values.map((w) => expand(w, st, ctx));
  if (texts.some((t) => t.includes(DYN))) return null;
  if (texts.every((t) => t === texts[0])) return texts[0]!;
  const dirs = new Set(texts.map((t) => (t.includes('/') ? posix.dirname(t) : '.')));
  return dirs.size === 1 ? `${[...dirs][0]}/${DYN}` : null;
}

/** Classifies a shell line in a state (changed in place: cd, assignments); every held part goes to run.parts. */
function shellLine(line: string, st: ShellState, run: Run): void {
  if (run.depth > MAX_DEPTH) {
    add(run, { kind: 'other', target: 'iç içe yürütme', why: 'çok derin dolaylı yürütme' });
    return;
  }
  let nodes: ShellNode[];
  try {
    nodes = parseShell(line);
  } catch (err) {
    if (!(err instanceof ShellSyntaxError)) throw err;
    add(run, { kind: 'other', target: `okunamayan komut: ${line.replace(/\s+/g, ' ').slice(0, 60)}`, why: `komut okunamadı (${err.message})` });
    return;
  }
  walk(nodes, st, run);
}

/** The body of a loop: the nodes up to its own `loopend` (loops inside it keep theirs). */
function loopBody(nodes: ShellNode[], from: number): number {
  let depth = 1;
  for (let i = from; i < nodes.length; i += 1) {
    const type = nodes[i]!.type;
    if (type === 'loopvar' || type === 'loopstart') depth += 1;
    if (type === 'loopend' && --depth === 0) return i;
  }
  return nodes.length;
}

function walk(nodes: ShellNode[], st: ShellState, run: Run): void {
  const saved: ShellState[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]!;
    if (node.type === 'open') saved.push(copyState(st));
    else if (node.type === 'close') {
      const back = saved.pop();
      if (back) Object.assign(st, back);
    } else if (node.type === 'loopvar') {
      // A loop over words known now runs its body once per word; otherwise once, the variable known as far as it can be.
      const end = loopBody(nodes, i + 1);
      const body = nodes.slice(i + 1, end);
      const values = node.values?.map((w) => expand(w, st, run.ctx)) ?? null;
      if (values && values.length > 0 && values.length <= 32 && values.every((v) => !v.includes(DYN))) {
        for (const v of values) {
          st.vars.set(node.name, v);
          walk(body, st, run);
        }
      } else {
        st.vars.set(node.name, loopValue(node.values, st, run.ctx));
        walk(body, st, run);
      }
      i = end;
    } else if (node.type === 'loopstart' || node.type === 'loopend') continue;
    else if (node.type === 'sub') shellLine(node.body, copyState(st), { ...run, depth: run.depth + 1, parts: run.parts });
    else command(node.words, node.assigns, node.redirects, st, run);
  }
}

function command(words: ShellWord[], assigns: ShellAssign[], redirects: Array<{ op: string; target: ShellWord | null; body?: string }>, st: ShellState, run: Run): void {
  const { ctx } = run;
  const env = new Map<string, string | null>();
  for (const a of assigns) {
    // A value known only in part (/tmp/<mktemp>) is kept as such: its known part still says where it is.
    const value = expand(a.value, st, ctx);
    if (words.length === 0) st.vars.set(a.name, value);
    else env.set(a.name, value);
  }
  // Redirections write files whatever the command is.
  const body = redirects.find((r) => r.op === '<<' && r.body !== undefined)?.body;
  for (const r of redirects) {
    if (!['>', '>>', '>|', '&>', '&>>', '<>', '>&'].includes(r.op) || !r.target) continue;
    const t = textOf(r.target, st, ctx);
    if (/^\/dev\/(null|stdout|stderr|tty|fd\/\d+)$/.test(t)) continue;
    writeTarget(run, '>', r.target, st);
    const at = pathOf(r.target, st, ctx);
    if (body !== undefined && at && !at.partial) run.written.set(at.path, body);
  }
  if (words.length === 0) return;
  simple(words, env, redirects, st, run);
}

const texts = (words: ShellWord[], st: ShellState, ctx: GateContext) => words.map((w) => textOf(w, st, ctx));

/** A file the command writes: held when its resolved target is protected, or when it cannot be known. */
function writeTarget(run: Run, verb: string, w: ShellWord, st: ShellState, recursive = false): void {
  const at = pathOf(w, st, run.ctx);
  if (!at) {
    add(run, { kind: 'self', target: `${verb} ${shown(textOf(w, st, run.ctx))}`, why: 'yazdığı yer çalışınca belli olur (temkinli: kapıda)' });
    return;
  }
  const why = protectedWhy(at.path, run.ctx, recursive || at.partial);
  if (why) add(run, { kind: 'self', target: `${verb} ${at.path}`, why: `korunan yola yazar: ${why}` });
}

/** rm -r and the like: the free deletion area, the worktrees, the protected paths (§3.1, round 3 and 3f7fe283). */
function deleteTarget(run: Run, verb: string, w: ShellWord, st: ShellState): void {
  const at = pathOf(w, st, run.ctx);
  if (!at) {
    add(run, { kind: 'delete', target: `${verb} ${shown(textOf(w, st, run.ctx))}`, why: 'neyi sileceği çalışınca belli olur (temkinli: kapıda)' });
    return;
  }
  const why = protectedWhy(at.path, run.ctx, true);
  if (why) {
    add(run, { kind: 'self', target: `${verb} ${at.path}`, why: `korunan yolu siler: ${why}` });
    return;
  }
  const wt = worktreeOf(at.path, run.ctx);
  if (wt === 'dirty') {
    add(run, { kind: 'delete', target: `${verb} ${at.path}`, why: 'commit edilmemiş işi olan bir worktree’yi siler' });
    return;
  }
  if (wt === 'clean' || freeToDelete(at.path, run.ctx)) return;
  add(run, { kind: 'delete', target: `${verb} ${at.path}`, why: 'serbest silme alanı (masa, /tmp) dışında' });
}

function simple(all: ShellWord[], env: Map<string, string | null>, redirects: Array<{ op: string; target: ShellWord | null; body?: string }>, st: ShellState, run: Run): void {
  const { ctx } = run;
  let words = all;
  // Wrappers that run the rest as a command.
  for (;;) {
    const head = literal(words[0]!) ?? '';
    const t = texts(words, st, ctx);
    if (head === 'sudo') {
      let i = 1;
      while (i < t.length && flag(t[i]!)) i += /^-[ugCDhprtUT]$/.test(t[i]!) ? 2 : 1;
      words = words.slice(i);
    } else if (head === 'env') {
      let i = 1;
      for (; i < t.length; i += 1) {
        if (t[i] === '-C' || t[i] === '--chdir') {
          const at = pathOf(words[i + 1]!, st, ctx);
          st = { ...st, cwd: at && !at.partial ? at.path : null };
          i += 1;
        } else if (t[i] === '-u' || t[i] === '--unset') i += 1;
        else if (t[i] === '-S' || t[i] === '--split-string') {
          shellLine(t[i + 1] ?? '', copyState(st), { ...run, depth: run.depth + 1 });
          return;
        } else if (flag(t[i]!)) continue;
        else if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t[i]!)) env.set(t[i]!.slice(0, t[i]!.indexOf('=')), t[i]!.includes(DYN) ? null : t[i]!.slice(t[i]!.indexOf('=') + 1));
        else break;
      }
      words = words.slice(i);
    } else if (head === 'timeout') {
      let i = 1;
      while (i < t.length && flag(t[i]!)) i += /^-[sk]$/.test(t[i]!) ? 2 : 1;
      words = words.slice(i + 1);
    } else if (head === 'nice' || head === 'ionice' || head === 'stdbuf') {
      let i = 1;
      while (i < t.length && flag(t[i]!)) i += /^-[ncioe]$/.test(t[i]!) ? 2 : 1;
      words = words.slice(i);
    } else if (['nohup', 'command', 'builtin', 'exec', 'setsid', 'time', 'chronic', 'unbuffer'].includes(head)) {
      let i = 1;
      while (i < t.length && flag(t[i]!)) i += 1;
      words = words.slice(i);
    } else if (head === 'xargs') {
      let i = 1;
      let placeholder: string | null = null;
      while (i < t.length && flag(t[i]!)) {
        if (t[i] === '-I') {
          placeholder = t[i + 1] ?? '{}';
          i += 2;
        } else if (/^-[nLPdEsa]$/.test(t[i]!)) i += 2;
        else {
          if (t[i]!.startsWith('-I') || t[i]!.startsWith('-i')) placeholder = t[i]!.slice(2) || '{}';
          i += 1;
        }
      }
      // What xargs reads from its input stands where the placeholder is (or after the command): known only at run time.
      const ph = placeholder;
      const rest = words.slice(i).map((w): ShellWord => {
        const text = textOf(w, st, ctx);
        return ph && text.includes(ph) ? { parts: [{ lit: text.split(ph).join(DYN) }], tilde: false, quoted: true } : w;
      });
      words = ph ? rest : [...rest, { parts: [{ dyn: true }], tilde: false, quoted: false }];
    } else break;
    if (words.length === 0) return;
  }
  const t = texts(words, st, ctx);
  // A command whose name is only known at run time could be anything (design §3 Y2: an unresolved command is held).
  if (t[0]!.includes(DYN)) return add(run, { kind: 'other', target: `${shown(t[0]!)} ${shown(t.slice(1).join(' '))}`.trim().slice(0, 80), why: 'komutun adı çalışınca belli olur' });
  const cmd = t[0]!;
  const name = cmd.includes('/') ? posix.basename(cmd) : cmd;
  const args = t.slice(1);

  // The shell's own state.
  if (cmd === 'cd' || cmd === 'pushd') {
    const target = words[1];
    if (cmd === 'pushd') st.dirs.push(st.cwd);
    if (!target) st.cwd = ctx.home;
    else if (textOf(target, st, ctx) === '-') st.cwd = null;
    else {
      // A folder known up to its last part (cd "$(mktemp -d)"): the shell is somewhere inside its known folder — enough
      // when that folder can hold nothing protected; otherwise unknown.
      const at = pathOf(target, st, ctx);
      st.cwd = !at ? null : !at.partial ? at.path : protectedWhy(at.path, ctx, true) ? null : `${at.path}/${DYN}`;
    }
    return;
  }
  if (cmd === 'popd') {
    st.cwd = st.dirs.length ? (st.dirs.pop() ?? null) : null;
    return;
  }
  if (['export', 'declare', 'local', 'readonly', 'typeset'].includes(cmd)) {
    for (const w of words.slice(1)) {
      const v = textOf(w, st, ctx);
      const eq = v.indexOf('=');
      if (eq > 0 && !flag(v)) st.vars.set(v.slice(0, eq), v.includes(DYN) ? null : v.slice(eq + 1));
    }
    return;
  }
  if (cmd === 'unset' || cmd === 'read') {
    for (const v of args) if (!flag(v)) st.vars.set(v, null);
    return;
  }

  // Indirect execution: what it runs is read and classified as well.
  if (SHELLS.has(name)) return shellIndirect(name, words, redirects, withEnv(st, env), run);
  if (cmd === 'eval') {
    shellLine(args.join(' '), st, { ...run, depth: run.depth + 1 });
    return;
  }
  if (cmd === 'source' || cmd === '.') {
    const at = words[1] ? pathOf(words[1], st, ctx) : null;
    for (const [k, v] of env) st.vars.set(k, v);
    const text = at && !at.partial ? scriptText(run, at.path) : null;
    if (text === null) add(run, { kind: 'other', target: `${cmd} ${shown(args[0] ?? '')}`, why: 'içeriği okunamayan bir betiği yürütür' });
    else shellLine(text, st, { ...run, depth: run.depth + 1 });
    return;
  }
  if (INTERPRETERS.has(name)) return interpreter(name, words, redirects, st, run);

  if (name === 'git') return git(words, env, st, run);
  if (name === 'gh') return gh(args, run);
  if (name === 'curl') return void httpParts('curl', curlRequests(args), ctx).forEach((p) => add(run, p));
  if (name === 'wget') return void httpParts('wget', wgetRequests(args), ctx).forEach((p) => add(run, p));
  if (['http', 'https', 'xh', 'xhs'].includes(name)) return void httpParts(name, httpieRequests(args), ctx).forEach((p) => add(run, p));
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(name)) return packages(name, words, env, st, run);
  if (name === 'npx' || name === 'bunx') {
    let i = 1;
    while (i < t.length && flag(t[i]!)) i += t[i] === '-p' || t[i] === '--package' ? 2 : 1;
    if (i < words.length) simple(words.slice(i), env, [], st, run);
    return;
  }
  if (PAY_CLIS.has(name)) return add(run, { kind: 'pay', target: `${name} ${args.find((a) => !flag(a)) ?? ''}`.trim(), why: KIND_WHY.pay });
  if (DEPLOY_CLIS.has(name)) {
    const positional = args.filter((a) => !flag(a));
    const verb = positional.find((a) => ['deploy', 'publish', 'release', 'promote'].includes(a));
    if (verb) return add(run, { kind: 'publish', target: `${name} ${verb}`, why: KIND_WHY.publish });
    if (name === 'vercel' && (positional.length === 0 || args.includes('--prod'))) return add(run, { kind: 'publish', target: 'vercel', why: KIND_WHY.publish });
    if (name === 'aws' && positional[0] === 's3' && ['cp', 'sync', 'mv', 'rm'].includes(positional[1] ?? '')) {
      return add(run, { kind: positional[1] === 'rm' ? 'delete' : 'publish', target: `aws s3 ${positional[1]}`, why: positional[1] === 'rm' ? KIND_WHY.delete : KIND_WHY.publish });
    }
    return;
  }
  if ((name === 'docker' && args[0] === 'push') || (name === 'twine' && args[0] === 'upload') || (name === 'cargo' && args[0] === 'publish') || (name === 'gem' && args[0] === 'push')) {
    return add(run, { kind: 'publish', target: `${name} ${args[0]}`, why: KIND_WHY.publish });
  }
  if (MAIL_CLIS.has(name)) return add(run, { kind: 'send', target: `${name} ${args.filter((a) => !flag(a)).pop() ?? ''}`.trim(), why: KIND_WHY.send });
  if (name === 'ssh' || name === 'scp' || name === 'sftp' || name === 'rsync') {
    const positional = args.filter((a) => !flag(a));
    const remote = name === 'ssh' ? positional[0] : positional.find((a) => /^[^/][^/]*:/.test(a) && !a.startsWith('./'));
    if (remote) return add(run, { kind: 'send', target: `${name} ${remote.split(':')[0]}`, why: 'başka bir makineye bağlanır ya da dosya gönderir' });
    if (name === 'rsync' && positional.length >= 2) writeTarget(run, 'rsync', words[1 + args.lastIndexOf(positional[positional.length - 1]!)]!, st);
    return;
  }
  if (name === 'sqlite3') return sqlite(words, st, run);
  if (name === 'find') return find(words, env, st, run);
  fileWrites(name, words, env, st, run);
}

/** A script's text: written earlier in the same line from a here-document, else as it stands on the disk. */
function scriptText(run: Run, path: string): string | null {
  return run.written.get(path) ?? run.ctx.readScript(path);
}

function shellIndirect(name: string, words: ShellWord[], redirects: Array<{ op: string; target: ShellWord | null; body?: string }>, st: ShellState, run: Run): void {
  const { ctx } = run;
  const t = texts(words, st, ctx);
  const deeper = { ...run, depth: run.depth + 1 };
  let i = 1;
  let inline = false;
  for (; i < t.length && flag(t[i]!); i += 1) {
    if (t[i] === '-o' || t[i] === '+o') i += 1;
    else if (!t[i]!.startsWith('--') && t[i]!.includes('c')) inline = true;
  }
  if (inline) {
    // Parts known only at run time stay unknown words in it; an unknown command name is held where it stands.
    shellLine(t[i] ?? '', copyState(st), deeper);
    return;
  }
  if (i < words.length) {
    const at = pathOf(words[i]!, st, ctx);
    const text = at && !at.partial ? scriptText(run, at.path) : null;
    if (text === null) add(run, { kind: 'other', target: `${name} ${shown(t[i]!)}`, why: 'içeriği okunamayan bir betiği yürütür' });
    else {
      // The script sees its arguments as $1, $2 …
      const inner = copyState(st);
      t.slice(i + 1, i + 10).forEach((arg, k) => inner.vars.set(String(k + 1), arg));
      shellLine(text, inner, deeper);
    }
    return;
  }
  // No script and no -c: the commands come on stdin.
  const here = redirects.find((r) => r.op === '<<' && r.body !== undefined) ?? redirects.find((r) => r.op === '<<<' && r.target);
  if (here) return shellLine(here.body ?? textOf(here.target!, st, ctx), copyState(st), deeper);
  const from = redirects.find((r) => r.op === '<' && r.target);
  const at = from ? pathOf(from.target!, st, ctx) : null;
  const text = at && !at.partial ? scriptText(run, at.path) : null;
  if (text !== null) return shellLine(text, copyState(st), deeper);
  add(run, { kind: 'other', target: `${name} (stdin)`, why: 'girdisinden gelen, okunamayan komutları yürütür' });
}

/**
 * Code that opens a database, in the interpreter's own language (a mention of office.db elsewhere — a string an edit
 * script writes into a test — is only text).
 */
const DB_ACCESS: Record<string, RegExp> = {
  python: /^\s*(import|from)\s+sqlite3\b|sqlite3\.connect\(/m,
  node: /node:sqlite|DatabaseSync\(|better-sqlite3|openDb\(|\/db\.ts['"]/,
  other: /sqlite|DBI->connect|\.connect\(/i,
};
const dbAccess = (name: string, code: string) => (DB_ACCESS[name.startsWith('python') ? 'python' : ['node', 'deno', 'bun', 'tsx', 'ts-node'].includes(name) ? 'node' : 'other']!).test(code);
/** Code that starts commands: only then do its string literals run as commands. */
const SPAWNS = /subprocess|os\.system|os\.popen|Popen|child_process|exec(File)?Sync|spawn(Sync)?\(|\bsystem\(/;
/** Code that talks HTTP. */
const HTTP = /import\s+(requests|httpx|urllib|http\.client)|from\s+(requests|httpx|urllib|http\.client)|\bfetch\(|https?\.request\(|axios/;

/**
 * node, python …: the live database without a read-only mark (in the line, the -c/-e code, a here-document, or the
 * script it runs — written in the same line or read from the disk); code that sends over HTTP; code that starts commands.
 */
function interpreter(name: string, words: ShellWord[], redirects: Array<{ op: string; target: ShellWord | null; body?: string }>, st: ShellState, run: Run): void {
  const { ctx } = run;
  const t = texts(words, st, ctx);
  const codes: string[] = [];
  let script: string | null = null;
  const valued = new Set(['-r', '--require', '--import', '--input-type', '-m', '-W', '-X', '--loader', '--experimental-loader']);
  for (let i = 1; i < t.length; i += 1) {
    if (['-c', '-e', '--eval', '-p', '--print', '-E'].includes(t[i]!) || (name === 'perl' && /^-\w*e$/.test(t[i]!))) {
      codes.push(t[++i] ?? '');
      continue;
    }
    if (name === 'deno' && t[i] === 'eval') {
      codes.push(t[++i] ?? '');
      continue;
    }
    if (valued.has(t[i]!)) {
      i += 1;
      continue;
    }
    if (flag(t[i]!) || t[i] === '-') continue;
    if (name === 'deno' && t[i] === 'run') continue;
    // The first operand is the script; the rest are its arguments.
    if (codes.length === 0 && script === null) {
      const at = pathOf(words[i]!, st, ctx);
      script = at && !at.partial ? scriptText(run, at.path) : null;
    }
    break;
  }
  for (const r of redirects) {
    if (r.op === '<<' && r.body !== undefined) codes.push(r.body);
    if (r.op === '<<<' && r.target) codes.push(textOf(r.target, st, ctx));
  }
  // perl -i edits files in place, like sed -i.
  if (name === 'perl' && t.slice(1).some((a) => /^-\w*i/.test(a))) {
    const files = words.slice(1).filter((_, k) => !flag(t[k + 1]!) && !codes.includes(t[k + 1]!));
    for (const f of files) writeTarget(run, 'perl -i', f, st);
  }
  const live = `${ctx.dataDir}/office.db`;
  const mentions = (text: string) => [...text.matchAll(/[^\s'"`(),;]*office\.db[^\s'"`(),;]*/g)].map((m) => m[0]);
  const isLive = (m: string) => {
    if (m.startsWith('/') || m.startsWith('~')) return posix.resolve(m.replace(/^~/, ctx.home)).startsWith(live);
    // A bare name or a joined path: it may well be the live one.
    return !m.startsWith('./') || (st.cwd !== null && posix.resolve(st.cwd, m).startsWith(live));
  };
  const named = [
    ...mentions(t.slice(1).filter((a) => !codes.includes(a)).join(' ')),
    ...codes.filter((c) => dbAccess(name, c)).flatMap(mentions),
    ...(script !== null && dbAccess(name, script) ? mentions(script) : []),
  ];
  const text = [t.join(' '), ...codes, script ?? ''].join('\n');
  if (named.some(isLive) && !RO_MARK.test(text)) add(run, { kind: 'self', target: `${name} ${live}`, why: 'canlı veritabanına salt-okunur işareti olmadan erişir' });
  for (const code of [...codes, ...(script !== null ? [script] : [])]) {
    if (HTTP.test(code) && /\b(requests|httpx)\.(post|put|patch|delete)\(|\bmethod\s*[:=]\s*['"](POST|PUT|PATCH|DELETE)['"]|urlopen\([^)]*data\s*=/i.test(code)) {
      const url = /https?:\/\/[^\s'"`]+/.exec(code)?.[0];
      const held = url ? httpParts(name, [{ method: 'POST', url }], ctx) : [{ kind: 'send' as const, target: `${name} ?`, why: KIND_WHY.send }];
      for (const p of held) add(run, p);
    }
    if (!SPAWNS.test(code)) continue;
    for (const m of code.matchAll(/(['"`])((?:git|gh|curl|wget|npm|pnpm|yarn|rm|stripe|vercel|netlify|scp|ssh|sqlite3|bash|sh)\s[^'"`]*)\1/g)) {
      shellLine(m[2]!, copyState(st), { ...run, depth: run.depth + 1 });
    }
  }
}

function git(words: ShellWord[], env: Map<string, string | null>, st: ShellState, run: Run): void {
  const { ctx } = run;
  const t = texts(words, st, ctx);
  let repo: string | null | undefined = st.cwd;
  let workTree: string | null | undefined;
  let gitDir: string | null | undefined;
  const asPath = (w: ShellWord | undefined, base: string | null): string | null => {
    if (!w) return null;
    const at = pathOf(w, { ...st, cwd: base }, ctx);
    return at && !at.partial ? at.path : null;
  };
  let i = 1;
  for (; i < t.length && flag(t[i]!); i += 1) {
    const a = t[i]!;
    if (a === '-C') repo = asPath(words[++i], repo ?? null);
    else if (a === '-c' || a === '--namespace' || a === '--exec-path') i += 1;
    else if (a === '--git-dir') gitDir = asPath(words[++i], st.cwd);
    else if (a === '--work-tree') workTree = asPath(words[++i], st.cwd);
    else if (a.startsWith('--git-dir=')) gitDir = asPath({ parts: [{ lit: a.slice(10) }], tilde: false, quoted: false }, st.cwd);
    else if (a.startsWith('--work-tree=')) workTree = asPath({ parts: [{ lit: a.slice(12) }], tilde: false, quoted: false }, st.cwd);
  }
  const fromEnv = (key: string) => (env.has(key) ? env.get(key)! : st.vars.has(key) ? st.vars.get(key)! : undefined);
  const envWorkTree = fromEnv('GIT_WORK_TREE');
  const envGitDir = fromEnv('GIT_DIR');
  const envPath = (v: string | null) => (v === null || v.includes(DYN) ? null : posix.resolve(st.cwd ?? '/', v.replace(/^~/, ctx.home)));
  if (workTree === undefined && envWorkTree !== undefined) workTree = envPath(envWorkTree);
  if (gitDir === undefined && envGitDir !== undefined) gitDir = envPath(envGitDir);
  const UNKNOWN = '\u0000unknown';
  let top: string | null;
  if (workTree !== undefined) top = workTree === null ? UNKNOWN : under(workTree, ctx.repoRoot) ? ctx.repoRoot : ctx.toplevel(workTree);
  else if (gitDir !== undefined) top = gitDir === null ? UNKNOWN : gitDir === `${ctx.repoRoot}/.git` ? ctx.repoRoot : under(gitDir, `${ctx.repoRoot}/.git/worktrees`) ? null : ctx.toplevel(gitDir);
  else top = repo === null || repo === undefined ? UNKNOWN : ctx.toplevel(repo);
  const sub = t[i] ?? '';
  const rest = words.slice(i + 1);
  const restT = t.slice(i + 1);

  if (sub === 'push') {
    const force = restT.some((a) => /^(-f|--force(-with-lease.*)?|--force-if-includes|-d|--delete|--mirror|--prune)$/.test(a) || /^-[a-z]*f[a-z]*$/.test(a) || /^[+:]/.test(a));
    let remote = '';
    for (let k = 0; k < restT.length; k += 1) {
      if (['-o', '--push-option', '--repo', '--receive-pack', '--exec'].includes(restT[k]!)) k += 1;
      else if (!flag(restT[k]!)) {
        remote = shown(restT[k]!);
        break;
      }
    }
    const target = `git push${remote ? ` ${remote}` : ''}`;
    add(run, force ? { kind: 'delete', target, why: 'uzaktaki dalı zorla yeniden yazar ya da siler' } : { kind: 'publish', target, why: KIND_WHY.publish });
    return;
  }
  if (sub === 'worktree') {
    const action = restT[0] ?? '';
    const positional = rest.slice(1).filter((_, k) => !flag(restT[k + 1]!));
    if (action === 'add') {
      const values = new Set(['-b', '-B', '--reason']);
      const pathWord = rest.slice(1).find((_, k) => !flag(restT[k + 1]!) && !values.has(restT[k] ?? ''));
      const at = pathWord ? pathOf(pathWord, st, ctx) : null;
      const why = at ? protectedWhy(at.path, ctx, true) : null;
      if (why) add(run, { kind: 'self', target: `git worktree add ${at!.path}`, why: `korunan yola yazar: ${why}` });
      return;
    }
    if (action === 'remove') {
      // git removes only a registered worktree: an unknown target passes (round 3 (c)).
      const at = positional[0] ? pathOf(positional[0], st, ctx) : null;
      if (!at || at.partial) return;
      const why = protectedWhy(at.path, ctx, true);
      if (why) return add(run, { kind: 'self', target: `git worktree remove ${at.path}`, why: `korunan yolu siler: ${why}` });
      const force = restT.some((a) => a === '--force' || a === '-f');
      if (force && worktreeOf(at.path, ctx) === 'dirty') add(run, { kind: 'delete', target: `git worktree remove ${at.path}`, why: 'commit edilmemiş işi olan bir worktree’yi zorla siler' });
      return;
    }
    if (action === 'move') {
      const at = positional[1] ? pathOf(positional[1], st, ctx) : null;
      const why = !at || at.partial ? 'yeni yeri çalışınca belli olur' : protectedWhy(at.path, ctx, true);
      if (why) add(run, { kind: 'self', target: `git worktree move ${at && !at.partial ? at.path : '?'}`, why: `korunan yola taşır: ${why}` });
    }
    return;
  }
  if (GIT_REWRITE.has(sub) && !(sub === 'stash' && ['list', 'show'].includes(restT[0] ?? ''))) {
    if (top === ctx.repoRoot) add(run, { kind: 'self', target: `git ${sub} ${ctx.repoRoot}`, why: 'canlı checkout’un çalışma ağacını ya da dalını yeniden yazar' });
    else if (top === UNKNOWN) add(run, { kind: 'self', target: `git ${sub} (dizin belirsiz)`, why: 'hangi depoda çalışacağı belli değil (temkinli: kapıda)' });
  }
}

function gh(args: string[], run: Run): void {
  const positional: string[] = [];
  let method: string | null = null;
  let fields = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === '-R' || a === '--repo') i += 1;
    else if (a === '-X' || a === '--method') method = args[++i] ?? null;
    else if (a.startsWith('--method=')) method = a.slice(9);
    else if (['-f', '-F', '--field', '--raw-field', '--input'].includes(a)) {
      fields = true;
      i += 1;
    } else if (!flag(a)) positional.push(a);
  }
  const [group = '', action = ''] = positional;
  const writes: Record<string, string[]> = {
    pr: ['create', 'merge', 'close', 'ready', 'reopen', 'comment', 'review', 'edit'],
    issue: ['create', 'close', 'comment', 'edit', 'delete', 'reopen', 'transfer', 'lock', 'unlock', 'pin', 'unpin'],
    repo: ['create', 'delete', 'edit', 'fork', 'rename', 'archive', 'unarchive', 'sync', 'deploy-key'],
    gist: ['create', 'edit', 'delete'],
    secret: ['set', 'delete'],
    variable: ['set', 'delete'],
    workflow: ['run', 'enable', 'disable'],
    run: ['rerun', 'cancel', 'delete'],
  };
  const held =
    group === 'release' ? !['list', 'view', 'download'].includes(action) : group === 'api' ? (method !== null && method.toUpperCase() !== 'GET') || fields : (writes[group] ?? []).includes(action);
  if (!held) return;
  const deletes = action === 'delete' || (group === 'api' && method?.toUpperCase() === 'DELETE');
  add(run, { kind: 'publish', target: `gh ${group}${group === 'api' ? ` ${(method ?? 'POST').toUpperCase()}` : ` ${action}`}`, why: deletes ? 'GitHub’da siler' : 'GitHub’da yayımlar ya da değiştirir' });
}

function packages(pm: string, words: ShellWord[], env: Map<string, string | null>, st: ShellState, run: Run): void {
  const { ctx } = run;
  const t = texts(words, st, ctx);
  let dir: string | null = st.cwd;
  let i = 1;
  for (; i < t.length && flag(t[i]!); i += 1) {
    const a = t[i]!;
    const valued = ['--filter', '-F', '--workspace', '--cwd', '--prefix', '--dir', '-C'].includes(a) || (pm === 'npm' && a === '-w');
    if (['-C', '--dir', '--prefix', '--cwd'].includes(a)) {
      const at = pathOf(words[i + 1]!, st, ctx);
      dir = at && !at.partial ? at.path : null;
    }
    if (a.startsWith('--dir=') || a.startsWith('--prefix=') || a.startsWith('--cwd=')) dir = posix.resolve(st.cwd ?? '/', a.slice(a.indexOf('=') + 1).replace(/^~/, ctx.home));
    if (valued) i += 1;
  }
  const sub = t[i] ?? (pm === 'yarn' ? 'install' : '');
  if (sub === 'publish') return add(run, { kind: 'publish', target: `${pm} publish`, why: KIND_WHY.publish });
  if (sub === 'exec' || sub === 'dlx' || sub === 'x') {
    let k = i + 1;
    while (k < t.length && flag(t[k]!)) k += t[k] === '--package' || t[k] === '-p' ? 2 : 1;
    if (k < words.length) simple(words.slice(k), env, [], st, run);
    return;
  }
  const script = sub === 'run' || sub === 'run-script' ? (t[i + 1] ?? '') : sub;
  // An office opened from any checkout uses the live data folder unless told another (and migrates it).
  if (script === 'office' && !env.has('OFFICE_DATA_DIR') && !st.vars.has('OFFICE_DATA_DIR')) {
    return add(run, { kind: 'self', target: `${pm} office`, why: 'canlı veri diziniyle bir ofis açar (OFFICE_DATA_DIR verilmemiş)' });
  }
  if (PACKAGE_WRITES.has(sub)) {
    const top = dir === null ? null : ctx.toplevel(dir);
    if (dir === null || top === ctx.repoRoot) add(run, { kind: 'self', target: `${pm} ${sub} ${dir === null ? '(dizin belirsiz)' : ctx.repoRoot}`, why: 'canlı checkout’un paketlerini ya da derleme çıktısını değiştirir' });
  }
}

function sqlite(words: ShellWord[], st: ShellState, run: Run): void {
  const { ctx } = run;
  const t = texts(words, st, ctx);
  const valued = new Set(['-cmd', '-init', '-separator', '-newline', '-nullvalue', '-vfs', '-maxsize', '-mmap', '-pagecache', '-lookaside', '-heap']);
  let readonly = false;
  let db: ShellWord | null = null;
  let dbText = '';
  for (let i = 1; i < t.length; i += 1) {
    if (t[i] === '-readonly' || t[i] === '--readonly') readonly = true;
    else if (valued.has(t[i]!)) i += 1;
    else if (!flag(t[i]!)) {
      db = words[i]!;
      dbText = t[i]!;
      break;
    }
  }
  if (!db || readonly || /mode=ro|immutable=1/.test(dbText)) return;
  const at = pathOf(db, st, ctx);
  const live = `${ctx.dataDir}/office.db`;
  if (at ? at.path.startsWith(live) || (at.partial && under(live, at.path)) : /office\.db/.test(dbText)) {
    add(run, { kind: 'self', target: `sqlite3 ${at && !at.partial ? at.path : shown(dbText)}`, why: 'canlı veritabanını salt-okunur olmadan açar' });
    return;
  }
  if (at && !at.partial && protectedWhy(at.path, ctx)) add(run, { kind: 'self', target: `sqlite3 ${at.path}`, why: `korunan yolu yazabilir: ${protectedWhy(at.path, ctx)}` });
}

function find(words: ShellWord[], env: Map<string, string | null>, st: ShellState, run: Run): void {
  const { ctx } = run;
  const t = texts(words, st, ctx);
  const roots: ShellWord[] = [];
  let i = 1;
  for (; i < t.length && !t[i]!.startsWith('-') && t[i] !== '(' && t[i] !== '!'; i += 1) roots.push(words[i]!);
  const starts = roots.length ? roots : [{ parts: [{ lit: '.' }], tilde: false, quoted: false } as ShellWord];
  const each = (root: ShellWord): ShellWord => ({ parts: [...root.parts, { lit: '/' }, { dyn: true }], tilde: root.tilde, quoted: root.quoted });
  for (let k = i; k < t.length; k += 1) {
    if (t[k] === '-delete') for (const r of starts) deleteTarget(run, 'find -delete', each(r), st);
    if (['-exec', '-execdir', '-ok', '-okdir'].includes(t[k]!)) {
      let end = k + 1;
      while (end < t.length && t[end] !== ';' && t[end] !== '+') end += 1;
      for (const r of starts) {
        const inner = words.slice(k + 1, end).map((w, n) => (t[k + 1 + n] === '{}' ? each(r) : w));
        if (inner.length) simple(inner, new Map(env), [], copyState(st), run);
      }
      k = end;
    }
  }
}

/** Plain commands that write or remove files (§3.1 (a)): their targets against the protected paths and the free area. */
function fileWrites(name: string, words: ShellWord[], env: Map<string, string | null>, st: ShellState, run: Run): void {
  const { ctx } = run;
  const t = texts(words, st, ctx);
  const operands = (valued: Set<string> = new Set()) => {
    const out: ShellWord[] = [];
    let options = true;
    for (let i = 1; i < t.length; i += 1) {
      if (options && t[i] === '--') {
        options = false;
        continue;
      }
      if (options && flag(t[i]!)) {
        if (valued.has(t[i]!)) i += 1;
        continue;
      }
      out.push(words[i]!);
    }
    return out;
  };
  const targetDir = (opt: string[]) => {
    for (let i = 1; i < t.length; i += 1) {
      if (opt.includes(t[i]!)) return words[i + 1] ?? null;
      for (const o of opt) if (o.startsWith('--') && t[i]!.startsWith(`${o}=`)) return { parts: [{ lit: t[i]!.slice(o.length + 1) }], tilde: false, quoted: false } as ShellWord;
    }
    return null;
  };
  switch (name) {
    case 'rm':
    case 'unlink':
    case 'rmdir':
    case 'shred': {
      const recursive = name === 'rm' && t.slice(1).some((a) => /^-[a-zA-Z]*[rR]/.test(a) || a === '--recursive');
      for (const w of operands()) (recursive ? deleteTarget : writeTarget)(run, name === 'rm' ? 'rm' : name, w, st);
      return;
    }
    case 'tee':
    case 'touch':
      for (const w of operands()) writeTarget(run, name, w, st);
      return;
    case 'mkdir':
      for (const w of operands(new Set(['-m', '--mode']))) writeTarget(run, name, w, st);
      return;
    case 'truncate':
      for (const w of operands(new Set(['-s', '--size', '-r', '--reference']))) writeTarget(run, name, w, st);
      return;
    case 'chmod':
    case 'chown':
    case 'chgrp': {
      const ops = operands();
      const recursive = t.slice(1).some((a) => /^-[a-zA-Z]*R/.test(a) || a === '--recursive');
      const files = t.slice(1).some((a) => a.startsWith('--reference')) ? ops : ops.slice(1);
      for (const w of files) writeTarget(run, name, w, st, recursive);
      return;
    }
    case 'sed': {
      if (!t.slice(1).some((a) => (/^-[a-zA-Z]*i/.test(a) && !a.startsWith('--')) || a.startsWith('--in-place'))) return;
      const scripted = t.slice(1).some((a) => ['-e', '--expression', '-f', '--file'].includes(a) || a.startsWith('--expression=') || a.startsWith('--file='));
      const ops = operands(new Set(['-e', '--expression', '-f', '--file', '-l', '--line-length']));
      for (const w of scripted ? ops : ops.slice(1)) writeTarget(run, 'sed -i', w, st);
      return;
    }
    case 'cp':
    case 'install':
    case 'ln':
    case 'mv': {
      const dir = targetDir(['-t', '--target-directory']);
      const ops = operands(new Set(['-t', '--target-directory', '-S', '--suffix', '-m', '--mode', '-o', '--owner', '-g', '--group']));
      const dest = dir ?? (ops.length >= 2 ? ops[ops.length - 1]! : null);
      if (dest) writeTarget(run, name, dest, st, name === 'mv');
      // A move takes its sources away from where they were.
      if (name === 'mv') for (const w of dir ? ops : ops.slice(0, -1)) writeTarget(run, 'mv', w, st, true);
      return;
    }
    case 'dd':
      for (const a of t.slice(1)) if (a.startsWith('of=')) writeTarget(run, 'dd', { parts: [{ lit: a.slice(3) }], tilde: false, quoted: false }, st);
      return;
    case 'patch': {
      const dir = targetDir(['-d', '--directory']);
      const out = targetDir(['-o', '--output']);
      const ops = operands(new Set(['-d', '--directory', '-o', '--output', '-p', '-i', '--input', '-r', '--reject-file', '-B', '-V', '-z', '-F', '-D']));
      const target = out ?? ops[0] ?? dir;
      if (target) writeTarget(run, 'patch', target, dir && target !== dir ? { ...st, cwd: pathOf(dir, st, ctx)?.path ?? null } : st);
      else if (st.cwd === null) add(run, { kind: 'self', target: 'patch (dizin belirsiz)', why: 'nereye yazacağı belli değil' });
      else {
        const why = protectedWhy(st.cwd, ctx, true);
        if (why) add(run, { kind: 'self', target: `patch ${st.cwd}`, why: `korunan yola yazar: ${why}` });
      }
      return;
    }
    case 'tar': {
      const extract = t.slice(1).some((a) => a === '--extract' || a === '--get' || /^-?[a-zA-Z]*x/.test(a));
      if (!extract) return;
      const dir = targetDir(['-C', '--directory']);
      if (dir) writeTarget(run, 'tar -x', dir, st, true);
      else if (st.cwd === null || protectedWhy(st.cwd, ctx, true)) add(run, { kind: 'self', target: `tar -x ${st.cwd ?? '?'}`, why: 'korunan yola açar' });
      return;
    }
    case 'unzip': {
      const dir = targetDir(['-d']);
      if (dir) writeTarget(run, 'unzip', dir, st, true);
      else if (st.cwd === null || protectedWhy(st.cwd, ctx, true)) add(run, { kind: 'self', target: `unzip ${st.cwd ?? '?'}`, why: 'korunan yola açar' });
      return;
    }
    default:
      // A script run by its path is the shell running it.
      if (words[0] && /\.(sh|bash)$/.test(t[0]!) && t[0]!.includes('/')) shellIndirect('bash', [{ parts: [{ lit: 'bash' }], tilde: false, quoted: false }, ...words], [], withEnv(st, env), run);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The browser to the office (review round 1, Kerem, important): the office page in the employee's browser would take
// the owner's approvals (the owner guard trusts the page's origin and nonce), so every browser call that reaches it is
// the office itself — held per call, never on a browser or task approval.

const URL_LIKE = /(?:[a-z][a-z0-9+.-]*:\/\/)?(?:\[[0-9a-f:.]+\]|[\w-]+(?:\.[\w-]+)*)(?::\d+)?(?:[/?#][^\s'"`<>)\\]*)?/gi;
const OFFICE_PATH = /(['"`])(\/(?:api|gate|mcp)\b[^'"`]*)\1/;
const CODE_FIELDS = new Set(['code', 'function', 'script', 'expression']);

function strings(input: unknown, key = ''): Array<[string, string]> {
  if (typeof input === 'string') return [[key, input]];
  if (Array.isArray(input)) return input.flatMap((v) => strings(v, key));
  if (input && typeof input === 'object') return Object.entries(input as Record<string, unknown>).flatMap(([k, v]) => strings(v, k));
  return [];
}

/** Where a browser call reaches the office (its path), or null. */
function browserOffice(short: string, input: unknown, ctx: GateContext): string | null {
  const code = ['browser_run_code_unsafe', 'browser_evaluate', 'browser_network_request'].includes(short);
  for (const [key, value] of strings(input)) {
    for (const m of value.matchAll(URL_LIKE)) {
      const url = urlOf(m[0]);
      if (url && isOffice(url.hostname.toLowerCase(), portOf(url), ctx)) return url.pathname;
    }
    // In code, a path of the office's own is completed by the page's origin — the office's, once the page is there.
    const path = (code || CODE_FIELDS.has(key)) && OFFICE_PATH.exec(value);
    if (path) return path[2]!.split(/[?#]/)[0]!;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Tool calls.

/** The first field that names whom or what the call is about, its first 80 characters (§4 madde 4). */
const TARGET_FIELDS = ['to', 'recipient', 'recipients', 'email', 'channel', 'account', 'post_id', 'postId', 'id', 'url', 'path', 'name', 'title', 'subject', 'content', 'text', 'body', 'message', 'prompt', 'query'];
function mcpTarget(short: string, input: unknown): string {
  const o = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const value = (v: unknown) => (typeof v === 'string' ? v : Array.isArray(v) && v.every((x) => typeof x === 'string') ? v.join(',') : typeof v === 'number' ? String(v) : null);
  const key = TARGET_FIELDS.find((k) => value(o[k]) !== null) ?? Object.keys(o).find((k) => value(o[k]) !== null);
  if (!key) return short;
  const v = value(o[key])!.replace(/\s+/g, ' ').trim().slice(0, 80);
  return v ? `${short} ${key}=${v}` : short;
}

function done(parts: GatePart[]): GateVerdict {
  return { gated: parts.length > 0, parts, scope: parts.length > 0 && parts.every((p) => p.kind === 'browser') ? 'task' : 'call' };
}

/** What the gate makes of one tool call, as the PreToolUse hook gives it (tool_name, tool_input, cwd). */
export function classifyCall(tool: string, input: unknown, cwd: string | undefined, ctx: GateContext): GateVerdict {
  const o = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const start = typeof cwd === 'string' && cwd.startsWith('/') ? posix.resolve(cwd) : ctx.deskDir;
  if (tool === 'Bash' || tool === 'Monitor') {
    const run: Run = { ctx, parts: [], depth: 0, written: new Map() };
    shellLine(typeof o.command === 'string' ? o.command : '', { cwd: start, vars: new Map(), dirs: [] }, run);
    return done(run.parts);
  }
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    const raw = [o.file_path, o.notebook_path, o.path].find((v) => typeof v === 'string') as string | undefined;
    if (!raw) return done([]);
    const path = posix.resolve(start, raw.replace(/^~(?=\/|$)/, ctx.home));
    const why = protectedWhy(path, ctx);
    return done(why ? [{ kind: 'self', target: `${tool} ${path}`, why: `korunan yola yazar: ${why}` }] : []);
  }
  if (tool === 'WebFetch') return done(typeof o.url === 'string' ? httpParts('WebFetch', [{ method: 'GET', url: o.url }], ctx) : []);
  if (!tool.startsWith('mcp__')) return done([]);
  const cut = tool.indexOf('__', 5);
  const server = cut === -1 ? tool.slice(5) : tool.slice(5, cut);
  const short = cut === -1 ? tool : tool.slice(cut + 2);
  if (server === 'office') return done([]);
  if (server.includes('playwright') && short.startsWith('browser_')) {
    const office = browserOffice(short, input, ctx);
    if (office !== null) return done([{ kind: 'self', target: `${short} ${office}`, why: 'tarayıcıyla ofisin kendi sayfasına ya da API’sine gider (sahibi onayı yalnız sahibinin sayfasından sayılır)' }]);
    return done(BROWSER_READ.has(short) ? [] : [{ kind: 'browser', target: short, why: KIND_WHY.browser }]);
  }
  const c = toolClass(tool);
  if (c.kind === 'office' || c.kind === 'builtin') return done([]);
  if (c.kind === 'classified') {
    if (!c.outward) return done([]);
    const kind = KIND_BY_CAPABILITY[c.capability] ?? 'other';
    return done([{ kind, target: mcpTarget(short, input), why: `${KIND_WHY[kind]} (${c.capability})` }]);
  }
  return done([{ kind: 'other', target: mcpTarget(short, input), why: 'sınıflandırılmamış bağlayıcı aracı (ne yaptığı sözlükte yok)' }]);
}
