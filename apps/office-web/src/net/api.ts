import type { AgendaReport, Approval, BudgetSummary, Constitution, Decision, Employee, EmployeeFile, Goal, HireInput, ManagementLog, Note, OfficeMetrics, OfficeSnapshot, Plan, PlaybookEntry, Proposal, Schedule, Spend, StoredEvent, Task } from '@cc/shared';

export class ApiError extends Error {
  readonly status: number;
  /** The server's machine-readable reason, when it gives one (e.g. owner_nonce). */
  readonly code: string | undefined;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The page's nonce for the owner's changes (office-server owner-guard.ts); fetched again a minute before it expires. */
let ownerNonce: { nonce: string; expiresAt: number } | null = null;

async function nonce(): Promise<string> {
  // B9a (review round 1): an employee's browser is driven by automation (Playwright sets navigator.webdriver). The
  // owner's changes come from the owner's own browser only: a driven page — reached by a redirect the gate cannot see —
  // asks for no nonce, so no approve button works there. A determined script can still forge it (§8 of the B9a note).
  if (typeof navigator !== 'undefined' && navigator.webdriver) {
    throw new ApiError(403, 'Bu sayfa otomasyonla açılmış (navigator.webdriver); sahibi işlemleri yalnız sahibinin kendi tarayıcısından yapılır.', 'owner_automation');
  }
  if (!ownerNonce || ownerNonce.expiresAt - Date.now() < 60_000) ownerNonce = await send<{ nonce: string; expiresAt: number }>('GET', '/api/owner/nonce');
  return ownerNonce.nonce;
}

async function send<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const init: RequestInit =
    method === 'POST'
      ? { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? '{}' : JSON.stringify(body) }
      : { method, ...(method === 'DELETE' ? { headers } : {}), body: undefined };
  const res = await fetch(path, init);
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const error = data as { error?: unknown; code?: unknown } | null;
    throw new ApiError(res.status, typeof error?.error === 'string' ? error.error : `İstek başarısız (HTTP ${res.status}).`, typeof error?.code === 'string' ? error.code : undefined);
  }
  return data as T;
}

/** A change carries the page's nonce; one the server no longer knows (it restarted, the laptop slept) is fetched again once. */
async function request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  if (method === 'GET') return send<T>(method, path, body);
  try {
    return await send<T>(method, path, body, { 'x-owner-nonce': await nonce() });
  } catch (err) {
    if (!(err instanceof ApiError && err.code === 'owner_nonce')) throw err;
    ownerNonce = null;
    return send<T>(method, path, body, { 'x-owner-nonce': await nonce() });
  }
}

const employee = (id: string) => `/api/employees/${encodeURIComponent(id)}`;

/** For tests: forget the page's nonce. */
export function resetOwnerNonce(): void {
  ownerNonce = null;
}

export const api = {
  codexRequests: (id: string) => request<Array<{ id: string; method: string; params: Record<string, unknown> }>>('GET', `${employee(id)}/codex-requests`),
  answerCodexRequest: (id: string, requestId: string, action: string, content?: unknown) => request('POST', `${employee(id)}/codex-requests`, { requestId, action, content }),
  office: () => request<OfficeSnapshot>('GET', '/api/office'),
  hire: (input: HireInput) => request<Employee>('POST', '/api/employees', input),
  approvePlan: (id: string) => request<Plan>('POST', `/api/plans/${encodeURIComponent(id)}/approve`),
  declinePlan: (id: string) => request<Plan>('POST', `/api/plans/${encodeURIComponent(id)}/decline`),
  stopPlan: (id: string) => request<Plan>('POST', `/api/plans/${encodeURIComponent(id)}/stop`),
  stopGoal: (id: string) => request<Goal>('POST', `/api/goals/${encodeURIComponent(id)}/stop`),
  pauseCompany: () => request<{ paused: boolean }>('POST', '/api/company/pause'),
  resumeCompany: () => request<{ paused: boolean }>('POST', '/api/company/resume'),
  appointCoordinator: (employeeId: string) => request<Employee>('POST', '/api/company/coordinator', { employeeId }),
  hireCoordinator: (provider?: 'claude' | 'codex') => request<Employee>('POST', '/api/company/coordinator/hire', { provider }),
  switchProvider: (id: string, provider: 'claude' | 'codex') => request<Employee>('POST', `/api/employees/${id}/provider`, { provider }),
  /** Without `now` the company first asks for a hand-over and answers with that task; `now` fires at once (null). */
  fire: (id: string, now = false) => request<{ handover: Task } | null>('DELETE', `${employee(id)}${now ? '?now=1' : ''}`),
  employeeFile: (id: string) => request<EmployeeFile>('GET', `${employee(id)}/file`),
  budget: () => request<BudgetSummary>('GET', '/api/budget'),
  spending: (planId?: string) => request<Spend[]>('GET', `/api/budget/spend${planId ? `?planId=${encodeURIComponent(planId)}` : ''}`),
  setConstitution: (patch: Record<string, unknown>) => request<Constitution>('POST', '/api/constitution', patch),
  proposals: () => request<Proposal[]>('GET', '/api/proposals'),
  /** B9a: the owner's approvals of calls the gate held; deciding goes through the owner guard like every change. */
  approvals: () => request<Approval[]>('GET', '/api/approvals'),
  approveApproval: (id: string, note?: string) => request<Approval>('POST', `/api/approvals/${encodeURIComponent(id)}/approve`, note ? { note } : {}),
  denyApproval: (id: string, note?: string) => request<Approval>('POST', `/api/approvals/${encodeURIComponent(id)}/deny`, note ? { note } : {}),
  approveProposal: (id: string, note?: string) => request<Proposal>('POST', `/api/proposals/${encodeURIComponent(id)}/approve`, note ? { note } : {}),
  rejectProposal: (id: string, note?: string) => request<Proposal>('POST', `/api/proposals/${encodeURIComponent(id)}/reject`, note ? { note } : {}),
  decisions: () => request<Decision[]>('GET', '/api/memory/decisions'),
  revertDecision: (id: string) => request<Decision>('POST', `/api/decisions/${encodeURIComponent(id)}/revert`),
  playbook: () => request<PlaybookEntry[]>('GET', '/api/memory/playbook'),
  playbookHistory: (topic: string) => request<PlaybookEntry[]>('GET', `/api/memory/playbook/history?topic=${encodeURIComponent(topic)}`),
  notes: (q = '') => request<Array<{ note: Note; snippet: string }>>('GET', `/api/memory/notes${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`),
  send: (id: string, text: string) => request<{ ok: true }>('POST', `${employee(id)}/messages`, { text }),
  sideQuestion: (id: string, text: string) => request<{ ok: boolean; answer: string }>('POST', `${employee(id)}/side-questions`, { text }),
  stop: (id: string) => request<Employee>('POST', `${employee(id)}/stop`),
  resume: (id: string) => request<Employee>('POST', `${employee(id)}/resume`),
  openTerminal: (id: string) => request<{ command: string; employee: Employee }>('POST', `${employee(id)}/terminal`),
  closeTerminal: (id: string) => request<Employee>('DELETE', `${employee(id)}/terminal`),
  events: (id: string, tail = 500) => request<StoredEvent[]>('GET', `${employee(id)}/events?tail=${tail}`),
  agenda: () => request<AgendaReport>('GET', '/api/agenda'),
  /** The coordinator's management log (management cycle §3.3): the cycle open now and the last `limit` recorded, newest first. */
  management: (limit?: number) => request<ManagementLog>('GET', `/api/management${limit ? `?limit=${limit}` : ''}`),
  /** The top bar's figures: busy, delivered in the last day, stuck. */
  metrics: () => request<OfficeMetrics>('GET', '/api/metrics'),
  /** `until`: relative (`+6h`, `+1d`) or local `YYYY-MM-DDTHH:MM`. */
  parkTask: (id: string, until: string, reason: string) => request<Task>('POST', `/api/tasks/${encodeURIComponent(id)}/park`, { until, reason }),
  /** "Şimdi başlasın": no park or start time any more, priority 1. */
  releaseTask: (id: string) => request<Task>('POST', `/api/tasks/${encodeURIComponent(id)}/release`),
  prioritizeTask: (id: string) => request<Task>('POST', `/api/tasks/${encodeURIComponent(id)}/prioritize`, { priority: 1 }),
  scheduleAction: (id: string, action: 'pause' | 'resume' | 'stop') => request<Schedule>('POST', `/api/schedules/${encodeURIComponent(id)}/${action}`),
};
