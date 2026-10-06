import { useOffice } from '../store/office.ts';
import { QuotaHud } from './QuotaHud.tsx';

export function TopBar() {
  const connected = useOffice((s) => s.connected);
  const quota = useOffice((s) => s.quota);
  const count = useOffice((s) => Object.keys(s.views).length);
  const setHireOpen = useOffice((s) => s.setHireOpen);
  const setCompanyOpen = useOffice((s) => s.setCompanyOpen);
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-name">control-center</span>
        <span className={`conn ${connected ? 'on' : 'off'}`}>{connected ? 'canlı' : 'bağlantı yok'}</span>
        <span className="muted">{count} çalışan</span>
      </div>
      <QuotaHud quota={quota} now={Date.now()} />
      <button type="button" onClick={() => setCompanyOpen(true)}>
        Şirket
      </button>
      <button type="button" className="primary" onClick={() => setHireOpen(true)}>
        + Çalışan al
      </button>
    </header>
  );
}
