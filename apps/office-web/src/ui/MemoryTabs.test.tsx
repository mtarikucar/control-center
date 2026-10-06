import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Decision } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { DecisionsTab, NotesTab, PlaybookTab } from './MemoryTabs.tsx';

const decision = (over: Partial<Decision> = {}): Decision => ({ id: 'd1', ts: 1, by: 'c', title: 'Ses aracı', chosen: 'ElevenLabs', reason: 'Türkçe iyi', alternatives: ['Polly'], planId: null, reverts: null, ...over });

vi.mock('../net/api.ts', () => ({
  api: {
    decisions: vi.fn(async () => [decision({ id: 'd2', title: 'Kurgu', chosen: 'CapCut', reason: 'hızlı', alternatives: [] }), decision()]),
    revertDecision: vi.fn(async () => ({})),
    playbook: vi.fn(async () => [
      { topic: 'Sürüm', version: 1, text: 'Etiketle ve yayınla.', by: 'c', reason: '', ts: 1 },
      { topic: 'Test', version: 3, text: 'Birim, sonra uçtan uca.', by: 'c', reason: 'e2e', ts: 2 },
    ]),
    playbookHistory: vi.fn(async () => [
      { topic: 'Sürüm', version: 1, text: 'Etiketle ve yayınla.', by: 'c', reason: '', ts: 1 },
    ]),
    notes: vi.fn(async (q: string) => (q ? [{ note: { id: 1, ts: 1, by: 'c', title: 'Seslendirme', text: 'uzun metin', tags: ['ses'], source: null }, snippet: '…ElevenLabs…' }] : [])),
  },
}));
const { api } = await import('../net/api.ts');

beforeEach(() => useOffice.setState({ memoryRev: 0, views: {}, plans: {} }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DecisionsTab', () => {
  it('lists decisions with their reason and alternatives, and lets the owner revert one', async () => {
    render(<DecisionsTab />);
    expect(await screen.findByText('Ses aracı')).toBeTruthy();
    expect(screen.getByText(/Türkçe iyi/)).toBeTruthy();
    expect(screen.getByText(/Polly/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Geri al' })[1]!);
    await waitFor(() => expect(api.revertDecision).toHaveBeenCalledWith('d1'));
  });

  it('marks a reverted decision and offers no second revert', async () => {
    vi.mocked(api.decisions).mockResolvedValueOnce([decision({ id: 'r1', by: 'owner', title: 'Geri alındı: Ses aracı', chosen: 'Geri alındı', reverts: 'd1' }), decision()]);
    render(<DecisionsTab />);
    expect(await screen.findByText('Geri alındı', { selector: '.badge' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Geri al' })).toBeNull();
  });

  it('reloads when the memory changes', async () => {
    render(<DecisionsTab />);
    await screen.findByText('Ses aracı');
    useOffice.setState({ memoryRev: 1 });
    await waitFor(() => expect(api.decisions).toHaveBeenCalledTimes(2));
  });
});

describe('PlaybookTab', () => {
  it('shows the first topic, switches topics, and shows older versions on demand', async () => {
    render(<PlaybookTab />);
    expect(await screen.findByText('Etiketle ve yayınla.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(screen.getByText('Birim, sonra uçtan uca.')).toBeTruthy();
    expect(screen.getByText(/sürüm 3/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sürüm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Önceki sürümler' }));
    await waitFor(() => expect(api.playbookHistory).toHaveBeenCalledWith('Sürüm'));
  });
});

describe('NotesTab', () => {
  it('searches the notes as the owner types', async () => {
    render(<NotesTab />);
    expect(await screen.findByText(/Henüz not yok/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Notlarda ara'), { target: { value: 'eleven' } });
    expect(await screen.findByText('Seslendirme')).toBeTruthy();
    expect(screen.getByText('…ElevenLabs…')).toBeTruthy();
    expect(api.notes).toHaveBeenLastCalledWith('eleven');
  });
});
