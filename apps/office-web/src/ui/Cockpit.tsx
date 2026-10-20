import { useEffect, useMemo, useState } from 'react';
import { INTEGRATION_STATUS_LABELS, kpiText, type Employee, type Integration, type StoredEvent, type Task } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';
import { ApprovalCard } from './ApprovalCard.tsx';
import { EventItem } from './EventItem.tsx';
import { PLAN_STATUS_LABELS, TASK_STATUS_LABELS, lifecycleLabel } from './labels.ts';
import { Panel } from './Panel.tsx';
import { PlanCard } from './PlanCard.tsx';
import { ProposalCard } from './ProposalCard.tsx';

/** How often the connections are read again: a session start changes them, and that is rare. */
const CONNECTIONS_POLL_MS = 60_000;
/** Connections shown open; the rest fold (an office sees dozens of connectors, most of them fine). */
const CONNECTIONS_OPEN = 8;
/** The feed keeps this many of the coordinator's events the owner cares about. */
const FEED_MAX = 25;
/** Open tasks shown before the “all tasks” link. */
const TASKS_MAX = 8;
/** Waiting items shown open; the rest fold under a summary so a backlog never pushes the feed off the page. */
const WAITING_OPEN = 4;

/** The feed shows what the coordinator told the owner and what changed in the work, not every tool call. */
const FEED_TYPES = new Set<StoredEvent['event']['type']>(['company.report', 'message.assistant', 'task.changed', 'goal.changed', 'plan.changed', 'error', 'clock.error']);
const OPEN_ORDER: Task['status'][] = ['blocked', 'in_progress', 'review', 'waiting', 'parked'];

const initial = (name: string) => name.trim().charAt(0).toLocaleUpperCase('tr') || '?';

function Team({ employees, tasks }: { employees: Employee[]; tasks: Task[] }) {
  const select = useOffice((s) => s.select);
  const setHireOpen = useOffice((s) => s.setHireOpen);
  // What a person is on: the task under way, else the one they are stuck on (the owner usually has to unstick it).
  const current = (id: string) => {
    const own = tasks.filter((t) => t.assignee === id).sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
    return own.find((t) => t.status === 'in_progress') ?? own.find((t) => t.status === 'blocked');
  };
  return (
    <section className="cockpit-block" aria-label="Ekip bölümü">
      <header className="cockpit-head">
        <h2>Ekip · {employees.length}</h2>
        <button type="button" className="primary small" onClick={() => setHireOpen(true)}>
          + Çalışan al
        </button>
      </header>
      <ul className="team" aria-label="Ekip">
        {employees.map((e) => {
          const t = current(e.id);
          const line = t ? t.title : e.lifecycle === 'working' ? 'Çalışıyor' : lifecycleLabel(e.lifecycle);
          return (
            <li key={e.id}>
              <button type="button" className="team-row" onClick={() => select(e.id)}>
                <span className={`avatar ${e.kind}`} aria-hidden="true">
                  {initial(e.name)}
                </span>
                <span className="team-text">
                  <span className="team-name">
                    {e.name}
                    {e.title ? <span className="muted"> · {e.title}</span> : null}
                  </span>
                  <span className="team-line">{line}</span>
                </span>
                <span className={`dot ${e.lifecycle}`} aria-label={lifecycleLabel(e.lifecycle)} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * In use: connected, or broken (configured and failing: the owner can act), or recorded by hand (someone meant it).
 * The rest — connectors of the account nobody signed into, or shut on every desk — are noise and fold away.
 */
const inUse = (i: Integration) => i.status === 'connected' || i.status === 'failed' || i.status === 'pending' || i.registeredBy !== null;

function Connections() {
  const [items, setItems] = useState<Integration[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    // A failed read keeps what is shown (null before the first): the block never breaks the page.
    const read = () =>
      void Promise.resolve()
        .then(() => api.integrations())
        .then((list) => alive && setItems(list.filter((i) => i.kind !== 'office' && i.status !== 'closed')))
        .catch(() => undefined);
    read();
    const poll = setInterval(read, CONNECTIONS_POLL_MS);
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, []);
  if (items === null) return null;
  // Closing drops the connector from every session; the list shows the server's answer at once.
  const close = async (name: string) => {
    setBusy(name);
    setError(null);
    try {
      await api.setIntegration(name, { closed: true });
      setItems((list) => (list ?? []).filter((i) => i.name !== name));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  // Broken ones first (the owner acts on them), then the live ones; a long list folds after a few.
  const rank = (i: Integration) => (i.status === 'failed' || i.status === 'needs_auth' ? 0 : i.status === 'pending' ? 1 : i.status === 'connected' ? 2 : 3);
  const byName = (a: Integration, b: Integration) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'tr');
  const used = items.filter(inUse).sort(byName);
  const idle = items.filter((i) => !inUse(i)).sort(byName);
  const shown = used.slice(0, CONNECTIONS_OPEN);
  const more = used.slice(CONNECTIONS_OPEN);
  const row = (i: Integration) => (
    <li key={i.name}>
      <span className="conn-name" title={i.authNeeded ?? i.note ?? undefined}>
        {i.name}
      </span>
      <span className={`conn-status ${i.status}`}>{INTEGRATION_STATUS_LABELS[i.status]}</span>
      {i.status !== 'connected' && (
        <button type="button" className="small" disabled={busy === i.name} aria-label={`${i.name} bağlantısını kapat`} onClick={() => void close(i.name)}>
          Kapat
        </button>
      )}
    </li>
  );
  const connected = items.filter((i) => i.status === 'connected').length;
  return (
    <section className="cockpit-block" aria-label="Bağlantılar bölümü">
      <header className="cockpit-head">
        <h2>Bağlantılar · {used.length}</h2>
        {items.length > 0 && <span className="muted">{connected} bağlı</span>}
      </header>
      {used.length === 0 ? (
        <p className="muted">Kullanılan bağlantı yok.</p>
      ) : (
        <ul className="connections" aria-label="Bağlantılar">
          {shown.map(row)}
        </ul>
      )}
      {more.length > 0 && (
        <details className="waiting-more">
          <summary>{more.length} bağlantı daha</summary>
          <ul className="connections">{more.map(row)}</ul>
        </details>
      )}
      {idle.length > 0 && (
        <details className="waiting-more">
          <summary>{idle.length} bağlayıcı kullanılmıyor</summary>
          <p className="muted">Hesabındaki claude.ai bağlayıcıları: giriş yapılmamış ya da masalarda kapalı. Ofis bunları kullanmıyor. Lazım olanı claude.ai → Ayarlar → Bağlayıcılar'dan bağla; gereksizi “Kapat” ile oturumlardan çıkar.</p>
          <ul className="connections">{idle.map(row)}</ul>
        </details>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function Waiting() {
  const approvals = useOffice((s) => s.approvals);
  const plans = useOffice((s) => s.plans);
  const proposals = useOffice((s) => s.proposals);
  const cards = useMemo(() => {
    const pending = Object.values(approvals)
      .filter((a) => a.status === 'pending')
      .sort((a, b) => b.requestedAt - a.requestedAt)
      .map((a) => ({ key: `a-${a.id}`, node: <ApprovalCard approval={a} /> }));
    const drafts = Object.values(plans)
      .filter((p) => p.status === 'draft')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((p) => ({ key: `p-${p.id}`, node: <PlanCard plan={p} /> }));
    const asks = Object.values(proposals)
      .filter((p) => p.status === 'owner')
      .sort((a, b) => b.ts - a.ts)
      .map((p) => ({ key: `q-${p.id}`, node: <ProposalCard proposal={p} /> }));
    return [...pending, ...drafts, ...asks];
  }, [approvals, plans, proposals]);
  const open = cards.slice(0, WAITING_OPEN);
  const rest = cards.slice(WAITING_OPEN);
  return (
    <section className="cockpit-block waiting" aria-label="Senden bekleyenler">
      <header className="cockpit-head">
        <h2>Senden bekleyenler</h2>
        {cards.length > 0 && <span className="count">{cards.length}</span>}
      </header>
      {cards.length === 0 && <p className="muted">Senden bir şey beklenmiyor. Ekip kendi işinde.</p>}
      {open.map((c) => (
        <div key={c.key}>{c.node}</div>
      ))}
      {rest.length > 0 && (
        <details className="waiting-more">
          <summary>{rest.length} öğe daha</summary>
          {rest.map((c) => (
            <div key={c.key}>{c.node}</div>
          ))}
        </details>
      )}
    </section>
  );
}

function Feed({ coordinatorId }: { coordinatorId: string }) {
  const view = useOffice((s) => s.views[coordinatorId]);
  const loadEvents = useOffice((s) => s.loadEvents);
  const loaded = view?.eventsLoaded ?? false;
  useEffect(() => {
    if (view && !loaded) void loadEvents(coordinatorId);
  }, [coordinatorId, view, loaded, loadEvents]);
  const events = useMemo(() => {
    const all = view?.events ?? [];
    const kept: StoredEvent[] = [];
    for (let i = all.length - 1; i >= 0 && kept.length < FEED_MAX; i -= 1) {
      const e = all[i]!;
      if (!FEED_TYPES.has(e.event.type)) continue;
      // Cards that wait for the owner sit in “Senden bekleyenler”; the feed keeps the decisions and the notes.
      if (e.event.type === 'plan.changed' && (e.event.change === 'proposed' || e.event.change === 'revised')) continue;
      kept.push(e);
    }
    return kept;
  }, [view?.events]);
  return (
    <section className="cockpit-block" aria-label="Akış">
      <header className="cockpit-head">
        <h2>Akış</h2>
        <span className="muted">Koordinatörün raporları ve işin dönüm noktaları, yeni olan üstte</span>
      </header>
      {events.length === 0 ? (
        <p className="muted">{loaded ? 'Henüz bir şey olmadı.' : 'Yükleniyor…'}</p>
      ) : (
        <div className="feed">
          {events.map((stored) => (
            <EventItem key={stored.seq} stored={stored} />
          ))}
        </div>
      )}
    </section>
  );
}

function Composer({ coordinatorId }: { coordinatorId: string }) {
  const markTyping = useOffice((s) => s.markTyping);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.send(coordinatorId, message);
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="cockpit-composer"
      onSubmit={(ev) => {
        ev.preventDefault();
        void submit();
      }}
    >
      <textarea
        aria-label="Koordinatöre yaz"
        rows={2}
        value={text}
        placeholder="Koordinatöre yaz…"
        onChange={(ev) => {
          setText(ev.target.value);
          markTyping(coordinatorId);
        }}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter' && !ev.shiftKey) {
            ev.preventDefault();
            void submit();
          }
        }}
      />
      <button type="submit" className="primary" disabled={busy || !text.trim()}>
        Gönder
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function Goals() {
  const goalMap = useOffice((s) => s.goals);
  const planMap = useOffice((s) => s.plans);
  const goals = useMemo(() => Object.values(goalMap).filter((g) => g.status === 'active').sort((a, b) => a.createdAt - b.createdAt), [goalMap]);
  const plans = useMemo(() => Object.values(planMap), [planMap]);
  return (
    <section className="cockpit-block" aria-label="Hedefler">
      <header className="cockpit-head">
        <h2>Hedefler · {goals.length}</h2>
      </header>
      {goals.length === 0 && <p className="muted">Henüz hedef yok.</p>}
      {goals.map((g) => {
        const own = plans.filter((p) => p.goalId === g.id && p.status !== 'declined');
        const done = own.filter((p) => p.status === 'done').length;
        const pct = own.length ? Math.round((done / own.length) * 100) : 0;
        return (
          <article key={g.id} className="goal-mini">
            <strong>{g.title}</strong>
            <span className="meter-track" aria-hidden="true">
              <span className="meter-fill ok" style={{ width: `${pct}%` }} />
            </span>
            <span className="muted">{own.length ? `${done} / ${own.length} plan bitti` : 'planı yok'}</span>
            {own.length > 0 && (
              <ul className="goal-mini-plans">
                {own.map((p) => (
                  <li key={p.id}>
                    <span>{p.title}</span>
                    <span className={`badge plan-${p.status}`}>{PLAN_STATUS_LABELS[p.status]}</span>
                  </li>
                ))}
              </ul>
            )}
            {g.kpis.length > 0 && <span className="muted">{g.kpis.map((k) => kpiText(k)).join(' · ')}</span>}
          </article>
        );
      })}
    </section>
  );
}

function OpenTasks({ tasks, nameOf }: { tasks: Task[]; nameOf: (id: string) => string }) {
  const setCompanyOpen = useOffice((s) => s.setCompanyOpen);
  const open = useMemo(() => {
    const rank = (t: Task) => OPEN_ORDER.indexOf(t.status);
    return tasks.filter((t) => OPEN_ORDER.includes(t.status)).sort((a, b) => rank(a) - rank(b) || a.priority - b.priority || a.createdAt - b.createdAt);
  }, [tasks]);
  return (
    <section className="cockpit-block" aria-label="Açık işler bölümü">
      <header className="cockpit-head">
        <h2>Açık işler · {open.length}</h2>
      </header>
      {open.length === 0 ? (
        <p className="muted">Açık iş yok.</p>
      ) : (
        <ul className="open-tasks" aria-label="Açık işler">
          {open.slice(0, TASKS_MAX).map((t) => (
            <li key={t.id} className={t.status}>
              <span className={`badge task-${t.status}`}>{TASK_STATUS_LABELS[t.status]}</span>
              <span className="open-task-title">{t.title}</span>
              <span className="muted">{nameOf(t.assignee)}</span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="link" onClick={() => setCompanyOpen(true, 'tasks')}>
        Tüm işler ve ajanda →
      </button>
    </section>
  );
}

/**
 * The flat office (one page, no 3D): the team and the connections on the left, what waits for the owner and the
 * coordinator's feed in the middle, the goals and the open work on the right. Everything else stays behind “Şirket”.
 */
export function Cockpit() {
  const views = useOffice((s) => s.views);
  const taskMap = useOffice((s) => s.tasks);
  const setCompanyOpen = useOffice((s) => s.setCompanyOpen);
  const selectedId = useOffice((s) => s.selectedId);
  const employees = useMemo(() => {
    const rank = (e: Employee) => (e.kind === 'coordinator' ? 0 : e.kind === 'lead' ? 1 : 2);
    return Object.values(views)
      .map((v) => v.employee)
      .filter((e) => e.lifecycle !== 'archived')
      .sort((a, b) => rank(a) - rank(b) || a.deskIndex - b.deskIndex || a.name.localeCompare(b.name, 'tr'));
  }, [views]);
  const tasks = useMemo(() => Object.values(taskMap), [taskMap]);
  const coordinator = employees.find((e) => e.kind === 'coordinator') ?? null;
  const nameOf = (id: string) => views[id]?.employee.name ?? '—';
  return (
    <div className="cockpit">
      <aside className="cockpit-col cockpit-team">
        <Team employees={employees} tasks={tasks} />
        <Connections />
        <button type="button" className="link" onClick={() => setCompanyOpen(true, 'constitution')}>
          Şirket ayarları →
        </button>
      </aside>
      <main className="cockpit-col cockpit-main">
        {selectedId ? (
          // The desk the owner opened takes the middle column (keyed: a draft never carries over to someone else); × brings the waiting list back.
          <Panel key={selectedId} id={selectedId} />
        ) : (
          <>
            <Waiting />
            {coordinator ? <Feed coordinatorId={coordinator.id} /> : <p className="muted">Koordinatör yok: “Şirket” bölümünden bir koordinatör al.</p>}
            {coordinator && <Composer coordinatorId={coordinator.id} />}
          </>
        )}
      </main>
      <aside className="cockpit-col cockpit-side">
        <Goals />
        <OpenTasks tasks={tasks} nameOf={nameOf} />
      </aside>
    </div>
  );
}
