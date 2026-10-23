import type { ToolDef, ToolOutcome, ToolSchema } from './contracts.ts';
import { omitContextSchemaAnnotations } from './schema-reading.ts';

export const TOOL_HELP_TOOL = {
  name: 'mc_tool_help', tags: ['read'],
  description: 'Read the actual Minecraft tool catalogue or one tool description/schema. Omit name for a short index. name returns the root constraints and child JSON pointers; path expands a documented subtree. full:true returns that exact original schema node. No tool is executed and no model is called. mc_help reads action/skill manuals; this tool reads tool parameter contracts.',
  parameters: { type: 'object', additionalProperties: false, properties: {
    name: { type: 'string', minLength: 1 },
    path: { type: 'string', description: 'JSON pointer into the advertised input schema, e.g. /properties/steps/items. Empty means root. Use only returned child pointers.' },
    full: { type: 'boolean', description: 'Return the complete selected schema node instead of its progressive summary.' },
  } },
} satisfies Omit<ToolDef, 'handler'>;

type CatalogTool = ToolSchema & Partial<Pick<ToolDef, 'tags'>>;
const fullParameterSchemas = new WeakMap<object, ToolSchema['parameters']>();
const pointer = (base: string, key: string) => `${base}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
const container = (value: unknown): value is Record<string, unknown> | unknown[] => value !== null && typeof value === 'object';

function schemaAt(schema: unknown, path: string): unknown {
  if (path === '') return schema;
  if (!path.startsWith('/') || /~(?![01])/u.test(path)) throw new Error('path must be a JSON pointer returned by this tool');
  let value = schema;
  for (const encoded of path.slice(1).split('/')) {
    const key = encoded.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!container(value) || !Object.hasOwn(value, key)
      || Array.isArray(value) && !/^(?:0|[1-9]\d*)$/.test(key))
      throw new Error(`No schema node at ${path}; expand a returned child path first`);
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function summarize(value: unknown, path: string) {
  if (!container(value)) return { value, complete: true, children: [] };
  const scalars: Record<string, unknown> = {};
  const children: { path: string; kind: string; keys: string[]; omittedKeys: number }[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (!container(child) || Array.isArray(child) && child.every(item => !container(item))) {
      scalars[key] = child;
      continue;
    }
    const keys = Object.keys(child);
    children.push({ path: pointer(path, key), kind: Array.isArray(child) ? 'array' : 'object',
      keys: keys.slice(0, 32), omittedKeys: Math.max(0, keys.length - 32) });
  }
  return { scalarFields: scalars, complete: children.length === 0, children };
}

/** Uses effective definitions, never a second handwritten schema or host registry. */
export function readToolHelp(tools: readonly CatalogTool[], args: Record<string, unknown>): ToolOutcome {
  const protocol = 'agent-mc-tool-help/v1';
  try {
    if (Object.keys(args).some(key => !['name', 'path', 'full'].includes(key))) throw new Error('Only name, path and full are accepted');
    if (args.name === undefined) {
      if (args.path !== undefined || args.full !== undefined) throw new Error('name is required with path/full');
      return { text: JSON.stringify({ protocol, tools: tools.map(tool => ({ name: tool.name,
        descriptionExcerpt: tool.description.slice(0, 160), tags: tool.tags ?? [] })) }) };
    }
    if (typeof args.name !== 'string' || !args.name) throw new Error('name must be an advertised tool name');
    if (args.path !== undefined && typeof args.path !== 'string') throw new Error('path must be a JSON pointer string');
    if (args.full !== undefined && typeof args.full !== 'boolean') throw new Error('full must be boolean');
    const tool = tools.find(tool => tool.name === args.name);
    if (!tool) throw new Error(`Unknown Minecraft tool ${args.name}; omit name for the actual catalogue`);
    const path = args.path as string ?? '';
    const node = schemaAt(fullParameterSchemas.get(tool.parameters) ?? tool.parameters, path);
    return { text: JSON.stringify({ protocol, name: tool.name, description: tool.description, tags: tool.tags ?? [], path,
      ...(args.full ? { schema: node, complete: true } : { schemaSummary: summarize(node, path) }) }) };
  } catch (error) {
    return { text: JSON.stringify({ protocol, error: String(error), executed: false }), failed: true };
  }
}

export function createToolHelpTool(catalogue: () => readonly CatalogTool[], name = TOOL_HELP_TOOL.name): ToolDef {
  return { ...TOOL_HELP_TOOL, name, handler: async (args, ctx) => {
    ctx.signal?.throwIfAborted(); return readToolHelp(catalogue(), args);
  } };
}

export interface ToolHelpOptions {
  /** Keep every parameter constraint; move prose annotations to the exact on-demand schema. */
  parameterDescriptions?: 'inline' | 'on-demand';
}

function withoutParameterDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutParameterDescriptions);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    if (key === 'description' && typeof child === 'string') return [];
    // These values are application data, including objects with a field named description.
    return [[key, ['const', 'enum', 'default', 'examples'].includes(key) ? child : withoutParameterDescriptions(child)]];
  }));
}

/** Rebuild after a host renames/mounts tools, so advertised names stay callable. */
export function withToolHelp(tools: readonly ToolDef[], name = TOOL_HELP_TOOL.name, options: ToolHelpOptions = {}): ToolDef[] {
  const result = tools.filter(tool => tool.name !== name);
  result.push(createToolHelpTool(() => result, name));
  return options.parameterDescriptions !== 'on-demand' ? result : result.map(tool => {
    if (tool.name === name) return tool;
    const original = fullParameterSchemas.get(tool.parameters) ?? tool.parameters;
    const parameters = omitContextSchemaAnnotations(withoutParameterDescriptions(original)) as ToolDef['parameters'];
    fullParameterSchemas.set(parameters, original);
    return { ...tool,
      description: `${tool.description}\nParameter notes: ${name} {"name":${JSON.stringify(tool.name)},"full":true}.`, parameters };
  });
}

/** Map callable recovery identities at a host mount boundary, without editing action arguments. */
export function mapToolRecovery(
  outcome: ToolOutcome,
  mapName: (name: string) => string,
  mapText: (text: string) => string = text => text,
): ToolOutcome {
  const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  const safe = outcome.data?.next_safe_read;
  const mapped = record(safe) && typeof safe.tool === 'string'
    ? { ...outcome, data: { ...outcome.data, next_safe_read: { ...safe, tool: mapName(safe.tool) } } } : outcome;
  const meta = outcome.meta, admission = record(meta) ? meta.admission : undefined;
  if (!record(admission) || !Array.isArray(admission.recovery)) return mapped;
  const recovery = admission.recovery.map(value => {
    if (!record(value) || typeof value.tool !== 'string') return value;
    const args = value.arguments;
    // name identifies a tool only in the tool-help selector. In an ordinary
    // recovery it may be a real player or object name and must stay untouched.
    const mappedArgs = value.tool === TOOL_HELP_TOOL.name && record(args) && typeof args.name === 'string'
      ? { ...args, name: mapName(args.name) } : args;
    return { ...value, tool: mapName(value.tool),
      ...(mappedArgs === undefined ? {} : { arguments: mappedArgs }),
      ...(typeof value.text === 'string' ? { text: mapText(value.text) } : {}) };
  });
  return { ...mapped, meta: { ...meta, admission: { ...admission, recovery } } };
}
