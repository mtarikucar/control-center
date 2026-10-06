import { useEffect, useState } from 'react';
import type { PlaybookEntry } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';
import { formatWhen } from './format.ts';

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Loads on mount and whenever `deps` change (the memory counter, a query). */
function useLoad<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    load().then(
      (value) => {
        if (!alive) return;
        setData(value);
        setError(null);
      },
      (err: unknown) => {
        if (alive) setError(message(err));
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error };
}

function useNameOf(): (id: string) => string {
  const views = useOffice((s) => s.views);
  return (id) => (id === 'owner' ? 'sahibi' : (views[id]?.employee.name ?? '—'));
}

export function DecisionsTab() {
  const rev = useOffice((s) => s.memoryRev);
  const plans = useOffice((s) => s.plans);
  const nameOf = useNameOf();
  const { data, error } = useLoad(() => api.decisions(), [rev]);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return <p className="muted">Yükleniyor…</p>;
  if (data.length === 0) return <p className="muted">Karar defteri boş. Koordinatör ve ekip liderleri önemli seçimleri buraya kaydeder.</p>;
  const reverted = new Set(data.map((d) => d.reverts).filter((x): x is string => x !== null));
  const revert = async (id: string) => {
    setBusy(id);
    setFailed(null);
    try {
      await api.revertDecision(id);
    } catch (err) {
      setFailed(message(err));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="memory-list">
      {failed && (
        <p className="error" role="alert">
          {failed}
        </p>
      )}
      {data.map((d) => (
        <article key={d.id} className={`memory-item${d.reverts ? ' revert' : ''}${reverted.has(d.id) ? ' reverted' : ''}`}>
          <header className="row">
            <strong>{d.title}</strong>
            <span className="muted">
              {nameOf(d.by)} · {formatWhen(d.ts)}
            </span>
          </header>
          {!d.reverts && (
            <>
              <p>
                <span className="muted">Seçilen:</span> {d.chosen}
              </p>
              <p>
                <span className="muted">Gerekçe:</span> {d.reason}
              </p>
              {d.alternatives.length > 0 && (
                <p>
                  <span className="muted">Alternatifler:</span> {d.alternatives.join(', ')}
                </p>
              )}
              {d.planId && plans[d.planId] && <p className="muted">Plan: {plans[d.planId]!.title}</p>}
            </>
          )}
          {reverted.has(d.id) ? (
            <span className="badge">Geri alındı</span>
          ) : (
            !d.reverts && (
              <div className="row end">
                <button type="button" disabled={busy === d.id} onClick={() => void revert(d.id)}>
                  Geri al
                </button>
              </div>
            )
          )}
        </article>
      ))}
    </div>
  );
}

function History({ topic }: { topic: string }) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<PlaybookEntry[] | null>(null);
  useEffect(() => {
    setOpen(false);
    setVersions(null);
  }, [topic]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void api.playbookHistory(topic).then((v) => alive && setVersions(v));
    return () => {
      alive = false;
    };
  }, [open, topic]);
  return (
    <div className="history">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        Önceki sürümler
      </button>
      {open &&
        (versions ? (
          versions.slice(1).map((v) => (
            <section key={v.version} className="history-version">
              <p className="muted">
                sürüm {v.version} · {formatWhen(v.ts)}
                {v.reason ? ` · ${v.reason}` : ''}
              </p>
              <div className="prose">{v.text}</div>
            </section>
          ))
        ) : (
          <p className="muted">Yükleniyor…</p>
        ))}
      {open && versions?.length === 1 && <p className="muted">Bu konunun tek sürümü var.</p>}
    </div>
  );
}

export function PlaybookTab() {
  const rev = useOffice((s) => s.memoryRev);
  const nameOf = useNameOf();
  const { data, error } = useLoad(() => api.playbook(), [rev]);
  const [topic, setTopic] = useState<string | null>(null);
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return <p className="muted">Yükleniyor…</p>;
  if (data.length === 0) return <p className="muted">El kitabı boş. Koordinatör ve ekip liderleri çalışma yöntemlerini buraya yazar.</p>;
  const current = data.find((p) => p.topic === topic) ?? data[0]!;
  return (
    <div className="playbook">
      <nav aria-label="Konular" className="playbook-topics">
        {data.map((p) => (
          <button key={p.topic} type="button" aria-pressed={p.topic === current.topic} onClick={() => setTopic(p.topic)}>
            {p.topic}
          </button>
        ))}
      </nav>
      <article className="playbook-text" aria-label={current.topic}>
        <h3>{current.topic}</h3>
        <p className="muted">
          sürüm {current.version} · {nameOf(current.by)} · {formatWhen(current.ts)}
          {current.reason ? ` · ${current.reason}` : ''}
        </p>
        <div className="prose">{current.text}</div>
        <History topic={current.topic} />
      </article>
    </div>
  );
}

export function NotesTab() {
  const rev = useOffice((s) => s.memoryRev);
  const nameOf = useNameOf();
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed.trim()), 250);
    return () => clearTimeout(timer);
  }, [typed]);
  const { data, error } = useLoad(() => api.notes(query), [rev, query]);
  return (
    <div className="notes">
      <input type="search" aria-label="Notlarda ara" placeholder="Notlarda ara…" value={typed} onChange={(e) => setTyped(e.target.value)} />
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : !data ? (
        <p className="muted">Yükleniyor…</p>
      ) : data.length === 0 ? (
        <p className="muted">{query ? 'Eşleşen not yok.' : 'Henüz not yok. Çalışanlar öğrendiklerini buraya yazar.'}</p>
      ) : (
        <div className="memory-list">
          {data.map(({ note, snippet }) => (
            <article key={note.id} className="memory-item">
              <header className="row">
                <strong>{note.title}</strong>
                <span className="muted">
                  {nameOf(note.by)} · {formatWhen(note.ts)}
                </span>
              </header>
              <p className="prose">{snippet || note.text}</p>
              {note.tags.length > 0 && (
                <p className="tags">
                  {note.tags.map((t) => (
                    <span key={t} className="badge">
                      {t}
                    </span>
                  ))}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
