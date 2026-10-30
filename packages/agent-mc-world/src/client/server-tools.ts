import { Ajv, type ValidateFunction } from 'ajv';
import type { ToolCallContext, ToolDef, ToolOutcome } from '../contracts/host.ts';

/** A host delegates explicitly installed server tools without acquiring its body queue. */
export const SERVER_TOOL_PORT_TOOL: Omit<ToolDef, 'handler'> = {
  name: 'mc_server', tags: ['read', 'act'], barrierAfter: true,
  description: 'Access tools supplied by an explicitly configured server extension. {} lists registered operations and their exact argument schemas; '
    + '{operation,arguments:{...}} invokes one. Use the registered tool name as operation. '
    + 'These operations do not enter the body task queue or stop movement/combat. The selected provider owns connection, permission and readiness checks. '
    + 'Read the result before issuing another action. Registration is not availability; sending is not a server-confirmed effect or goal completion. '
    + 'There is no automatic retry, command rewriting or fallback to another operation.',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: { operation: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,127}$' }, arguments: { type: 'object' } },
    anyOf: [{ maxProperties: 0 }, { required: ['operation', 'arguments'] }],
  },
};

const MAX_TOOLS = 64;
const reject = (text: string, data: Record<string, unknown> = {}): ToolOutcome => ({
  text, failed: true, data: { goal_completed: false, notInvoked: true, ...data },
});

/** Routes one explicit call. Provider handlers remain responsible for transport and effect evidence. */
export function createServerToolRouter(tools: readonly ToolDef[]): ToolDef {
  if (tools.length > MAX_TOOLS) throw new Error(`A server tool port supports at most ${MAX_TOOLS} operations`);
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
  const entries = new Map<string, { tool: ToolDef; validate: ValidateFunction }>();
  for (const tool of tools) {
    if (!/^[a-z][a-z0-9_]{0,127}$/.test(tool.name) || entries.has(tool.name))
      throw new Error('Server tool names must be valid and unique');
    // Schemas are data; copying prevents a consumer of the capability index from changing validation.
    const registered = { ...tool, tags: [...tool.tags], parameters: structuredClone(tool.parameters) };
    entries.set(tool.name, { tool: registered, validate: ajv.compile(registered.parameters) });
  }
  const validateInput = ajv.compile(SERVER_TOOL_PORT_TOOL.parameters);
  const isIndex = (args: Record<string, unknown>) => Object.keys(args).length === 0;
  const selected = (args: Record<string, unknown>) => typeof args.operation === 'string' ? entries.get(args.operation) : undefined;
  const validInvocation = (args: Record<string, unknown>) => validateInput(args)
    && typeof args.operation === 'string' && args.arguments !== null && typeof args.arguments === 'object' && !Array.isArray(args.arguments);
  return {
    ...SERVER_TOOL_PORT_TOOL,
    readOnlyCall: args => isIndex(args) || (validInvocation(args) && (() => {
      const entry = selected(args); if (!entry || !entry.validate(args.arguments)) return false;
      return entry.tool.readOnlyCall?.(args.arguments as Record<string, unknown>)
        ?? (entry.tool.tags.includes('read') && !entry.tool.tags.some(t => ['act', 'write', 'speak', 'flow'].includes(t)));
    })()),
    handler: async (args, context: ToolCallContext) => {
      if (!args || typeof args !== 'object' || Array.isArray(args) || !validateInput(args))
        return reject('Use {} or {operation,arguments:{...}}. No server operation was invoked.');
      if (isIndex(args)) {
        const operations = [...entries.values()].map(({ tool }) => ({
          name: tool.name, description: tool.description, parameters: structuredClone(tool.parameters),
          tags: [...tool.tags], available: tool.runtimeAvailable?.() ?? null,
        }));
        const data = { operations, maxOperations: MAX_TOOLS, goal_completed: false };
        return { text: 'Configured server operations; choose their exact names and argument schemas.\n' + JSON.stringify(data), data };
      }
      if (!validInvocation(args)) return reject('An invocation requires operation and an arguments object. No server operation was invoked.');
      const entry = selected(args);
      if (!entry) return reject('Unknown server operation. Read {} for the configured index.', { operation: args.operation });
      if (!entry.validate(args.arguments)) return reject('Server operation arguments do not match its schema. No operation was invoked.', {
        operation: entry.tool.name,
        errors: (entry.validate.errors ?? []).slice(0, 8).map(e => ({ instancePath: e.instancePath, keyword: e.keyword, message: e.message })),
      });
      if (entry.tool.runtimeAvailable?.() === false) return reject('This configured server operation is currently unavailable.', { operation: entry.tool.name });
      if (context.signal?.aborted) return reject('The caller cancelled before dispatch. No server operation was invoked.', { operation: entry.tool.name });
      try {
        // No queue, bot, inference, timer or retry belongs to this routing boundary.
        return await entry.tool.handler(args.arguments as Record<string, unknown>, context);
      } catch (error) {
        return { text: `Server operation ${entry.tool.name} failed: ${String(error).slice(0, 512)}. Its effects remain unknown; no retry was issued.`,
          failed: true, data: { operation: entry.tool.name, outcomeUnknown: true, goal_completed: false } };
      }
    },
  };
}
