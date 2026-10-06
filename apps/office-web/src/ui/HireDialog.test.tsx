import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOffice } from '../store/office.ts';
import { HireDialog } from './HireDialog.tsx';

vi.mock('../net/api.ts', () => ({
  api: {
    hire: vi.fn(async () => ({
      id: 'new-id', slug: 'ece', name: 'Ece', role: 'r', model: 'opus', characterId: 'designer', deskIndex: 1, sessionId: 's-new',
      sessionStarted: false, lifecycle: 'idle', limitResetsAt: null, lastError: null, createdAt: 1,
    })),
    events: vi.fn(async () => []),
  },
}));
const { api } = await import('../net/api.ts');

beforeEach(() => {
  useOffice.setState({
    hireOpen: true,
    selectedId: null,
    manifest: { items: [{ id: 'designer', kind: 'character', name: 'Tasarımcı', file: 'c/base.glb', height: 1.7, clips: {} }] },
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('HireDialog', () => {
  it('hires with the chosen model and character, then selects the new employee', async () => {
    render(<HireDialog />);
    fireEvent.change(screen.getByLabelText('Ad'), { target: { value: 'Ece' } });
    fireEvent.change(screen.getByLabelText('Rol tanımı'), { target: { value: 'Arayüz tasarımcısı' } });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'opus' } });
    fireEvent.change(screen.getByLabelText('Karakter'), { target: { value: 'designer' } });
    fireEvent.click(screen.getByRole('button', { name: 'İşe al' }));
    await waitFor(() => expect(api.hire).toHaveBeenCalledWith({ name: 'Ece', role: 'Arayüz tasarımcısı', model: 'opus', characterId: 'designer' }));
    await waitFor(() => expect(useOffice.getState().hireOpen).toBe(false));
    expect(useOffice.getState().selectedId).toBe('new-id');
    // The panel must find the new employee at once, not say "not found" until the next snapshot.
    expect(useOffice.getState().views['new-id']?.employee.name).toBe('Ece');
  });

  it('keeps the dialog open and shows why when hiring fails', async () => {
    vi.mocked(api.hire).mockRejectedValueOnce(new Error('Ofis dolu: 8 masanın hepsi dolu.'));
    render(<HireDialog />);
    fireEvent.change(screen.getByLabelText('Ad'), { target: { value: 'Ece' } });
    fireEvent.change(screen.getByLabelText('Rol tanımı'), { target: { value: 'r' } });
    fireEvent.click(screen.getByRole('button', { name: 'İşe al' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Ofis dolu: 8 masanın hepsi dolu.');
    expect(useOffice.getState().hireOpen).toBe(true);
  });

  it('hires a voxel figure when that is the choice, instead of falling back to a model', async () => {
    render(<HireDialog />);
    fireEvent.change(screen.getByLabelText('Ad'), { target: { value: 'Ece' } });
    fireEvent.change(screen.getByLabelText('Rol tanımı'), { target: { value: 'r' } });
    fireEvent.change(screen.getByLabelText('Karakter'), { target: { value: 'voxel' } });
    fireEvent.click(screen.getByRole('button', { name: 'İşe al' }));
    await waitFor(() => expect(api.hire).toHaveBeenCalledWith(expect.objectContaining({ characterId: 'voxel' })));
  });

  it('hires a voxel figure when there are no models at all', async () => {
    useOffice.setState({ manifest: { items: [] } });
    render(<HireDialog />);
    fireEvent.change(screen.getByLabelText('Ad'), { target: { value: 'Ece' } });
    fireEvent.change(screen.getByLabelText('Rol tanımı'), { target: { value: 'r' } });
    fireEvent.click(screen.getByRole('button', { name: 'İşe al' }));
    await waitFor(() => expect(api.hire).toHaveBeenCalledWith(expect.objectContaining({ characterId: 'voxel' })));
  });

  it('offers Fable, Opus, Sonnet and Haiku by what they are good at', () => {
    render(<HireDialog />);
    const options = [...(screen.getByLabelText('Model') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options).toEqual(['Fable — en güçlü', 'Opus — güçlü', 'Sonnet — dengeli', 'Haiku — hızlı ve ucuz']);
  });
});
