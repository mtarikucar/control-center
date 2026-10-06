import { accessSync, constants, createReadStream, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** The absolute file for `urlPath` under `root`, or null when it is malformed or would leave `root`. */
export function resolveInside(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const base = resolve(root);
  const full = resolve(base, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`);
  return full === base || full.startsWith(base + sep) ? full : null;
}

/** Streams a readable regular file; false when there is none to send (caller decides what 404 looks like). */
export function sendFile(res: ServerResponse, file: string): boolean {
  let size: number;
  try {
    const st = statSync(file);
    if (!st.isFile()) return false;
    accessSync(file, constants.R_OK);
    size = st.size;
  } catch {
    return false;
  }
  res.writeHead(200, {
    'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': size,
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-cache',
  });
  // pipeline closes the file when the client goes away and never lets a read error escape as an 'error' event.
  pipeline(createReadStream(file), res, () => {});
  return true;
}
