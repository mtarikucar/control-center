import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BudgetSummary, Employee, PlanView } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { BudgetTab, ConstitutionTab } from './BudgetTabs.tsx';

const summary = (over: Partial<BudgetSummary> = {}): BudgetSummary => ({
  constitution: { maxEmployees: 8, ownerReservePct: 25, monthlyUsdCap: 50, chainDepth: 5, tasksPerDay: 30, openTasksPerPlan: 60, idleSleepMinutes: 30, digestHours: [9, 17],
    coordinatorModels: { kickoff: 'fable', cycle: 'opus', routine: 'sonnet' }, cacheTtlMinutes: 5, difficultyModels: { easy: 'haiku', medium: 'sonnet', hard: 'opus', critical: 'fable' },
    digestEnabled: false, modelPolicyEnabled: false, difficultyModelsEnabled: false, capabilityPrecheckEnabled: false, gateEnabled: false, autonomy: 'free', activeGoals: 10, pulseHours: 6, idleCapacityHours: 2, weeklyStopPct: 90, defaultTaskMinutes: 45, minScheduleMinutes: 60, maxSchedules: 20, outwardPolicy: { send: 'system', publish: 'system', call: 'system', calendar: 'owner' }, specialContacts: [], sendsPerHour: 30, bulkRecipients: 5, callHours: [9, 19], callsPerDay: 20 },
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
  it('saves the owner’s limits, an empty money cap meaning none', async () => {
    render(<ConstitutionTab />);
    fireEvent.change(screen.getByLabelText('Sahibinin kota payı (%)'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('Aylık para sınırı (USD)'), { target: { value: '' } });
    expect((screen.getByLabelText('Özet saatleri') as HTMLInputElement).value).toBe('9, 17');
    fireEvent.change(screen.getByLabelText('Özet saatleri'), { target: { value: '8, 13 18' } });
    expect(screen.getByRole('group', { name: 'Koordinatör modelleri' })).toBeTruthy();
    expect(['Başlangıç', 'Yönetim turu', 'Sıradan'].map((l) => (screen.getByLabelText(l) as HTMLSelectElement).value)).toEqual(['fable', 'opus', 'sonnet']);
    fireEvent.change(screen.getByLabelText('Sıradan'), { target: { value: 'haiku' } });
    // R9: the switches come off; the owner turns one on.
    expect((screen.getByLabelText('Model politikası açık') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByLabelText('Model politikası açık'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Kaydet' })));
    expect(api.setConstitution).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerReservePct: 40, monthlyUsdCap: null, maxEmployees: 8, digestHours: [8, 13, 18], cacheTtlMinutes: 5,
        coordinatorModels: { kickoff: 'fable', cycle: 'opus', routine: 'haiku' }, difficultyModels: { easy: 'haiku', medium: 'sonnet', hard: 'opus', critical: 'fable' },
        digestEnabled: false, modelPolicyEnabled: true, difficultyModelsEnabled: false,
      }),
    );
    expect(screen.getByText('Kaydedildi.')).toBeTruthy();
  });

  it('the coordinator’s models by turn type: three selects of the models, with what each turn is', () => {
    render(<ConstitutionTab />);
    const group = screen.getByRole('group', { name: 'Koordinatör modelleri' });
    expect(within(group).getAllByRole('combobox').map((s) => s.getAttribute('aria-label'))).toEqual(['Başlangıç', 'Yönetim turu', 'Sıradan']);
    expect(within(group).getAllByRole('option', { name: 'fable' })).toHaveLength(3);
    expect([...(screen.getByLabelText('Başlangıç') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['fable', 'opus', 'sonnet', 'haiku']);
    expect(group.textContent).toMatch(/Başlangıç: süren plan yokken senin mesajın; aktif hedef yokken ya da hiçbir hedefin süren planı yokken gelen yönetim turu\./);
    expect(group.textContent).toMatch(/model politikası kapalıyken de/);
  });

  it('shows the server’s Turkish error', async () => {
    vi.mocked(api.setConstitution).mockRejectedValueOnce(new Error('Anayasa: Çalışan sınırı 1 ile 8 arasında bir tam sayı olmalı.'));
    render(<ConstitutionTab />);
    fireEvent.change(screen.getByLabelText('Çalışan sınırı'), { target: { value: '12' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Kaydet' })));
    expect(screen.getByRole('alert').textContent).toMatch(/1 ile 8/);
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
    fireEvent.change(screen.getByLabelText('Sahibinin kota payı (%)'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('Özet saatleri'), { target: { value: '9, akşam' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Kaydet' })));
    expect(screen.getByRole('alert').textContent).toMatch(/Özet saatleri: virgülle ayrılmış tam saatler/);
    fireEvent.change(screen.getByLabelText('Özet saatleri'), { target: { value: '9, 17' } });
    fireEvent.change(screen.getByLabelText('Zorluk modelleri'), { target: { value: 'haiku / sonnet' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Kaydet' })));
    expect(screen.getByRole('alert').textContent).toMatch(/Zorluk modelleri: “\/” ile ayrılmış 4 model/);
    expect(api.setConstitution).not.toHaveBeenCalled();
  });

  it('important: keeps what the owner is typing when the budget changes underneath', () => {
    render(<ConstitutionTab />);
    fireEvent.change(screen.getByLabelText('Sahibinin kota payı (%)'), { target: { value: '40' } });
    act(() => useOffice.setState({ budget: summary({ month: { key: '2026-10', usd: 99 } }) }));
    expect((screen.getByLabelText('Sahibinin kota payı (%)') as HTMLInputElement).value).toBe('40');
  });

  it('edits autonomy, the active-goal limit and the pulse interval', async () => {
    render(<ConstitutionTab />);
    const free = screen.getByLabelText('Tam serbest') as HTMLInputElement;
    expect(free.checked).toBe(true);
    fireEvent.click(free);
    fireEvent.change(screen.getByLabelText('En fazla aktif hedef'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Nabız aralığı (saat)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(api.setConstitution).toHaveBeenCalledWith(expect.objectContaining({ autonomy: 'plans', activeGoals: 4, pulseHours: 0 })));
  });

  it('edits the scheduler keys', async () => {
    render(<ConstitutionTab />);
    fireEvent.change(screen.getByLabelText('Varsayılan görev süresi (dk)'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Rutin aralığı en az (dk)'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('En fazla rutin'), { target: { value: '5' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Kaydet' })));
    expect(api.setConstitution).toHaveBeenCalledWith(expect.objectContaining({ defaultTaskMinutes: 30, minScheduleMinutes: 120, maxSchedules: 5 }));
  });

  it('says what the pulse interval and the idle-capacity hours do under the management cycle', () => {
    render(<ConstitutionTab />);
    expect(screen.getByText('Hiç hedef ve iş yokken koordinatöre bu aralıkla yönetim turu açılır (dinlenirken açılmaz, dinlenme bitince bir tur açılır); 0 = hiç.')).toBeTruthy();
    expect(screen.getByText('Bu kadar saattir işi olmayan çalışanlar yönetim panosunda “uzun süredir” diye işaretlenir; 0 = hiç.')).toBeTruthy();
    expect(screen.queryByText(/en çok bu sıklıkla hatırlatılır|her boşlukta bir kez/)).toBeNull();
  });

  it('edits the weekly stop line (the owner’s weekly quota line; 0 = off)', async () => {
    render(<ConstitutionTab />);
    const field = screen.getByLabelText('Haftalık kota durdurma sınırı (%)') as HTMLInputElement;
    expect(field.value).toBe('90');
    expect(screen.getByText('Hesabın 7 günlük Claude kotası bu yüzdeye ulaşınca ofis kendini duraklatır (o hafta bir kez); sürdürmek sizde. 0 = kapalı.')).toBeTruthy();
    fireEvent.change(field, { target: { value: '85' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Kaydet' })));
    expect(api.setConstitution).toHaveBeenCalledWith(expect.objectContaining({ weeklyStopPct: 85 }));
  });

  it('edits the idle-capacity warning hours', async () => {
    render(<ConstitutionTab />);
    const field = screen.getByLabelText('Boşta kapasite uyarısı (saat)') as HTMLInputElement;
    expect(field.value).toBe('2');
    fireEvent.change(field, { target: { value: '4' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Kaydet' })));
    expect(api.setConstitution).toHaveBeenCalledWith(expect.objectContaining({ idleCapacityHours: 4, pulseHours: 6 }));
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
    fireEvent.change(screen.getByLabelText('Arama saatleri'), { target: { value: '10, 18' } });
    fireEvent.change(screen.getByLabelText('Toplu gönderim eşiği (alıcı)'), { target: { value: '3' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Kaydet' })));
    expect(api.setConstitution).toHaveBeenCalledWith(expect.objectContaining({
      outwardPolicy: { send: 'owner', publish: 'system', call: 'system', calendar: 'owner' }, specialContacts: ['ali@firma.com', '+90 532 111 22 33'],
      callHours: [10, 18], bulkRecipients: 3, sendsPerHour: 30, callsPerDay: 20,
    }));
  });

  it('refuses call hours that are not two whole hours, sending nothing', async () => {
    render(<ConstitutionTab />);
    fireEvent.change(screen.getByLabelText('Arama saatleri'), { target: { value: '9' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Kaydet' })));
    expect(screen.getByRole('alert').textContent).toMatch(/Arama saatleri: iki tam saat girin/);
    expect(api.setConstitution).not.toHaveBeenCalled();
  });

  it('call hours: three hours, a fraction or a word are refused too; a dash or a space between the two reads', async () => {
    render(<ConstitutionTab />);
    // A leading dash is a minus sign, not a separator: “-9, 19” is not the window 9–19.
    for (const bad of ['9, 12, 19', '9, 19.5', '9, akşam', '', '-9, 19', ' –9 19', '-9-19']) {
      fireEvent.change(screen.getByLabelText('Arama saatleri'), { target: { value: bad } });
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Kaydet' })));
      expect(screen.getByRole('alert').textContent).toMatch(/Arama saatleri: iki tam saat girin/);
    }
    expect(api.setConstitution).not.toHaveBeenCalled();
    for (const [typed, hours] of [['8-17', [8, 17]], ['8 – 17', [8, 17]], ['0 24', [0, 24]]] as const) {
      vi.mocked(api.setConstitution).mockClear();
      fireEvent.change(screen.getByLabelText('Arama saatleri'), { target: { value: typed } });
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Kaydet' })));
      expect(api.setConstitution).toHaveBeenCalledWith(expect.objectContaining({ callHours: hours }));
    }
  });

  it('shows what the owner stored: the contacts one per line, the call window as “from, to”, each kind’s decider', () => {
    useOffice.setState({
      budget: summary({ constitution: { ...summary().constitution, outwardPolicy: { send: 'owner', publish: 'owner', call: 'system', calendar: 'system' }, specialContacts: ['ali@firma.com', 'Ahmet Yılmaz'], callHours: [8, 20] } }),
    });
    render(<ConstitutionTab />);
    expect((screen.getByLabelText('Özel kişiler') as HTMLTextAreaElement).value).toBe('ali@firma.com\nAhmet Yılmaz');
    expect((screen.getByLabelText('Arama saatleri') as HTMLInputElement).value).toBe('8, 20');
    expect(['Gönderim', 'Yayın', 'Arama', 'Takvim'].map((l) => (screen.getByLabelText(l) as HTMLSelectElement).value)).toEqual(['owner', 'owner', 'system', 'system']);
  });

  it('saving without touching the policy keeps the gate as stored (off stays off) and the rules as they are', async () => {
    render(<ConstitutionTab />);
    expect((screen.getByLabelText('Geri alınamaz iş kapısı açık') as HTMLInputElement).checked).toBe(false);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Kaydet' })));
    expect(api.setConstitution).toHaveBeenCalledWith(expect.objectContaining({
      gateEnabled: false, outwardPolicy: { send: 'system', publish: 'system', call: 'system', calendar: 'owner' }, specialContacts: [], callHours: [9, 19],
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

  it('task 11: a test starts without the provider an earlier one set (the Codex test above leaves none behind)', () => {
    expect(useOffice.getState().runtime).toBeUndefined();
    render(<ConstitutionTab />);
    expect(screen.getByLabelText('Önbellek süresi (dk)').closest('label')!.textContent).toMatch(/Claude Code önbelleği yine bir saat tutar/);
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

  it('task 11: the rules’ hints say what 0 does — no sends, no calls', () => {
    render(<ConstitutionTab />);
    expect(screen.getByLabelText('Saatlik gönderim sınırı').closest('label')!.textContent).toMatch(/0 = sistem hiç göndermez/);
    expect(screen.getByLabelText('Günlük arama sınırı').closest('label')!.textContent).toMatch(/0 = sistem hiç aramaz/);
  });
});
