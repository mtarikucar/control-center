import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '../src/errors.ts';
import { Roster, slugify } from '../src/roster.ts';
import { setup } from './helpers.ts';

describe('slugify', () => {
  it('turns Turkish names into ASCII slugs', () => {
    expect(slugify('Ayşe Çınar')).toBe('ayse-cinar');
    expect(slugify('İLKER Işık')).toBe('ilker-isik');
    expect(slugify('Ada  Lovelace!')).toBe('ada-lovelace');
    expect(slugify('Zoë Ğüler')).toBe('zoe-guler');
  });

  it('falls back when nothing usable is left', () => {
    expect(slugify('!!!')).toBe('calisan');
    expect(slugify('   ')).toBe('calisan');
  });
});

describe('Roster', () => {
  it('creates with defaults and assigns the lowest free desk', () => {
    const { roster } = setup();
    const a = roster.create({ name: 'Ada', role: 'Yazılımcı' });
    const b = roster.create({ name: 'Can', role: 'Tasarımcı', model: 'opus', characterId: 'designer' });
    expect(a).toMatchObject({ slug: 'ada', model: 'sonnet', characterId: 'coder', deskIndex: 0, lifecycle: 'stopped', sessionStarted: false, limitResetsAt: null, lastError: null });
    expect(b).toMatchObject({ model: 'opus', characterId: 'designer', deskIndex: 1 });
    expect(a.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(roster.get(a.id)).toEqual(a);
  });

  it('validates input', () => {
    const { roster } = setup();
    expect(() => roster.create({ name: '', role: 'r' })).toThrow(ValidationError);
    expect(() => roster.create({ name: 'Ada', role: '   ' })).toThrow(ValidationError);
    expect(() => roster.create({ name: 'Ada', role: 'r', model: 'gpt' as never })).toThrow(ValidationError);
    expect(() => roster.create({ name: 42 as never, role: 'r' })).toThrow(ValidationError);
    expect(() => roster.create({ name: 'x'.repeat(61), role: 'r' })).toThrow(ValidationError);
  });

  it('refuses when every desk is taken and frees a desk on archive', () => {
    const { db } = setup();
    const roster = new Roster(db, 2);
    const a = roster.create({ name: 'Ada', role: 'r' });
    roster.create({ name: 'Can', role: 'r' });
    expect(() => roster.create({ name: 'Ece', role: 'r' })).toThrow(ConflictError);
    roster.update(a.id, { lifecycle: 'archived' });
    expect(roster.create({ name: 'Ece', role: 'r' }).deskIndex).toBe(0);
  });

  it('review focus: duplicate names get unique slugs and archived slugs are not reused', () => {
    const { roster } = setup();
    const first = roster.create({ name: 'Ayşe', role: 'r' });
    expect(roster.create({ name: 'AYŞE', role: 'r' }).slug).toBe('ayse-2');
    roster.update(first.id, { lifecycle: 'archived' });
    expect(roster.create({ name: 'Ayşe', role: 'r' }).slug).toBe('ayse-3');
  });

  it('skips slugs whose desk folder is still on disk', () => {
    const { db } = setup();
    const roster = new Roster(db, 8, Date.now, (slug) => slug === 'ada');
    expect(roster.create({ name: 'Ada', role: 'r' }).slug).toBe('ada-2');
  });

  it('updates and persists fields', () => {
    const { roster } = setup();
    const a = roster.create({ name: 'Ada', role: 'r' });
    const updated = roster.update(a.id, { lifecycle: 'limited', sessionStarted: true, limitResetsAt: 123, lastError: 'x' });
    expect(updated).toMatchObject({ lifecycle: 'limited', sessionStarted: true, limitResetsAt: 123, lastError: 'x' });
    expect(roster.get(a.id)).toEqual(updated);
  });

  it('throws NotFoundError for an unknown id', () => {
    const { roster } = setup();
    expect(() => roster.get('00000000-0000-0000-0000-000000000000')).toThrow(NotFoundError);
  });

  it('hides archived employees unless asked', () => {
    const { roster } = setup();
    const a = roster.create({ name: 'Ada', role: 'r' });
    roster.create({ name: 'Can', role: 'r' });
    roster.update(a.id, { lifecycle: 'archived' });
    expect(roster.list().map((e) => e.name)).toEqual(['Can']);
    expect(roster.list({ includeArchived: true }).map((e) => e.name).sort()).toEqual(['Ada', 'Can']);
  });

  it('finds someone at work by id or by name (case and Turkish i insensitive), never someone archived or a name two share', () => {
    const { roster } = setup();
    const ada = roster.create({ name: 'Ada', role: 'r' });
    const ilker = roster.create({ name: 'İlker Işık', role: 'r' });
    roster.create({ name: 'Can', role: 'r' });
    roster.create({ name: 'can', role: 'r' });
    expect(roster.byIdOrName(ada.id)?.id).toBe(ada.id);
    expect(roster.byIdOrName('  ada ')?.id).toBe(ada.id);
    expect(roster.byIdOrName('ilker ışık')?.id).toBe(ilker.id);
    expect(roster.byIdOrName('Can')).toBeNull();
    expect(roster.byIdOrName('kimse')).toBeNull();
    roster.update(ada.id, { lifecycle: 'archived' });
    expect(roster.byIdOrName(ada.id)).toBeNull();
    expect(roster.byIdOrName('Ada')).toBeNull();
  });
});

describe('Roster — company fields', () => {
  it('stores title, team, kind and who someone reports to, with member defaults', () => {
    const s = setup();
    const lead = s.roster.create({ name: 'Ada', role: 'r', title: 'Koordinatör', team: 'Yönetim', kind: 'coordinator' });
    const dev = s.roster.create({ name: 'Can', role: 'r', reportsTo: lead.id });
    expect(s.roster.get(lead.id)).toMatchObject({ title: 'Koordinatör', team: 'Yönetim', kind: 'coordinator', reportsTo: null });
    expect(s.roster.get(dev.id)).toMatchObject({ title: '', team: '', kind: 'member', reportsTo: lead.id });
    s.cleanup();
  });

  it('refuses an unknown kind and over-long titles', () => {
    const s = setup();
    expect(() => s.roster.create({ name: 'Ada', role: 'r', kind: 'boss' as never })).toThrow(/Bilinmeyen çalışan türü/);
    expect(() => s.roster.create({ name: 'Ada', role: 'r', title: 'x'.repeat(81) })).toThrow(/Unvan/);
    s.cleanup();
  });

  it('updates the role card fields', () => {
    const s = setup();
    const e = s.roster.create({ name: 'Ada', role: 'eski rol' });
    const next = s.roster.update(e.id, { role: 'yeni rol', title: 'Testçi', team: 'Kalite', kind: 'lead', reportsTo: null });
    expect(next).toMatchObject({ role: 'yeni rol', title: 'Testçi', team: 'Kalite', kind: 'lead' });
    expect(s.roster.get(e.id)).toMatchObject({ role: 'yeni rol', title: 'Testçi', team: 'Kalite', kind: 'lead' });
    s.cleanup();
  });
  it('changes the model', () => {
    const s = setup();
    const e = s.roster.create({ name: 'Ada', role: 'r', model: 'haiku' });
    expect(s.roster.update(e.id, { model: 'opus' }).model).toBe('opus');
    expect(s.roster.get(e.id).model).toBe('opus');
    s.cleanup();
  });
});
