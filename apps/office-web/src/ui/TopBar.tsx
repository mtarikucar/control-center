import { useOffice } from '../store/office.ts';
import { QuotaHud } from './QuotaHud.tsx';

export function TopBar() {
  const connected = useOffice((s) => s.connected);
  const quota = useOffice((s) => s.quota);
  const count = useOffice((s) => Object.keys(s.views).length);
  const setHireOpen = useOffice((s) => s.setHireOpen);
  const setCompanyOpen = useOffice((s) => s.setCompanyOpen);
  const reserve = useOffice((s) => s.budget?.reserve.active ?? false);
  const waiting = useOffice(
    (s) => Object.values(s.plans).filter((p) => p.status === 'draft').length + Object.values(s.proposals).filter((p) => p.status === 'owner').length,
  );
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-name">control-center</span>
        <span className={`conn ${connected ? 'on' : 'off'}`}>{connected ? 'canlı' : 'bağlantı yok'}</span>
        <span className="muted">{count} çalışan</span>
      </div>
      <QuotaHud quota={quota} now={Date.now()} />
      {reserve && (
        <span className="badge reserve" title="Kota kullanımı sahibinin payına dayandı: ofis yalnız acil işleri başlatıyor.">
          Sahibinin payı korunuyor
        </span>
      )}
      <button type="button" onClick={() => setCompanyOpen(true)}>
        Şirket
        {waiting > 0 && (
          <span className="count" aria-label={`${waiting} karar bekliyor`}>
            {waiting}
          </span>
        )}
      </button>
      <button type="button" className="primary" onClick={() => setHireOpen(true)}>
        + Çalışan al
      </button>
    </header>
  );
}
