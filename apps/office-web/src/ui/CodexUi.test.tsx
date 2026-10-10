import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_DATA } from '../store/reducers.ts';
import { useOffice } from '../store/office.ts';
import { HireDialog } from './HireDialog.tsx';
import { Panel } from './Panel.tsx';
import { EventItem } from './EventItem.tsx';
import { TopBar } from './TopBar.tsx';

vi.mock('../net/api.ts', () => ({ api: { metrics: vi.fn(async () => null), events: vi.fn(async () => []) } }));
beforeEach(() => useOffice.setState({ ...EMPTY_DATA, runtime: { provider: 'codex', model: 'test-model', costAvailable: false } }));
afterEach(() => { cleanup(); useOffice.setState({ ...EMPTY_DATA, runtime: undefined }); });

describe('Codex office UI', () => {
  it('previews native generations through the recorded employee event, not a raw filesystem URL', () => {
    render(<EventItem stored={{ seq: 42, ts: 0, employeeId: 'employee-1', event: { provider: 'codex', type: 'image.generated', path: 'C:/private/generated.png', prompt: 'test' } }} />);
    expect(screen.getByRole('img').getAttribute('src')).toBe('/api/employees/employee-1/images/42');
    expect(screen.getByText('Görseli indir').getAttribute('href')).toBe('/api/employees/employee-1/images/42');
    expect(screen.queryByText('C:/private/generated.png')).toBeNull();
  });
  it('identifies the provider and offers Codex work levels instead of Claude model families', () => {
    render(<><TopBar /><HireDialog /></>);
    expect(screen.getByText('Claude + Codex')).toBeTruthy();
    const levels = screen.getByLabelText('Çalışma düzeyi') as HTMLSelectElement;
    expect(Array.from(levels.options).map(o => o.text)).toEqual(['Codex — en yüksek', 'Codex — yüksek', 'Codex — dengeli', 'Codex — düşük']);
    expect(screen.queryByText(/Fable/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Sağlayıcı'), { target: { value: 'claude' } });
    expect(screen.getByLabelText('Model')).toBeTruthy();
    expect(screen.getByText(/Opus/)).toBeTruthy();
  });
  it('keeps token usage visible while suppressing unavailable dollar cost', () => {
    useOffice.setState({ views: { e: { employee: { provider: 'codex', id: 'e', slug: 'ada', name: 'Ada', role: 'r', model: 'haiku', characterId: 'coder', title: '', team: '', kind: 'member', reportsTo: null, deskIndex: 0, sessionId: 's', sessionStarted: false, lifecycle: 'idle', limitResetsAt: null, lastError: null, createdAt: 1 }, events: [], eventsLoaded: true, openTools: {}, idleSince: null } } });
    render(<Panel id="e" />);
    expect(screen.getByText('Codex — düşük')).toBeTruthy();
    expect(screen.getByText(/Codex para maliyeti bildirmiyor/)).toBeTruthy();
    expect(screen.queryByText(/\$0\.00/)).toBeNull();
  });
  it('renders turn results without a misleading zero-dollar price', () => {
    render(<EventItem stored={{ seq: 1, ts: 0, employeeId: 'e', event: { provider: 'codex', type: 'turn.finished', ok: true, subtype: 'completed', usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 0, cacheCreationTokens: 0 }, costUsd: 0, numTurns: 1, queuedTurns: 0, sessionUsage: null, sessionCostUsd: 0 } }} />);
    expect(screen.getByText(/Tur bitti/).textContent).not.toContain('$');
  });
});
