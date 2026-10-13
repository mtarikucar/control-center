import { MAX_DEPARTMENTS, OWNER, ROOM_COUNT, departmentOwner, type Department, type DepartmentChange, type DepartmentInput, type Employee, type Plan, type PlanStreamView } from '@cc/shared';
import { writeDepartmentFile, writeRoleCard } from '../desk.ts';
import { ConflictError, ForbiddenError, ValidationError } from '../errors.ts';
import type { EventStore } from '../event-store.ts';
import type { Roster } from '../roster.ts';
import type { DepartmentStore } from './department-store.ts';
import { departmentTemplate, scopeSection, templateScope } from './department-templates.ts';
import type { NoticeStore } from './store.ts';
import { clean, fold } from './text.ts';

export interface DepartmentsDeps {
  store: DepartmentStore;
  roster: Roster;
  events: EventStore;
  notices: NoticeStore;
  dataDir: string;
  /** Restarts a session so it reads its new card and tool list (Engine.reload); absent in tests that do not care. */
  reload?: (id: string) => void;
  /** Walks someone to their seat after their department changed (Seating.reseat, spec office rooms §3); absent: seats stay. */
  reseat?: (employeeId: string) => void;
}

/** What the company gives the departments once both exist (they need each other). */
export interface DepartmentLinks {
  /** Every not-done stream of a running plan, with its plan. */
  openStreams: () => Array<{ plan: Plan; stream: PlanStreamView }>;
  /** Someone stopped heading a department: their open proposals go up (Company.rerouteProposalsOf). */
  headEnded: (employeeId: string) => void;
}

const firstSentence = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  const end = flat.search(/[.!?](\s|$)/);
  return end < 0 ? flat : flat.slice(0, end + 1);
};

/** What a desk's department.md says (spec §5.4): where its person sits, what their department does not do, every department. */
export function departmentBlock(e: Employee, open: Department[], people: Employee[]): string {
  const nameOf = (id: string | null) => (id ? (people.find((p) => p.id === id)?.name ?? null) : null);
  const mine = e.departmentId ? (open.find((d) => d.id === e.departmentId) ?? null) : null;
  const lines = ['# Departmanın', ''];
  if (e.kind === 'coordinator') {
    lines.push('Koordinatörsün: departmanların hepsi sana bağlı. İşi plan kartında akışlara böl, her akışı bir departmana ver (owner: "departman: <ad>"); başkanı akışını kendisi planlar ve yönetir.');
  } else if (!mine) {
    lines.push('Merkezdesin: bir departmanda değilsin, doğrudan koordinatöre bağlısın.');
  } else {
    lines.push(`**${mine.name}** — ${mine.mission}`, '', `Başkan: ${mine.headId === e.id ? 'sensin' : (nameOf(mine.headId) ?? 'yok (koordinatör yönetir)')}.`);
    const not = scopeSection(mine.scope, 'Yapmaz');
    if (not) lines.push('', '## Yapmadıkların (başka departmanın işi)', '', not);
  }
  lines.push('', '# Departmanlar', '');
  if (open.length === 0) lines.push('- yok');
  for (const d of open) lines.push(`- **${d.name}**: ${firstSentence(d.mission)} — başkan ${nameOf(d.headId) ?? 'yok'}`);
  lines.push('', 'Başka bir departmandan iş istemek için `taskPass` kullan ve `to` alanına departmanın adını yaz: iş başkanına gider (başkanı yoksa koordinatöre).');
  return `${lines.join('\n')}\n`;
}

/**
 * The departments (spec 2026-10-13-departments): one place that keeps their invariants — someone is in at most one
 * open department, the coordinator in none; `kind` is 'lead' exactly for an open department's head; `team` is the
 * department's name ('' in the centre); members report to the head — and tells the desks.
 */
export class Departments {
  readonly #d: DepartmentsDeps;
  #links: DepartmentLinks | null = null;

  constructor(d: DepartmentsDeps) {
    this.#d = d;
  }

  attach(links: DepartmentLinks): void {
    this.#links = links;
  }

  list(o: { status?: 'open' | 'closed' } = {}): Department[] {
    return this.#d.store.list(o);
  }

  get(id: string): Department {
    return this.#d.store.get(id);
  }

  /** An open department, or a ConflictError saying it closed. */
  open(id: string): Department {
    const dep = this.get(id);
    if (dep.status !== 'open') throw new ConflictError(`“${dep.name}” departmanı kapandı.`);
    return dep;
  }

  /** An open department by id or by name (folded: case and Turkish letters); null: none. */
  find(who: string): Department | null {
    const text = who.trim();
    const open = this.list({ status: 'open' });
    return open.find((d) => d.id === text) ?? open.find((d) => fold(d.name) === fold(text)) ?? null;
  }

  /** The open department someone is in; null: the centre. */
  of(employeeId: string): Department | null {
    const e = this.#person(employeeId);
    return e?.departmentId ? (this.list({ status: 'open' }).find((d) => d.id === e.departmentId) ?? null) : null;
  }

  headOf(employeeId: string): Department | null {
    return this.list({ status: 'open' }).find((d) => d.headId === employeeId) ?? null;
  }

  /** At work in it, the head first. */
  members(id: string): Employee[] {
    const head = this.get(id).headId;
    const people = this.#d.roster.list().filter((e) => e.departmentId === id);
    return [...people.filter((e) => e.id === head), ...people.filter((e) => e.id !== head)];
  }

  /** Who answers for it: its head, else the coordinator; null: neither. */
  responsible(id: string): Employee | null {
    const head = this.get(id).headId;
    return (head ? this.#person(head) : null) ?? this.#coordinator();
  }

  /** The room someone works in: their open department's (spec office rooms §4.1); null: the centre, or a department with no room. */
  roomOf(employeeId: string): number | null {
    return this.of(employeeId)?.room ?? null;
  }

  create(by: string, input: DepartmentInput): Department {
    this.#assertDirector(by);
    const open = this.list({ status: 'open' });
    if (open.length >= MAX_DEPARTMENTS) throw new ConflictError(`En fazla ${MAX_DEPARTMENTS} departman açık olabilir (ofisin ${MAX_DEPARTMENTS} odası var); önce birini kapat (departmentClose).`);
    const template = input.template ? departmentTemplate(input.template) : null;
    const name = this.#name(input.name?.trim() ? input.name : template?.name, null);
    const mission = clean(input.mission?.trim() ? input.mission : template?.mission, 'Misyon', 600, true);
    const scope = clean(input.scope?.trim() ? input.scope : template ? templateScope(template) : '', 'Sınır', 8000, false);
    const head = input.headId ? this.#candidate(input.headId) : null;
    let dep = this.#d.store.create({ name, mission, scope, template: template ? { id: template.id, version: template.version } : null, headId: null, room: this.#freeRoom() });
    this.#emit(by, 'created', dep);
    this.#announce(by, `${name} departmanı açıldı${template ? ` (şablon ${template.id})` : ''}: ${firstSentence(mission)}`, head ? [head.id] : []);
    if (head) dep = this.setHead(by, dep.id, head.id);
    else this.refreshDesks();
    return dep;
  }

  update(by: string, id: string, patch: { name?: string; mission?: string; scope?: string }): Department {
    this.#assertDirector(by);
    const dep = this.open(id);
    const name = patch.name === undefined ? dep.name : this.#name(patch.name, id);
    const mission = patch.mission === undefined ? dep.mission : clean(patch.mission, 'Misyon', 600, true);
    const scope = patch.scope === undefined ? dep.scope : clean(patch.scope, 'Sınır', 8000, false);
    const next = this.#d.store.update(id, { name, mission, scope });
    if (name !== dep.name) {
      for (const m of this.members(id)) {
        const renamed = this.#d.roster.update(m.id, { team: name });
        writeRoleCard(this.#d.dataDir, renamed);
        this.#d.events.append(m.id, { type: 'role.changed', kind: renamed.kind, title: renamed.title, team: renamed.team });
      }
      this.#announce(by, `${dep.name} departmanının yeni adı: ${name}.`, []);
    }
    this.#emit(by, 'updated', next);
    this.refreshDesks();
    return next;
  }

  setHead(by: string, id: string, employeeId: string | null): Department {
    this.#assertDirector(by);
    let dep = this.open(id);
    const former = dep.headId ? this.#person(dep.headId) : null;
    if (employeeId === null) {
      if (!former) return dep;
      dep = this.#d.store.update(id, { headId: null });
      const stays = this.#stepDown(former, dep);
      this.#headless(dep, former.id);
      this.#changed(by, 'head', dep, stays ? [[former.id, `${dep.name} departmanının başkanlığın bitti; departmanda çalışansın.`]] : []);
      return dep;
    }
    // The coordinator is refused here, before the first write.
    const target = this.#candidate(employeeId);
    if (former?.id === target.id) return dep;
    const elsewhere = this.headOf(target.id);
    if (elsewhere && elsewhere.id !== id) this.#vacate(by, elsewhere, target.id);
    dep = this.#d.store.update(id, { headId: target.id });
    const told: Array<[string, string]> = [];
    if (former) {
      const stays = this.#stepDown(former, dep);
      this.#links?.headEnded(former.id);
      if (stays) told.push([former.id, `${dep.name} departmanının başkanı artık ${target.name}; departmanda çalışansın.`]);
    }
    const head = this.#place(target, dep, true);
    for (const m of this.members(id)) if (m.id !== head.id && m.reportsTo !== head.id) this.#d.roster.update(m.id, { reportsTo: head.id });
    told.push([head.id, `Artık ${dep.name} departmanının başkanısın: sana verilen akışları streamPlan ile planlar, görevleri açıp odana dağıtır, gerekirse kendi departmanına işe alırsın (hire); akış bitince streamReport ile raporlarsın. Rol kartın ve araçların yenilendi.`]);
    this.#changed(by, 'head', dep, told);
    this.#handOver(dep, head);
    return dep;
  }

  move(by: string, employeeId: string, departmentId: string | null): Employee {
    this.#assertDirector(by);
    const target = this.#candidate(employeeId);
    const dep = departmentId === null ? null : this.open(departmentId);
    const before = this.of(target.id);
    if ((before?.id ?? null) === (dep?.id ?? null)) return target;
    const headed = this.headOf(target.id);
    if (headed) this.#vacate(by, headed, target.id);
    const moved = this.#place(target, dep, false);
    const head = dep?.headId ? this.#person(dep.headId) : null;
    const text = dep ? `Artık ${dep.name} departmanındasın (başkan: ${head?.name ?? 'yok, koordinatör yönetir'}).` : 'Artık merkezdesin: doğrudan koordinatöre bağlısın.';
    // Read again: leaving a department one headed made it headless since `before` was taken.
    this.#changed(by, 'moved', this.get((dep ?? before!).id), [[moved.id, text]]);
    return this.#d.roster.get(moved.id);
  }

  close(by: string, id: string, reason: string): Department {
    this.#assertDirector(by);
    const dep = this.open(id);
    const why = clean(reason, 'Gerekçe', 600, true);
    const people = this.members(id);
    if (dep.headId) this.#headless(dep, dep.headId, true);
    else this.#returnStreams(dep, true);
    for (const e of people) this.#place(e, null, false);
    const closed = this.#d.store.close(id);
    // A coordinator found inside (the tools never put one there) is in the centre like the rest but hears of it as everyone outside does.
    const told = people.filter((e) => e.kind !== 'coordinator');
    this.#changed(by, 'closed', closed, told.map((e): [string, string] => [e.id, `${dep.name} departmanı kapandı (${why}); artık merkezdesin, doğrudan koordinatöre bağlısın.`]));
    this.#announce(by, `${dep.name} departmanı kapandı: ${why}`, told.map((e) => e.id));
    // The room it gave up goes to the earliest-opened department that has none.
    this.#giveRooms(by);
    return closed;
  }

  /**
   * A free-text team (hire, appointLead, a blueprint role): the open department of that name; with `create`, a
   * headless custom one when there is none and a room is free. Null: none and not to be made.
   */
  forTeam(by: string, team: string, o: { create: boolean }): Department | null {
    const found = this.find(team);
    if (found || !o.create) return found;
    const open = this.list({ status: 'open' });
    if (open.length >= MAX_DEPARTMENTS) {
      throw new ValidationError(`“${team.trim()}” adında departman yok ve en fazla ${MAX_DEPARTMENTS} departman açık olabilir. Açık departmanlar: ${open.map((d) => d.name).join(', ')}.`);
    }
    return this.create(by, { name: team, mission: `${team.trim()} ekibi; misyonunu departmentUpdate ile yaz.` });
  }

  /** Throws what making this person a head would throw (nobody, let go, the coordinator), changing nothing: callers that also write other fields check the head first. */
  assertCanHead(employeeId: string): void {
    this.#candidate(employeeId);
  }

  /** A person may not take a department's name (taskPass and a stream's owner must mean one thing). */
  assertFreeName(name: string): void {
    const clash = this.find(name);
    if (clash) throw new ValidationError(`“${clash.name}” bir departmanın adı; çalışana başka bir ad ver.`);
  }

  /** Someone was let go (Company.releaseTasksOf): a department they headed is headless now. */
  left(employeeId: string): void {
    const dep = this.headOf(employeeId);
    if (!dep) return;
    this.#vacate(OWNER, dep, employeeId);
    this.refreshDesks();
  }

  /**
   * The teams of before departments become departments (spec §9.1), at every start and idempotent: names matched
   * folded, so “Keşif” and “keşif” are one; a team's first lead heads it, another lead becomes a member, and so does a lead without a team.
   */
  adoptTeams(): void {
    // A department with no room while one is free (data from before the rule, or a close that never reached it) gets it first.
    this.#giveRooms(OWNER);
    const touched = new Set<string>();
    const everyone = this.#d.roster.list();
    // A department never takes a person's name (taskPass and a stream's owner must mean one thing): such a team becomes “<team> ekibi”.
    const names = new Set(everyone.map((e) => fold(e.name)));
    const nameOf = (team: string) => (names.has(fold(team)) ? `${team.slice(0, 34).trimEnd()} ekibi` : team.trim());
    const people = everyone.filter((e) => e.kind !== 'coordinator' && !e.departmentId && e.team.trim());
    // The rooms go in this order, so it is total: hired earlier first, the same millisecond by desk (the roster lists by desk, but the sort says it).
    for (const e of [...people].sort((a, b) => a.createdAt - b.createdAt || a.deskIndex - b.deskIndex)) {
      let dep = this.find(nameOf(e.team));
      if (!dep) {
        dep = this.#d.store.create({ name: nameOf(e.team), mission: `${e.team.trim()} ekibi (departmanlardan önceki ekipten); misyonunu departmentUpdate ile yaz.`, scope: '', template: null, headId: null, room: this.#freeRoom() });
        this.#emit(OWNER, 'created', dep);
      }
      const asHead = e.kind === 'lead' && !dep.headId;
      if (asHead) dep = this.#d.store.update(dep.id, { headId: e.id });
      const adopted = this.#d.roster.update(e.id, { departmentId: dep.id, team: dep.name, kind: asHead ? 'lead' : 'member', reportsTo: asHead ? null : dep.headId });
      this.#d.reseat?.(e.id);
      // The card names the team and the guide follows the kind; no notice and no restart (this runs at the start).
      if (adopted.kind !== e.kind || adopted.team !== e.team) writeRoleCard(this.#d.dataDir, adopted);
      touched.add(dep.id);
    }
    // “Lead” is exactly “head of an open department”: a lead with no team has none, so they work as a member (card written, no notice, no restart).
    for (const e of everyone) {
      if (e.kind === 'lead' && !e.team.trim() && !e.departmentId) writeRoleCard(this.#d.dataDir, this.#d.roster.update(e.id, { kind: 'member' }));
    }
    for (const id of touched) {
      const head = this.get(id).headId;
      if (head) for (const m of this.members(id)) if (m.id !== head && m.reportsTo !== head) this.#d.roster.update(m.id, { reportsTo: head });
    }
    if (touched.size > 0) this.refreshDesks();
  }

  /** Every desk's department.md, written anew (cheap; read at the next session start). */
  refreshDesks(): void {
    const people = this.#d.roster.list();
    const open = this.list({ status: 'open' });
    for (const e of people) writeDepartmentFile(this.#d.dataDir, e.slug, departmentBlock(e, open, people));
  }

  // ── internals ─────────────────────────────────────────────────────────────

  #assertDirector(by: string): void {
    if (by === OWNER) return;
    if (this.#d.roster.get(by).kind !== 'coordinator') throw new ForbiddenError('Departmanları yalnız koordinatör ya da sahibi düzenler.');
  }

  #name(value: string | undefined, exceptId: string | null): string {
    const name = clean(value, 'Departman adı', 40, true);
    const clash = this.list({ status: 'open' }).find((d) => d.id !== exceptId && fold(d.name) === fold(name));
    if (clash) throw new ConflictError(`“${clash.name}” adında bir departman zaten var.`);
    if (this.#d.roster.list().some((e) => fold(e.name) === fold(name))) {
      throw new ConflictError(`“${name}” bir çalışanın adı; departmana başka bir ad ver (taskPass ve akış sahibinde ad tek anlamlı olmalı).`);
    }
    return name;
  }

  /** Someone at work who may be in a department (the coordinator never). */
  #candidate(id: string): Employee {
    const e = this.#d.roster.get(id);
    if (e.lifecycle === 'archived') throw new ConflictError(`${e.name} işten çıkarıldı.`);
    if (e.kind === 'coordinator') throw new ConflictError('Koordinatörün departmanı olmaz.');
    return e;
  }

  /** Puts someone in a department (or the centre) as its head or a member, keeping the invariants (spec §3); their seat follows. */
  #place(e: Employee, dep: Department | null, head: boolean): Employee {
    if (e.kind === 'coordinator') {
      // Never into a department; one found in a department (the tools do not allow it) may still go to the centre, keeping their kind.
      if (dep) throw new ConflictError('Koordinatörün departmanı olmaz.');
      this.#d.roster.update(e.id, { departmentId: null, team: '', reportsTo: null });
    } else {
      this.#d.roster.update(e.id, { departmentId: dep?.id ?? null, team: dep?.name ?? '', kind: head ? 'lead' : 'member', reportsTo: !dep || head ? null : dep.headId });
    }
    this.#d.reseat?.(e.id);
    // Read again: the walk to the seat changed the desk.
    return this.#d.roster.get(e.id);
  }

  /** The lowest room no open department has; null: none (a team adopted past the six rooms sits at the hub). */
  #freeRoom(): number | null {
    const used = new Set(this.list({ status: 'open' }).map((d) => d.room));
    for (let room = 0; room < ROOM_COUNT; room += 1) if (!used.has(room)) return room;
    return null;
  }

  /**
   * Every open department with no room takes the lowest free one, the earliest-opened first (spec office rooms §4.1): a
   * closed department's room is not left empty while another sits at the hub. The page hears it (department.changed
   * updated) and the department's people walk to the room.
   */
  #giveRooms(by: string): void {
    for (const dep of this.list({ status: 'open' })) {
      if (dep.room !== null) continue;
      const room = this.#freeRoom();
      if (room === null) return;
      this.#emit(by, 'updated', this.#d.store.setRoom(dep.id, room));
      for (const m of this.members(dep.id)) this.#d.reseat?.(m.id);
    }
  }

  /** A former head stays in the department as a member (true); a coordinator found heading one goes to the centre (false). */
  #stepDown(former: Employee, dep: Department): boolean {
    const stays = former.kind !== 'coordinator';
    this.#place(former, stays ? dep : null, false);
    return stays;
  }

  /** A department lost its head (`closed`: it is closing): its members report to no one, the former head's proposals go up, its open streams go to the coordinator. */
  #headless(dep: Department, formerHead: string, closed = false): void {
    for (const m of this.#d.roster.list()) if (m.reportsTo === formerHead && m.departmentId === dep.id) this.#d.roster.update(m.id, { reportsTo: null });
    this.#links?.headEnded(formerHead);
    this.#returnStreams(dep, closed);
  }

  /** The department's open streams are the coordinator's: it has no head, or it closed (a stream's owner is then a room that is gone). */
  #returnStreams(dep: Department, closed: boolean): void {
    const coordinator = this.#coordinator();
    const streams = (this.#links?.openStreams() ?? []).filter((x) => x.stream.owner === departmentOwner(dep.id));
    if (!coordinator || streams.length === 0) return;
    const list = streams.map((x) => `“${x.stream.title}” (plan “${x.plan.title}”, ${x.stream.id})`).join(', ');
    const text = closed
      ? `${dep.name} departmanı kapandı; açık akışları sende: ${list}. Akışların sahibini planRevise ile değiştir ya da kendin yönet.`
      : `${dep.name} departmanının başkanı yok; açık akışları sende: ${list}. departmentUpdate ile başkan ata ya da akışları kendin yönet.`;
    this.#d.notices.add(coordinator.id, 'stream.returned', text);
  }

  /** A new head hears of the department's open streams: their assignment came at the plan's start, when no one (or their predecessor) headed it. */
  #handOver(dep: Department, head: Employee): void {
    const streams = (this.#links?.openStreams() ?? []).filter((x) => x.stream.owner === departmentOwner(dep.id));
    if (streams.length === 0) return;
    const list = streams.map((x) => `“${x.stream.title}” (plan “${x.plan.title}”, planId ${x.plan.id}, streamId ${x.stream.id})`).join(', ');
    this.#d.notices.add(
      head.id,
      'stream.assigned',
      `Artık başkanı olduğun ${dep.name} departmanının açık akışları: ${list}. Her birini streamPlan ile planla (planId, streamId), görevlerini taskCreate ile planId ve streamId vererek aç; bitince streamReport ile raporla.`,
    );
  }

  /** The head leaves a department that stays open (heading another, moved out, let go): it is headless and the 'head' change is emitted; telling the person is the caller's. */
  #vacate(by: string, dep: Department, formerHead: string): Department {
    const next = this.#d.store.update(dep.id, { headId: null });
    this.#headless(next, formerHead);
    this.#emit(by, 'head', next);
    return next;
  }

  /** One change, told: the department's event; each affected person's card, role event, notice and session restart; every desk's block. */
  #changed(by: string, change: DepartmentChange, dep: Department, told: Array<[string, string]>): void {
    this.#emit(by, change, dep);
    for (const [id, text] of told) {
      const e = this.#d.roster.get(id);
      writeRoleCard(this.#d.dataDir, e);
      this.#d.events.append(id, { type: 'role.changed', kind: e.kind, title: e.title, team: e.team });
      this.#d.notices.add(id, 'role.changed', text);
      this.#d.reload?.(id);
    }
    this.refreshDesks();
  }

  /** An info notice to everyone at work but the actor and those told already. */
  #announce(by: string, text: string, except: string[]): void {
    for (const e of this.#d.roster.list()) if (e.id !== by && !except.includes(e.id)) this.#d.notices.add(e.id, 'department.changed', text);
  }

  #emit(by: string, change: DepartmentChange, department: Department): void {
    this.#d.events.append(by === OWNER ? null : by, { type: 'department.changed', change, department });
  }

  #person(id: string): Employee | null {
    try {
      return this.#d.roster.get(id);
    } catch {
      return null;
    }
  }

  #coordinator(): Employee | null {
    return this.#d.roster.list().find((e) => e.kind === 'coordinator') ?? null;
  }
}
