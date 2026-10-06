import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Employee } from '@cc/shared';

vi.mock('./scene/OfficeScene.tsx', () => ({ OfficeScene: () => null }));
vi.mock('./net/live.ts', () => ({ connectLive: () => () => {} }));
vi.mock('./assets/manifest.ts', async (importOriginal) => ({ ...(await importOriginal<object>()), loadManifest: async () => ({ items: [] }) }));
vi.mock('./net/api.ts', () => ({ api: { office: vi.fn(async () => ({ employees: [], quota: null, usage: {}, lastSeq: 0 })), events: vi.fn(async () => []) } }));
const { App } = await import('./App.tsx');
const { useOffice } = await import('./store/office.ts');

const person = (id: string, name: string): Employee => ({
  id, slug: id, name, role: 'r', model: 'haiku', characterId: 'coder', deskIndex: 0, sessionId: `s-${id}`,
  sessionStarted: true, lifecycle: 'idle', limitResetsAt: null, lastError: null, createdAt: 1,
});

afterEach(cleanup);

describe('App', () => {
  it('gives each employee a fresh panel: a draft for Ada never ends up in Can’s message box', async () => {
    render(<App />);
    act(() => {
      useOffice.setState({
        views: {
          ada: { employee: person('ada', 'Ada'), events: [], openTools: {}, lastTurnFinishedAt: null, eventsLoaded: true },
          can: { employee: person('can', 'Can'), events: [], openTools: {}, lastTurnFinishedAt: null, eventsLoaded: true },
        },
        selectedId: 'ada',
      });
    });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ada için taslak' } });
    fireEvent.click(screen.getByLabelText('Yan soru'));
    act(() => useOffice.getState().select('can'));
    expect(screen.getByRole('heading', { name: 'Can' })).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByLabelText('Yan soru') as HTMLInputElement).checked).toBe(false);
  });
});
