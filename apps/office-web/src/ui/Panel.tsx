import { useEffect, useRef, useState } from 'react';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';
import { EventItem } from './EventItem.tsx';
import { formatCost, formatTokens, tokensOf } from './format.ts';
import { canResume, canStop, lifecycleLabel } from './labels.ts';

export function Panel({ id }: { id: string }) {
  const view = useOffice((s) => s.views[id]);
  const usage = useOffice((s) => s.usage[id]);
  const command = useOffice((s) => s.terminalCommands[id]);
  const select = useOffice((s) => s.select);
  const loadEvents = useOffice((s) => s.loadEvents);
  const markTyping = useOffice((s) => s.markTyping);
  const setTerminalCommand = useOffice((s) => s.setTerminalCommand);
  const [text, setText] = useState('');
  const [side, setSide] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stream = useRef<HTMLDivElement>(null);
  /** Follow new events only while the owner is at (or near) the bottom of the stream. */
  const stickToBottom = useRef(true);
  const exists = view !== undefined;
  const loaded = view?.eventsLoaded ?? false;
  // The list is capped, so its length stops changing; the newest seq does not.
  const newestSeq = view?.events.at(-1)?.seq ?? 0;

  useEffect(() => {
    if (exists && !loaded) void loadEvents(id);
  }, [id, exists, loaded, loadEvents]);
  useEffect(() => {
    const el = stream.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [newestSeq]);

  if (!view) {
    return (
      <aside className="panel">
        <p className="muted">Çalışan yükleniyor…</p>
      </aside>
    );
  }
  const e = view.employee;

  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const submit = () => {
    const message = text.trim();
    if (!message || busy) return;
    void run(async () => {
      if (side) await api.sideQuestion(id, message);
      else await api.send(id, message);
      setText('');
    });
  };

  return (
    <aside className="panel" aria-label={`${e.name} paneli`}>
      <header className="panel-head">
        <div>
          <h2>{e.name}</h2>
          <span className={`badge ${e.lifecycle}`}>{lifecycleLabel(e.lifecycle)}</span>
          <span className="muted"> {e.model}</span>
        </div>
        <button type="button" className="icon" aria-label="Paneli kapat" onClick={() => select(null)}>
          ×
        </button>
      </header>
      <p className="role">{e.role}</p>
      <p className="usage">
        Bugün {formatTokens(tokensOf(usage?.today))} · {formatCost(usage?.today.costUsd ?? 0)} — toplam {formatTokens(tokensOf(usage?.total))} ·{' '}
        {formatCost(usage?.total.costUsd ?? 0)}
      </p>
      <div className="actions">
        {canStop(e.lifecycle) && (
          <button type="button" disabled={busy} onClick={() => void run(() => api.stop(id))}>
            Durdur
          </button>
        )}
        {canResume(e.lifecycle) && (
          <button type="button" disabled={busy} onClick={() => void run(() => api.resume(id))}>
            Devam
          </button>
        )}
        {e.lifecycle !== 'in_terminal' && e.sessionStarted && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const opened = await api.openTerminal(id);
                setTerminalCommand(id, opened.command);
              })
            }
          >
            Terminalde aç
          </button>
        )}
        {e.lifecycle === 'in_terminal' && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api.closeTerminal(id);
                setTerminalCommand(id, null);
              })
            }
          >
            Ofise geri al
          </button>
        )}
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`${e.name} işten çıkarılsın mı?`)) {
              void run(async () => {
                await api.fire(id);
                select(null);
              });
            }
          }}
        >
          İşten çıkar
        </button>
      </div>
      {command && (
        <div className="terminal">
          <code>{command}</code>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(command)}>
            Kopyala
          </button>
        </div>
      )}
      {e.lastError && <p className="error">{e.lastError}</p>}
      <div
        className="stream"
        ref={stream}
        onScroll={(ev) => {
          const el = ev.currentTarget;
          stickToBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
        }}
      >
        {view.events.map((stored) => (
          <EventItem key={stored.seq} stored={stored} />
        ))}
      </div>
      <form
        className="composer"
        onSubmit={(ev) => {
          ev.preventDefault();
          submit();
        }}
      >
        <textarea
          value={text}
          rows={3}
          disabled={e.lifecycle === 'in_terminal'}
          placeholder={side ? 'Yan soru: işini bölmeden cevaplar' : `${e.name}'a yaz…`}
          onChange={(ev) => {
            setText(ev.target.value);
            markTyping(id);
          }}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' && !ev.shiftKey) {
              ev.preventDefault();
              submit();
            }
          }}
        />
        <div className="row">
          <label className="switch">
            <input type="checkbox" checked={side} onChange={(ev) => setSide(ev.target.checked)} />
            Yan soru
          </label>
          <button type="submit" className="primary" disabled={busy || !text.trim()}>
            Gönder
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </aside>
  );
}
