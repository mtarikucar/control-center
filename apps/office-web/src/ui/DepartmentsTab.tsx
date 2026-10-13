import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { MAX_DEPARTMENTS, type Department, type DepartmentTemplate, type Employee } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';

const FULL = `En fazla ${MAX_DEPARTMENTS} departman açık olabilir; önce birini kapat.`;

/** People at work, as the page knows them. */
function usePeople(): Employee[] {
  const views = useOffice((s) => s.views);
  return useMemo(() => Object.values(views).map((v) => v.employee).filter((e) => e.lifecycle !== 'archived'), [views]);
}

/** Runs an owner action; its error is shown, the next action clears it. */
function useRun() {
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    try {
      await work();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  };
  return { error, run };
}

function OpenDialog({ people, onClose }: { people: Employee[]; onClose: () => void }) {
  const [templates, setTemplates] = useState<DepartmentTemplate[]>([]);
  const [choice, setChoice] = useState('');
  const [name, setName] = useState('');
  const [mission, setMission] = useState('');
  const [scope, setScope] = useState('');
  const [headId, setHeadId] = useState('');
  const { error, run } = useRun();
  useEffect(() => {
    void api.departmentTemplates().then(setTemplates, () => setTemplates([]));
  }, []);
  const candidates = people.filter((e) => e.kind !== 'coordinator');
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!choice) return;
    const head = headId ? { headId } : {};
    const input = choice === 'custom' ? { name, mission, scope, ...head } : { template: choice, ...head };
    if (await run(() => api.createDepartment(input))) onClose();
  };
  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <form className="dialog" role="dialog" aria-label="Departman aç" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <h2>Departman aç</h2>
        <fieldset className="department-choices">
          {templates.map((t) => (
            <label key={t.id} className="department-choice">
              <input type="radio" name="department-kind" value={t.id} checked={choice === t.id} onChange={() => setChoice(t.id)} />
              <strong>{t.name}</strong> <span className="muted">{t.mission}</span>
              <span className="muted"> Başkan: {t.head}. Gerekirse: {t.roles.map((r) => `${r.template} (${r.when})`).join('; ')}</span>
            </label>
          ))}
          <label className="department-choice">
            <input type="radio" name="department-kind" value="custom" checked={choice === 'custom'} onChange={() => setChoice('custom')} />
            Özel departman
          </label>
        </fieldset>
        {choice === 'custom' && (
          <>
            <div className="field">
              <label htmlFor="department-name">Ad</label>
              <input id="department-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
            </div>
            <div className="field">
              <label htmlFor="department-mission">Misyon</label>
              <textarea id="department-mission" value={mission} onChange={(e) => setMission(e.target.value)} rows={3} required />
            </div>
            <div className="field">
              <label htmlFor="department-scope">Yapar / Yapmaz</label>
              <textarea id="department-scope" value={scope} onChange={(e) => setScope(e.target.value)} rows={5} placeholder={'### Yapar\n\n### Yapmaz\n\n### Sana gelir'} />
            </div>
          </>
        )}
        <div className="field">
          <label htmlFor="department-head">Başkan</label>
          <select id="department-head" value={headId} onChange={(e) => setHeadId(e.target.value)}>
            <option value="">Başkansız</option>
            {candidates.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row end">
          <button type="button" onClick={onClose}>
            Vazgeç
          </button>
          <button type="submit" className="primary" disabled={!choice}>
            Aç
          </button>
        </div>
      </form>
    </div>
  );
}

function DepartmentDetails({ dep, members, people }: { dep: Department; members: Employee[]; people: Employee[] }) {
  const { error, run } = useRun();
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState('');
  const outside = people.filter((e) => e.kind !== 'coordinator' && e.departmentId !== dep.id);
  return (
    <div className="department-details">
      {dep.scope && <pre className="department-scope">{dep.scope}</pre>}
      <ul className="department-members">
        {members.map((e) => (
          <li key={e.id}>
            {e.id === dep.headId ? '★ ' : ''}
            {e.name}
            {e.title ? ` — ${e.title}` : ''}{' '}
            <button type="button" onClick={() => void run(() => api.moveEmployee(e.id, null))}>
              Merkeze al
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <div className="field">
          <label htmlFor={`department-add-${dep.id}`}>Kişi ekle</label>
          <select id={`department-add-${dep.id}`} value="" onChange={(ev) => ev.target.value && void run(() => api.moveEmployee(ev.target.value, dep.id))}>
            <option value="">Seç…</option>
            {outside.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`department-head-${dep.id}`}>Başkanı değiştir</label>
          <select id={`department-head-${dep.id}`} value={dep.headId ?? ''} onChange={(ev) => void run(() => api.updateDepartment(dep.id, { headId: ev.target.value || null }))}>
            <option value="">Başkansız</option>
            {members.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {closing ? (
        <div className="row">
          <div className="field">
            <label htmlFor={`department-reason-${dep.id}`}>Gerekçe</label>
            <input id={`department-reason-${dep.id}`} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <button type="button" className="danger" onClick={() => reason.trim() && void run(() => api.closeDepartment(dep.id, reason.trim()))}>
            Departmanı kapat
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setClosing(true)}>
          Kapat…
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function DepartmentCard({ dep, people }: { dep: Department; people: Employee[] }) {
  const [open, setOpen] = useState(false);
  const members = people.filter((e) => e.departmentId === dep.id).sort((a, b) => Number(b.id === dep.headId) - Number(a.id === dep.headId));
  const head = people.find((e) => e.id === dep.headId);
  return (
    <section aria-label={dep.name} className="department-card">
      <header className="row">
        <h3>{dep.name}</h3>
        {dep.template ? <span className="badge">şablon {dep.template.id}</span> : <span className="badge">özel</span>}
      </header>
      <p>{dep.mission}</p>
      <p className="muted">
        Başkan: {head?.name ?? 'yok'} · {members.length} kişi
      </p>
      <button type="button" data-action="details" onClick={() => setOpen(!open)}>
        {open ? 'Gizle' : 'Ayrıntı'}
      </button>
      {open && <DepartmentDetails dep={dep} members={members} people={people} />}
    </section>
  );
}

/** The owner's view of the departments (spec departments §8): open one, name its head, move people, close it. */
export function DepartmentsTab() {
  const departments = useOffice((s) => s.departments);
  const people = usePeople();
  const [opening, setOpening] = useState(false);
  const open = useMemo(() => Object.values(departments ?? {}).filter((d) => d.status === 'open').sort((a, b) => a.createdAt - b.createdAt), [departments]);
  const full = open.length >= MAX_DEPARTMENTS;
  return (
    <div className="departments">
      <div className="row">
        <button type="button" className="primary" disabled={full} onClick={() => setOpening(true)}>
          Departman aç
        </button>
        {full && <span className="muted">{FULL}</span>}
      </div>
      {opening && <OpenDialog people={people} onClose={() => setOpening(false)} />}
      {open.length === 0 ? (
        <p className="muted">Henüz departman yok: bir şablondan ya da özel bir departman aç; koordinatör de açabilir.</p>
      ) : (
        open.map((d) => <DepartmentCard key={d.id} dep={d} people={people} />)
      )}
    </div>
  );
}
