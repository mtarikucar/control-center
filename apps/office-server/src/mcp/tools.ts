import { MODEL_ALIASES, PROPOSAL_KINDS, REVIEW_SEVERITIES, TASK_DIFFICULTIES, WORK_TYPES, type Employee, type EmployeeKind, type MemoryHit, type ModelAlias, type Plan, type Task, type TaskDifficulty } from '@cc/shared';
import type { Budget } from '../company/budget.ts';
import type { Company } from '../company/company.ts';
import { methodText } from '../company/craft.ts';
import type { Memory } from '../company/memory.ts';
import type { TaskStore } from '../company/store.ts';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors.ts';
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

const STATUS_TR: Record<Task['status'], string> = { waiting: 'bekliyor', in_progress: 'sürüyor', review: 'incelemede', blocked: 'takıldı', parked: 'ertelendi', done: 'bitti', cancelled: 'iptal' };

function taskLine(t: Task, company: Company): string {
  const done = t.done.length ? ` — bitti tanımı: ${t.done.join('; ')}` : '';
  const review = t.reviewer ? `, inceleyen ${company.nameOf(t.reviewer)}${t.round ? `, tur ${t.round}` : ''}` : '';
  return `• [${STATUS_TR[t.status]}] ${t.id} “${t.title}” (öncelik ${t.priority}, isteyen ${company.nameOf(t.requester)}${review})${done}`;
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
}): McpTool[] {
  const { company, roster, tasks, memory, budget, engine, plans } = o;

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
      inputSchema: object({ to: s('Colleague id or name.'), title: s('Short title.'), description: s('What is needed and why.'), done: strings('Definition of done, one item each.'), priority: integer('1 = most urgent … 5 = whenever (default 3).', 1, 5), difficulty: { ...difficulty, description: `${difficulty.description} critical is for the coordinator and team leads; from anyone else it counts as hard.` }, reviewer }, ['to', 'title']),
      kinds: EVERYONE,
      run: ({ employee }, args) => {
        // Arguments first: a malformed call should say what is malformed, not that a person was not found.
        const input = { title: str(args, 'title'), description: optStr(args, 'description'), done: list(args, 'done'), priority: num(args, 'priority'), difficulty: difficultyArg(args) };
        const to = findPerson(str(args, 'to'));
        const task = company.createTask(employee.id, { assignee: to.id, ...input, reviewer: reviewerArg(args) });
        const lowered = input.difficulty === 'critical' && task.difficulty === 'hard' ? ' Zorluk “kritik” yerine “zor” sayıldı: kritik işi koordinatör ya da ekip lideri açar.' : '';
        return `“${task.title}” ${to.name} adlı çalışanın sırasına eklendi (görev ${task.id}).${lowered}`;
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
      inputSchema: object({ assignee: s('Employee id or name.'), title: s('Short title.'), description: s('What is needed and why.'), done: strings('Definition of done.'), priority: integer('1 = most urgent … 5 = whenever.', 1, 5), difficulty, reviewer, planId: s('Id of the approved plan this belongs to.'), dependsOn: strings('Task ids that must be done first.') }, ['assignee', 'title']),
      kinds: LEADS,
      run: ({ employee }, args) => {
        const input = { title: str(args, 'title'), description: optStr(args, 'description'), done: list(args, 'done'), priority: num(args, 'priority'), difficulty: difficultyArg(args), planId: optStr(args, 'planId') ?? null, dependsOn: list(args, 'dependsOn') };
        const to = findPerson(str(args, 'assignee'));
        if (employee.kind === 'lead' && to.id !== employee.id && to.team !== employee.team) {
          throw new ForbiddenError('Ekip lideri taskCreate ile yalnız kendi ekibine görev açar; başkasına taskPass ile pasla.');
        }
        const task = company.createTask(employee.id, { assignee: to.id, ...input, reviewer: reviewerArg(args) });
        return `Görev açıldı: ${task.id} “${task.title}” → ${to.name}.`;
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
        return `“${task.title}” artık ${to.name} adlı çalışanda.`;
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
      inputSchema: object({ goalId: s('The goal to change; omit to open a new one.'), title: s('Goal title.'), why: s('Why it matters to the mission.'), done: strings('When it counts as reached, one measurable item each.'), status: { type: 'string', enum: ['active', 'done', 'dropped'] }, note: s('A note, e.g. why it was closed.') }),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const goal = company.goalSet(employee.id, { goalId: optStr(args, 'goalId'), title: optStr(args, 'title'), why: optStr(args, 'why'), done: args.done as string[] | undefined, status: optStr(args, 'status'), note: optStr(args, 'note') });
        if (!optStr(args, 'goalId')) return `Hedef açıldı (${goal.id}): “${goal.title}”. Planlarını planPropose ile goalId vererek başlat.`;
        return `Hedef güncellendi: “${goal.title}” (${goal.status}).`;
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
            return `• ${g.id} “${g.title}” [${g.status}] — neden: ${g.why}\n   bitti: ${g.done.join('; ')}${own ? `\n${own}` : ''}`;
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
