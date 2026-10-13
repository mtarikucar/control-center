import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOffice } from '../store/office.ts';
import { DepartmentsTab } from './DepartmentsTab.tsx';

vi.mock('../net/api.ts', () => ({
  api: {
    departmentTemplates: vi.fn(async () => [
      { id: 'pazarlama', version: 1, name: 'Pazarlama', mission: 'Şirketi duyurur.', head: 'pazarlama-muduru', roles: [{ template: 'icerik-yazari', when: 'Hacim artınca.' }], methods: ['content'], routines: [], checks: ['x'], kpis: ['y'], body: '### Yapar' },
    ]),
    createDepartment: vi.fn(async (input: object) => ({ id: 'd9', name: 'Pazarlama', mission: 'Şirketi duyurur.', scope: '', template: { id: 'pazarlama', version: 1 }, headId: null, status: 'open', createdAt: 1, closedAt: null, ...input })),
    updateDepartment: vi.fn(async () => ({})),
    closeDepartment: vi.fn(async () => ({})),
    moveEmployee: vi.fn(async () => ({})),
  },
}));
const { api } = await import('../net/api.ts');

const dep = (id: string, name: string, headId: string | null = null) => ({ id, name, mission: `${name} misyonu`, scope: '### Yapmaz\n\n- Başka iş.', template: null, headId, status: 'open' as const, createdAt: 1, closedAt: null });
const person = (id: string, name: string, departmentId?: string, kind: 'member' | 'lead' | 'coordinator' = 'member') => ({
  id, slug: id, name, role: 'r', model: 'sonnet', characterId: 'coder', title: '', team: '', kind, reportsTo: null, deskIndex: 0, sessionId: 's', sessionStarted: false, lifecycle: 'idle', limitResetsAt: null, lastError: null, createdAt: 1, ...(departmentId ? { departmentId } : {}),
});

function seed(departments: ReturnType<typeof dep>[], people: ReturnType<typeof person>[]) {
  useOffice.setState({
    departments: Object.fromEntries(departments.map((x) => [x.id, x])),
    views: Object.fromEntries(people.map((p) => [p.id, { employee: p } as never])),
  } as never);
}

beforeEach(() => seed([dep('d1', 'Yazılım', 'e1')], [person('e1', 'Selin', 'd1', 'lead'), person('e2', 'Deniz'), person('c', 'Koordinatör', undefined, 'coordinator')]));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DepartmentsTab', () => {
  it('lists open departments with their head and size', () => {
    render(<DepartmentsTab />);
    const card = screen.getByRole('region', { name: 'Yazılım' });
    expect(card.textContent).toMatch(/Başkan: Selin/);
    expect(card.textContent).toMatch(/1 kişi/);
  });

  it('opens a department from a template', async () => {
    render(<DepartmentsTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Departman aç' }));
    fireEvent.click(await screen.findByRole('radio', { name: /Pazarlama/ }));
    fireEvent.change(screen.getByLabelText('Başkan'), { target: { value: 'e2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aç' }));
    await waitFor(() => expect(api.createDepartment).toHaveBeenCalledWith({ template: 'pazarlama', headId: 'e2' }));
  });

  it('opens a custom department with a name and a mission', async () => {
    render(<DepartmentsTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Departman aç' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Özel departman' }));
    fireEvent.change(screen.getByLabelText('Ad'), { target: { value: 'Keşif' } });
    fireEvent.change(screen.getByLabelText('Misyon'), { target: { value: 'Araştırır.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aç' }));
    await waitFor(() => expect(api.createDepartment).toHaveBeenCalledWith({ name: 'Keşif', mission: 'Araştırır.', scope: '' }));
  });

  it('cannot open a seventh; says why', () => {
    seed(['a', 'b', 'c', 'd', 'e', 'f'].map((x) => dep(x, x.toUpperCase())), []);
    render(<DepartmentsTab />);
    const button = screen.getByRole('button', { name: 'Departman aç' });
    expect(button).toHaveProperty('disabled', true);
    expect(screen.getByText(/En fazla 6 departman açık olabilir/)).toBeTruthy();
  });

  it('names a head, adds a member, closes with a reason', async () => {
    render(<DepartmentsTab />);
    const card = screen.getByRole('region', { name: 'Yazılım' });
    fireEvent.click(card.querySelector('button[data-action="details"]')!);
    fireEvent.change(screen.getByLabelText('Kişi ekle'), { target: { value: 'e2' } });
    await waitFor(() => expect(api.moveEmployee).toHaveBeenCalledWith('e2', 'd1'));
    fireEvent.change(screen.getByLabelText('Başkanı değiştir'), { target: { value: '' } });
    await waitFor(() => expect(api.updateDepartment).toHaveBeenCalledWith('d1', { headId: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Kapat…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Departmanı kapat' }));
    expect(api.closeDepartment).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Gerekçe'), { target: { value: 'iş bitti' } });
    fireEvent.click(screen.getByRole('button', { name: 'Departmanı kapat' }));
    await waitFor(() => expect(api.closeDepartment).toHaveBeenCalledWith('d1', 'iş bitti'));
  });
});
