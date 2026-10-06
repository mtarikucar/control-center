import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Employee, Task } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { FireControls } from './FireControls.tsx';

vi.mock('../net/api.ts', () => ({ api: { fire: vi.fn(async (_id: string, now?: boolean) => (now ? null : { handover: {} })), events: vi.fn(async () => []) } }));
const { api } = await import('../net/api.ts');

const ada: Employee = {
  id: 'ada', slug: 'ada', name: 'Ada', role: 'r', model: 'haiku', characterId: 'coder', title: '', team: '', kind: 'member', reportsTo: null, deskIndex: 0,
  sessionId: 's', sessionStarted: true, lifecycle: 'idle', limitResetsAt: null, lastError: null, createdAt: 1,
};
const handover = (status: Task['status']): Task => ({
  id: 'h1', kind: 'handover', planId: null, title: 'Devir', description: '', done: [], requester: 'owner', assignee: 'ada', priority: 1, dependsOn: [],
  status, chainDepth: 0, note: null, result: null, nudged: false, createdAt: 1, startedAt: null, finishedAt: null,
});

beforeEach(() => useOffice.setState({ tasks: {}, selectedId: 'ada' }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('FireControls', () => {
  it('asks whether to hand over first; the hand-over keeps the panel open', async () => {
    render(<FireControls employee={ada} />);
    fireEvent.click(screen.getByRole('button', { name: 'İşten çıkar' }));
    expect(screen.getByRole('dialog', { name: 'Ada işten çıkarılsın mı?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Devir yaptır, sonra çıkar' }));
    await waitFor(() => expect(api.fire).toHaveBeenCalledWith('ada', false));
    expect(useOffice.getState().selectedId).toBe('ada');
  });

  it('fires at once when asked, and closes the panel', async () => {
    render(<FireControls employee={ada} />);
    fireEvent.click(screen.getByRole('button', { name: 'İşten çıkar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hemen çıkar' }));
    await waitFor(() => expect(api.fire).toHaveBeenCalledWith('ada', true));
    await waitFor(() => expect(useOffice.getState().selectedId).toBeNull());
  });

  it('review focus: during a hand-over it says so and still offers to fire at once', async () => {
    useOffice.setState({ tasks: { h1: handover('in_progress') } });
    render(<FireControls employee={ada} />);
    expect(screen.getByRole('status').textContent).toMatch(/Devir yapıyor/);
    expect(screen.queryByRole('button', { name: 'İşten çıkar' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hemen çıkar' }));
    await waitFor(() => expect(api.fire).toHaveBeenCalledWith('ada', true));
  });

  it('a cancelled hand-over is no longer shown', () => {
    useOffice.setState({ tasks: { h1: handover('cancelled') } });
    render(<FireControls employee={ada} />);
    expect(screen.getByRole('button', { name: 'İşten çıkar' })).toBeTruthy();
  });
});
