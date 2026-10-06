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
});
