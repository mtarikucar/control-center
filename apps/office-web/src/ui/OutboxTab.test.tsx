import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OUTBOX_GATE_OFF_TEXT, type Constitution, type OutboxEntry } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { OutboxTab } from './OutboxTab.tsx';

const entry = (over: Partial<OutboxEntry>): OutboxEntry => ({
  id: 1, employeeId: 'ada', departmentId: 'd1', tool: 'mcp__claude_ai_Gmail__send_message', kind: 'send', target: 'send_message to=a@x.co', recipients: ['a@x.co'],
  summary: '{"to":"a@x.co"}', via: 'system', approvalId: null, at: Date.now(), ...over,
});
vi.mock('../net/api.ts', () => ({
  api: {
    outbox: vi.fn(async () => [
      entry({ id: 3, employeeId: 'can', departmentId: null, kind: 'call', target: 'jeeta_click_to_dial phone=+905321112233', recipients: ['+905321112233'], via: 'owner', approvalId: 'ap1' }),
      entry({ id: 2, departmentId: 'd2', kind: 'publish', target: 'jeeta_publish_social_post post_id=p1', recipients: [] }),
      entry({ id: 1 }),
    ]),
  },
}));
const { api } = await import('../net/api.ts');

/** A promise the test settles itself: a read that has not come back. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() =>
  useOffice.setState({
    outboxRev: 0,
    budget: null,
    departments: { d1: { id: 'd1', name: 'Satış', status: 'open' }, d2: { id: 'd2', name: 'Pazarlama', status: 'open' } } as never,
    views: { ada: { employee: { id: 'ada', name: 'Ada' } } as never, can: { employee: { id: 'can', name: 'Can' } } as never },
  }),
);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('OutboxTab (spec capabilities §7)', () => {
  it('lists what went out, newest first, and who let it out; filters by department (none: the centre) and kind', async () => {
    render(<OutboxTab />);
    await screen.findByRole('row', { name: 'Ada send_message to=a@x.co' });
    const rows = () => screen.getAllByRole('row').map((r) => r.getAttribute('aria-label')).filter(Boolean);
    expect(rows()).toEqual(['Can jeeta_click_to_dial phone=+905321112233', 'Ada jeeta_publish_social_post post_id=p1', 'Ada send_message to=a@x.co']);
    expect(screen.getByRole('row', { name: /^Can/ }).textContent).toMatch(/merkez.*arama.*sahibinin onayıyla/);
    expect(screen.getByRole('row', { name: 'Ada send_message to=a@x.co' }).textContent).toMatch(/Satış.*gönderim.*sistem/);
    fireEvent.change(screen.getByLabelText('Departman'), { target: { value: 'd1' } });
    expect(rows()).toEqual(['Ada send_message to=a@x.co']);
    fireEvent.change(screen.getByLabelText('Departman'), { target: { value: 'none' } });
    expect(rows()).toEqual(['Can jeeta_click_to_dial phone=+905321112233']);
    fireEvent.change(screen.getByLabelText('Departman'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Tür'), { target: { value: 'publish' } });
    expect(rows()).toEqual(['Ada jeeta_publish_social_post post_id=p1']);
    expect(screen.getByText(/"izin verildi" kaydıdır, teslim değil/)).toBeTruthy();
  });

  it('names whom each call was for, and the department choices are the open ones and those with a record', async () => {
    useOffice.setState({
      departments: {
        d1: { id: 'd1', name: 'Satış', status: 'open' }, d2: { id: 'd2', name: 'Pazarlama', status: 'open' },
        d3: { id: 'd3', name: 'Eski', status: 'closed' }, d4: { id: 'd4', name: 'Kapalı ve kayıtlı', status: 'closed' },
      } as never,
    });
    vi.mocked(api.outbox).mockResolvedValueOnce([entry({ id: 9, departmentId: 'd4' })]);
    render(<OutboxTab />);
    const row = await screen.findByRole('row', { name: 'Ada send_message to=a@x.co' });
    expect(row.textContent).toMatch(/Kapalı ve kayıtlı.*→ a@x\.co/);
    const choices = [...(screen.getByLabelText('Departman') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(choices).toEqual(['Hepsi', 'Departmansız', 'Satış', 'Pazarlama', 'Kapalı ve kayıtlı']);
  });

  it('says so when nothing went out, and when the record cannot be read', async () => {
    vi.mocked(api.outbox).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('Sunucuya ulaşılamadı.'));
    const { unmount } = render(<OutboxTab />);
    expect(await screen.findByText('Kayıt yok.')).toBeTruthy();
    unmount();
    render(<OutboxTab />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/ulaşılamadı/);
    expect(screen.queryByText('Kayıt yok.')).toBeNull();
  });

  it('task 12: no empty state before the record has come back', async () => {
    const reading = deferred<OutboxEntry[]>();
    vi.mocked(api.outbox).mockImplementationOnce(() => reading.promise);
    render(<OutboxTab />);
    await act(async () => {});
    expect(screen.queryByText('Kayıt yok.')).toBeNull();
    await act(async () => reading.resolve([]));
    expect(screen.getByText('Kayıt yok.')).toBeTruthy();
  });

  it('task 12: a later read that fails does not make the record look empty', async () => {
    vi.mocked(api.outbox).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('Sunucuya ulaşılamadı.'));
    render(<OutboxTab />);
    await screen.findByText('Kayıt yok.');
    await act(async () => useOffice.setState({ outboxRev: 1 }));
    expect((await screen.findByRole('alert', {}, { timeout: 3000 })).textContent).toMatch(/ulaşılamadı/);
    expect(screen.queryByText('Kayıt yok.')).toBeNull();
  });

  it('task 12: a filter that matches none of the newest 200 says so, which is not an empty record', async () => {
    render(<OutboxTab />);
    await screen.findByRole('row', { name: 'Ada send_message to=a@x.co' });
    fireEvent.change(screen.getByLabelText('Tür'), { target: { value: 'calendar' } });
    expect(screen.getByText('Son 200 kayıtta bu süzgece uyan yok.')).toBeTruthy();
    expect(screen.queryByText('Kayıt yok.')).toBeNull();
    fireEvent.change(screen.getByLabelText('Tür'), { target: { value: '' } });
    expect(screen.queryByText(/süzgece uyan yok/)).toBeNull();
  });

  it('with the gate off an empty box says nothing is written then, not just that it is empty', async () => {
    useOffice.setState({ budget: { constitution: { gateEnabled: false } as Constitution } as never });
    vi.mocked(api.outbox).mockResolvedValueOnce([]);
    render(<OutboxTab />);
    expect(await screen.findByText(OUTBOX_GATE_OFF_TEXT)).toBeTruthy();
    expect(screen.queryByText('Kayıt yok.')).toBeNull();
  });

  it('task 12: says what the record holds — sends, publications, calls and calendar calls — and that nothing is written with the gate off', async () => {
    render(<OutboxTab />);
    await screen.findByRole('row', { name: 'Ada send_message to=a@x.co' });
    const intro = screen.getByText(/"izin verildi" kaydıdır/).textContent ?? '';
    expect(intro).toMatch(/gönderim, yayın, arama ve takvim çağrıları \(son 200\)/);
    expect(intro).toMatch(/kapı kapalıyken yazılmaz/);
    expect(intro).not.toMatch(/dışa dönük çağrılar/);
  });

  it('task 12: the table has a header row', async () => {
    render(<OutboxTab />);
    await screen.findByRole('row', { name: 'Ada send_message to=a@x.co' });
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Ne zaman', 'Çalışan', 'Departman', 'Tür', 'Hedef', 'Kim geçirdi', 'Özet']);
  });

  it('reads again when something goes out', async () => {
    render(<OutboxTab />);
    await screen.findByRole('row', { name: 'Ada send_message to=a@x.co' });
    expect(api.outbox).toHaveBeenCalledTimes(1);
    await act(async () => useOffice.setState({ outboxRev: 1 }));
    await waitFor(() => expect(api.outbox).toHaveBeenCalledTimes(2), { timeout: 3000 });
  });
});
