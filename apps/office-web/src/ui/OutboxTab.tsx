import { useState } from 'react';
import { APPROVAL_KIND_LABELS, OUTBOX_GATE_OFF_TEXT, OUTBOX_READ_MAX, OUTBOX_VIA_LABELS, OUTWARD_POLICY_KINDS } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';
import { formatWhenTR } from './format.ts';
import { useLiveRead } from './useLiveRead.ts';

/** Spec capabilities §7: what the gate let out, the newest OUTBOX_READ_MAX, filtered here by department and kind. */
export function OutboxTab() {
  const rev = useOffice((s) => s.outboxRev);
  const departments = useOffice((s) => s.departments);
  const views = useOffice((s) => s.views);
  const [department, setDepartment] = useState('');
  const [kind, setKind] = useState('');
  // Off for sure (the budget has come): the box is empty because nothing is written, not because nothing went out.
  const gateOff = useOffice((s) => s.budget?.constitution.gateEnabled === false);
  const { data, error } = useLiveRead(rev, () => api.outbox());
  const all = data ?? [];
  const nameOf = (id: string) => views[id]?.employee.name ?? id;
  const departmentOf = (id: string | null) => (id === null ? 'merkez' : (departments[id]?.name ?? '—'));
  const choices = Object.values(departments).filter((d) => d.status === 'open' || all.some((e) => e.departmentId === d.id));
  const shown = all.filter((e) => (!department || (department === 'none' ? e.departmentId === null : e.departmentId === department)) && (!kind || e.kind === kind));
  const now = Date.now();
  return (
    <div className="outbox">
      <p className="muted">
        Kapının sistem adına geçirdiği ve senin onayladığın gönderim, yayın, arama ve takvim çağrıları (son {OUTBOX_READ_MAX}). Bir "izin verildi" kaydıdır, teslim değil; kapı kapalıyken yazılmaz.
      </p>
      <div className="row board-filters">
        <label>
          Departman
          <select aria-label="Departman" value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">Hepsi</option>
            <option value="none">Departmansız</option>
            {choices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tür
          <select aria-label="Tür" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Hepsi</option>
            {OUTWARD_POLICY_KINDS.map((k) => (
              <option key={k} value={k}>
                {APPROVAL_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {/* Said only of a record that has come and could be read: before that, or after a failed read, it is not known to be empty. */}
      {data && !error && shown.length === 0 && (
        <p className="muted">{all.length > 0 ? `Son ${OUTBOX_READ_MAX} kayıtta bu süzgece uyan yok.` : gateOff ? OUTBOX_GATE_OFF_TEXT : 'Kayıt yok.'}</p>
      )}
      <table>
        <thead>
          <tr>
            <th>Ne zaman</th>
            <th>Çalışan</th>
            <th>Departman</th>
            <th>Tür</th>
            <th>Hedef</th>
            <th>Kim geçirdi</th>
            <th>Özet</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((e) => (
            <tr key={e.id} aria-label={`${nameOf(e.employeeId)} ${e.target}`}>
              <td>{formatWhenTR(e.at, now)}</td>
              <td>{nameOf(e.employeeId)}</td>
              <td>{departmentOf(e.departmentId)}</td>
              <td>{APPROVAL_KIND_LABELS[e.kind]}</td>
              <td>
                <code>{e.target}</code>
                {e.recipients.length > 0 && <span className="muted">{` → ${e.recipients.join(', ')}`}</span>}
              </td>
              <td>{OUTBOX_VIA_LABELS[e.via]}</td>
              <td className="summary">{e.summary}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
