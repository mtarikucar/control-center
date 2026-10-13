import { useState } from 'react';
import { APPROVAL_KIND_LABELS, OUTBOX_VIA_LABELS, OUTWARD_POLICY_KINDS } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';
import { formatWhenTR } from './format.ts';
import { useLiveRead } from './useLiveRead.ts';

/** Spec capabilities §7: what the gate let out, the newest 200, filtered here by department and kind. */
export function OutboxTab() {
  const rev = useOffice((s) => s.outboxRev);
  const departments = useOffice((s) => s.departments);
  const views = useOffice((s) => s.views);
  const [department, setDepartment] = useState('');
  const [kind, setKind] = useState('');
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
        Kapının sistem adına geçirdiği ve senin onayladığın dışa dönük çağrılar (son 200). Bir "izin verildi" kaydıdır, teslim değil; kapı kapalıyken hiçbir şey yazılmaz.
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
      {data && shown.length === 0 && <p className="muted">Kayıt yok.</p>}
      <table>
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
