import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capability, CustomCapability } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { CapabilitiesTab } from './CapabilitiesTab.tsx';

const product: Capability[] = [
  { id: 'email.send', title: 'E-posta gönderme', summary: 'Şirket adına e-posta gönderir.', kind: 'send', outward: true, builtin: [], tools: ['mcp__claude_ai_Gmail__send_message'] },
  { id: 'messages.read', title: 'Gelen mesajları ve yorumları okuma', summary: 'Okur.', kind: 'read', outward: false, builtin: [], tools: [] },
];
const custom = (over: Partial<CustomCapability>): CustomCapability => ({
  id: 'sms.send', title: 'SMS gönderme', summary: 'Netgsm ile SMS.', kind: 'send', tools: ['mcp__netgsm__send_sms'], status: 'active',
  proposedBy: 'ada', decidedBy: 'koord', note: null, createdAt: 1, decidedAt: Date.now() - 60_000, ...over,
});
vi.mock('../net/api.ts', () => ({
  api: {
    capabilities: vi.fn(async () => ({ version: 3, capabilities: [...product, { ...product[0]!, id: 'sms.send', company: true }], knownConnectors: [], coverage: [], unclassified: [] })),
    customCapabilities: vi.fn(async () => [
      custom({}),
      custom({ id: 'sms.credits', title: 'SMS kredisi', kind: 'pay', status: 'proposed', decidedBy: null, decidedAt: null, tools: ['mcp__netgsm__buy_credits'] }),
    ]),
    addCapability: vi.fn(async (x: object) => x),
    decideCapability: vi.fn(async () => ({})),
    retireCapability: vi.fn(async () => ({})),
    setCapabilityKind: vi.fn(async () => ({})),
    confirmCapability: vi.fn(async () => ({})),
  },
}));
const { api } = await import('../net/api.ts');

/** A promise the test settles itself: an action that is still running, or a read that has not come back. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() =>
  useOffice.setState({
    capabilitiesRev: 0,
    views: { ada: { employee: { id: 'ada', name: 'Ada' } } as never, koord: { employee: { id: 'koord', name: 'Koordinatör', kind: 'coordinator' } } as never },
  }),
);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CapabilitiesTab (spec capabilities §9)', () => {
  it('the product’s read-only with their kinds; the company’s waiting first, then active (a new one marked); the owner approves with a kind, changes a kind, retires', async () => {
    render(<CapabilitiesTab />);
    expect((await screen.findByRole('row', { name: 'email.send' })).textContent).toMatch(/E-posta gönderme.*gönderim/);
    expect(within(screen.getByRole('region', { name: 'Ürünle gelenler' })).queryByRole('row', { name: 'sms.send' })).toBeNull();
    const credits = await within(screen.getByRole('region', { name: 'Karar bekleyenler' })).findByRole('listitem', { name: 'sms.credits' });
    expect(credits.textContent).toMatch(/karar bekliyor/);
    expect(credits.textContent).toMatch(/öneren Ada/);
    // Each button disables while its call runs: the next click waits for the previous one to settle.
    await act(async () => fireEvent.click(within(credits).getByRole('button', { name: 'Onayla' })));
    expect(api.decideCapability).toHaveBeenCalledWith('sms.credits', true, { kind: 'pay' });
    const active = within(screen.getByRole('region', { name: 'Şirketin yetenekleri' })).getByRole('listitem', { name: 'sms.send' });
    expect(active.textContent).toMatch(/yeni · koordinatör onayladı/);
    expect(active.textContent).toMatch(/karar Koordinatör/);
    fireEvent.change(within(active).getByLabelText('sms.send türü'), { target: { value: 'pay' } });
    await act(async () => fireEvent.click(within(active).getByRole('button', { name: 'Türü değiştir' })));
    expect(api.setCapabilityKind).toHaveBeenCalledWith('sms.send', 'pay');
    // The row waits for the changed list (see the tests of task 12): retiring is another row, freshly read.
    cleanup();
    render(<CapabilitiesTab />);
    const again = await within(await screen.findByRole('region', { name: 'Şirketin yetenekleri' })).findByRole('listitem', { name: 'sms.send' });
    await act(async () => fireEvent.click(within(again).getByRole('button', { name: 'Geri al' })));
    expect(api.retireCapability).toHaveBeenCalledWith('sms.send');
  });

  it('the owner adds one: id, title, summary, kind and the tools, one per line', async () => {
    render(<CapabilitiesTab />);
    const form = screen.getByRole('form', { name: 'Yetenek ekle' });
    fireEvent.change(within(form).getByLabelText('Kimlik'), { target: { value: 'wa.send' } });
    fireEvent.change(within(form).getByLabelText('Başlık'), { target: { value: 'WhatsApp gönderme' } });
    fireEvent.change(within(form).getByLabelText('Açıklama'), { target: { value: 'WhatsApp Business ile mesaj.' } });
    fireEvent.change(within(form).getByLabelText('Tür'), { target: { value: 'send' } });
    fireEvent.change(within(form).getByLabelText('Araçlar'), { target: { value: 'mcp__wa__send\nmcp__wa__send_template' } });
    await act(async () => fireEvent.click(within(form).getByRole('button', { name: 'Ekle' })));
    expect(api.addCapability).toHaveBeenCalledWith({ id: 'wa.send', title: 'WhatsApp gönderme', summary: 'WhatsApp Business ile mesaj.', kind: 'send', tools: ['mcp__wa__send', 'mcp__wa__send_template'] });
  });

  it('shows the server’s Turkish error', async () => {
    vi.mocked(api.addCapability).mockRejectedValueOnce(new Error('email.send ürünle gelen bir yetenek; başka bir kimlik seç.'));
    render(<CapabilitiesTab />);
    const form = screen.getByRole('form', { name: 'Yetenek ekle' });
    fireEvent.change(within(form).getByLabelText('Kimlik'), { target: { value: 'email.send' } });
    fireEvent.change(within(form).getByLabelText('Tür'), { target: { value: 'send' } });
    await act(async () => fireEvent.click(within(form).getByRole('button', { name: 'Ekle' })));
    expect(within(form).getByRole('alert').textContent).toMatch(/ürünle gelen/);
  });

  it('rejecting without a note sends the note the server requires of a rejection', async () => {
    render(<CapabilitiesTab />);
    const credits = await screen.findByRole('listitem', { name: 'sms.credits' });
    await act(async () => fireEvent.click(within(credits).getByRole('button', { name: 'Reddet' })));
    expect(api.decideCapability).toHaveBeenCalledWith('sms.credits', false, { note: 'Sahibi reddetti.' });
  });

  it('shows why a decision failed on the capability it was for', async () => {
    vi.mocked(api.decideCapability).mockRejectedValueOnce(new Error('sms.credits karar beklemiyor (etkin).'));
    render(<CapabilitiesTab />);
    const credits = await screen.findByRole('listitem', { name: 'sms.credits' });
    await act(async () => fireEvent.click(within(credits).getByRole('button', { name: 'Onayla' })));
    expect(within(credits).getByRole('alert').textContent).toMatch(/karar beklemiyor/);
  });

  it('marks a capability new only when someone else activated it within the week', async () => {
    const day = 24 * 60 * 60_000;
    vi.mocked(api.customCapabilities).mockResolvedValueOnce([
      custom({ id: 'sms.send', decidedBy: 'koord', decidedAt: Date.now() - 2 * day }),
      custom({ id: 'sms.old', decidedBy: 'koord', decidedAt: Date.now() - 8 * day }),
      custom({ id: 'sms.mine', proposedBy: 'owner', decidedBy: 'owner', decidedAt: Date.now() - 60_000 }),
    ]);
    render(<CapabilitiesTab />);
    const marked = (id: string) => /yeni · koordinatör onayladı/.test(screen.getByRole('listitem', { name: id }).textContent ?? '');
    await screen.findByRole('listitem', { name: 'sms.send' });
    expect([marked('sms.send'), marked('sms.old'), marked('sms.mine')]).toEqual([true, false, false]);
    expect(screen.getByRole('listitem', { name: 'sms.mine' }).textContent).toMatch(/öneren sahibi · karar sahibi/);
  });

  it('offers every kind, and says that read is open in every session and free at the gate, and that pay and delete always ask the owner', async () => {
    render(<CapabilitiesTab />);
    const kind = within(screen.getByRole('form', { name: 'Yetenek ekle' })).getByLabelText('Tür') as HTMLSelectElement;
    expect([...kind.options].map((o) => [o.value, o.textContent])).toEqual([
      ['', 'Tür seç…'], ['read', 'okuma (her oturumda açık, kapıda serbest)'], ['send', 'gönderim'], ['calendar', 'takvim'], ['call', 'arama'], ['publish', 'yayın'],
      ['pay', 'ödeme/harcama (her zaman sana sorulur)'], ['delete', 'silme (her zaman sana sorulur)'],
    ]);
  });

  it('final review (must-fix): the add form starts on no kind — read is the most permissive one — and does not submit until the owner chose', async () => {
    render(<CapabilitiesTab />);
    const form = screen.getByRole('form', { name: 'Yetenek ekle' });
    expect((within(form).getByLabelText('Tür') as HTMLSelectElement).value).toBe('');
    fireEvent.change(within(form).getByLabelText('Kimlik'), { target: { value: 'sms.send' } });
    fireEvent.change(within(form).getByLabelText('Araçlar'), { target: { value: 'mcp__netgsm__send_sms' } });
    const add = within(form).getByRole('button', { name: 'Ekle' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    // Enter in a field submits too: the form itself refuses.
    await act(async () => fireEvent.submit(form));
    expect(api.addCapability).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText('Tür'), { target: { value: 'send' } });
    expect(add.disabled).toBe(false);
    await act(async () => fireEvent.click(add));
    expect(api.addCapability).toHaveBeenCalledTimes(1);
    // The next addition starts from no kind again, not from the last one's.
    expect((within(form).getByLabelText('Tür') as HTMLSelectElement).value).toBe('');
    expect(add.disabled).toBe(true);
  });

  it('lists the rejected and retired ones apart, the newest decision first, with nothing to decide on them', async () => {
    vi.mocked(api.customCapabilities).mockResolvedValueOnce([
      custom({ id: 'sms.old', status: 'retired', decidedBy: 'owner', note: 'Artık kullanılmıyor.', createdAt: 3, decidedAt: 5_000 }),
      custom({ id: 'sms.no', status: 'rejected', decidedBy: 'koord', note: 'Gereksiz.', createdAt: 1, decidedAt: 9_000 }),
      custom({ id: 'sms.mid', status: 'rejected', decidedBy: 'koord', note: 'Yok.', createdAt: 2, decidedAt: 7_000 }),
    ]);
    render(<CapabilitiesTab />);
    const past = await screen.findByRole('region', { name: 'Geçmiş' });
    expect(within(past).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['sms.no', 'sms.mid', 'sms.old']);
    expect(past.textContent).toMatch(/Reddedilen ve geri alınanlar \(son 10\)/);
    expect(past.textContent).toMatch(/geri alındı.*not: Artık kullanılmıyor/);
    expect(within(past).queryByRole('button')).toBeNull();
  });

  it('shows the ten latest decisions of the past, not the ten oldest or the last ten created', async () => {
    // Created in order 1..12; decided in the opposite order, so the newest decisions belong to the first created.
    vi.mocked(api.customCapabilities).mockResolvedValueOnce(
      Array.from({ length: 12 }, (_, i) => custom({ id: `sms.n${String.fromCharCode(97 + i)}`, status: 'rejected', decidedBy: 'koord', note: 'Hayır.', createdAt: i + 1, decidedAt: 100_000 - i })),
    );
    render(<CapabilitiesTab />);
    const past = await screen.findByRole('region', { name: 'Geçmiş' });
    expect(within(past).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(
      Array.from({ length: 10 }, (_, i) => `sms.n${String.fromCharCode(97 + i)}`),
    );
  });

  it('final review I1: an active capability someone else activated is the owner’s at the gate until “Sisteme aç”; the owner’s own, a closed kind and a retired one have nothing to open', async () => {
    vi.mocked(api.customCapabilities).mockResolvedValueOnce([
      custom({ id: 'sms.send' }),
      custom({ id: 'sms.mine', proposedBy: 'owner', decidedBy: 'owner' }),
      custom({ id: 'sms.credits', kind: 'pay', tools: ['mcp__netgsm__buy_credits'] }),
      custom({ id: 'sms.old', status: 'retired', decidedBy: 'owner' }),
    ]);
    render(<CapabilitiesTab />);
    const row = (id: string) => screen.findByRole('listitem', { name: id });
    const open = (li: HTMLElement) => within(li).queryByRole('button', { name: 'Sisteme aç' });
    const sms = await row('sms.send');
    expect(sms.textContent).toMatch(/kapıda sana sorulur — sisteme açmak senin kararın/);
    await act(async () => fireEvent.click(open(sms)!));
    expect(api.confirmCapability).toHaveBeenCalledExactlyOnceWith('sms.send');
    for (const id of ['sms.mine', 'sms.credits', 'sms.old']) {
      const li = await row(id);
      expect([id, open(li), /sisteme açmak senin kararın/.test(li.textContent ?? '')]).toEqual([id, null, false]);
    }
  });

  it('final review I1: a failed confirm says why on its row and the buttons come back', async () => {
    vi.mocked(api.confirmCapability).mockRejectedValueOnce(new Error('sms.send etkin değil (geri alındı).'));
    render(<CapabilitiesTab />);
    const sms = await screen.findByRole('listitem', { name: 'sms.send' });
    await act(async () => fireEvent.click(within(sms).getByRole('button', { name: 'Sisteme aç' })));
    expect(within(sms).getByRole('alert').textContent).toMatch(/etkin değil/);
    expect((within(sms).getByRole('button', { name: 'Sisteme aç' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('final review I1: a proposal as read is the owner’s to accept as read; the coordinator’s own proposal is the owner’s to decide', async () => {
    vi.mocked(api.customCapabilities).mockResolvedValueOnce([
      custom({ id: 'sms.read', kind: 'read', status: 'proposed', decidedBy: null, decidedAt: null }),
      custom({ id: 'sms.own', status: 'proposed', proposedBy: 'koord', decidedBy: null, decidedAt: null }),
      custom({ id: 'sms.team', status: 'proposed', decidedBy: null, decidedAt: null }),
    ]);
    render(<CapabilitiesTab />);
    const text = async (id: string) => (await screen.findByRole('listitem', { name: id })).textContent ?? '';
    expect(await text('sms.read')).toMatch(/okuma olarak yalnız sen kabul edersin/);
    expect(await text('sms.read')).not.toMatch(/koordinatörün kendi önerisi/);
    expect(await text('sms.own')).toMatch(/koordinatörün kendi önerisi — karar senin/);
    expect(await text('sms.own')).not.toMatch(/okuma olarak/);
    const team = await text('sms.team');
    expect(team).not.toMatch(/okuma olarak|karar senin/);
  });

  it('task 12: a row’s buttons run one call at a time — a second click while it runs makes no second call', async () => {
    const running = deferred<CustomCapability>();
    vi.mocked(api.decideCapability).mockImplementationOnce(() => running.promise);
    render(<CapabilitiesTab />);
    const credits = await screen.findByRole('listitem', { name: 'sms.credits' });
    const approve = within(credits).getByRole('button', { name: 'Onayla' }) as HTMLButtonElement;
    fireEvent.click(approve);
    fireEvent.click(approve);
    expect(approve.disabled).toBe(true);
    expect((within(credits).getByRole('button', { name: 'Reddet' }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.decideCapability).toHaveBeenCalledTimes(1);
    await act(async () => running.resolve(custom({ status: 'active' })));
    expect(api.decideCapability).toHaveBeenCalledTimes(1);
  });

  it('task 12: after a successful action the row stays disabled until it comes back with new data (a click on the old row cannot repeat the action)', async () => {
    render(<CapabilitiesTab />);
    const credits = await screen.findByRole('listitem', { name: 'sms.credits' });
    await act(async () => fireEvent.click(within(credits).getByRole('button', { name: 'Onayla' })));
    expect(api.decideCapability).toHaveBeenCalledTimes(1);
    expect(within(credits).getAllByRole('button').map((b) => (b as HTMLButtonElement).disabled)).toEqual([true, true]);
    fireEvent.click(within(credits).getByRole('button', { name: 'Onayla' }));
    expect(api.decideCapability).toHaveBeenCalledTimes(1);
    // The server answers with the decision: the capability is active now, as a row with its own buttons.
    vi.mocked(api.customCapabilities).mockResolvedValueOnce([
      custom({ id: 'sms.credits', kind: 'pay', status: 'active', decidedBy: 'owner', tools: ['mcp__netgsm__buy_credits'] }),
    ]);
    await act(async () => useOffice.setState({ capabilitiesRev: 1 }));
    const active = await within(await screen.findByRole('region', { name: 'Şirketin yetenekleri' })).findByRole('listitem', { name: 'sms.credits' }, { timeout: 3000 });
    expect(within(active).getByRole('button', { name: 'Geri al' })).toBeTruthy();
    expect((within(active).getByRole('button', { name: 'Geri al' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('task 12: a confirmed row (same status and kind, a new decider) comes back enabled too', async () => {
    render(<CapabilitiesTab />);
    const sms = await screen.findByRole('listitem', { name: 'sms.send' });
    await act(async () => fireEvent.click(within(sms).getByRole('button', { name: 'Sisteme aç' })));
    expect((within(sms).getByRole('button', { name: 'Geri al' }) as HTMLButtonElement).disabled).toBe(true);
    vi.mocked(api.customCapabilities).mockResolvedValueOnce([custom({ id: 'sms.send', decidedBy: 'owner' })]);
    await act(async () => useOffice.setState({ capabilitiesRev: 1 }));
    await waitFor(() => expect(screen.getByRole('listitem', { name: 'sms.send' })).not.toBe(sms), { timeout: 3000 });
    const confirmed = screen.getByRole('listitem', { name: 'sms.send' });
    expect(within(confirmed).queryByRole('button', { name: 'Sisteme aç' })).toBeNull();
    expect((within(confirmed).getByRole('button', { name: 'Geri al' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('task 12: a failed action brings the buttons back, with its error', async () => {
    vi.mocked(api.decideCapability).mockRejectedValueOnce(new Error('sms.credits karar beklemiyor (etkin).'));
    render(<CapabilitiesTab />);
    const credits = await screen.findByRole('listitem', { name: 'sms.credits' });
    await act(async () => fireEvent.click(within(credits).getByRole('button', { name: 'Onayla' })));
    expect(within(credits).getAllByRole('button').map((b) => (b as HTMLButtonElement).disabled)).toEqual([false, false]);
  });

  it('task 12: nothing is said to be missing before the lists have come back, and nothing when they could not be read', async () => {
    const reading = deferred<CustomCapability[]>();
    vi.mocked(api.customCapabilities).mockImplementationOnce(() => reading.promise);
    const { unmount } = render(<CapabilitiesTab />);
    await screen.findByRole('row', { name: 'email.send' });
    for (const empty of ['Bekleyen öneri yok.', 'Şirketin eklediği etkin yetenek yok.']) expect(screen.queryByText(empty)).toBeNull();
    await act(async () => reading.resolve([]));
    for (const empty of ['Bekleyen öneri yok.', 'Şirketin eklediği etkin yetenek yok.']) expect(screen.getByText(empty)).toBeTruthy();
    unmount();
    vi.mocked(api.customCapabilities).mockRejectedValueOnce(new Error('Sunucuya ulaşılamadı.'));
    render(<CapabilitiesTab />);
    await screen.findByRole('alert');
    for (const empty of ['Bekleyen öneri yok.', 'Şirketin eklediği etkin yetenek yok.']) expect(screen.queryByText(empty)).toBeNull();
  });

  it('task 12: the product’s table has a header row', async () => {
    render(<CapabilitiesTab />);
    const products = await screen.findByRole('region', { name: 'Ürünle gelenler' });
    expect(within(products).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Kimlik', 'Başlık', 'Tür', 'Açıklama']);
  });

  it('reads again when a capability changes', async () => {
    render(<CapabilitiesTab />);
    await screen.findByRole('row', { name: 'email.send' });
    expect(api.customCapabilities).toHaveBeenCalledTimes(1);
    await act(async () => useOffice.setState({ capabilitiesRev: 1 }));
    await waitFor(() => expect(api.customCapabilities).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(api.capabilities).toHaveBeenCalledTimes(2);
  });

  it('says so when the lists cannot be read', async () => {
    vi.mocked(api.customCapabilities).mockRejectedValueOnce(new Error('Sunucuya ulaşılamadı.'));
    render(<CapabilitiesTab />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/ulaşılamadı/);
  });
});
