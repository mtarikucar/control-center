import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BudgetSummary, Employee, PlanView } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { BudgetTab, ConstitutionTab } from './BudgetTabs.tsx';

const summary = (over: Partial<BudgetSummary> = {}): BudgetSummary => ({
  constitution: { maxEmployees: 8, ownerReservePct: 25, monthlyUsdCap: 50, chainDepth: 5, tasksPerDay: 30, openTasksPerPlan: 60, idleSleepMinutes: 30, digestHours: [9, 17],
    coordinatorModels: { kickoff: 'fable', cycle: 'opus', routine: 'sonnet' }, cacheTtlMinutes: 5, difficultyModels: { easy: 'haiku', medium: 'sonnet', hard: 'opus', critical: 'fable' },
    digestEnabled: false, modelPolicyEnabled: false, difficultyModelsEnabled: false, capabilityPrecheckEnabled: false, gateEnabled: false, autonomy: 'free', activeGoals: 10, pulseHours: 6, idleCapacityHours: 2, weeklyStopPct: 90, defaultTaskMinutes: 45, minScheduleMinutes: 60, maxSchedules: 20 },
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
});
