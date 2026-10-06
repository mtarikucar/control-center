import { MODEL_ALIASES, type Employee, type EmployeeKind, type MemoryHit, type ModelAlias, type Task } from '@cc/shared';
import type { Budget } from '../company/budget.ts';
import type { Company } from '../company/company.ts';
import type { Memory } from '../company/memory.ts';
import type { TaskStore } from '../company/store.ts';
import { NotFoundError, ValidationError } from '../errors.ts';
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

const STATUS_TR: Record<Task['status'], string> = { waiting: 'bekliyor', in_progress: 'sürüyor', blocked: 'takıldı', done: 'bitti', cancelled: 'iptal' };

function taskLine(t: Task, company: Company): string {
  const done = t.done.length ? ` — bitti tanımı: ${t.done.join('; ')}` : '';
  return `• [${STATUS_TR[t.status]}] ${t.id} “${t.title}” (öncelik ${t.priority}, isteyen ${company.nameOf(t.requester)})${done}`;
}

const s = (description: string) => ({ type: 'string', description });
const strings = (description: string) => ({ type: 'array', items: { type: 'string' }, description });
const integer = (description: string, minimum: number, maximum: number) => ({ type: 'integer', minimum, maximum, description });
const number = (description: string) => ({ type: 'number', minimum: 0, description });
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });

export function officeTools(o: {
  company: Company;
  roster: Roster;
  tasks: TaskStore;
  characters: () => string[];
  memory: Memory;
  budget: Budget;
  engine: { sleep(id: string): Promise<unknown>; wake(id: string): unknown };
}): McpTool[] {
  const { company, roster, tasks, memory, budget, engine } = o;

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

  const characterList = () => [...o.characters(), 'voxel'];

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
      description: 'Hand in a task you finished: a short summary of the result, the files you produced, and what you learned. Always call this when a task is done.',
      inputSchema: object({ taskId: s('The task id from the task message.'), summary: s('What was done, in 1–5 sentences.'), outputs: strings('Files you produced (paths).'), learned: s('Anything worth remembering for later work.') }, ['taskId', 'summary']),
      kinds: EVERYONE,
      run: ({ employee }, args) => {
        const task = company.finish(employee.id, str(args, 'taskId'), { summary: str(args, 'summary'), outputs: list(args, 'outputs') ?? [], learned: optStr(args, 'learned') ?? '' });
        return `“${task.title}” teslim edildi${task.result?.archive ? ` (arşiv: ${task.result.archive})` : ''}. İsteyen ve koordinatör haberdar edildi.`;
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
      inputSchema: object({ to: s('Colleague id or name.'), title: s('Short title.'), description: s('What is needed and why.'), done: strings('Definition of done, one item each.'), priority: integer('1 = most urgent … 5 = whenever (default 3).', 1, 5) }, ['to', 'title']),
      kinds: EVERYONE,
      run: ({ employee }, args) => {
        // Arguments first: a malformed call should say what is malformed, not that a person was not found.
        const input = { title: str(args, 'title'), description: optStr(args, 'description'), done: list(args, 'done'), priority: num(args, 'priority') };
        const to = findPerson(str(args, 'to'));
        const task = company.createTask(employee.id, { assignee: to.id, ...input });
        return `“${task.title}” ${to.name} adlı çalışanın sırasına eklendi (görev ${task.id}).`;
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
      description: 'Put an idle employee to sleep to free the machine (coordinator). Their session is kept; a task for them or a message wakes them.',
      inputSchema: object({ employee: s('Employee id or name.') }, ['employee']),
      kinds: COORDINATOR,
      run: async ({ employee }, args) => {
        const who = findPerson(str(args, 'employee'));
        if (who.id === employee.id) throw new ValidationError('Kendini uyutamazsın.');
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
      name: 'taskCreate',
      description: 'Open a task for someone (coordinator). With planId it belongs to an approved plan. Use dependsOn for "start when that part is done".',
      inputSchema: object({ assignee: s('Employee id or name.'), title: s('Short title.'), description: s('What is needed and why.'), done: strings('Definition of done.'), priority: integer('1 = most urgent … 5 = whenever.', 1, 5), planId: s('Id of the approved plan this belongs to.'), dependsOn: strings('Task ids that must be done first.') }, ['assignee', 'title']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const input = { title: str(args, 'title'), description: optStr(args, 'description'), done: list(args, 'done'), priority: num(args, 'priority'), planId: optStr(args, 'planId') ?? null, dependsOn: list(args, 'dependsOn') };
        const to = findPerson(str(args, 'assignee'));
        const task = company.createTask(employee.id, { assignee: to.id, ...input });
        return `Görev açıldı: ${task.id} “${task.title}” → ${to.name}.`;
      },
    },
    {
      name: 'taskAssign',
      description: 'Give a waiting or blocked task to someone else (coordinator).',
      inputSchema: object({ taskId: s('The task id.'), assignee: s('Employee id or name.') }, ['taskId', 'assignee']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const to = findPerson(str(args, 'assignee'));
        const task = company.assign(employee.id, str(args, 'taskId'), to.id);
        return `“${task.title}” artık ${to.name} adlı çalışanda.`;
      },
    },
    {
      name: 'taskReprioritize',
      description: 'Change a task’s priority (coordinator): 1 = most urgent … 5 = whenever.',
      inputSchema: object({ taskId: s('The task id.'), priority: integer('New priority.', 1, 5) }, ['taskId', 'priority']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const priority = num(args, 'priority');
        if (priority === undefined) throw new ValidationError('priority gerekli.');
        const task = company.reprioritize(employee.id, str(args, 'taskId'), priority);
        return `“${task.title}” önceliği ${task.priority}.`;
      },
    },
    {
      name: 'planPropose',
      description: 'Propose a plan card to the owner before starting any work they asked for: goal, approach, who works on it (existing people and roles to hire), draft tasks, estimates (share of weekly quota %, money in USD, days) and risks. The owner approves it on screen.',
      inputSchema: object({ title: s('Plan title.'), goal: s('What the owner wants to achieve.'), approach: s('How you will do it.'), people: s('Who works on it.'), steps: strings('Draft tasks, one each.'), quotaPct: number('Estimated share of the weekly Claude quota, %.'), usd: number('Estimated money to spend, USD.'), days: number('Estimated days.'), risks: s('What could go wrong.') }, ['title', 'goal', 'approach']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const plan = company.propose(employee.id, { title: str(args, 'title'), goal: str(args, 'goal'), approach: str(args, 'approach'), people: optStr(args, 'people'), steps: list(args, 'steps'), quotaPct: num(args, 'quotaPct') ?? null, usd: num(args, 'usd') ?? null, days: num(args, 'days') ?? null, risks: optStr(args, 'risks') });
        return `Plan kartı açıldı (${plan.id}). Sahibinin onayını bekle; onay gelince sana haber verilecek.`;
      },
    },
    {
      name: 'planRevise',
      description: 'Revise a plan card (only the fields you pass change). Revising an approved plan sends it back to the owner for approval.',
      inputSchema: object({ planId: s('The plan id.'), title: s('Plan title.'), goal: s('Goal.'), approach: s('Approach.'), people: s('Who.'), steps: strings('Draft tasks.'), quotaPct: number('Quota share, %.'), usd: number('Money, USD.'), days: number('Days.'), risks: s('Risks.') }, ['planId']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const plan = company.revise(employee.id, str(args, 'planId'), { title: optStr(args, 'title'), goal: optStr(args, 'goal'), approach: optStr(args, 'approach'), people: optStr(args, 'people'), steps: list(args, 'steps'), quotaPct: num(args, 'quotaPct'), usd: num(args, 'usd'), days: num(args, 'days'), risks: optStr(args, 'risks') });
        return `Plan güncellendi: sürüm ${plan.version}, sahibinin onayını bekliyor.`;
      },
    },
    {
      name: 'hire',
      description: `Hire a new employee (coordinator): name, job title, team, the role card text (responsibilities, how to work, what "done" means), the model (${MODEL_ALIASES.join(', ')}) and the look (characterId). Desks are limited.`,
      inputSchema: {
        ...object({ name: s('Name.'), title: s('Job title.'), team: s('Team.'), role: s('Role card: responsibilities and way of working.'), model: { type: 'string', enum: [...MODEL_ALIASES] }, characterId: { type: 'string', enum: characterList(), description: 'Look in the 3D office.' } }, ['name', 'role', 'model']),
      },
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const model = str(args, 'model') as ModelAlias;
        if (!(MODEL_ALIASES as readonly string[]).includes(model)) throw new ValidationError(`Bilinmeyen model: ${model}. Seçenekler: ${MODEL_ALIASES.join(', ')}.`);
        const hired = company.hire(employee.id, { name: str(args, 'name'), role: str(args, 'role'), title: optStr(args, 'title'), team: optStr(args, 'team'), model, characterId: optStr(args, 'characterId'), reportsTo: null });
        return `İşe alındı: ${hired.name} (${hired.id}), masa ${hired.deskIndex + 1}, model ${hired.model}.`;
      },
    },
    {
      name: 'editRoleCard',
      description: 'Rewrite someone’s role card (coordinator): title, team and/or the role text. It takes effect when their session next loads it.',
      inputSchema: object({ employee: s('Employee id or name.'), title: s('Job title.'), team: s('Team.'), role: s('Role card text.') }, ['employee']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const who = findPerson(str(args, 'employee'));
        const next = company.editRoleCard(employee.id, who.id, { title: optStr(args, 'title'), team: optStr(args, 'team'), role: optStr(args, 'role') });
        return `${next.name} adlı çalışanın rol kartı güncellendi.`;
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
