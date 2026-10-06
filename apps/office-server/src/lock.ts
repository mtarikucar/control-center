import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * One office per data directory: a second one would run a second claude process per session and rewrite the
 * first one's lifecycles during recovery. Returns the release function.
 */
export function acquireLock(dataDir: string): () => void {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, 'office.lock');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(file, String(process.pid), { flag: 'wx' });
      return () => {
        try {
          if (readFileSync(file, 'utf8') === String(process.pid)) unlinkSync(file);
        } catch {
          // Already gone.
        }
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const pid = Number(readFileSync(file, 'utf8').trim());
      if (Number.isInteger(pid) && pid > 0 && alive(pid)) {
        throw new Error(`Bu veri klasörünü başka bir office-server kullanıyor (pid ${pid}): ${dataDir}`);
      }
      unlinkSync(file);
    }
  }
  throw new Error(`Veri klasörü kilitlenemedi: ${dataDir}`);
}
