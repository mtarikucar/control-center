import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BudgetSummary, Employee, PlanView } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { BudgetTab, ConstitutionTab } from './BudgetTabs.tsx';

const summary = (over: Partial<BudgetSummary> = {}): BudgetSummary => ({
  constitution: { maxEmployees: 8, ownerReservePct: 25, monthlyUsdCap: 50, chainDepth: 5, tasksPerDay: 30, openTasksPerPlan: 60, idleSleepMinutes: 30, digestHours: [9, 17],
    coordinatorModels: { kickoff: 'fable', cycle: 'opus', routine: 'sonnet' }, cacheTtlMinutes: 5, difficultyModels: { easy: 'haiku', medium: 'sonnet', hard: 'opus', critical: 'fable' },
    digestEnabled: false, modelPolicyEnabled: false, difficultyModelsEnabled: false, capabilityPrecheckEnabled: false, gateEnabled: false, autonomy: 'free', releasePolicy: 'owner', activeGoals: 10, pulseHours: 6, idleCapacityHours: 2, weeklyStopPct: 90, defaultTaskMinutes: 45, minScheduleMinutes: 60, maxSchedules: 20, outwardPolicy: { send: 'system', publish: 'system', call: 'system', calendar: 'owner' }, specialContacts: [], sendsPerHour: 30, bulkRecipients: 5, callHours: [9, 19], callsPerDay: 20 },
  reserve: { active: true, limitPct: 75, fiveHourPct: 82, sevenDayPct: 40 },
  month: { key: '2026-10', usd: 31.5 },
  plans: { p1: { spentUsd: 25, claudeUsd: 3.2 } },
  ...over,
});
vi.mock('../net/api.ts', () => ({ api: { budget: vi.fn(async () => summary()), setConstitution: vi.fn(async (p: object) => p) } }));
const { api } = await import('../net/api.ts');

const plan: PlanView = {
  id: 'p1', title: 'Tanıtım videosu', goal: 'g', approach: 'a', people: '', steps: [], quotaPct: 10, usd: 20, days: 3, risks: '',
  status: 'approved', version: 1, proposedBy: 'c', createdAt: 1, updatedAt: 1, approvedAt: 1,
};
const ada: Employee = {
  id: 'ada', slug: 'ada', name: 'Ada', role: 'r', model: 'haiku', characterId: 'coder', title: '', team: 'İçerik', kind: 'member', reportsTo: null,
  deskIndex: 0, sessionId: 's', sessionStarted: true, lifecycle: 'idle', limitResetsAt: null, lastError: null, createdAt: 1,
};

beforeEach(() =>
  useOffice.setState({
    // The Codex test sets it: left over, every later test would read Codex's names.
    runtime: undefined,
    budget: summary(),
    plans: { p1: plan },
    views: { ada: { employee: ada, events: [], openTools: {}, idleSince: null, eventsLoaded: true } },
    usage: { ada: { today: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 1.25, turns: 7, sideAnswers: 0 }, total: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 4, turns: 20, sideAnswers: 1 } } },
  }),
);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BudgetTab', () => {
  it('shows the reserve, the month against the cap, every plan’s money and usage, and teams today', async () => {
    render(<BudgetTab />);
    expect(screen.getByRole('status').textContent).toMatch(/Sahibinin payı korunuyor/);
    expect(screen.getByText(/5 saat %82/)).toBeTruthy();
    expect(screen.getByText(/\$31.5 \/ \$50/)).toBeTruthy();
    const row = screen.getByRole('row', { name: /Tanıtım videosu/ });
    expect(within(row).getByText('$25 / $20')).toBeTruthy();
    expect(within(row).getByText('~$3.2')).toBeTruthy();
    expect(row.className).toContain('over');
    expect(screen.getByRole('row', { name: /İçerik/ }).textContent).toContain('$1.25');
    expect(screen.getByRole('row', { name: /İçerik/ }).textContent).toContain('7 tur');
    await waitFor(() => expect(api.budget).toHaveBeenCalled());
  });
});

describe('ConstitutionTab', () => {
  it('saves the owner’s own settings and nothing else: the office keeps its models, limits and timings to itself', async () => {
    render(<ConstitutionTab />);
    fireEvent.change(screen.getByLabelText('Sahibinin kota payı (%)'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('Aylık para sınırı (USD)'), { target: { value: '' } });
    const free = screen.getByLabelText('Tam serbest') as HTMLInputElement;
    expect(free.checked).toBe(true);
    fireEvent.click(free);
    fireEvent.click(screen.getByLabelText('Canlıya alma ve birleştirme ofiste'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Kaydet' })));
    const patch = vi.mocked(api.setConstitution).mock.calls[0]![0];
    expect(patch).toMatchObject({ ownerReservePct: 40, monthlyUsdCap: null, autonomy: 'plans', releasePolicy: 'office', gateEnabled: false });
    expect(Object.keys(patch).sort()).toEqual(['autonomy', 'gateEnabled', 'monthlyUsdCap', 'outwardPolicy', 'ownerReservePct', 'releasePolicy', 'specialContacts']);
    expect(screen.getByText('Kaydedildi.')).toBeTruthy();
  });

  it('shows the server’s Turkish error', async () => {
    vi.mocked(api.setConstitution).mockRejectedValueOnce(new Error('Anayasa: Sahibinin kota payı (%) 0 ile 90 arasında bir tam sayı olmalı.'));
    render(<ConstitutionTab />);
    fireEvent.change(screen.getByLabelText('Sahibinin kota payı (%)'), { target: { value: '95' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Kaydet' })));
    expect(screen.getByRole('alert').textContent).toMatch(/0 ile 90/);
  });

  it('important: refuses a money cap that is not a number and an emptied required field, sending nothing', async () => {
    render(<ConstitutionTab />);
    fireEvent.change(screen.getByLabelText('Aylık para sınırı (USD)'), { target: { value: '50 dolar' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Kaydet' })));
    expect(screen.getByRole('alert').textContent).toMatch(/Aylık para sınırı \(USD\): bir sayı girin/);
    fireEvent.change(screen.getByLabelText('Aylık para sınırı (USD)'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Sahibinin kota payı (%)'), { target: { value: '' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Kaydet' })));
    expect(screen.getByRole('alert').textContent).toMatch(/Sahibinin kota payı \(%\): bir sayı girin/);
    expect(api.setConstitution).not.toHaveBeenCalled();
  });

  it('important: keeps what the owner is typing when the budget changes underneath', () => {
    render(<ConstitutionTab />);
    fireEvent.change(screen.getByLabelText('Sahibinin kota payı (%)'), { target: { value: '40' } });
    act(() => useOffice.setState({ budget: summary({ month: { key: '2026-10', usd: 99 } }) }));
    expect((screen.getByLabelText('Sahibinin kota payı (%)') as HTMLInputElement).value).toBe('40');
  });

  it('the office’s own knobs are not on the page: headcount, models, digest, chain, task and routine limits, pulse, quota stop', () => {
    render(<ConstitutionTab />);
    for (const label of ['Çalışan sınırı', 'Özet saatleri', 'Koordinatör modelleri', 'Zorluk modelleri', 'Model politikası açık', 'Paslama zinciri', 'Günlük görev sınırı', 'Nabız aralığı (saat)', 'Haftalık kota durdurma sınırı (%)', 'En fazla rutin', 'Saatlik gönderim sınırı', 'Arama saatleri']) {
      expect(screen.queryByLabelText(label), label).toBeNull();
      expect(screen.queryByText(label), label).toBeNull();
    }
    expect(screen.queryByText(/Gelişmiş ayarlar/)).toBeNull();
  });

  it('spec capabilities §5–§6: the outward policy (four choices), the special contacts (one per line) and the rules', async () => {
    render(<ConstitutionTab />);
    const group = screen.getByRole('group', { name: 'Otonomi politikası' });
    expect(within(group).getAllByRole('combobox').map((s) => s.getAttribute('aria-label'))).toEqual(['Gönderim', 'Yayın', 'Arama', 'Takvim']);
    expect(['Gönderim', 'Yayın', 'Arama', 'Takvim'].map((l) => (screen.getByLabelText(l) as HTMLSelectElement).value)).toEqual(['system', 'system', 'system', 'owner']);
    expect([...(screen.getByLabelText('Takvim') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['Sahibine sor', 'Sistem halletsin']);
    expect(group.textContent).toMatch(/Ödeme, silme, tarayıcı, ofisin kendisi, sınıflandırılmamış araçlar ve komut satırından gönderim her zaman sana gelir/);
    fireEvent.change(screen.getByLabelText('Gönderim'), { target: { value: 'owner' } });
    fireEvent.change(screen.getByLabelText('Özel kişiler'), { target: { value: 'ali@firma.com\n\n +90 532 111 22 33 ' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Kaydet' })));
    expect(api.setConstitution).toHaveBeenCalledWith(expect.objectContaining({
      outwardPolicy: { send: 'owner', publish: 'system', call: 'system', calendar: 'owner' }, specialContacts: ['ali@firma.com', '+90 532 111 22 33'],
    }));
    // The rules under the policy (hours, thresholds) are the office's: not on the page, not in the patch.
    expect(vi.mocked(api.setConstitution).mock.calls[0]![0]).not.toHaveProperty('callHours');
  });

  it('shows what the owner stored: the contacts one per line, the call window as “from, to”, each kind’s decider', () => {
    useOffice.setState({
      budget: summary({ constitution: { ...summary().constitution, outwardPolicy: { send: 'owner', publish: 'owner', call: 'system', calendar: 'system' }, specialContacts: ['ali@firma.com', 'Ahmet Yılmaz'], callHours: [8, 20] } }),
    });
    render(<ConstitutionTab />);
    expect((screen.getByLabelText('Özel kişiler') as HTMLTextAreaElement).value).toBe('ali@firma.com\nAhmet Yılmaz');
    expect(['Gönderim', 'Yayın', 'Arama', 'Takvim'].map((l) => (screen.getByLabelText(l) as HTMLSelectElement).value)).toEqual(['owner', 'owner', 'system', 'system']);
  });

  it('saving without touching the policy keeps the gate as stored (off stays off) and the rules as they are', async () => {
    render(<ConstitutionTab />);
    expect((screen.getByLabelText('Geri alınamaz iş kapısı açık') as HTMLInputElement).checked).toBe(false);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Kaydet' })));
    expect(api.setConstitution).toHaveBeenCalledWith(expect.objectContaining({
      gateEnabled: false, outwardPolicy: { send: 'system', publish: 'system', call: 'system', calendar: 'owner' }, specialContacts: [],
    }));
  });

  it('the policy offers only send, publish, call and calendar, two choices each — pay and delete are never offered, and the form says they are the owner’s', () => {
    render(<ConstitutionTab />);
    const group = screen.getByRole('group', { name: 'Otonomi politikası' });
    expect(within(group).getAllByRole('combobox')).toHaveLength(4);
    for (const s of within(group).getAllByRole('combobox')) expect([...(s as HTMLSelectElement).options].map((o) => o.value)).toEqual(['owner', 'system']);
    expect(within(group).queryByLabelText(/Ödeme|Silme|Tarayıcı/)).toBeNull();
    expect(group.textContent).toMatch(/Ödeme, silme, .* her zaman sana gelir/);
  });

  it('the policy’s choices keep their wording under Codex (they are not models)', () => {
    useOffice.setState({ runtime: { provider: 'codex' } as never });
    render(<ConstitutionTab />);
    expect([...(screen.getByLabelText('Gönderim') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['Sahibine sor', 'Sistem halletsin']);
  });

  it('says what the gate does now that the policy exists, and what a special contact can be', () => {
    render(<ConstitutionTab />);
    const gate = screen.getByLabelText('Geri alınamaz iş kapısı açık').closest('label')!;
    expect(gate.textContent).toMatch(/Açıkken dışa dönük işler Otonomi politikasına göre: sistemce ya da sana/);
    expect(gate.textContent).not.toMatch(/Açıkken yayın, gönderim/);
    expect(gate.textContent).toMatch(/Ödeme, silme.* her zaman senin onayını bekler/);
    const contacts = screen.getByLabelText('Özel kişiler').closest('label')!;
    expect(contacts.textContent).toMatch(/e-posta, telefon numarası, kullanıcı adı, kişinin ya da firmanın adı ya da kişinin aday\/konuşma kimliği/);
    expect(contacts.textContent).toMatch(/adlar bütün bir ifade olarak aranır/);
    expect(contacts.textContent).toMatch(/satır başına bir/i);
    // Final review C1/I4: the gate looks at what the call carries, and only with the gate on; the owner lists the ids too.
    expect(contacts.textContent).toMatch(/Kapı açıkken, girdisinde bunlardan biri geçen çağrı — o kişiye giden ya da onu anan —, politika ne olursa olsun sana gelir/);
    expect(contacts.textContent).toMatch(/Kapı yalnız çağrının girdisine bakar: kimlikle adreslenen bir çağrıda/);
    expect(contacts.textContent).toMatch(/adresini, telefonunu ve kimliklerini birlikte yaz/);
    expect(contacts.textContent).not.toMatch(/her zaman sana gelir|ulaşması gereken kişi/);
  });

});
