import { describe, expect, it } from 'vitest';
import { streamStatus, type Employee, type TaskStatus } from '@cc/shared';
import { checkStreams } from '../src/company/streams.ts';

const ada = { id: 'e-ada', name: 'Ada', lifecycle: 'idle' } as Employee;
const can = { id: 'e-can', name: 'Can', lifecycle: 'idle' } as Employee;
const eda = { id: 'e-eda', name: 'Eda', lifecycle: 'archived' } as Employee;
/** The office's lookup: by id or by name; someone let go only by id (as the company gives them); null for no one. */
const person = (who: string): Employee | null =>
  [ada, can].find((e) => e.id === who || e.name.toLocaleLowerCase('tr') === who.toLocaleLowerCase('tr').trim()) ?? (who === eda.id ? eda : null);
const check = (value: unknown) => checkStreams(value, person);

describe('stream status (derived from its tasks, never stored)', () => {
  const of = (...statuses: TaskStatus[]) => streamStatus(statuses.map((status) => ({ status })));

  it('planned with no tasks, only waiting and parked ones, or only cancelled ones', () => {
    expect(of()).toBe('planned');
    expect(of('waiting', 'parked')).toBe('planned');
    expect(of('cancelled')).toBe('planned');
    expect(of('cancelled', 'waiting')).toBe('planned');
  });

  it('done when every task is closed and at least one is done', () => {
    expect(of('done')).toBe('done');
    expect(of('done', 'cancelled')).toBe('done');
  });

  it('blocked when any task is blocked, before active', () => {
    expect(of('blocked')).toBe('blocked');
    expect(of('in_progress', 'blocked', 'done')).toBe('blocked');
  });

  it('active when work started and some is still open: a task done, in progress or in review', () => {
    expect(of('waiting', 'in_progress')).toBe('active');
    expect(of('done', 'review')).toBe('active');
    expect(of('done', 'waiting')).toBe('active');
    expect(of('done', 'parked', 'cancelled')).toBe('active');
  });
});

describe('checkStreams', () => {
  it('keeps id, title, owner and dependencies; an owner named by name is stored by id; “alınacak: <rol>” stays text', () => {
    expect(
      check([
        { id: 'api', title: ' API ', owner: 'ada', dependsOn: [] },
        { id: 'ui-v2', title: 'Arayüz', owner: '  Alınacak:   tasarımcı ', dependsOn: ['api'] },
        { id: 'test', title: 'Test', owner: can.id },
      ]),
    ).toEqual([
      { id: 'api', title: 'API', owner: ada.id, dependsOn: [] },
      { id: 'ui-v2', title: 'Arayüz', owner: 'alınacak: tasarımcı', dependsOn: ['api'] },
      { id: 'test', title: 'Test', owner: can.id, dependsOn: [] },
    ]);
    expect(check(undefined)).toEqual([]);
    expect(check([])).toEqual([]);
    expect(check([{ id: 'a', title: 'A', owner: 'ALINACAK: yazar' }])[0]!.owner).toBe('alınacak: yazar');
  });

  it('refuses a list that is not one, and a stream that is not an object', () => {
    expect(() => check('api')).toThrow(/Akışlar \(streams\) bir liste olmalı/);
    expect(() => check(['api'])).toThrow(/Her akış bir nesne olmalı/);
  });

  it('refuses an id that is not a short lowercase slug, and two streams with one id', () => {
    for (const id of ['', 'API', 'ön-yüz', 'a b', '-a', 'a-', 'x'.repeat(33), 7]) expect(() => check([{ id, title: 'T', owner: 'Ada' }])).toThrow(/Akış kimliği/);
    expect(() => check([{ id: 'api', title: 'A', owner: 'Ada' }, { id: 'api', title: 'B', owner: 'Can' }])).toThrow(/Aynı kimlikle iki akış var: “api”/);
  });

  it('refuses an empty title', () => {
    expect(() => check([{ id: 'api', title: ' ', owner: 'Ada' }])).toThrow(/“api” akışının başlığı boş olamaz/);
  });

  it('refuses a missing owner, someone not in the office and a role to hire with no role', () => {
    expect(() => check([{ id: 'api', title: 'API' }])).toThrow(/“api” akışının sahibi \(owner\) boş olamaz/);
    expect(() => check([{ id: 'api', title: 'API', owner: 'Zeynep' }])).toThrow(/“api” akışının sahibi bulunamadı: Zeynep/);
    expect(() => check([{ id: 'api', title: 'API', owner: 'alınacak:  ' }])).toThrow(/alınacak: <rol>/);
  });

  it('refuses an owner who was let go, saying so and asking for a new owner', () => {
    expect(() => check([{ id: 'api', title: 'API', owner: eda.id }])).toThrow(/“api” akışının sahibi Eda işten ayrıldı; akışa yeni bir sahip ver/);
  });

  it('refuses dependencies outside the plan, on itself, or that are not a list of ids', () => {
    expect(() => check([{ id: 'ui', title: 'UI', owner: 'Ada', dependsOn: ['api'] }])).toThrow(/“ui” akışı bu planda olmayan bir akışa bağlı: “api”/);
    expect(() => check([{ id: 'ui', title: 'UI', owner: 'Ada', dependsOn: ['ui'] }])).toThrow(/“ui” akışı kendine bağlı olamaz/);
    expect(() => check([{ id: 'ui', title: 'UI', owner: 'Ada', dependsOn: 'api' }])).toThrow(/“ui” akışının bağımlılıkları \(dependsOn\)/);
  });

  it('refuses a cycle, naming it', () => {
    expect(() =>
      check([
        { id: 'a', title: 'A', owner: 'Ada', dependsOn: ['c'] },
        { id: 'b', title: 'B', owner: 'Ada', dependsOn: ['a'] },
        { id: 'c', title: 'C', owner: 'Can', dependsOn: ['b'] },
        { id: 'd', title: 'D', owner: 'Can', dependsOn: ['a'] },
      ]),
    ).toThrow(/Akış bağımlılıklarında döngü var: a → c → b → a/);
    expect(check([{ id: 'a', title: 'A', owner: 'Ada' }, { id: 'b', title: 'B', owner: 'Ada', dependsOn: ['a'] }, { id: 'c', title: 'C', owner: 'Ada', dependsOn: ['a', 'b', 'a'] }])[2]!.dependsOn).toEqual(['a', 'b']);
  });

  it('refuses more than 12 streams', () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ id: `s${i}`, title: `S${i}`, owner: 'Ada' }));
    expect(() => check(many)).toThrow(/en fazla 12 akış/);
    expect(check(many.slice(0, 12))).toHaveLength(12);
  });
});
