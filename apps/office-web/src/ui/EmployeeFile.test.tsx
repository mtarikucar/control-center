import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmployeeFileSection } from './EmployeeFile.tsx';

vi.mock('../net/api.ts', () => ({
  api: {
    employeeFile: vi.fn(async () => ({
      employee: {}, finished: 4, notes: [{ id: 1, ts: 1, employeeId: 'ada', by: 'c', text: 'Testte çok iyi.' }],
      recent: [{ id: 't1', title: 'Rapor', summary: 'Rapor hazır.', finishedAt: 2 }],
    })),
  },
}));
const { api } = await import('../net/api.ts');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('EmployeeFileSection', () => {
  it('loads the file only when opened', async () => {
    render(<EmployeeFileSection id="ada" />);
    expect(api.employeeFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Çalışan dosyası' }));
    expect(await screen.findByText('4 görev bitirdi.')).toBeTruthy();
    expect(screen.getByText(/Testte çok iyi/)).toBeTruthy();
    expect(screen.getByText(/Rapor hazır/)).toBeTruthy();
  });
});
