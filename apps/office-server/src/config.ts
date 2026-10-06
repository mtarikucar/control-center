import { homedir } from 'node:os';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));

export interface OfficeConfig {
  dataDir: string;
  host: string;
  port: number;
  claudeCommand: string[];
  deskCount: number;
  /** Origins allowed besides the server's own http://127.0.0.1:<port> and http://localhost:<port>. */
  allowedOrigins: string[];
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
  const dataDir = resolve(env.OFFICE_DATA_DIR ?? join(homedir(), '.control-center'));
  if (insideRepo(dataDir)) {
    throw new Error(`OFFICE_DATA_DIR repo içinde olamaz (${dataDir}); çalışanlar reponun talimatlarını devralırdı.`);
  }
  const port = Number(env.OFFICE_PORT ?? '4319');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`OFFICE_PORT geçersiz: ${env.OFFICE_PORT}`);
  let claudeCommand = ['claude'];
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
  const webDir = env.OFFICE_WEB_DIR ?? join(REPO_ROOT, 'apps', 'office-web', 'dist');
  const assetsDir = env.OFFICE_ASSETS_DIR ?? join(REPO_ROOT, 'assets', '3d');
  return { dataDir, host: '127.0.0.1', port, claudeCommand, deskCount: 8, allowedOrigins, webDir, assetsDir };
}
