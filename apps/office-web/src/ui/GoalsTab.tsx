import { useMemo, useState } from 'react';
import type { Goal } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';
import { GOAL_STATUS_LABELS, PLAN_STATUS_LABELS } from './labels.ts';

function GoalCard({ goal }: { goal: Goal }) {
  // Select the map (a stable reference) and derive the list: a selector that builds a new array loops React.
  const allPlans = useOffice((s) => s.plans);
  const plans = useMemo(() => Object.values(allPlans).filter((p) => p.goalId === goal.id), [allPlans, goal.id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stop = async () => {
    if (!window.confirm(`“${goal.title}” hedefi durdurulsun mu? Süren planları da durur ve açık görevleri iptal edilir.`)) return;
    setError(null);
    setBusy(true);
    try {
      await api.stopGoal(goal.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={`goal-card ${goal.status}`} aria-label={goal.title}>
      <header className="row">
        <strong>{goal.title}</strong>
        <span className={`badge goal-${goal.status}`}>{GOAL_STATUS_LABELS[goal.status]}</span>
      </header>
      <p className="muted">{goal.why}</p>
      <span className="goal-label">Bitti tanımı</span>
      <ul>
        {goal.done.map((d, i) => (
          <li key={i}>{d}</li>
        ))}
      </ul>
      {plans.length > 0 && (
        <>
          <span className="goal-label">Planlar</span>
          <ul className="goal-plans">
            {plans.map((p) => (
              <li key={p.id}>
                {p.title} <span className={`badge plan-${p.status}`}>{PLAN_STATUS_LABELS[p.status]}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {goal.note && <p className="muted">{goal.note}</p>}
      {goal.status === 'active' && (
        <div className="row end">
          <button type="button" disabled={busy} onClick={() => void stop()}>
            Durdur
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** The coordinator's goals (spec §6.4): active first, then the closed ones. */
export function GoalsTab() {
  const goalMap = useOffice((s) => s.goals);
  const goals = Object.values(goalMap);
  if (goals.length === 0) return <p className="muted">Henüz hedef yok. Koordinatör şirketin misyonundan hedef koyunca burada görünür.</p>;
  const order = (g: Goal) => (g.status === 'active' ? 0 : 1);
  const sorted = [...goals].sort((a, b) => order(a) - order(b) || a.createdAt - b.createdAt);
  return (
    <div className="goals">
      {sorted.map((g) => (
        <GoalCard key={g.id} goal={g} />
      ))}
    </div>
  );
}
