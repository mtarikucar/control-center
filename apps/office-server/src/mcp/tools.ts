import { INTEGRATION_KINDS, INTEGRATION_STATUSES, INTEGRATION_STATUS_LABELS, type IntegrationStatus, KPI_CADENCES, KPI_DIRECTIONS, KPI_OFFICE_METRICS, KPI_SOURCES, MODEL_ALIASES, PROFILE_SECTIONS, PROFILE_SPEC, PROPOSAL_KINDS, kpiText, REVIEW_SEVERITIES, TASK_DIFFICULTIES, WORK_TYPES, type Employee, type EmployeeKind, type MemoryHit, type ModelAlias, type Plan, type ScheduleStatus, type Task, type TaskDifficulty } from '@cc/shared';
import type { Budget } from '../company/budget.ts';
import type { Company } from '../company/company.ts';
import { methodText, onboardingGuideText } from '../company/craft.ts';
import { applyText, blueprintText, type Blueprints } from '../company/blueprint.ts';
import { capabilityVocabulary, coverage, coverageBrief, coverageLines, unclassifiedLines, unknownCapabilities } from '../company/capabilities.ts';
import { listRoleTemplates, roleTemplate, templateRole } from '../company/role-templates.ts';
import { integrationsText, type IntegrationRegistry } from '../company/integrations.ts';
import { nextText, ofThem } from '../company/onboarding.ts';
import type { Memory } from '../company/memory.ts';
import { profileFieldsHelp, profileHistoryText, profileSection, profileText } from '../company/profile.ts';
import type { TaskStore } from '../company/store.ts';
import { formatPerformance, type PerformanceReport } from '../performance.ts';
import { cronLabel, formatWhen, parseCron } from '../company/time.ts';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.ts';
import type { Roster } from '../roster.ts';
import type { McpTool } from './protocol.ts';

const EVERYONE: EmployeeKind[] = ['member', 'lead', 'coordinator'];
const COORDINATOR: EmployeeKind[] = ['coordinator'];
const LEADS: EmployeeKind[] = ['lead', 'coordinator'];
const HIT_KIND: Record<MemoryHit['kind'], string> = { note: 'not', decision: 'karar', playbook: 'el kitabı', task: 'teslim' };
const day = (ts: number) => new Date(ts).toISOString().slice(0, 10);

type Args = Record<string, unknown>;

function str(args: Args, key: string, required = true): string {
  const v = args[key];
  if (v === undefined || v === null) {
    if (required) throw new ValidationError(`${key} gerekli.`);
    return '';
  }
  if (typeof v !== 'string') throw new ValidationError(`${key} metin olmalı.`);
  return v;
}

function optStr(args: Args, key: string): string | undefined {
  return args[key] === undefined || args[key] === null ? undefined : str(args, key);
}

function list(args: Args, key: string): string[] | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new ValidationError(`${key} metinlerden oluşan bir liste olmalı.`);
  return v as string[];
}

function num(args: Args, key: string): number | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ValidationError(`${key} sayı olmalı.`);
  return v;
}

function bool(args: Args, key: string): boolean | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') throw new ValidationError(`${key} true ya da false olmalı.`);
  return v;
}

const SCHEDULE_TR: Record<ScheduleStatus, string> = { active: 'sürüyor', paused: 'duraklatıldı', stopped: 'durduruldu' };
const STATUS_TR: Record<Task['status'], string> = { waiting: 'bekliyor', in_progress: 'sürüyor', review: 'incelemede', blocked: 'takıldı', parked: 'ertelendi', done: 'bitti', cancelled: 'iptal' };

function taskLine(t: Task, company: Company): string {
  const done = t.done.length ? ` — bitti tanımı: ${t.done.join('; ')}` : '';
  const review = t.reviewer ? `, inceleyen ${company.nameOf(t.reviewer)}${t.round ? `, tur ${t.round}` : ''}` : '';
  const requires = t.requires?.length ? ` — gereken yetenekler: ${t.requires.join(', ')}` : '';
  return `• [${STATUS_TR[t.status]}] ${t.id} “${t.title}” (öncelik ${t.priority}, isteyen ${company.nameOf(t.requester)}${review})${done}${requires}`;
}

const s = (description: string) => ({ type: 'string', description });
const strings = (description: string) => ({ type: 'array', items: { type: 'string' }, description });
const integer = (description: string, minimum: number, maximum: number) => ({ type: 'integer', minimum, maximum, description });
const number = (description: string) => ({ type: 'number', minimum: 0, description });
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const difficulty = {
  type: 'string',
  enum: [...TASK_DIFFICULTIES],
  description: 'How hard the task is; it starts on the model the constitution gives that difficulty. None: the assignee stays on their model.',
};
const difficultyArg = (args: Args) => optStr(args, 'difficulty') as TaskDifficulty | undefined;
const reviewer = s('Who checks the hand-in before it closes (id or name); never the one who does the task. Give one for any task with a quality risk.');
const requires = strings('The capabilities the work needs, from the vocabulary (capabilitiesRead), e.g. email.read, social.publish. The reply says how the assignee’s desk has each; the task opens anyway.');
const until = s('When: relative (+30m, +6h, +1d) or a local time (2026-10-08T14:55).');
const startAfter = { ...until, description: 'Do not hand this out before this time: relative (+6h, +1d) or a local time (2026-10-08T14:55). For follow-ups and waiting periods.' };
const dueAt = { ...until, description: 'Should be done by this time (same forms). Nearer due dates go first within a priority; the coordinator hears once when it passes.' };
const method = {
  type: 'object',
  description: 'How the work is done (read methodRead first): the work type, at least two stages with who does each and whether someone else checks it, and at least one quality check.',
  properties: {
    workType: { type: 'string', enum: [...WORK_TYPES] },
    stages: {
      type: 'array',
      minItems: 2,
      items: { type: 'object', properties: { name: s('Stage name.'), role: s('Who does it: a person or a role.'), review: { type: 'boolean', description: 'Someone other than the doer checks it.' } }, required: ['name', 'role'] },
    },
    checks: strings('Quality checks or acceptance evidence, one each.'),
  },
  required: ['workType', 'stages', 'checks'],
};

export function officeTools(o: {
  company: Company;
  roster: Roster;
  tasks: TaskStore;
  characters: () => string[];
  memory: Memory;
  budget: Budget;
  engine: { sleep(id: string): Promise<unknown>; wake(id: string): unknown; sideQuestion(id: string, text: string): Promise<{ ok: boolean; answer: string }> };
  /** Every plan, newest first (goalsRead lists each goal's plans). */
  plans: () => Plan[];
  /** Who does what when, as Turkish text (agendaRead). */
  agenda: { text(employeeId?: string): string };
  /** How the work went, from the log (performanceRead); absent in tests that do not care. */
  performance?: { report(o: { days?: number }): PerformanceReport };
  /** The integration registry (integrationsList, integrationRegister); absent in tests that do not care. */
  integrations?: IntegrationRegistry;
  /** The blueprints (B5: blueprintPropose, blueprintApply, blueprintRead); absent in tests that do not care. */
  blueprints?: Blueprints;
}): McpTool[] {
  const { company, roster, tasks, memory, budget, engine, plans, agenda } = o;

  /** A colleague by id or by name (case and Turkish dotted/dotless i insensitive). */
  const findPerson = (who: string): Employee => {
    const people = roster.list();
    const byId = people.find((e) => e.id === who);
    if (byId) return byId;
    const norm = (x: string) => x.toLocaleLowerCase('tr').trim();
    const byName = people.filter((e) => norm(e.name) === norm(who));
    if (byName.length === 1) return byName[0]!;
    throw new NotFoundError(`Çalışan bulunamadı: ${who}. officeStatus ile ofistekileri görebilirsin.`);
  };

  const reviewerArg = (args: Args): string | undefined => {
    const who = optStr(args, 'reviewer');
    return who === undefined || who === '' ? undefined : findPerson(who).id;
  };

  const characterList = () => [...o.characters(), 'voxel'];

  /** How a desk has these capabilities, as a reply's extra line; with no registry, only the list. */
  const deskBrief = (ids: string[] | undefined, employeeId: string, lead: string, anyway = ''): string => {
    if (!ids?.length) return '';
    if (!o.integrations) return `\n${lead}: ${ids.join(', ')}.`;
    return `\n${coverageBrief(coverage(o.integrations.list(), ids, employeeId), lead, anyway)}`;
  };

  return [
    {
      name: 'myTasks',
      description: 'List your own tasks (open ones first, then the last finished). Call it when you need to know what is on your plate.',
      inputSchema: object({}),
      kinds: EVERYONE,
      run: ({ employee }) => {
        const mine = tasks.list({ assignee: employee.id });
        const open = mine.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
        const finished = mine.filter((t) => t.status === 'done').slice(-5);
        if (mine.length === 0) return 'Sende hiç görev yok.';
        return [`Açık görevlerin (${open.length}):`, ...open.map((t) => taskLine(t, company)), finished.length ? 'Son bitenler:' : '', ...finished.map((t) => taskLine(t, company))].filter(Boolean).join('\n');
      },
    },
    {
      name: 'taskFinish',
      description:
        'Hand in a task you finished: a short summary of the result, one line of evidence per definition-of-done item (same order: what you did and how you checked it), the files you produced, and what you learned. Always call this when a task is done.',
      inputSchema: object({ taskId: s('The task id from the task message.'), summary: s('What was done, in 1–5 sentences.'), evidence: strings('One line of proof per definition-of-done item, in the same order.'), outputs: strings('Files you produced (paths).'), learned: s('Anything worth remembering for later work.') }, ['taskId', 'summary']),
      kinds: EVERYONE,
      run: ({ employee }, args) => {
        const task = company.finish(employee.id, str(args, 'taskId'), { summary: str(args, 'summary'), evidence: list(args, 'evidence'), outputs: list(args, 'outputs') ?? [], learned: optStr(args, 'learned') ?? '' });
        if (task.status === 'review') return `“${task.title}” teslim edildi ve incelemeye gitti; karar gelince ya kapanacak ya da bulgularla sana dönecek.`;
        return `“${task.title}” teslim edildi${task.result?.archive ? ` (arşiv: ${task.result.archive})` : ''}. İsteyen ve koordinatör haberdar edildi.`;
      },
    },
    {
      name: 'taskPark',
      description:
        'Set a task aside until a time, with a reason — your own task, or (coordinator, lead) one you manage. It stays open but frees the slot: the office hands out the next task meanwhile and brings this one back at the time. Use it for waiting periods (a measurement window, an answer you wait for) instead of keeping the task open. The third park of the same task tells the coordinator.',
      inputSchema: object({ taskId: s('The task id.'), until, reason: s('Why it waits (shown in the agenda).') }, ['taskId', 'until', 'reason']),
      kinds: EVERYONE,
      run: ({ employee }, args) => {
        const task = company.parkTask(employee.id, str(args, 'taskId'), str(args, 'until'), str(args, 'reason'));
        const when = formatWhen(task.notBefore ?? Date.now(), Date.now());
        // Someone else's task: the caller's own slot was never held (the assignee hears separately).
        if (task.assignee !== employee.id) return `“${task.title}” ${company.nameOf(task.assignee)} için ${when} saatine ertelendi; saatinde onun sırasına geri gelecek.`;
        return `“${task.title}” ertelendi: ${when} saatinde sırana geri gelecek. Sıran boş; ofis sıradaki işini verir.`;
      },
    },
    {
      name: 'taskUnpark',
      description: 'Bring a parked or start-timed task back to the queue now (coordinator; lead for their team).',
      inputSchema: object({ taskId: s('The task id.') }, ['taskId']),
      kinds: LEADS,
      run: ({ employee }, args) => {
        const task = company.unparkTask(employee.id, str(args, 'taskId'));
        return `“${task.title}” sıraya döndü (öncelik ${task.priority}).`;
      },
    },
    {
      name: 'scheduleCreate',
      description:
        'Open a routine (coordinator; lead for their team): recurring work that opens an ordinary task each time — with a reviewer, evidence and all the office rules. cron has 5 fields in local time ("0 9 * * 1-5" = weekdays 09:00). Routines cost quota: keep few, no more often than the constitution allows. A new instance is skipped while the previous one is still open.',
      inputSchema: object(
        { title: s('Routine title.'), description: s('What to do each time.'), done: strings('Definition of done of each instance.'), assignee: s('Employee id or name.'), cron: s('5-field cron, local time.'), reviewer, planId: s('The plan it serves.'), priority: integer('1 = most urgent … 5 = whenever (default 3).', 1, 5), difficulty, until: { ...until, description: 'Stop after this time (optional): relative (+30d) or a local time (2026-12-31T18:00).' } },
        ['title', 'assignee', 'cron'],
      ),
      kinds: LEADS,
      run: ({ employee }, args) => {
        const to = findPerson(str(args, 'assignee'));
        const created = company.createSchedule(employee.id, {
          title: str(args, 'title'), description: optStr(args, 'description'), done: list(args, 'done'), assignee: to.id, cron: str(args, 'cron'), reviewer: reviewerArg(args) ?? null,
          planId: optStr(args, 'planId') ?? null, priority: num(args, 'priority'), difficulty: difficultyArg(args), until: optStr(args, 'until'),
        });
        return `Rutin açıldı (${created.id}): “${created.title}” → ${to.name}, ${cronLabel(parseCron(created.cron))}; ilk çalışma ${formatWhen(created.nextRunAt ?? Date.now(), Date.now())}.`;
      },
    },
    {
      name: 'scheduleList',
      description: 'List the routines (coordinator, lead): who, when (in Turkish and as cron), the next run, the last instance, skips and failures.',
      inputSchema: object({}),
      kinds: LEADS,
      run: () => {
        const all = company.schedules();
        if (all.length === 0) return 'Rutin yok.';
        return all
          .map((x) => `• ${x.id} “${x.title}” → ${company.nameOf(x.assignee)} · ${cronLabel(parseCron(x.cron))} (${x.cron}) · ${SCHEDULE_TR[x.status]}${x.nextRunAt && x.status === 'active' ? ` · sıradaki ${formatWhen(x.nextRunAt, Date.now())}` : ''}${x.lastTaskId ? ` · son örnek ${x.lastTaskId}` : ''}${x.skipCount ? ` · ${x.skipCount} atlama` : ''}${x.failCount ? ` · ${x.failCount} hata` : ''}${x.note ? ` · ${x.note}` : ''}`)
          .join('\n');
      },
    },
    {
      name: 'scheduleUpdate',
      description: 'Change a routine (coordinator; lead for their team): status (active resumes, paused, stopped), cron, assignee, reviewer, priority, difficulty, until, title, description, done.',
      inputSchema: object(
        { scheduleId: s('The routine id.'), status: { type: 'string', enum: ['active', 'paused', 'stopped'], description: 'active resumes (next run from now), paused waits, stopped is final.' }, cron: s('New 5-field cron.'), assignee: s('New assignee (id or name).'), reviewer, priority: integer('1–5.', 1, 5), difficulty, until: { ...until, description: 'New stop time: relative (+30d) or a local time (2026-12-31T18:00); empty removes it.' }, title: s('New title.'), description: s('New description.'), done: strings('New definition of done.') },
        ['scheduleId'],
      ),
      kinds: LEADS,
      run: ({ employee }, args) => {
        const assignee = optStr(args, 'assignee');
        const changed = company.updateSchedule(employee.id, str(args, 'scheduleId'), {
          status: optStr(args, 'status'), cron: optStr(args, 'cron'), assignee: assignee ? findPerson(assignee).id : undefined, reviewer: args.reviewer === undefined ? undefined : (reviewerArg(args) ?? null),
          priority: num(args, 'priority'), difficulty: args.difficulty === undefined ? undefined : difficultyArg(args), until: optStr(args, 'until'), title: optStr(args, 'title'), description: optStr(args, 'description'), done: list(args, 'done'),
        });
        return `“${changed.title}” rutini güncellendi: ${SCHEDULE_TR[changed.status]}, ${cronLabel(parseCron(changed.cron))}${changed.nextRunAt && changed.status === 'active' ? `, sıradaki ${formatWhen(changed.nextRunAt, Date.now())}` : ''}.`;
      },
    },
    {
      name: 'agendaRead',
      description:
        'Read the agenda (coordinator, lead): for each employee what runs now, what is queued with estimated times, what waits for review, what is parked and until when, which routines are coming. Use it to see who is free when before handing out work.',
      inputSchema: object({ employee: s('One employee (id or name); omit for everyone.') }),
      kinds: LEADS,
      run: (_ctx, args) => {
        const who = optStr(args, 'employee');
        return agenda.text(who ? findPerson(who).id : undefined);
      },
    },
    {
      name: 'reviewDecide',
      description:
        'Decide a review task (its title starts with "İnceleme:"): approve closes the reviewed task; changes sends it back to whoever did it with your findings. Check every claim yourself first. Give each finding a severity (critical: wrong or harmful; important: misses the definition of done; minor: an improvement) and a concrete failure scenario. Approve only without critical or important findings. Never review your own work.',
      inputSchema: object(
        {
          taskId: s('The review task id.'),
          decision: { type: 'string', enum: ['approve', 'changes'] },
          findings: { type: 'array', items: object({ severity: { type: 'string', enum: [...REVIEW_SEVERITIES] }, text: s('What is wrong, with a concrete scenario.') }, ['severity', 'text']), description: 'Findings, most severe first.' },
          note: s('A short overall note.'),
        },
        ['taskId', 'decision'],
      ),
      kinds: EVERYONE,
      run: ({ employee }, args) => {
        const task = company.reviewDecide(employee.id, str(args, 'taskId'), { decision: str(args, 'decision'), findings: args.findings, note: optStr(args, 'note') });
        if (task.status === 'done') return `Onaylandı: “${task.title}” kapandı; yapan ve isteyen haberdar edildi.`;
        const doer = roster.list({ includeArchived: true }).find((e) => e.id === task.assignee);
        if (!doer || doer.lifecycle === 'archived') return `Değişiklik istendi, ama “${task.title}” görevini yapan ${company.nameOf(task.assignee)} işten çıkarıldı: görevi taskAssign ile başkasına ver (bulgular onunla gider).`;
        return `Değişiklik istendi: “${task.title}” bulgularınla ${company.nameOf(task.assignee)} adlı çalışana döndü (tur ${task.round ?? 1}).`;
      },
    },
    {
      name: 'taskUpdate',
      description: 'Update one of your tasks: add a progress note, or mark it blocked (blocked: true, with the reason in note) / unblocked (blocked: false). The coordinator is told when you are blocked.',
      inputSchema: object({ taskId: s('The task id.'), note: s('Progress note or the reason you are blocked.'), blocked: { type: 'boolean', description: 'true = you cannot continue; false = you can again.' } }, ['taskId']),
      kinds: EVERYONE,
      run: ({ employee }, args) => {
        const task = company.update(employee.id, str(args, 'taskId'), { note: optStr(args, 'note'), blocked: bool(args, 'blocked') });
        return `“${task.title}” güncellendi: ${STATUS_TR[task.status]}.`;
      },
    },
    {
      name: 'taskPass',
      description: 'Pass a piece of work to a colleague (by id or name). It goes to the end of their queue; they are not interrupted. Say what, why and when it counts as done.',
      inputSchema: object({ to: s('Colleague id or name.'), title: s('Short title.'), description: s('What is needed and why.'), done: strings('Definition of done, one item each.'), priority: integer('1 = most urgent … 5 = whenever (default 3).', 1, 5), difficulty: { ...difficulty, description: `${difficulty.description} critical is for the coordinator and team leads; from anyone else it counts as hard.` }, reviewer, startAfter, dueAt, requires }, ['to', 'title']),
      kinds: EVERYONE,
      run: ({ employee }, args) => {
        // Arguments first: a malformed call should say what is malformed, not that a person was not found.
        const input = { title: str(args, 'title'), description: optStr(args, 'description'), done: list(args, 'done'), priority: num(args, 'priority'), difficulty: difficultyArg(args), startAfter: optStr(args, 'startAfter'), dueAt: optStr(args, 'dueAt'), requires: list(args, 'requires') };
        const to = findPerson(str(args, 'to'));
        const task = company.createTask(employee.id, { assignee: to.id, ...input, reviewer: reviewerArg(args) });
        const lowered = input.difficulty === 'critical' && task.difficulty === 'hard' ? ' Zorluk “kritik” yerine “zor” sayıldı: kritik işi koordinatör ya da ekip lideri açar.' : '';
        return `“${task.title}” ${to.name} adlı çalışanın sırasına eklendi (görev ${task.id}).${lowered}${deskBrief(task.requires, to.id, `Gereken yetenekler, ${to.name} masasında`, 'Görev yine açıldı')}`;
      },
    },
    {
      name: 'officeStatus',
      description: 'See who works in the office: role, team, state and current task. Use it to find the right person to pass work to.',
      inputSchema: object({}),
      kinds: EVERYONE,
      run: () => {
        const kindTr: Record<EmployeeKind, string> = { coordinator: 'koordinatör', lead: 'ekip lideri', member: 'çalışan' };
        return company
          .status()
          .map((l) => `• ${l.name}${l.title ? ` — ${l.title}` : ''} (${kindTr[l.kind]}${l.team ? `, ${l.team}` : ''}; ${l.lifecycle}) id ${l.id}${l.task ? ` — şu an: “${l.task}”` : ''}`)
          .join('\n');
      },
    },
    {
      name: 'briefRead',
      description: 'Read the current company brief (mission, running plans, who does what, ground rules).',
      inputSchema: object({}),
      kinds: EVERYONE,
      run: () => company.brief(),
    },
    {
      name: 'profileRead',
      description: `Read the company profile: what the company is, section by section (${PROFILE_SECTIONS.join(', ')}); empty sections show as empty, assumed ones are marked. With section only that one; with section and history: true its versions, newest first.`,
      inputSchema: object({ section: { type: 'string', enum: [...PROFILE_SECTIONS], description: 'One section only.' }, history: { type: 'boolean', description: 'The section’s versions, newest first (needs section).' } }),
      kinds: EVERYONE,
      run: (_ctx, args) => {
        const section = optStr(args, 'section');
        if (bool(args, 'history')) {
          if (section === undefined) throw new ValidationError('Geçmiş için bir bölüm (section) ver.');
          return profileHistoryText(profileSection(section), company.profileHistory(section), (id) => company.nameOf(id));
        }
        return profileText(company.profile(), section === undefined ? undefined : profileSection(section));
      },
    },
    {
      name: 'integrationsList',
      description: 'Read the integration registry, read-only: every connector the office has, its status (connected, denied — connected but the desk’s session has none of its tools —, needs_auth, pending, failed, closed, unknown), on which desks it is open or shut and why, and what the coordinator noted (capabilities, what the owner must do, cost). It calls no connector. status or employee narrow it.',
      inputSchema: object({ status: { type: 'string', enum: [...INTEGRATION_STATUSES] }, employee: s('Only what this person’s desk reports (id or name).') }),
      kinds: EVERYONE,
      run: (_ctx, args) => {
        if (!o.integrations) throw new ConflictError('Bu ofiste entegrasyon kaydı yok.');
        const status = optStr(args, 'status');
        if (status !== undefined && !(INTEGRATION_STATUSES as readonly string[]).includes(status)) throw new ValidationError(`durum (status) ${INTEGRATION_STATUSES.slice(0, -1).join(', ')} ya da ${INTEGRATION_STATUSES.at(-1)} olmalı.`);
        const who = optStr(args, 'employee');
        const list = o.integrations.list({ status: status as IntegrationStatus | undefined, employee: who === undefined ? undefined : findPerson(who).id });
        return integrationsText(list, status !== undefined || who !== undefined);
      },
    },
    {
      name: 'capabilitiesRead',
      description:
        'Read the capability model, read-only: without arguments the vocabulary — every capability the product knows, which go outward — and how the office has each (built in, or which connectors and on which desks they are open), then each connector’s tools no capability names (unclassified: no role gets them, the gate counts them outward); with employee, the capabilities that person declares and how their desk has each; with task, what the task requires and how its assignee’s desk has each (with employee as well: on that person’s desk instead, to see who could do it). It calls no connector.',
      inputSchema: object({ employee: s('Id or name.'), task: s('Task id.') }),
      kinds: EVERYONE,
      run: (_ctx, args) => {
        if (!o.integrations) throw new ConflictError('Bu ofiste entegrasyon kaydı yok.');
        const who = optStr(args, 'employee');
        const taskId = optStr(args, 'task');
        const person = who === undefined ? null : findPerson(who);
        const registry = o.integrations.list();
        if (taskId !== undefined) {
          const task = tasks.get(taskId);
          const desk = person ?? roster.get(task.assignee);
          if (!task.requires?.length) return `“${task.title}” görevi yetenek istemiyor.`;
          return [`# Görev “${task.title}” — gereken yetenekler (${task.requires.length}); masa: ${desk.name}`, ...coverageLines(coverage(registry, task.requires, desk.id), true)].join('\n');
        }
        if (person) {
          const declared = person.capabilities ?? [];
          if (!declared.length) return `${person.name} için bildirilmiş yetenek yok. Koordinatör editRoleCard(capabilities) ile bildirir.`;
          return [`# ${person.name} — yetenekler (${declared.length}), masasındaki karşılığı`, ...coverageLines(coverage(registry, declared, person.id), true)].join('\n');
        }
        const v = capabilityVocabulary();
        return [
          `# Yetenek sözlüğü (${v.capabilities.length} yetenek, sürüm ${v.version}) — ofisteki karşılığı; salt okunur, hiçbir bağlayıcı çağrılmadı.`,
          ...coverageLines(coverage(registry, v.capabilities.map((c) => c.id)), false),
          ...unclassifiedLines(registry),
        ].join('\n');
      },
    },
    {
      name: 'memorySearch',
      description: 'Search the company memory (knowledge notes, decisions, playbook topics and finished work) for every word you give. Use it before starting work and whenever you wonder whether the company already knows something.',
      inputSchema: object({ query: s('Words to look for.'), limit: integer('How many results (default 10).', 1, 30) }, ['query']),
      kinds: EVERYONE,
      run: (_ctx, args) => {
        const hits = memory.search(str(args, 'query'), num(args, 'limit') ?? 10);
        if (hits.length === 0) return 'Şirket hafızasında bununla ilgili bir şey yok.';
        return hits.map((h) => `• [${HIT_KIND[h.kind]}] ${h.title} (${day(h.ts)}, ${h.kind === 'playbook' ? `playbookRead konu: ${h.id}` : h.id}): ${h.snippet}`).join('\n');
      },
    },
    {
      name: 'noteWrite',
      description: 'Write a knowledge note for the whole company: something you learned that others will need (a tool that works, a pitfall, a contact, a number). Short title, the facts, a few tags.',
      inputSchema: object({ title: s('Short title.'), text: s('The note.'), tags: strings('Up to 8 tags.') }, ['title', 'text']),
      kinds: EVERYONE,
      run: ({ employee }, args) => {
        const note = memory.writeNote(employee.id, { title: str(args, 'title'), text: str(args, 'text'), tags: list(args, 'tags') });
        return `Not kaydedildi (#${note.id}).`;
      },
    },
    {
      name: 'playbookRead',
      description: 'Read the company playbook: without a topic, the list of topics; with a topic, how the company does it (the newest version). Follow it unless you have a reason not to, and say so.',
      inputSchema: object({ topic: s('Topic name.') }),
      kinds: EVERYONE,
      run: (_ctx, args) => {
        const topic = optStr(args, 'topic');
        if (!topic) {
          const topics = memory.playbookTopics();
          return topics.length ? `El kitabı konuları:\n${topics.map((t) => `• ${t.topic} (sürüm ${t.version}, ${day(t.ts)})`).join('\n')}` : 'El kitabı henüz boş.';
        }
        const entry = memory.playbookTopic(topic);
        return `# ${entry.topic} (sürüm ${entry.version}, ${company.nameOf(entry.by)}, ${day(entry.ts)})\n\n${entry.text}`;
      },
    },
    {
      name: 'methodRead',
      description:
        'Read how a kind of work is done well (the office’s coordination craft, the same in every company): without a type, the list of work types; with one, its stages, roles, quality checks, evidence, common mistakes and model advice. Read it before planning work; the company’s own rules are in playbookRead.',
      inputSchema: object({ type: { type: 'string', enum: [...WORK_TYPES], description: 'Work type; omit for the list.' } }),
      kinds: EVERYONE,
      run: (_ctx, args) => methodText(optStr(args, 'type')),
    },
    {
      name: 'decisionsRead',
      description: 'Read the company decision log, newest first: what was chosen, why, and the alternatives; reverted decisions are marked. Filter by words or by plan id.',
      inputSchema: object({ query: s('Words to look for.'), planId: s('Only this plan’s decisions.'), limit: integer('How many (default 15).', 1, 50) }),
      kinds: EVERYONE,
      run: (_ctx, args) => {
        const found = memory.decisions({ query: optStr(args, 'query'), planId: optStr(args, 'planId'), limit: num(args, 'limit') ?? 15 });
        if (found.length === 0) return 'Karar defterinde eşleşen kayıt yok.';
        const reverted = new Set(memory.decisions({ limit: 500 }).map((d) => d.reverts).filter((x): x is string => x !== null));
        return found
          .map((d) => `• ${day(d.ts)} ${d.title} → ${d.chosen}${reverted.has(d.id) ? ' (geri alındı)' : ''} — ${d.reason}${d.alternatives.length ? ` [alternatifler: ${d.alternatives.join(', ')}]` : ''} (${company.nameOf(d.by)}, ${d.id})`)
          .join('\n');
      },
    },
    {
      name: 'playbookUpdate',
      description: 'Write a new version of a playbook topic (coordinator or team lead): the whole method as it should be followed from now on, and why it changed.',
      inputSchema: object({ topic: s('Topic name, e.g. "Test prosedürü".'), text: s('The whole method, in Markdown.'), reason: s('Why it changed.') }, ['topic', 'text']),
      kinds: LEADS,
      run: ({ employee }, args) => {
        const entry = memory.updatePlaybook(employee.id, { topic: str(args, 'topic'), text: str(args, 'text'), reason: optStr(args, 'reason') });
        return `El kitabı güncellendi: “${entry.topic}” sürüm ${entry.version}.`;
      },
    },
    {
      name: 'decisionRecord',
      description: 'Record a decision in the company decision log (coordinator or team lead): what was decided about, what was chosen, why, and the alternatives considered. The owner can revert it.',
      inputSchema: object({ title: s('What was decided about.'), chosen: s('What was chosen.'), reason: s('Why.'), alternatives: strings('Other options considered.'), planId: s('The plan it belongs to.') }, ['title', 'chosen', 'reason']),
      kinds: LEADS,
      run: ({ employee }, args) => {
        const d = memory.recordDecision(employee.id, { title: str(args, 'title'), chosen: str(args, 'chosen'), reason: str(args, 'reason'), alternatives: list(args, 'alternatives'), planId: optStr(args, 'planId') ?? null });
        return `Karar kaydedildi (${d.id}).`;
      },
    },
    {
      name: 'employeeNote',
      description: 'The employee file (coordinator): with text, add an observation about someone (what they are good at, what to watch); without text, read their file (your notes and their finished work). Look at it before handing out work.',
      inputSchema: object({ employee: s('Employee id or name.'), text: s('Your observation.') }, ['employee']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const text = optStr(args, 'text');
        const who = findPerson(str(args, 'employee'));
        if (text) {
          memory.addEmployeeNote(employee.id, who.id, text);
          return `${who.name} adlı çalışanın dosyasına not eklendi.`;
        }
        const file = memory.employeeFile(who.id);
        return [
          `${who.name}${who.title ? ` — ${who.title}` : ''}: ${file.finished} görev bitirdi.`,
          ...(file.notes.length ? ['Notların:', ...file.notes.map((n) => `• ${day(n.ts)} ${n.text}`)] : ['Henüz notun yok.']),
          ...(file.recent.length ? ['Son işleri:', ...file.recent.map((r) => `• ${r.title}: ${r.summary}`)] : []),
        ].join('\n');
      },
    },
    {
      name: 'recordSpend',
      description: 'Record money you spent on an outside service (a subscription, a purchase, a paid API). Call it right after spending: the office cannot see outside spending, and the owner sets monthly and per-plan limits.',
      inputSchema: object({ service: s('Which service or vendor.'), usd: number('Amount in USD.'), purpose: s('What it was for.'), planId: s('The plan it belongs to.') }, ['service', 'usd', 'purpose']),
      kinds: EVERYONE,
      run: ({ employee }, args) => {
        const usd = num(args, 'usd');
        if (usd === undefined) throw new ValidationError('usd gerekli.');
        const { spend, warnings } = budget.recordSpend(employee.id, { service: str(args, 'service'), usd, purpose: str(args, 'purpose'), planId: optStr(args, 'planId') ?? null });
        return [`Harcama kaydedildi: ${spend.service} $${spend.usd}.`, ...warnings].join('\n');
      },
    },
    {
      name: 'budgetStatus',
      description: 'See the budget (coordinator): quota use and the owner’s reserve, this month’s spending against the cap, money and Claude usage of every running plan, and who used most today.',
      inputSchema: object({}),
      kinds: COORDINATOR,
      run: () => budget.status(),
    },
    {
      name: 'setModel',
      description: `Move an employee to another model (coordinator): ${MODEL_ALIASES.join(', ')}. Their session goes on with the new model and keeps its memory.`,
      inputSchema: object({ employee: s('Employee id or name.'), model: { type: 'string', enum: [...MODEL_ALIASES] } }, ['employee', 'model']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const model = str(args, 'model') as ModelAlias;
        const who = findPerson(str(args, 'employee'));
        const next = company.setModel(employee.id, who.id, model);
        return `${next.name} artık ${next.model} ile çalışıyor (oturumu yeniden açılıyor; hafızası korunur).`;
      },
    },
    {
      name: 'sleep',
      description:
        'Put an idle employee to sleep to free the machine (coordinator). Their session is kept; a task for them or a message wakes them. Not while they hold a task in progress: sleeping stops their running work, so park it first or let it finish.',
      inputSchema: object({ employee: s('Employee id or name.') }, ['employee']),
      kinds: COORDINATOR,
      run: async ({ employee }, args) => {
        const who = findPerson(str(args, 'employee'));
        if (who.id === employee.id) throw new ValidationError('Kendini uyutamazsın.');
        // Sleeping ends the session's process, and with it anything the session runs in the background.
        const running = tasks.inProgressOf(who.id);
        if (running) {
          throw new ConflictError(`${who.name} “${running.title}” görevinde (no ${running.id}) çalışıyor; uyutmak süren işini durdurur. Önce görevi \`taskPark\` ile park et ya da bitirmesini bekle.`);
        }
        await engine.sleep(who.id);
        return `${who.name} uyudu.`;
      },
    },
    {
      name: 'wake',
      description: 'Wake a sleeping employee (coordinator).',
      inputSchema: object({ employee: s('Employee id or name.') }, ['employee']),
      kinds: COORDINATOR,
      run: (_ctx, args) => {
        const who = findPerson(str(args, 'employee'));
        engine.wake(who.id);
        return `${who.name} uyandı.`;
      },
    },
    {
      name: 'propose',
      description:
        'Carry something upwards: need (something the work requires), purchase (anything that costs money: a phone line, a subscription, a device), idea, or objection (we are on the wrong track). It goes to your lead or the coordinator; purchases go to the owner, who pays and buys.',
      inputSchema: object({ kind: { type: 'string', enum: [...PROPOSAL_KINDS] }, title: s('Short title.'), text: s('What, why, and what you suggest.'), usd: number('For a purchase: the price, USD.'), planId: s('The plan it concerns.') }, ['kind', 'title', 'text']),
      kinds: EVERYONE,
      run: ({ employee }, args) => {
        const p = company.openProposal(employee.id, { kind: str(args, 'kind'), title: str(args, 'title'), text: str(args, 'text'), usd: num(args, 'usd') ?? null, planId: optStr(args, 'planId') ?? null });
        return p.status === 'owner' ? `Talep açıldı (${p.id}) ve sahibine gitti; karar verince haber gelecek.` : `Öneri açıldı (${p.id}); ${company.nameOf(p.routedTo!)} karara bağlayacak.`;
      },
    },
    {
      name: 'proposalsOpen',
      description: 'List the proposals waiting for your decision (lead or coordinator).',
      inputSchema: object({}),
      kinds: LEADS,
      run: ({ employee }) => {
        const open = company.proposalsFor(employee.id);
        if (open.length === 0) return 'Kararını bekleyen öneri yok.';
        return open.map((p) => `• ${p.id} [${p.kind}] “${p.title}” — ${company.nameOf(p.by)}: ${p.text}`).join('\n');
      },
    },
    {
      name: 'proposalDecide',
      description: 'Decide a proposal that came to you (lead or coordinator): accept, decline, or escalate (a lead to the coordinator, the coordinator to the owner — do that for anything big). The decision goes to the decision log and the proposer hears.',
      inputSchema: object({ proposalId: s('The proposal id.'), decision: { type: 'string', enum: ['accept', 'decline', 'escalate'] }, note: s('Why, in a sentence.') }, ['proposalId', 'decision']),
      kinds: LEADS,
      run: ({ employee }, args) => {
        const p = company.decideProposal(employee.id, str(args, 'proposalId'), { decision: str(args, 'decision'), note: optStr(args, 'note') });
        return p.status === 'accepted' ? `“${p.title}” kabul edildi.` : p.status === 'declined' ? `“${p.title}” reddedildi.` : p.status === 'owner' ? `“${p.title}” sahibine götürüldü.` : `“${p.title}” koordinatöre götürüldü.`;
      },
    },
    {
      name: 'askColleague',
      description: 'Ask a colleague a quick question without interrupting them: a copy of their session answers from what they know and are doing. It cannot do work for you (use taskPass for that). Takes up to a couple of minutes.',
      inputSchema: object({ to: s('Colleague id or name.'), question: s('The question.') }, ['to', 'question']),
      kinds: EVERYONE,
      run: async ({ employee }, args) => {
        const question = str(args, 'question');
        const to = findPerson(str(args, 'to'));
        if (to.id === employee.id) throw new ValidationError('Kendine soramazsın.');
        const out = await engine.sideQuestion(to.id, `${employee.name}${employee.title ? ` (${employee.title})` : ''} soruyor; kısaca, bildiğin kadarıyla cevap ver: ${question}`);
        return out.ok ? `${to.name}: ${out.answer}` : `${to.name} şu an cevap veremedi: ${out.answer}`;
      },
    },
    {
      name: 'appointLead',
      description: 'Make an employee the lead of a team (coordinator) — do it when a team grows past 4–5 people. The team reports to them; they hand out and order its work and settle its proposals, but cannot hire. lead: false ends it.',
      inputSchema: object({ employee: s('Employee id or name.'), team: s('The team they lead.'), lead: { type: 'boolean', description: 'false ends the leadership (default true).' } }, ['employee']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const lead = bool(args, 'lead');
        const team = optStr(args, 'team');
        const who = findPerson(str(args, 'employee'));
        const next = company.appointLead(employee.id, who.id, { team, lead });
        return next.kind === 'lead' ? `${next.name} artık ${next.team} ekibinin lideri.` : `${next.name} artık ekip lideri değil.`;
      },
    },
    {
      name: 'taskCreate',
      description:
        'Open a task for someone (coordinator). With planId it belongs to an approved plan. Use dependsOn for "start when that part is done". Give a difficulty: when difficulty models are on in the constitution, the task starts on its model (by default easy → haiku, medium → sonnet, hard → opus, critical → fable), so routine work does not run on an expensive model.',
      inputSchema: object({ assignee: s('Employee id or name.'), title: s('Short title.'), description: s('What is needed and why.'), done: strings('Definition of done.'), priority: integer('1 = most urgent … 5 = whenever.', 1, 5), difficulty, reviewer, planId: s('Id of the approved plan this belongs to.'), dependsOn: strings('Task ids that must be done first.'), startAfter, dueAt, requires }, ['assignee', 'title']),
      kinds: LEADS,
      run: ({ employee }, args) => {
        const input = { title: str(args, 'title'), description: optStr(args, 'description'), done: list(args, 'done'), priority: num(args, 'priority'), difficulty: difficultyArg(args), planId: optStr(args, 'planId') ?? null, dependsOn: list(args, 'dependsOn'), startAfter: optStr(args, 'startAfter'), dueAt: optStr(args, 'dueAt'), requires: list(args, 'requires') };
        const to = findPerson(str(args, 'assignee'));
        if (employee.kind === 'lead' && to.id !== employee.id && to.team !== employee.team) {
          throw new ForbiddenError('Ekip lideri taskCreate ile yalnız kendi ekibine görev açar; başkasına taskPass ile pasla.');
        }
        const task = company.createTask(employee.id, { assignee: to.id, ...input, reviewer: reviewerArg(args) });
        const when = [task.notBefore ? `başlangıç ${formatWhen(task.notBefore, Date.now())}` : '', task.dueAt ? `son tarih ${formatWhen(task.dueAt, Date.now())}` : ''].filter(Boolean).join(', ');
        return `Görev açıldı: ${task.id} “${task.title}” → ${to.name}${when ? ` (${when})` : ''}.${deskBrief(task.requires, to.id, `Gereken yetenekler, ${to.name} masasında`, 'Görev yine açıldı')}`;
      },
    },
    {
      name: 'taskAssign',
      description: 'Give a waiting or blocked task to someone else (coordinator); with difficulty, also say anew how hard it is.',
      inputSchema: object({ taskId: s('The task id.'), assignee: s('Employee id or name.'), difficulty, reviewer }, ['taskId', 'assignee']),
      kinds: LEADS,
      run: ({ employee }, args) => {
        const to = findPerson(str(args, 'assignee'));
        const task = company.assign(employee.id, str(args, 'taskId'), to.id, { difficulty: difficultyArg(args), reviewer: reviewerArg(args) });
        return `“${task.title}” artık ${to.name} adlı çalışanda.${deskBrief(task.requires, to.id, `Gereken yetenekler, ${to.name} masasında`)}`;
      },
    },
    {
      name: 'taskReprioritize',
      description: 'Change a task’s priority (coordinator): 1 = most urgent … 5 = whenever.',
      inputSchema: object({ taskId: s('The task id.'), priority: integer('New priority.', 1, 5) }, ['taskId', 'priority']),
      kinds: LEADS,
      run: ({ employee }, args) => {
        const priority = num(args, 'priority');
        if (priority === undefined) throw new ValidationError('priority gerekli.');
        const task = company.reprioritize(employee.id, str(args, 'taskId'), priority);
        return `“${task.title}” önceliği ${task.priority}.`;
      },
    },
    {
      name: 'planPropose',
      description:
        'Propose a plan card to the owner before starting any work they asked for: goal, approach, the method (work type, stages with who does and who checks each, quality checks — read methodRead first), who works on it (existing people and roles to hire), draft tasks, estimates (share of weekly quota %, money in USD, days) and risks. The owner approves it on screen.',
      inputSchema: object({ title: s('Plan title.'), goal: s('What the owner wants to achieve.'), approach: s('How you will do it.'), method, goalId: s('The active goal this plan serves (from goalSet / goalsRead).'), people: s('Who works on it.'), steps: strings('Draft tasks, one each.'), quotaPct: number('Estimated share of the weekly Claude quota, %.'), usd: number('Estimated money to spend, USD.'), days: number('Estimated days.'), risks: s('What could go wrong.') }, ['title', 'goal', 'approach', 'method']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const plan = company.propose(employee.id, { title: str(args, 'title'), goal: str(args, 'goal'), approach: str(args, 'approach'), method: args.method, goalId: optStr(args, 'goalId') ?? null, people: optStr(args, 'people'), steps: list(args, 'steps'), quotaPct: num(args, 'quotaPct') ?? null, usd: num(args, 'usd') ?? null, days: num(args, 'days') ?? null, risks: optStr(args, 'risks') });
        if (plan.status === 'approved') return `Plan başladı (${plan.id}): tam serbestsin, sahibini beklemiyorsun. Görevleri taskCreate ile aç ve dağıt; sahibi kartı görüyor ve isterse durdurabilir.`;
        return `Plan kartı açıldı (${plan.id}). Sahibinin onayını bekle; onay gelince sana haber verilecek.`;
      },
    },
    {
      name: 'planRevise',
      description: 'Revise a plan card (only the fields you pass change). Revising an approved plan sends it back to the owner for approval.',
      inputSchema: object({ planId: s('The plan id.'), title: s('Plan title.'), goal: s('Goal.'), approach: s('Approach.'), method, people: s('Who.'), steps: strings('Draft tasks.'), quotaPct: number('Quota share, %.'), usd: number('Money, USD.'), days: number('Days.'), risks: s('Risks.') }, ['planId']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const plan = company.revise(employee.id, str(args, 'planId'), { title: optStr(args, 'title'), goal: optStr(args, 'goal'), approach: optStr(args, 'approach'), method: args.method, people: optStr(args, 'people'), steps: list(args, 'steps'), quotaPct: num(args, 'quotaPct'), usd: num(args, 'usd'), days: num(args, 'days'), risks: optStr(args, 'risks') });
        return plan.status === 'approved' ? `Plan güncellendi: sürüm ${plan.version}, sürüyor.` : `Plan güncellendi: sürüm ${plan.version}, sahibinin onayını bekliyor.`;
      },
    },
    {
      name: 'planRetro',
      description:
        'Assess a plan when it ends (coordinator): what went well, what got stuck, what to change next time, and — if it would help every company — a method suggestion for the office’s craft. Then write company-specific lessons with playbookUpdate and report to the owner.',
      inputSchema: object({ planId: s('The plan id.'), wentWell: s('What went well.'), stuck: s('What got stuck or went wrong.'), change: s('What to do differently next time.'), methodSuggestion: s('A change to the work-type method that would help any company (optional).') }, ['planId', 'wentWell', 'stuck', 'change']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const { suggestion } = company.retro(employee.id, str(args, 'planId'), { wentWell: str(args, 'wentWell'), stuck: str(args, 'stuck'), change: str(args, 'change'), methodSuggestion: optStr(args, 'methodSuggestion') });
        return `Değerlendirme şirket notlarına yazıldı${suggestion ? ' (yöntem önerisi ayrıca)' : ''}. Şirkete özgü dersleri playbookUpdate ile el kitabına işle, sonra reportToOwner ile sahibine kısaca raporla.`;
      },
    },
    {
      name: 'goalSet',
      description:
        'Open, change or close a goal (coordinator) — the lasting aims above the plans, taken from the company mission: a title, why it serves the mission, and a measurable definition of done. Without goalId it opens a new one; with goalId it changes it (status done or dropped closes it, active reopens it). Keep few goals active.',
      inputSchema: object({
        goalId: s('The goal to change; omit to open a new one.'), title: s('Goal title.'), why: s('Why it matters to the mission.'), done: strings('When it counts as reached, one measurable item each.'),
        status: { type: 'string', enum: ['active', 'done', 'dropped'] }, note: s('A note, e.g. why it was closed.'),
        kpis: {
          type: 'array',
          maxItems: 8,
          description: `The goal's KPIs, the whole list (replaces it; [] clears it; omit to keep them): each a name, a target number, direction atLeast or atMost, a unit (%, gün, sipariş …), the source — manual (read by hand), capability (from a connection) or office (one of the office's own metrics: ${Object.keys(KPI_OFFICE_METRICS).join(', ')}; its unit comes with it) — and how often it is read.`,
          items: {
            type: 'object',
            properties: {
              name: s('KPI name.'), target: { type: 'number', description: 'Target value (a % is 0–100).' }, direction: { type: 'string', enum: [...KPI_DIRECTIONS] }, unit: s('Unit; not needed for source office.'),
              source: { type: 'string', enum: [...KPI_SOURCES] }, metric: { type: 'string', enum: Object.keys(KPI_OFFICE_METRICS), description: 'Only for source office.' }, cadence: { type: 'string', enum: [...KPI_CADENCES] },
            },
            required: ['name', 'target', 'direction', 'source', 'cadence'],
          },
        },
      }),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const goal = company.goalSet(employee.id, { goalId: optStr(args, 'goalId'), title: optStr(args, 'title'), why: optStr(args, 'why'), done: args.done as string[] | undefined, kpis: args.kpis, status: optStr(args, 'status'), note: optStr(args, 'note') });
        if (!optStr(args, 'goalId')) return `Hedef açıldı (${goal.id}): “${goal.title}”. Planlarını planPropose ile goalId vererek başlat.`;
        return `Hedef güncellendi: “${goal.title}” (${goal.status}).`;
      },
    },
    {
      name: 'performanceRead',
      description:
        'Read how the work went, from the office’s own log (coordinator or team lead): per person and per plan the work tasks done and open, the first-pass approval rate, the average review rounds to approval, the average cost and time per task, blocks, parks and overdue; and the Claude usage reconciled to every turn. With employee or plan: that one and its tasks. days: only the last days.',
      inputSchema: object({ employee: s('Employee id or name.'), plan: s('Plan id.'), days: integer('Only the last days.', 1, 365) }),
      kinds: LEADS,
      run: (_ctx, args) => {
        if (!o.performance) throw new ConflictError('Bu ofiste performans okuması yok.');
        const days = num(args, 'days');
        if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 365)) throw new ValidationError('days 1 ile 365 arasında bir tam sayı olmalı.');
        const who = optStr(args, 'employee');
        const planId = optStr(args, 'plan');
        if (planId !== undefined && !plans().some((p) => p.id === planId)) throw new NotFoundError(`Plan bulunamadı: ${planId}`);
        return formatPerformance(o.performance.report({ days }), { employee: who === undefined ? undefined : findPerson(who).id, plan: planId, days });
      },
    },
    {
      name: 'roleTemplates',
      description: 'Read the role template catalog (coordinator or team lead): without id, every template with its title, model, methods and one line; with id, one whole — defaults, capabilities, checks, measures and the role text a hire from it gets. Hire from one with hire(template).',
      inputSchema: object({ id: s('Template id.') }),
      kinds: LEADS,
      run: (_ctx, args) => {
        const id = optStr(args, 'id');
        if (id === undefined) {
          const all = listRoleTemplates();
          return [`# Rol şablonları (${all.length})`, ...all.map((t) => `• ${t.id} — ${t.title} (${t.model}; yöntem: ${t.methods.join(', ')}): ${t.summary}`)].join('\n');
        }
        const t = roleTemplate(id);
        return [
          `# ${t.title} (${t.id}, sürüm ${t.version})`,
          `Model: ${t.model} · Ekip: ${t.team} · Yöntemler: ${t.methods.join(', ')} · Yetenekler: ${t.capabilities.join(', ')}`,
          '',
          templateRole(t),
        ].join('\n');
      },
    },
    {
      name: 'blueprintPropose',
      description:
        'Propose the company’s setup as a blueprint (coordinator), once the onboarding’s required questions are in: the roles (from roleTemplates, with capabilities — read capabilitiesRead and integrationsList), the playbook topics to seed, the first goals with KPIs, routines, the first tasks, optionally the brief and a closed mode (deny rules each new desk gets before its first session). The office checks it against the profile, the catalog and the constitution, shows it to the owner as a plan card (what is open, what is missing, what goes outward) and keeps it with the plan. With planId: that blueprint plan’s revision. Install it with blueprintApply once approved.',
      inputSchema: object({
        blueprint: {
          type: 'object',
          description: 'title, summary (the business in a paragraph), brief?, roles [{key, name, template?, role?, title?, team?, model?, capabilities?}], playbook [{topic, text}], goals [{key, title, why, done[], kpis?}], routines [{key, title, role (a role key or "coordinator"), reviewer?, cron, done?, description?, difficulty?}], tasks [{key, title, role, reviewer?, done?, description?, requires?, difficulty?, priority?}], closedMode? {deny[]}, estimates? {quotaPct, usd, days}, risks?. Keys: a-z, 0-9, dashes; at most 40 steps.',
        },
        planId: s('Revise this blueprint plan instead of opening a new one.'),
        goalId: s('The active goal the setup serves.'),
      }, ['blueprint']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        if (!o.blueprints) throw new ConflictError('Bu ofiste blueprint açık değil.');
        const { plan, blueprint } = o.blueprints.propose(employee.id, args.blueprint, { planId: optStr(args, 'planId'), goalId: optStr(args, 'goalId') });
        const n = plan.steps.length;
        if (plan.status === 'approved') return `Blueprint planı başladı (tam serbestlik): “${blueprint.title}” (plan ${plan.id}), ${n} adım. Şimdi blueprintApply ile kur.`;
        return `Blueprint plan kartı olarak sahibine gitti: “${blueprint.title}” (plan ${plan.id}), ${n} adım. Onaylanınca blueprintApply ile kur.`;
      },
    },
    {
      name: 'blueprintApply',
      description: 'Install an approved blueprint plan (coordinator): brief, playbook, hires, goals, routines, tasks in that order. Idempotent: a step already done — recorded, or found by its natural key (same name, title or topic) — is not done again; if it stops halfway, fix what it says and run it again, it goes on where it stopped.',
      inputSchema: object({ planId: s('The blueprint plan.') }, ['planId']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        if (!o.blueprints) throw new ConflictError('Bu ofiste blueprint açık değil.');
        return applyText(o.blueprints.apply(employee.id, str(args, 'planId')));
      },
    },
    {
      name: 'blueprintRead',
      description: 'Read a blueprint plan (coordinator or team lead): its steps and how far the install went, the profile version it stood on, and — when it has a closed mode — each installed desk’s rules as its latest session shows them (read only: no tool is called to check).',
      inputSchema: object({ planId: s('The blueprint plan.') }, ['planId']),
      kinds: LEADS,
      run: (_ctx, args) => {
        if (!o.blueprints) throw new ConflictError('Bu ofiste blueprint açık değil.');
        const planId = str(args, 'planId');
        return blueprintText(o.blueprints.read(planId), plans().find((p) => p.id === planId)!);
      },
    },
    {
      name: 'goalsRead',
      description: 'Read the company’s goals (coordinator or team lead): each active goal with why, its definition of done and its plans; then the recently closed ones.',
      inputSchema: object({}),
      kinds: LEADS,
      run: () => {
        const goals = company.goals();
        if (goals.length === 0) return 'Henüz hedef yok.';
        const plansOf = (id: string) => plans().filter((p) => p.goalId === id);
        return goals
          .map((g) => {
            const own = plansOf(g.id).map((p) => `   - ${p.title} [${p.status}]`).join('\n');
            const kpis = g.kpis.length ? `\n   KPI: ${g.kpis.map(kpiText).join('; ')}` : '';
            return `• ${g.id} “${g.title}” [${g.status}] — neden: ${g.why}\n   bitti: ${g.done.join('; ')}${kpis}${own ? `\n${own}` : ''}`;
          })
          .join('\n');
      },
    },
    {
      name: 'restUntil',
      description: 'Say there is nothing worth doing now (coordinator): for how many hours (1–168) and why. The office stops reminding you about having no goal until then; a new goal ends the rest. Never invent work to stay busy.',
      inputSchema: object({ hours: number('Hours to rest (1–168).'), reason: s('Why there is nothing worth doing now.') }, ['hours', 'reason']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const until = company.restUntil(employee.id, num(args, 'hours') ?? 0, str(args, 'reason'));
        return `Dinleniyorsun: ${new Date(until).toLocaleString('tr-TR')} tarihine kadar hedef hatırlatması gelmeyecek. Sahibinin isteği ya da yeni bir hedef bunu bitirir.`;
      },
    },
    {
      name: 'hire',
      description: `Hire a new employee (coordinator). From a role template (template; read them with roleTemplates): the role text, title, team and model come from it; role is then this company's own part (brand voice, channels, language, limits from the profile) and title, team or model given override the template's. Without a template: the role card text (responsibilities, how to work, what "done" means) and the model (${MODEL_ALIASES.join(', ')}) are required. Desks are limited.`,
      inputSchema: {
        ...object(
          {
            name: s('Name.'), template: { type: 'string', enum: listRoleTemplates().map((t) => t.id), description: 'Role template id (roleTemplates).' }, title: s('Job title.'), team: s('Team.'),
            role: s('Without a template: the role card. With one: this company’s own part of the role.'), model: { type: 'string', enum: [...MODEL_ALIASES] },
            capabilities: strings('The capabilities the role needs, from the vocabulary (capabilitiesRead): the whole list, replacing the template’s; none given, the template’s. The reply says how the new desk has each.'),
            characterId: { type: 'string', enum: characterList(), description: 'Look in the 3D office.' },
          },
          ['name'],
        ),
      },
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const template = optStr(args, 'template');
        // Without a template, as before: role and model are required.
        const model = (template === undefined ? str(args, 'model') : optStr(args, 'model')) as ModelAlias | undefined;
        if (model !== undefined && !(MODEL_ALIASES as readonly string[]).includes(model)) throw new ValidationError(`Bilinmeyen model: ${model}. Seçenekler: ${MODEL_ALIASES.join(', ')}.`);
        const role = template === undefined ? str(args, 'role') : (optStr(args, 'role') ?? '');
        const hired = company.hire(employee.id, { name: str(args, 'name'), role, template, title: optStr(args, 'title'), team: optStr(args, 'team'), model, characterId: optStr(args, 'characterId'), reportsTo: null, capabilities: list(args, 'capabilities') });
        const from = hired.template ? `, şablon ${hired.template.id} (sürüm ${hired.template.version})` : '';
        return `İşe alındı: ${hired.name} (${hired.id}), masa ${hired.deskIndex + 1}, model ${hired.model}${from}.${deskBrief(hired.capabilities, hired.id, 'Yetenekler')}`;
      },
    },
    {
      name: 'editRoleCard',
      description: 'Rewrite someone’s role card (coordinator): title, team, the role text and/or the capabilities the role needs (the whole list; [] clears it). It takes effect when their session next loads it.',
      inputSchema: object({ employee: s('Employee id or name.'), title: s('Job title.'), team: s('Team.'), role: s('Role card text.'), capabilities: strings('The capabilities the role needs, from the vocabulary (capabilitiesRead): the whole list.') }, ['employee']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const who = findPerson(str(args, 'employee'));
        const capabilities = list(args, 'capabilities');
        const next = company.editRoleCard(employee.id, who.id, { title: optStr(args, 'title'), team: optStr(args, 'team'), role: optStr(args, 'role'), capabilities });
        return `${next.name} adlı çalışanın rol kartı güncellendi.${capabilities === undefined ? '' : deskBrief(next.capabilities, next.id, 'Yetenekler')}`;
      },
    },
    {
      name: 'briefUpdate',
      description: 'Replace the company brief (coordinator): mission, running plans, who does what, ground rules. Keep it short (max ~2 pages); every desk gets the new copy.',
      inputSchema: object({ text: s('The whole brief, in Markdown.') }, ['text']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        company.updateBrief(employee.id, str(args, 'text'));
        return 'Şirket özeti güncellendi ve bütün masalara dağıtıldı.';
      },
    },
    {
      name: 'profileUpdate',
      description: `Write one section of the company profile (coordinator): the fields given replace theirs, null or an empty value removes one, the others stay; every change is a new version. assumed (required) is about the fields given in this call only: true when you filled them in without the owner saying so, false when they are the owner's word — give an assumed field again with assumed: false once the owner confirms it; the other fields keep their mark. The brief is not changed. Sections and fields (name[] = a list of texts): ${profileFieldsHelp()}.`,
      inputSchema: object(
        {
          section: { type: 'string', enum: [...PROFILE_SECTIONS], description: 'The section.' },
          fields: { type: 'object', description: 'Field → text, list of texts, or null to remove.' },
          assumed: { type: 'boolean', description: 'The fields given here: true = your assumption, false = the owner said so.' },
        },
        ['section', 'fields', 'assumed'],
      ),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const before = company.profile().version;
        const entry = company.profileUpdate(employee.id, { section: args.section, fields: args.fields, assumed: args.assumed });
        const label = PROFILE_SPEC[entry.section].label;
        if (entry.version <= before) return `Değişiklik yok: ${label} (sürüm ${entry.version}) zaten böyle.`;
        return entry.assumed
          ? `Profil güncellendi: ${label} (sürüm ${entry.version}; varsayım: ${entry.assumedFields.join(', ')}). Sahibi doğrulayınca bu alanları assumed: false ile yeniden yaz.`
          : `Profil güncellendi: ${label} (sürüm ${entry.version}).`;
      },
    },
    {
      name: 'integrationRegister',
      description: `Record a connector in the integration registry by hand (coordinator): one the sessions do not show (an adapter or a CLI, give kind), or notes on one they do — capabilities, what the owner must do (authNeeded), cost, a note — or close it (closed: true; the registry marks it, B9 will shut it in sessions). Fields given are written, the others kept. Kinds: ${INTEGRATION_KINDS.join(', ')}.`,
      inputSchema: object(
        {
          name: s('Connector name as the sessions report it (e.g. "claude.ai Gmail") or your own.'), kind: { type: 'string', enum: [...INTEGRATION_KINDS] }, capabilities: strings('What it can do, e.g. email.read, social.publish.'),
          authNeeded: s('What the owner must do to make it work.'), costNote: s('What it costs.'), note: s('A note.'), closed: { type: 'boolean', description: 'Closed: not to be used.' },
        },
        ['name'],
      ),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        if (!o.integrations) throw new ConflictError('Bu ofiste entegrasyon kaydı yok.');
        const i = o.integrations.register(employee.id, { name: args.name, kind: args.kind, capabilities: args.capabilities, authNeeded: args.authNeeded, costNote: args.costNote, note: args.note, closed: args.closed });
        // Kept as written (B3); only the vocabulary's ids take part in a match (B7).
        const unknown = args.capabilities === undefined ? [] : unknownCapabilities(i.capabilities);
        const warn = unknown.length ? `\nSözlükte olmayan yetenek: ${unknown.join(', ')} — eşleşmede kullanılmaz (sözlük: capabilitiesRead).` : '';
        return `Kayıt güncellendi: ${i.name} [${INTEGRATION_STATUS_LABELS[i.status]}].${warn}`;
      },
    },
    {
      name: 'onboardingStart',
      description: 'Start the onboarding (coordinator) when the owner tells what the company does: their sentence goes into the profile as their word and the dialog opens; the reply is the guide to follow.',
      inputSchema: object({ description: s('The owner’s own sentence about what the company does.') }, ['description']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        company.onboardingStart(employee.id, str(args, 'description'));
        return `Onboarding başladı: iş tarifi profile sahibinin sözü olarak yazıldı (identity.summary).\n\n${onboardingGuideText()}`;
      },
    },
    {
      name: 'onboardingNext',
      description: 'The next onboarding questions to ask the owner in one message (coordinator): at most five, required first, your guesses to confirm; and the questions asked twice without an answer, to fill by assumption. A round counts once the owner replied after it; until then this gives the same round again and records nothing. optional: true brings the optional questions once the required are in.',
      inputSchema: object({ optional: { type: 'boolean', description: 'Also the optional questions (once the required are in).' } }),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        return nextText(company.onboardingNext(employee.id, { optional: bool(args, 'optional') }));
      },
    },
    {
      name: 'onboardingRead',
      description: 'Where the onboarding stands (coordinator), recording nothing: the questions answered, assumed and open, the round still waiting for the owner or the one that would come next, and what to fill by assumption. Use it to look again, e.g. after your session restarted.',
      inputSchema: object({ optional: { type: 'boolean', description: 'Show the optional questions that would come (once the required are in).' } }),
      kinds: COORDINATOR,
      run: ({ employee }, args) => nextText(company.onboardingPeek(employee.id, { optional: bool(args, 'optional') }), 'read'),
    },
    {
      name: 'onboardingFinish',
      description: 'End the onboarding (coordinator) once no required question is open: answered by the owner or filled by assumption (marked). The reply counts the assumptions to tell the owner.',
      inputSchema: object({}),
      kinds: COORDINATOR,
      run: ({ employee }) => {
        const view = company.onboardingFinish(employee.id);
        const req = view.questions.filter((v) => v.required);
        const assumed = req.filter((v) => v.state === 'assumed').map((v) => v.id);
        const owners = req.length - assumed.length;
        return `Onboarding bitti: zorunlu ${req.length} sorunun ${ofThem(owners)} sahibinden${assumed.length ? `, ${ofThem(assumed.length)} varsayım (${assumed.join(', ')}). Varsayımları sahibine kısaca bildir; doğrularsa profileUpdate(…, assumed: false).` : '.'}`;
      },
    },
    {
      name: 'reportToOwner',
      description: 'Report to the owner (coordinator): a finished plan, a small change you decided, a daily summary, or a request that needs them.',
      inputSchema: object({ text: s('The report.') }, ['text']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        company.report(employee.id, str(args, 'text'));
        return 'Rapor sahibine iletildi.';
      },
    },
  ];
}
