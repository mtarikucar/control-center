import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelAlias, OfficeEvent, Usage } from '@cc/shared';
import { codexItem, codexQuota, codexUsage } from './normalize.ts';
import { CodexRpc, num, obj, str, type Obj } from './rpc.ts';

export const CODEX_SESSION_FILE = 'codex-session.json';
export const CODEX_EFFORT: Record<ModelAlias, string> = { haiku: 'low', sonnet: 'medium', opus: 'high', fable: 'xhigh' };
export function codexSession(cwd: string): string | null {
  const file = join(cwd, CODEX_SESSION_FILE);
  if (!existsSync(file)) return null;
  const id = str(obj(JSON.parse(readFileSync(file, 'utf8'))).threadId);
  if (!id) throw new Error('Codex oturum kaydı geçersiz; hafızayı kaybetmemek için yeni oturum açılmadı');
  return id;
}

export interface CodexOptions {
  command: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  model?: string;
  preset: ModelAlias;
  instructions: string;
  mcp?: { url: string; token: string };
  gate?: { url: string; token: string };
  /** Side questions fork the parent's history, deny mutations and never overwrite the desk's session. */
  fork?: string;
  requireSession?: boolean;
}
export interface CodexHandlers {
  onEvent: (event: OfficeEvent) => void;
  onAcknowledged?: (uuid: string) => void;
  onExit: (code: number | null, signal: NodeJS.Signals | null, stderr: string) => void;
}

export class CodexProcess {
  readonly #rpc: CodexRpc;
  readonly #o: CodexOptions;
  readonly #h: CodexHandlers;
  readonly #ready: Promise<void>;
  #chain: Promise<void> = Promise.resolve();
  #threadId = '';
  #turnId = '';
  #pendingInputs = 0;
  #closing = false;
  #effort: string | null = null;
  #usage: Usage = codexUsage(null);
  #lastUsage: Usage = codexUsage(null);
  #limits: Obj = {};
  readonly #items = new Map<string, Obj>();

  constructor(o: CodexOptions, h: CodexHandlers) {
    this.#o = o; this.#h = h;
    this.#rpc = new CodexRpc({ command: o.command, cwd: o.cwd, env: { ...(o.env ?? process.env), ...(o.mcp ? { OFFICE_CODEX_MCP_TOKEN: o.mcp.token } : {}) }, onMessage: (m) => this.#message(m), onExit: h.onExit });
    this.#ready = this.#start();
    // A failed handshake closes the process so the engine can recover or mark the employee unavailable.
    void this.#ready.catch((err: unknown) => {
      h.onEvent({ type: 'error', message: `Codex açılamadı: ${err instanceof Error ? err.message : String(err)}` });
      void this.#rpc.close();
    });
  }
  get exited(): boolean { return this.#rpc.exited; }
  get stderrTail(): string { return this.#rpc.stderrTail; }

  async #start(): Promise<void> {
    await this.#rpc.initialize();
    const account = await this.#rpc.request('account/read', { refreshToken: false });
    if (account.requiresOpenaiAuth === true && !account.account) throw new Error('Önce codex login ile giriş yapın');
    const config = obj((await this.#rpc.request('config/read', { includeLayers: false })).config);
    const overrides: Obj = { 'features.apps': false, 'features.multi_agent': false, 'features.image_generation': !this.#o.fork };
    // Claude's tool-deny and PreToolUse policies cannot govern Codex connectors. Expose only office tools until
    // connector policy has a native Codex implementation; inherited user/plugin connectors are disabled.
    for (const name of Object.keys(obj(config.mcp_servers))) overrides[`mcp_servers.${name}.enabled`] = false;
    for (const name of Object.keys(obj(config.plugins))) overrides[`plugins.${name}.enabled`] = false;
    if (this.#o.mcp && !this.#o.fork) {
      overrides['mcp_servers.office'] = { url: this.#o.mcp.url, bearer_token_env_var: 'OFFICE_CODEX_MCP_TOKEN', required: true, default_tools_approval_mode: 'approve' };
    }
    const model = this.#o.model || str(config.model);
    const catalog = await this.#rpc.request('model/list', { limit: 100 });
    const models = Array.isArray(catalog.data) ? catalog.data.map(obj) : [];
    const selected = models.find((m) => m.model === model || m.id === model) ?? (!model ? models.find((m) => m.isDefault === true) : undefined);
    const supported = Array.isArray(selected?.supportedReasoningEfforts) ? selected.supportedReasoningEfforts.map((e) => str(obj(e).reasoningEffort)) : [];
    const wanted = CODEX_EFFORT[this.#o.preset];
    this.#effort = supported.includes(wanted) ? wanted : str(selected?.defaultReasoningEffort) || null;
    const params: Obj = {
      cwd: this.#o.cwd, approvalPolicy: 'untrusted', approvalsReviewer: 'user', sandbox: 'read-only',
      developerInstructions: `${this.#o.instructions}\n\nOfis dışındaki kişilere mesaj, yayın, satın alma ve geri alınamaz işler approvalRequest ile sahibinin onayından geçer. Zamanlama yalnız ofisin taskPark ve scheduleCreate araçlarıyla yapılır. Çalışanları yalnız hire ile oluştur; Codex alt ajanı başlatma.`,
      config: overrides, ...(model ? { model } : {}),
    };
    const saved = this.#o.fork ?? codexSession(this.#o.cwd);
    if (this.#o.requireSession && !saved) throw new Error('Codex oturum kaydı bulunamadı; hafızayı korumak için yeni oturum açılmadı');
    const response = await this.#rpc.request(this.#o.fork ? 'thread/fork' : saved ? 'thread/resume' : 'thread/start', { ...params, ...(saved ? { threadId: saved } : {}), ...(this.#o.fork ? { ephemeral: true, excludeTurns: true } : {}) });
    this.#threadId = str(obj(response.thread).id);
    if (!this.#threadId) throw new Error('Codex oturum kimliği göndermedi');
    if (!this.#o.fork) {
      const file = join(this.#o.cwd, CODEX_SESSION_FILE), temp = `${file}.tmp`;
      writeFileSync(temp, `${JSON.stringify({ threadId: this.#threadId, model: response.model })}\n`, { mode: 0o600 });
      renameSync(temp, file);
    }
    // Read the actual MCP catalog, not an assumed successful connection.
    const servers = await this.#rpc.request('mcpServerStatus/list', { threadId: this.#threadId, limit: 100 });
    const reported = (Array.isArray(servers.data) ? servers.data : []).map(obj);
    if (this.#o.fork && reported.some((s) => Object.keys(obj(s.tools)).length > 0)) throw new Error('Yan soru oturumunda ofis araçları kapatılamadı');
    if (reported.some((s) => s.name !== 'office' && Object.keys(obj(s.tools)).length > 0)) throw new Error('Ofis dışındaki Codex bağlantıları kapatılamadı; çalışan başlatılmadı');
    const mcp = reported.filter((s) => s.name === 'office').map((raw) => {
      const s = obj(raw), tools = Object.keys(obj(s.tools));
      return { name: str(s.name), status: s.runtimeStatus === 'ready' || (tools.length > 0 && !s.toolsError) ? 'connected' : s.authStatus === 'notLoggedIn' ? 'needs-auth' : 'failed', tools: tools.length, toolNames: tools.map((t) => t.replace(/^mcp__[^_]+__/, '')) };
    });
    this.#h.onEvent({ type: 'session.started', model: `${str(response.model)}${this.#effort ? ` / ${this.#effort}` : ''}`, mcp });
    const limits = await this.#rpc.request('account/rateLimits/read').catch(() => null);
    if (limits) { this.#limits = obj(limits.rateLimits); this.#h.onEvent(codexQuota(this.#limits)); }
  }

  sendUser(text: string, uuid?: string): void {
    if (this.#closing || this.exited) throw new Error('Codex süreci kapalı');
    this.#pendingInputs += 1;
    this.#chain = this.#chain.then(async () => {
      await this.#ready;
      this.#pendingInputs -= 1;
      const response = await this.#rpc.request('turn/start', { threadId: this.#threadId, input: [{ type: 'text', text }], ...(uuid ? { clientUserMessageId: uuid } : {}), ...(this.#effort ? { effort: this.#effort } : {}) });
      this.#turnId = str(obj(response.turn).id) || this.#turnId;
      if (uuid) this.#h.onAcknowledged?.(uuid);
    }).catch((err: unknown) => {
      if (this.#closing) return;
      this.#h.onEvent({ type: 'error', message: `Codex mesajı teslim edilemedi: ${err instanceof Error ? err.message : String(err)}` });
      // Close instead of acknowledging: unread input is redelivered by the engine.
      void this.#rpc.close();
    });
  }
  interrupt(): void {
    if (this.#turnId) void this.#rpc.request('turn/interrupt', { threadId: this.#threadId, turnId: this.#turnId }).catch(() => {});
  }
  async close(graceMs = 2000): Promise<void> { this.#closing = true; this.interrupt(); await this.#rpc.close(graceMs); }

  #message(m: Obj): void {
    if ('id' in m) { void this.#serverRequest(m); return; }
    const p = obj(m.params);
    // Each worker owns one thread; fork/child events must not affect that worker's lifecycle.
    if (p.threadId && this.#threadId && p.threadId !== this.#threadId) return;
    if (m.method === 'turn/started') { this.#turnId = str(obj(p.turn).id); this.#lastUsage = codexUsage(null); }
    else if (m.method === 'thread/tokenUsage/updated') { this.#usage = codexUsage(obj(p.tokenUsage).total); this.#lastUsage = codexUsage(obj(p.tokenUsage).last); }
    else if (m.method === 'account/rateLimits/updated') { this.#limits = obj(p.rateLimits); this.#h.onEvent(codexQuota(this.#limits)); }
    else if (m.method === 'item/started' || m.method === 'item/completed') {
      const i = obj(p.item); this.#items.set(str(i.id), i);
      for (const e of codexItem(i, m.method === 'item/completed')) this.#h.onEvent(e);
    } else if (m.method === 'error') {
      const error = obj(p.error);
      this.#h.onEvent({ type: 'error', message: str(error.message) || 'Codex hatası' });
      if (/usage.?limit/i.test(JSON.stringify(error.codexErrorInfo))) this.#h.onEvent(codexQuota(this.#limits, true));
    } else if (m.method === 'turn/completed') {
      const turn = obj(p.turn);
      this.#turnId = ''; this.#items.clear();
      this.#h.onEvent({ type: 'turn.finished', ok: turn.status === 'completed', subtype: str(turn.status), usage: this.#lastUsage, costUsd: 0, numTurns: 1, queuedTurns: this.#pendingInputs, sessionUsage: this.#usage, sessionCostUsd: 0 });
    }
  }

  async #gate(tool: string, input: unknown, cwd = this.#o.cwd): Promise<boolean> {
    if (this.#o.fork) return false;
    if (!this.#o.gate) return true;
    try {
      const res = await fetch(this.#o.gate.url, { method: 'POST', headers: { authorization: `Bearer ${this.#o.gate.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ tool_name: tool, tool_input: input, cwd }), signal: AbortSignal.timeout(8000) });
      const verdict = res.ok ? obj(await res.json()) : {};
      if (verdict.decision === 'allow') return true;
      this.#h.onEvent({ type: 'error', message: str(verdict.reason) || 'Ofis kapısı Codex çağrısını durdurdu' });
    } catch { this.#h.onEvent({ type: 'error', message: 'Ofis kapısına ulaşılamadı; Codex çağrısı yapılmadı' }); }
    return false;
  }

  async #serverRequest(m: Obj): Promise<void> {
    const p = obj(m.params), item = this.#items.get(str(p.itemId)) ?? {};
    try {
      if (m.method === 'item/commandExecution/requestApproval') {
        const command = str(p.command) || str(item.command);
        const allowed = !!command && await this.#gate('Bash', { command }, str(p.cwd) || str(item.cwd) || this.#o.cwd);
        this.#rpc.write({ id: m.id, result: { decision: allowed ? 'accept' : 'decline' } });
      } else if (m.method === 'item/fileChange/requestApproval') {
        const changes = Array.isArray(item.changes) ? item.changes.map(obj) : [];
        let allowed = changes.length > 0;
        for (const c of changes) if (!await this.#gate('Write', { file_path: c.path, content: c.diff })) allowed = false;
        this.#rpc.write({ id: m.id, result: { decision: allowed ? 'accept' : 'decline' } });
      } else if (m.method === 'item/permissions/requestApproval') {
        this.#rpc.write({ id: m.id, result: { permissions: {}, scope: 'turn' } });
      } else if (m.method === 'mcpServer/elicitation/request') {
        this.#rpc.write({ id: m.id, result: { action: 'decline', content: null } });
      } else if (m.method === 'item/tool/requestUserInput') {
        this.#h.onEvent({ type: 'message.assistant', text: 'Sahibinin yanıtı gerekiyor. Soruyu ofis sohbetine yaz ve taskPark ile yanıtı bekle.' });
        this.#rpc.write({ id: m.id, result: { answers: {} } });
      } else this.#rpc.write({ id: m.id, error: { code: -32601, message: 'ControlCenter bu Codex isteğini desteklemiyor; ofis araçlarını kullanın' } });
    } catch (err) { this.#h.onEvent({ type: 'error', message: err instanceof Error ? err.message : String(err) }); }
  }
}
