import { useMemo, useState } from 'react';
import { TASK_DIFFICULTY_LABELS, type Employee, type PlanView, type Task, type TaskStatus } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';
import { KIND_LABELS, TASK_STATUS_LABELS, lifecycleLabel } from './labels.ts';
import { AgendaTab } from './AgendaTab.tsx';
import { BudgetTab, ConstitutionTab } from './BudgetTabs.tsx';
import { formatWhenTR } from './format.ts';
import { GoalsTab } from './GoalsTab.tsx';
import { ManagementTab } from './ManagementTab.tsx';
import { DecisionsTab, NotesTab, PlaybookTab } from './MemoryTabs.tsx';
import { ProposalCard } from './ProposalCard.tsx';
import { streamOf } from './streams.ts';

const TABS = [
  ['org', 'Örgüt'],
  ['goals', 'Hedefler'],
  ['agenda', 'Ajanda'],
  ['tasks', 'Görevler'],
  ['management', 'Yönetim'],
  ['proposals', 'Öneriler'],
  ['decisions', 'Kararlar'],
  ['playbook', 'El kitabı'],
  ['notes', 'Notlar'],
  ['budget', 'Bütçe'],
  ['constitution', 'Anayasa'],
] as const;
type Tab = (typeof TABS)[number][0];

const COLUMNS: TaskStatus[] = ['waiting', 'in_progress', 'review', 'blocked', 'done'];
/** A parked task waits too: it shows in Bekliyor (after the ones that may start), with when it comes back. */
const inColumn = (t: Task, status: TaskStatus) => t.status === status || (status === 'waiting' && t.status === 'parked');
const parkedLast = (t: Task) => (t.status === 'parked' ? 1 : 0);

function NoCoordinator({ people }: { people: Employee[] }) {
  const [pick, setPick] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <div className="company-banner">
      <p>Şirketin koordinatörü yok. Koordinatör seninle plan konuşur, gerekirse işe alır ve işleri dağıtır.</p>
      <div className="row">
        <button type="button" className="primary" onClick={() => void run(() => api.hireCoordinator())}>
          Koordinatör işe al
        </button>
        {people.length > 0 && (
          <>
            <select aria-label="Koordinatör yapılacak çalışan" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Bir çalışan seç…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button type="button" disabled={!pick} onClick={() => void run(() => api.appointCoordinator(pick))}>
              Koordinatör yap
            </button>
          </>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function PersonCard({ e, current, onOpen }: { e: Employee; current: Task | undefined; onOpen: () => void }) {
  // "Koordinatör — Koordinatör [Koordinatör]" says one thing three times: show each word once.
  const title = e.title && e.title !== e.name ? e.title : '';
  const badge = e.kind !== 'member' && KIND_LABELS[e.kind] !== e.name && KIND_LABELS[e.kind] !== e.title ? KIND_LABELS[e.kind] : '';
  return (
    <button type="button" className="org-card" onClick={onOpen}>
      <strong>{e.name}</strong>
      {title && <span className="muted"> — {title}</span>}
      {badge && <span className="badge">{badge}</span>}
      <span className={`dot ${e.lifecycle}`} aria-hidden="true" />
      <span className="muted">{lifecycleLabel(e.lifecycle)}</span>
      {current && <span className="org-task">şu an: {current.title}</span>}
    </button>
  );
}

/** A task on the board: its title, its plan's stream (management cycle §3.4), who does it, and what holds it. */
function TaskCard({ t, plans, nameOf }: { t: Task; plans: Record<string, PlanView>; nameOf: (id: string) => string }) {
  const stream = streamOf(plans, t);
  return (
    <article className={`task-card ${t.status}`}>
      <strong>{t.title}</strong>
      {stream && (
        <span className="badge stream-tag" title="Planın akışı">
          akış: {stream.title}
        </span>
      )}
      {t.difficulty && <span className={`badge difficulty ${t.difficulty}`}>{TASK_DIFFICULTY_LABELS[t.difficulty]}</span>}
      {t.kind === 'review' && <span className="badge review">İnceleme</span>}
      {t.status === 'parked' && (
        <span className="badge parked" title={t.parkedReason ?? undefined}>
          ertelendi · {t.notBefore ? formatWhenTR(t.notBefore, Date.now()) : '—'}
        </span>
      )}
      <span className="muted">
        {nameOf(t.assignee)} · P{t.priority}
        {t.planId && plans[t.planId] ? ` · ${plans[t.planId]!.title}` : ''}
      </span>
      {t.reviewer && (
        <span className="muted">
          İnceleyen: {nameOf(t.reviewer)}
          {(t.round ?? 0) > 0 ? ` · tur ${t.round}` : ''}
        </span>
      )}
      {t.note && <span className="task-note">{t.note}</span>}
    </article>
  );
}

function ProposalsTab() {
  const proposals = useOffice((s) => s.proposals);
  const all = Object.values(proposals).sort((a, b) => b.ts - a.ts);
  const owner = all.filter((p) => p.status === 'owner');
  const open = all.filter((p) => p.status === 'open');
  const decided = all.filter((p) => p.status === 'accepted' || p.status === 'declined').slice(0, 20);
  if (all.length === 0) return <p className="muted">Henüz öneri yok. Çalışanlar ihtiyaç, fikir, itiraz ve satın alma taleplerini buraya getirir.</p>;
  const section = (label: string, items: typeof all) =>
    items.length > 0 && (
      <section aria-label={label} className="proposal-list">
        <h3>{label}</h3>
        {items.map((p) => (
          <ProposalCard key={p.id} proposal={p} />
        ))}
      </section>
    );
  return (
    <div className="proposals">
      {section('Senin kararını bekleyenler', owner)}
      {section('Ekipte karar bekleyenler', open)}
      {section('Karara bağlananlar', decided)}
    </div>
  );
}

/** The company at a glance: who is who (org chart) and what is being done (task board). */
export function CompanyView() {
  const views = useOffice((s) => s.views);
  const tasks = useOffice((s) => s.tasks);
  const plans = useOffice((s) => s.plans);
  const setCompanyOpen = useOffice((s) => s.setCompanyOpen);
  const select = useOffice((s) => s.select);
  const asked = useOffice((s) => s.companyTab);
  // The dialog mounts on opening: the tab it was asked for is where it starts.
  const [tab, setTab] = useState<Tab>(() => TABS.find(([key]) => key === asked)?.[0] ?? 'org');
  const [person, setPerson] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const people = useMemo(() => Object.values(views).map((v) => v.employee).filter((e) => e.lifecycle !== 'archived'), [views]);
  const coordinator = people.find((e) => e.kind === 'coordinator');
  const allTasks = Object.values(tasks);
  const currentOf = (id: string) => allTasks.find((t) => t.assignee === id && t.status === 'in_progress');
  const nameOf = (id: string) => (id === 'owner' ? 'sahibi' : (views[id]?.employee.name ?? '—'));
  const open = (id: string) => {
    select(id);
    setCompanyOpen(false);
  };

  const teams = new Map<string, Employee[]>();
  for (const e of people) {
    if (e.kind === 'coordinator') continue;
    const team = e.team || 'Ekipsiz';
    teams.set(team, [...(teams.get(team) ?? []), e]);
  }

  const shown = allTasks.filter((t) => (!person || t.assignee === person) && (!planFilter || (planFilter === 'none' ? t.planId === null : t.planId === planFilter)));

  return (
    <div className="dialog-backdrop" role="presentation" onClick={() => setCompanyOpen(false)}>
      <section className="company" role="dialog" aria-label="Şirket" onClick={(e) => e.stopPropagation()}>
        <header className="row">
          <h2>Şirket</h2>
          <div role="tablist" className="tabs">
            {TABS.map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
                {label}
              </button>
            ))}
          </div>
          <button type="button" className="icon" aria-label="Kapat" onClick={() => setCompanyOpen(false)}>
            ×
          </button>
        </header>
        {!coordinator && <NoCoordinator people={people} />}
        {tab === 'org' ? (
          <div className="org">
            {coordinator && (
              <section aria-label="Koordinatör" className="org-top">
                <PersonCard e={coordinator} current={currentOf(coordinator.id)} onOpen={() => open(coordinator.id)} />
              </section>
            )}
            <div className="org-teams">
              {[...teams.entries()].map(([team, members]) => (
                <section key={team} aria-label={team} className="org-team">
                  <h3>{team}</h3>
                  {members.map((e) => (
                    <PersonCard key={e.id} e={e} current={currentOf(e.id)} onOpen={() => open(e.id)} />
                  ))}
                </section>
              ))}
            </div>
          </div>
        ) : tab === 'goals' ? (
          <GoalsTab />
        ) : tab === 'agenda' ? (
          <AgendaTab />
        ) : tab === 'tasks' ? (
          <div className="board-wrap">
            <div className="row board-filters">
              <label>
                Kişi
                <select aria-label="Kişi" value={person} onChange={(e) => setPerson(e.target.value)}>
                  <option value="">Herkes</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Plan
                <select aria-label="Plan" value={planFilter} onChange={(e) => setPlanFilter(e.target.value)}>
                  <option value="">Hepsi</option>
                  <option value="none">Plansız</option>
                  {Object.values(plans).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="board">
              {COLUMNS.map((status) => {
                const items = shown
                  .filter((t) => inColumn(t, status))
                  .sort((a, b) => (status === 'done' ? (b.finishedAt ?? 0) - (a.finishedAt ?? 0) : parkedLast(a) - parkedLast(b) || a.priority - b.priority || a.createdAt - b.createdAt))
                  .slice(0, status === 'done' ? 20 : undefined);
                return (
                  <section key={status} aria-label={TASK_STATUS_LABELS[status]} className="board-col">
                    <h3>
                      {TASK_STATUS_LABELS[status]} <span className="muted">{items.length}</span>
                    </h3>
                    {items.map((t) => (
                      <TaskCard key={t.id} t={t} plans={plans} nameOf={nameOf} />
                    ))}
                  </section>
                );
              })}
            </div>
          </div>
        ) : tab === 'management' ? (
          <ManagementTab />
        ) : tab === 'proposals' ? (
          <ProposalsTab />
        ) : tab === 'decisions' ? (
          <DecisionsTab />
        ) : tab === 'playbook' ? (
          <PlaybookTab />
        ) : tab === 'notes' ? (
          <NotesTab />
        ) : tab === 'budget' ? (
          <BudgetTab />
        ) : (
          <ConstitutionTab />
        )}
      </section>
    </div>
  );
}
