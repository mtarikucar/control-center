import { useEffect, useState } from 'react';
import type { EmployeeFile } from '@cc/shared';
import { api } from '../net/api.ts';
import { formatWhen } from './format.ts';

/** What the company knows about this employee: the coordinator's notes and their recent work (loaded when opened). */
export function EmployeeFileSection({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<EmployeeFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    api.employeeFile(id).then(
      (f) => alive && setFile(f),
      (err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      alive = false;
    };
  }, [open, id]);
  return (
    <section className="employee-file">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        Çalışan dosyası
      </button>
      {open &&
        (error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : !file ? (
          <p className="muted">Yükleniyor…</p>
        ) : (
          <div className="employee-file-body">
            <p>{file.finished} görev bitirdi.</p>
            {file.notes.length > 0 ? (
              <ul>
                {file.notes.map((n) => (
                  <li key={n.id}>
                    {n.text} <span className="muted">· {formatWhen(n.ts)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Koordinatörün bu çalışan hakkında notu yok.</p>
            )}
            {file.recent.length > 0 && (
              <ul>
                {file.recent.map((r) => (
                  <li key={r.id}>
                    <strong>{r.title}</strong>: {r.summary}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
    </section>
  );
}
