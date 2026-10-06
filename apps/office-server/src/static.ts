import { accessSync, constants, createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
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

/** If-None-Match: `*`, or a list of tags compared weakly (a W/ prefix does not matter). */
function unchanged(header: string | string[] | undefined, etag: string): boolean {
  const value = Array.isArray(header) ? header.join(',') : header;
  if (!value) return false;
  if (value.trim() === '*') return true;
  const bare = (tag: string) => tag.trim().replace(/^W\//, '');
  return value.split(',').some((tag) => bare(tag) === bare(etag));
}

/**
 * Streams a readable regular file (headers only for HEAD); false when there is none to send (caller decides what
 * 404 looks like). An ETag lets the browser revalidate the ~100 MB of models instead of downloading them again.
 */
export function sendFile(req: IncomingMessage, res: ServerResponse, file: string): boolean {
  let size: number;
  let etag: string;
  let modified: string;
  try {
    const st = statSync(file);
    if (!st.isFile()) return false;
    accessSync(file, constants.R_OK);
    size = st.size;
    etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    modified = st.mtime.toUTCString();
  } catch {
    return false;
  }
  const headers = {
    'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-cache',
    etag,
    'last-modified': modified,
  };
  if (unchanged(req.headers['if-none-match'], etag)) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  res.writeHead(200, { ...headers, 'content-length': size });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  // pipeline closes the file when the client goes away and never lets a read error escape as an 'error' event.
  pipeline(createReadStream(file), res, () => {});
  return true;
}
