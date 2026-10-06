import type { Employee, EmployeeKind } from '@cc/shared';
import { statusOf } from '../errors.ts';
import type { Roster } from '../roster.ts';
import type { TokenRegistry } from './tokens.ts';

export interface McpTool {
  name: string;
  /** Read by the model: English, precise about when to call the tool. */
  description: string;
  inputSchema: Record<string, unknown>;
  kinds: EmployeeKind[];
  run(ctx: { employee: Employee }, args: Record<string, unknown>): string | Promise<string>;
}

interface RpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const isRequest = (b: unknown): b is RpcRequest =>
  typeof b === 'object' && b !== null && !Array.isArray(b) && (b as RpcRequest).jsonrpc === '2.0' && typeof (b as RpcRequest).method === 'string';

/**
 * The office's MCP endpoint: the subset of streamable HTTP that Claude Code uses (JSON responses, no event stream,
 * no sessions). Verified against Claude Code 2.1.291: server/discover (answered not-found) → initialize →
 * notifications/initialized → GET (405) → tools/list → tools/call.
 */
export async function handleMcp(o: {
  method: string;
  authorization: string | undefined;
  body: unknown;
  tokens: TokenRegistry;
  roster: Roster;
  tools: McpTool[];
}): Promise<{ status: number; body?: unknown }> {
  if (o.method !== 'POST') return { status: 405 };
  const token = /^Bearer\s+(\S+)$/i.exec(o.authorization ?? '')?.[1];
  const employeeId = token ? o.tokens.resolve(token) : null;
  let employee: Employee | null = null;
  if (employeeId) {
    try {
      employee = o.roster.get(employeeId);
    } catch {
      employee = null;
    }
  }
  if (!employee || employee.lifecycle === 'archived') return { status: 401, body: { error: 'Geçersiz ofis jetonu.' } };
  if (!isRequest(o.body)) return { status: 400, body: { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } } };
  const req = o.body;
  if (req.id === undefined) return { status: 202 };
  const reply = (result: unknown) => ({ status: 200, body: { jsonrpc: '2.0', id: req.id, result } });
  const fail = (code: number, message: string) => ({ status: 200, body: { jsonrpc: '2.0', id: req.id, error: { code, message } } });
  const allowed = o.tools.filter((t) => t.kinds.includes(employee.kind));

  switch (req.method) {
    case 'initialize':
      return reply({
        protocolVersion: typeof req.params?.protocolVersion === 'string' ? req.params.protocolVersion : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'office', version: '1.0.0' },
        instructions: 'control-center ofis araçları: görevler, paslama, teslim ve (koordinatör için) plan, işe alma ve dağıtım.',
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: allowed.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
    case 'tools/call': {
      const name = typeof req.params?.name === 'string' ? req.params.name : '';
      const tool = allowed.find((t) => t.name === name);
      if (!tool) return fail(-32602, `Bilinmeyen ya da bu çalışana kapalı araç: ${name}`);
      const args = typeof req.params?.arguments === 'object' && req.params.arguments !== null ? (req.params.arguments as Record<string, unknown>) : {};
      try {
        return reply({ content: [{ type: 'text', text: await tool.run({ employee }, args) }] });
      } catch (err) {
        // The office's own errors (validation, conflict, not found, forbidden) are meant for the model to read and act on.
        const message = statusOf(err) < 500 && err instanceof Error ? err.message : `Araç çalışırken beklenmeyen bir hata oldu: ${err instanceof Error ? err.message : String(err)}`;
        return reply({ content: [{ type: 'text', text: message }], isError: true });
      }
    }
    default:
      return fail(-32601, `Method not found: ${req.method}`);
  }
}
