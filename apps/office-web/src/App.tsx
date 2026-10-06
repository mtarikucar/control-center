import { useEffect } from 'react';
import { loadManifest } from './assets/manifest.ts';
import { connectLive } from './net/live.ts';
import { OfficeScene } from './scene/OfficeScene.tsx';
import { useOffice } from './store/office.ts';
import { CompanyView } from './ui/CompanyView.tsx';
import { HireDialog } from './ui/HireDialog.tsx';
import { Panel } from './ui/Panel.tsx';
import { TopBar } from './ui/TopBar.tsx';

export function App() {
  const selectedId = useOffice((s) => s.selectedId);
  const hireOpen = useOffice((s) => s.hireOpen);
  const companyOpen = useOffice((s) => s.companyOpen);

  useEffect(() => {
    const store = useOffice.getState();
    void loadManifest().then(store.setManifest);
    void store.refresh();
    const preselected = new URLSearchParams(location.search).get('employee');
    if (preselected) store.select(preselected);
    return connectLive({
      onMessage: (m) => useOffice.getState().receive(m),
      onStatus: (connected) => useOffice.getState().setConnected(connected),
      getAfter: () => useOffice.getState().lastSeq,
    });
  }, []);

  return (
    <div className="app">
      <OfficeScene />
      <TopBar />
      {/* Keyed by employee so a draft, the side-question switch or an error never carries over to someone else. */}
      {selectedId && <Panel key={selectedId} id={selectedId} />}
      {hireOpen && <HireDialog />}
      {companyOpen && <CompanyView />}
    </div>
  );
}
