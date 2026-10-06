import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Employee, StoredEvent } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { Panel } from './Panel.tsx';

vi.mock('../net/api.ts', () => ({
  api: {
    send: vi.fn(async () => ({ ok: true })),
    sideQuestion: vi.fn(async () => ({ ok: true, answer: 'tamam' })),
    stop: vi.fn(async () => ({})),
    resume: vi.fn(async () => ({})),
    openTerminal: vi.fn(async () => ({ command: "cd '/d/ada' && claude --resume s1", employee: {} })),
    closeTerminal: vi.fn(async () => ({})),
    fire: vi.fn(async () => null),
    events: vi.fn(async () => []),
    office: vi.fn(async () => ({ employees: [], quota: null, usage: {}, lastSeq: 0 })),
  },
}));
const { api } = await import('../net/api.ts');

const employee: Employee = {
  id: 'e1', slug: 'ada', name: 'Ada', role: 'Testleri yazan yazılımcı', model: 'haiku', characterId: 'coder', deskIndex: 0,
  sessionId: 's1', sessionStarted: true, lifecycle: 'working', limitResetsAt: null, lastError: null, createdAt: 1,
};
const events: StoredEvent[] = [
  { seq: 1, employeeId: 'e1', ts: 1000, event: { type: 'message.user', text: 'merhaba', source: 'owner' } },
  { seq: 2, employeeId: 'e1', ts: 1100, event: { type: 'tool.started', toolUseId: 't', name: 'Bash', input: { command: 'ls -la' } } },
  { seq: 3, employeeId: 'e1', ts: 1200, event: { type: 'message.assistant', text: '<img src=x onerror=alert(1)> bitti' } },
];

beforeEach(() => {
  useOffice.setState({
    views: { e1: { employee, events, openTools: {}, lastTurnFinishedAt: null, eventsLoaded: true } },
    usage: { e1: { today: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.04 }, total: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.04 } } },
    selectedId: 'e1',
    terminalCommands: {},
    typingAt: {},
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Panel', () => {
  it('shows who, how much and the live stream', () => {
    render(<Panel id="e1" />);
    expect(screen.getByRole('heading', { name: 'Ada' })).toBeTruthy();
    expect(screen.getByText('Çalışıyor')).toBeTruthy();
    expect(screen.getByText('merhaba')).toBeTruthy();
    expect(screen.getByText('ls -la')).toBeTruthy();
    expect(screen.getByText(/1,5k tok/)).toBeTruthy();
  });

  it('review focus: shows employee text as plain text, never as HTML', () => {
    const { container } = render(<Panel id="e1" />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)> bitti')).toBeTruthy();
  });

  it('sends a message on Enter and marks the owner as typing', async () => {
    render(<Panel id="e1" />);
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'yeni iş' } });
    expect(useOffice.getState().typingAt.e1).toBeGreaterThan(0);
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(api.send).toHaveBeenCalledWith('e1', 'yeni iş'));
  });

  it('routes to a side question when the switch is on', async () => {
    render(<Panel id="e1" />);
    fireEvent.click(screen.getByLabelText('Yan soru'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ne durumdasın?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gönder' }));
    await waitFor(() => expect(api.sideQuestion).toHaveBeenCalledWith('e1', 'ne durumdasın?'));
    expect(api.send).not.toHaveBeenCalled();
  });

  it('stops, and shows the terminal command to copy', async () => {
    render(<Panel id="e1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Durdur' }));
    await waitFor(() => expect(api.stop).toHaveBeenCalledWith('e1'));
    fireEvent.click(screen.getByRole('button', { name: 'Terminalde aç' }));
    await waitFor(() => expect(screen.getByText("cd '/d/ada' && claude --resume s1")).toBeTruthy());
  });

  it('shows an API error instead of failing silently', async () => {
    vi.mocked(api.send).mockRejectedValueOnce(new Error('Bu çalışan şu an terminalde; önce ofise geri al.'));
    render(<Panel id="e1" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gönder' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Bu çalışan şu an terminalde; önce ofise geri al.');
  });

  it('keeps following new events once the stream is at its 500-event cap, unless the owner scrolled up', () => {
    // jsdom has no layout: give every element a 5000 px tall, 400 px high scroll box with a writable scrollTop.
    const tops = new WeakMap<Element, number>();
    const restore = [
      ['scrollHeight', { configurable: true, get: () => 5000 }],
      ['clientHeight', { configurable: true, get: () => 400 }],
      ['scrollTop', { configurable: true, get(this: Element) { return tops.get(this) ?? 0; }, set(this: Element, v: number) { tops.set(this, v); } }],
    ].map(([key, desc]) => {
      const before = Object.getOwnPropertyDescriptor(Element.prototype, key as string);
      Object.defineProperty(Element.prototype, key as string, desc as PropertyDescriptor);
      return () => (before ? Object.defineProperty(Element.prototype, key as string, before) : delete (Element.prototype as unknown as Record<string, unknown>)[key as string]);
    });
    try {
      const many: StoredEvent[] = Array.from({ length: 500 }, (_, i) => ({ seq: i + 1, employeeId: 'e1', ts: i, event: { type: 'message.assistant', text: `m${i}` } }));
      const push = (seq: number) =>
        act(() => {
          const view = useOffice.getState().views.e1!;
          useOffice.setState({ views: { e1: { ...view, events: [...view.events, { seq, employeeId: 'e1', ts: seq, event: { type: 'message.assistant', text: `m${seq}` } } as StoredEvent].slice(-500) } } });
        });
      useOffice.setState({ views: { e1: { employee, events: many, openTools: {}, lastTurnFinishedAt: null, eventsLoaded: true } } });
      const { container } = render(<Panel id="e1" />);
      const stream = container.querySelector('.stream') as HTMLDivElement;
      stream.scrollTop = 0;
      push(501);
      expect(stream.scrollTop).toBe(5000);
      stream.scrollTop = 1000;
      fireEvent.scroll(stream);
      push(502);
      expect(stream.scrollTop).toBe(1000);
    } finally {
      for (const undo of restore) undo();
    }
  });
});

