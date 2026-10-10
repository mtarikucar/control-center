import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));

export interface OfficeConfig {
  dataDir: string;
  host: string;
  port: number;
  claudeCommand: string[];
  provider: 'claude' | 'codex';
  codexCommand: string[];
  codexModel?: string;
  deskCount: number;
  /** Origins allowed besides the server's own http://127.0.0.1:<port> and http://localhost:<port>. */
  allowedOrigins: string[];
  /**
   * Host names allowed besides 127.0.0.1:<port> and localhost:<port>, e.g. the office's private Tailscale name
   * (OFFICE_ALLOWED_HOSTS); each also allows its https:// origin. Only for a private network: the office has no login.
   */
  allowedHosts: string[];
  /** Built office-web (served at /). */
  webDir: string;
  /** Models and manifest (served at /assets3d/). */
  assetsDir: string;
}

function insideRepo(dir: string): boolean {
  const rel = relative(REPO_ROOT, resolve(dir));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OfficeConfig {
  const provider = env.OFFICE_PROVIDER ?? 'claude';
  if (provider !== 'claude' && provider !== 'codex') throw new Error('OFFICE_PROVIDER claude ya da codex olmalı');
  // pnpm runs scripts in the package folder; a relative path means relative to where the owner typed the command.
  const dataDir = resolve(env.INIT_CWD ?? process.cwd(), env.OFFICE_DATA_DIR ?? join(homedir(), provider === 'codex' ? '.control-center-codex' : '.control-center'));
  if (insideRepo(dataDir)) {
    throw new Error(`OFFICE_DATA_DIR repo içinde olamaz (${dataDir}); çalışanlar reponun talimatlarını devralırdı.`);
  }
  const port = Number(env.OFFICE_PORT ?? '4319');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`OFFICE_PORT geçersiz: ${env.OFFICE_PORT}`);
  let claudeCommand = ['claude'];
  if (process.platform === 'win32' && env.OFFICE_CLAUDE_COMMAND === undefined) {
    // npm's .cmd/.ps1 shims cannot be spawned without a shell. Prefer the installed native binary (or old JS entry).
    for (const dir of (env.PATH ?? env.Path ?? '').split(';').filter(Boolean)) {
      const native = join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
      const js = join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
      if (existsSync(native)) { claudeCommand = [native]; break; }
      if (existsSync(js)) { claudeCommand = [process.execPath, js]; break; }
    }
  }
  let codexCommand = ['codex'];
  if (env.OFFICE_CODEX_COMMAND !== undefined) {
    let parsed: unknown;
    try { parsed = JSON.parse(env.OFFICE_CODEX_COMMAND); } catch { parsed = null; }
    if (!Array.isArray(parsed) || !parsed.length || !parsed.every((p) => typeof p === 'string' && p.length > 0)) throw new Error('OFFICE_CODEX_COMMAND boş olmayan bir JSON komut dizisi olmalı');
    codexCommand = parsed;
  }
  if (env.OFFICE_CLAUDE_COMMAND !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(env.OFFICE_CLAUDE_COMMAND);
    } catch {
      parsed = null;
    }
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((p) => typeof p === 'string')) {
      throw new Error('OFFICE_CLAUDE_COMMAND bir JSON dizi olmalı, örn. ["claude"]');
    }
    claudeCommand = parsed;
  }
  // No extra origins by default: a dev server on a shared port (e.g. Vite's 5173) could otherwise drive employees.
  const allowedOrigins = (env.OFFICE_ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  const allowedHosts = (env.OFFICE_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  const webDir = env.OFFICE_WEB_DIR ?? join(REPO_ROOT, 'apps', 'office-web', 'dist');
  const assetsDir = env.OFFICE_ASSETS_DIR ?? join(REPO_ROOT, 'assets', '3d');
  return { dataDir, host: '127.0.0.1', port, claudeCommand, provider, codexCommand, ...(env.OFFICE_CODEX_MODEL?.trim() ? { codexModel: env.OFFICE_CODEX_MODEL.trim() } : {}), deskCount: 8, allowedOrigins, allowedHosts, webDir, assetsDir };
}
