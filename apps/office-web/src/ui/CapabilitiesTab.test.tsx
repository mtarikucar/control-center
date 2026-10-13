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
  },
}));
const { api } = await import('../net/api.ts');

beforeEach(() =>
  useOffice.setState({
    capabilitiesRev: 0,
    views: { ada: { employee: { id: 'ada', name: 'Ada' } } as never, koord: { employee: { id: 'koord', name: 'Koordinatör' } } as never },
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
    await act(async () => fireEvent.click(within(active).getByRole('button', { name: 'Geri al' })));
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

  it('offers every kind, and says that pay and delete always ask the owner', async () => {
    render(<CapabilitiesTab />);
    const kind = within(screen.getByRole('form', { name: 'Yetenek ekle' })).getByLabelText('Tür') as HTMLSelectElement;
    expect([...kind.options].map((o) => [o.value, o.textContent])).toEqual([
      ['read', 'okuma'], ['send', 'gönderim'], ['calendar', 'takvim'], ['call', 'arama'], ['publish', 'yayın'],
      ['pay', 'ödeme/harcama (her zaman sana sorulur)'], ['delete', 'silme (her zaman sana sorulur)'],
    ]);
  });

  it('lists the rejected and retired ones apart, with nothing to decide on them', async () => {
    vi.mocked(api.customCapabilities).mockResolvedValueOnce([
      custom({ id: 'sms.old', status: 'retired', decidedBy: 'owner', note: 'Artık kullanılmıyor.' }),
      custom({ id: 'sms.no', status: 'rejected', decidedBy: 'koord', note: 'Gereksiz.' }),
    ]);
    render(<CapabilitiesTab />);
    const past = await screen.findByRole('region', { name: 'Geçmiş' });
    expect(within(past).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['sms.no', 'sms.old']);
    expect(past.textContent).toMatch(/geri alındı.*not: Artık kullanılmıyor/);
    expect(within(past).queryByRole('button')).toBeNull();
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
