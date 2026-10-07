import type { BudgetSummary, Constitution, Decision, Employee, EmployeeFile, HireInput, Note, OfficeSnapshot, Plan, PlaybookEntry, Proposal, Spend, StoredEvent, Task } from '@cc/shared';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const init: RequestInit =
    method === 'POST'
      ? { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? '{}' : JSON.stringify(body) }
      : { method, body: undefined };
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
    const message = (data as { error?: unknown } | null)?.error;
    throw new ApiError(res.status, typeof message === 'string' ? message : `İstek başarısız (HTTP ${res.status}).`);
  }
  return data as T;
}

const employee = (id: string) => `/api/employees/${encodeURIComponent(id)}`;

export const api = {
  office: () => request<OfficeSnapshot>('GET', '/api/office'),
  hire: (input: HireInput) => request<Employee>('POST', '/api/employees', input),
  approvePlan: (id: string) => request<Plan>('POST', `/api/plans/${encodeURIComponent(id)}/approve`),
  declinePlan: (id: string) => request<Plan>('POST', `/api/plans/${encodeURIComponent(id)}/decline`),
  appointCoordinator: (employeeId: string) => request<Employee>('POST', '/api/company/coordinator', { employeeId }),
  hireCoordinator: () => request<Employee>('POST', '/api/company/coordinator/hire'),
  /** Without `now` the company first asks for a hand-over and answers with that task; `now` fires at once (null). */
  fire: (id: string, now = false) => request<{ handover: Task } | null>('DELETE', `${employee(id)}${now ? '?now=1' : ''}`),
  employeeFile: (id: string) => request<EmployeeFile>('GET', `${employee(id)}/file`),
  budget: () => request<BudgetSummary>('GET', '/api/budget'),
  spending: (planId?: string) => request<Spend[]>('GET', `/api/budget/spend${planId ? `?planId=${encodeURIComponent(planId)}` : ''}`),
  setConstitution: (patch: Record<string, number | number[] | null>) => request<Constitution>('POST', '/api/constitution', patch),
  proposals: () => request<Proposal[]>('GET', '/api/proposals'),
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
};
