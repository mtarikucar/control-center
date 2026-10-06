import { useEffect } from 'react';
import { loadManifest } from './assets/manifest.ts';
import { connectLive } from './net/live.ts';
import { OfficeScene } from './scene/OfficeScene.tsx';
import { useOffice } from './store/office.ts';
import { HireDialog } from './ui/HireDialog.tsx';
import { Panel } from './ui/Panel.tsx';
import { TopBar } from './ui/TopBar.tsx';

export function App() {
  const selectedId = useOffice((s) => s.selectedId);
  const hireOpen = useOffice((s) => s.hireOpen);

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
      {selectedId && <Panel id={selectedId} />}
      {hireOpen && <HireDialog />}
    </div>
  );
}
