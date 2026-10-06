import { create } from 'zustand';
import type { ServerMessage } from '@cc/shared';
import { EMPTY_MANIFEST, type AssetManifest } from '../assets/manifest.ts';
import { api } from '../net/api.ts';
import { EMPTY_DATA, applyEvent, applySnapshot, mergeEvents, needsRefresh, type OfficeData } from './reducers.ts';

export interface OfficeStore extends OfficeData {
  connected: boolean;
  selectedId: string | null;
  manifest: AssetManifest;
  /** employeeId → when the owner last typed to them (drives the "turns to you" pose). */
  typingAt: Record<string, number>;
  terminalCommands: Record<string, string>;
  hireOpen: boolean;
  receive: (m: ServerMessage) => void;
  setConnected: (connected: boolean) => void;
  refresh: () => Promise<void>;
  select: (id: string | null) => void;
  loadEvents: (id: string) => Promise<void>;
  markTyping: (id: string) => void;
  setManifest: (m: AssetManifest) => void;
  setTerminalCommand: (id: string, command: string | null) => void;
  setHireOpen: (open: boolean) => void;
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export const useOffice = create<OfficeStore>()((set, get) => ({
  ...EMPTY_DATA,
  connected: false,
  selectedId: null,
  manifest: EMPTY_MANIFEST,
  typingAt: {},
  terminalCommands: {},
  hireOpen: false,

  receive(m) {
    if (m.type === 'snapshot') {
      set((s) => applySnapshot(s, m.snapshot));
      return;
    }
    set((s) => applyEvent(s, m.event));
    if (needsRefresh(m.event)) {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void get().refresh(), 150);
    }
  },
  setConnected: (connected) => set({ connected }),
  async refresh() {
    try {
      const snapshot = await api.office();
      set((s) => applySnapshot(s, snapshot));
    } catch {
      // The next live snapshot brings the office back in sync.
    }
  },
  select(id) {
    set({ selectedId: id });
    const view = id ? get().views[id] : undefined;
    if (id && view && !view.eventsLoaded) void get().loadEvents(id);
  },
  async loadEvents(id) {
    const loaded = await api.events(id, 500).catch(() => null);
    if (!loaded) return;
    set((s) => {
      const view = s.views[id];
      return view ? { views: { ...s.views, [id]: mergeEvents(view, loaded) } } : {};
    });
  },
  markTyping: (id) => set((s) => ({ typingAt: { ...s.typingAt, [id]: Date.now() } })),
  setManifest: (manifest) => set({ manifest }),
  setTerminalCommand: (id, command) =>
    set((s) => {
      const terminalCommands = { ...s.terminalCommands };
      if (command) terminalCommands[id] = command;
      else delete terminalCommands[id];
      return { terminalCommands };
    }),
  setHireOpen: (hireOpen) => set({ hireOpen }),
}));
