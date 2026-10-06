import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Task } from '@cc/shared';
import { archiveTask } from '../src/company/archive.ts';
import { tempDir } from './helpers.ts';

const task = (over: Partial<Task> = {}): Task => ({
  id: 'a1b2c3d4-0000-0000-0000-000000000000', kind: 'work', planId: null, title: 'Tanıtım metni', description: '', done: [], requester: 'owner',
  assignee: 'e1', priority: 3, dependsOn: [], status: 'in_progress', chainDepth: 0, note: null, result: null, nudged: false, createdAt: 1,
  startedAt: 1, finishedAt: null, ...over,
});

describe('archiveTask', () => {
  it('copies the outputs into company/archive/<plan>/<date>-<id>-<title>/ and writes teslim.md', () => {
    const dataDir = tempDir();
    const desk = join(dataDir, 'desks', 'ada');
    mkdirSync(join(desk, 'out'), { recursive: true });
    writeFileSync(join(desk, 'metin.md'), 'merhaba');
    writeFileSync(join(desk, 'out', 'a.txt'), 'a');
    const dir = archiveTask({ dataDir, desk, task: task(), result: { summary: 'Metin hazır.', outputs: ['metin.md', 'out'], learned: 'Kısa cümleler iyi.' }, planTitle: 'Lansman Planı', by: 'Ada', now: Date.UTC(2026, 9, 6) });
    expect(dir).toBe(join(dataDir, 'company', 'archive', 'lansman-plani', '2026-10-06-a1b2c3d4-tanitim-metni'));
    expect(readFileSync(join(dir, 'metin.md'), 'utf8')).toBe('merhaba');
    expect(readFileSync(join(dir, 'out', 'a.txt'), 'utf8')).toBe('a');
    const teslim = readFileSync(join(dir, 'teslim.md'), 'utf8');
    expect(teslim).toContain('# Tanıtım metni');
    expect(teslim).toContain('Metin hazır.');
    expect(teslim).toContain('Kısa cümleler iyi.');
    expect(teslim).toContain('metin.md → metin.md');
  });

  it('review focus: missing, outside-the-desk, too big and same-named outputs still give an archive that says what happened', () => {
    const dataDir = tempDir();
    const desk = join(dataDir, 'desks', 'ada');
    const elsewhere = tempDir();
    mkdirSync(join(desk, 'b'), { recursive: true });
    writeFileSync(join(desk, 'rapor.md'), 'r1');
    writeFileSync(join(desk, 'b', 'rapor.md'), 'r2');
    writeFileSync(join(elsewhere, 'dis.txt'), 'dış');
    writeFileSync(join(desk, 'buyuk.bin'), Buffer.alloc(2048));
    const dir = archiveTask({
      dataDir, desk, task: task(), planTitle: null, by: 'Ada', now: 0, limitBytes: 1024,
      result: { summary: 's', outputs: ['rapor.md', 'b/rapor.md', join(elsewhere, 'dis.txt'), 'yok.md', 'buyuk.bin', dataDir], learned: '' },
    });
    expect(dir).toContain(join('archive', 'plansiz'));
    expect(readFileSync(join(dir, 'rapor.md'), 'utf8')).toBe('r1');
    expect(readFileSync(join(dir, '2-rapor.md'), 'utf8')).toBe('r2');
    expect(readFileSync(join(dir, 'dis.txt'), 'utf8')).toBe('dış');
    expect(existsSync(join(dir, 'buyuk.bin'))).toBe(false);
    const teslim = readFileSync(join(dir, 'teslim.md'), 'utf8');
    expect(teslim).toContain('yok.md — bulunamadı');
    expect(teslim).toContain('buyuk.bin — arşive sığmadı');
    expect(teslim).toMatch(/kopyalanamadı|arşive sığmadı/);
  });


  it('important: never copies a device or pipe (it would never end), and says so', () => {
    const dataDir = tempDir();
    const desk = join(dataDir, 'desks', 'ada');
    mkdirSync(desk, { recursive: true });
    const started = Date.now();
    const dir = archiveTask({ dataDir, desk, task: task(), planTitle: null, by: 'Ada', now: 0, result: { summary: 's', outputs: ['/dev/zero'], learned: '' } });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(readFileSync(join(dir, 'teslim.md'), 'utf8')).toContain('/dev/zero — dosya ya da klasör değil');
    expect(existsSync(join(dir, 'zero'))).toBe(false);
  });
});
