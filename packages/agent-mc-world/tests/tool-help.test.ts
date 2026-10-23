import { expect, it, vi } from 'vitest';
import { createToolHelpTool, readToolHelp, withToolHelp, mapToolRecovery, TOOL_HELP_TOOL, nullLogger } from '../src/client/index.ts';
import { MinecraftWorld, MINECRAFT_TOOL_DECLS, MINECRAFT_DEFAULTS } from '../src/extension.ts';

const schema = { type: 'object', additionalProperties: false, required: ['steps'], properties: {
  steps: { type: 'array', items: { oneOf: [
    { type: 'object', required: ['skill'], properties: { skill: { const: 'look' }, yaw: { type: 'number' } } },
    { type: 'object', required: ['skill'], properties: { skill: { const: 'move' }, ticks: { type: 'integer', minimum: 1, maximum: 120 } } },
  ] } }, 'a/b~c': { enum: ['original', 'unchanged'] },
} };
const handler = vi.fn(async () => 'Never call this');
const target = { name: 'mc_do', description: 'Actual body contract', tags: ['act'] as const, parameters: schema, handler };
const read = (args: Record<string, unknown>) => JSON.parse(readToolHelp([target], args).text);

it('moves parameter notes on demand without changing constraints, data values or execution', async () => {
  const execute = vi.fn(async (args: Record<string, unknown>) => ({ text: JSON.stringify(args) }));
  const original = { type: 'object', additionalProperties: false, description: 'Root notes', properties: {
    steps: { type: 'array', minItems: 1, description: 'Read exact skill notes first', items: {
      type: 'object', required: ['skill'], properties: { skill: { enum: ['walk', 'look'], description: 'Action name' },
        description: { type: 'string', description: 'User-authored method description' },
        data: { const: { description: 'literal payload' }, default: { description: 'literal default' } } },
    } },
  }, required: ['steps'] };
  const tools = withToolHelp([{ ...target, name: 'mounted_do', parameters: original, handler: execute }],
    'mounted_tool_help', { parameterDescriptions: 'on-demand' });
  const projected = tools.find(tool => tool.name === 'mounted_do')!;
  expect(projected.parameters).toEqual({ type: 'object', additionalProperties: false, properties: {
    steps: { type: 'array', minItems: 1, items: { type: 'object', required: ['skill'], properties: {
      skill: { enum: ['walk', 'look'] }, description: { type: 'string' },
      data: { const: { description: 'literal payload' }, default: { description: 'literal default' } },
    } } },
  }, required: ['steps'] });
  const help = await tools.find(tool => tool.name === 'mounted_tool_help')!.handler(
    { name: 'mounted_do', path: '/properties/steps', full: true }, { role: 'test', log: nullLogger() });
  expect(JSON.parse((help as any).text).schema).toEqual(original.properties.steps);
  expect(execute).not.toHaveBeenCalled();
  const args = { steps: [{ skill: 'walk', description: 'keep this value' }] };
  expect(await projected.handler(args, { role: 'test', log: nullLogger() })).toEqual({ text: JSON.stringify(args) });
  expect(original.description).toBe('Root notes');
  expect(original.properties.steps.description).toBe('Read exact skill notes first');
});

it('progressively expands the effective schema without inventing fields or dispatching an action', async () => {
  expect(read({}).tools[0]).toMatchObject({ name: 'mc_do', tags: ['act'] });
  const root = read({ name: 'mc_do' });
  expect(root.schemaSummary.scalarFields).toMatchObject({ additionalProperties: false, required: ['steps'] });
  expect(root.schemaSummary.children).toContainEqual(expect.objectContaining({ path: '/properties', keys: ['steps', 'a/b~c'] }));
  expect(root.schemaSummary.complete).toBe(false);
  expect(read({ name: 'mc_do', path: '/properties/steps/items/oneOf/1', full: true }).schema).toEqual(schema.properties.steps.items.oneOf[1]);
  expect(read({ name: 'mc_do', path: '/properties/a~1b~0c', full: true }).schema).toEqual({ enum: ['original', 'unchanged'] });
  expect(read({ name: 'mc_do', full: true }).schema).toEqual(schema);
  const renamed = withToolHelp([{ ...target, name: 'mymc_do' }, { ...TOOL_HELP_TOOL, name: 'mymc_tool_help', handler }], 'mymc_tool_help');
  expect(renamed.filter(tool => tool.name === 'mymc_tool_help')).toHaveLength(1);
  const tool = renamed.find(tool => tool.name === 'mymc_tool_help')!;
  const outcome = await tool.handler({ name: 'mymc_do', full: true }, { role: 'test', log: nullLogger() });
  expect(JSON.parse((outcome as any).text).schema).toEqual(schema);
  expect(handler).not.toHaveBeenCalled();
});

it('maps only the callable safe-read tool identity in structured business results', () => {
  const original={text:'mc_Alex requested mc_queue',data:{status:'blocked',reason:'mc_queue',
    next_safe_read:{tool:'mc_bag',arguments:{name:'mc_Alex'}}}};
  const result=mapToolRecovery(original,name=>name.replace(/^mc_/,'mounted_'));
  expect(result).toEqual({...original,data:{...original.data,next_safe_read:{tool:'mounted_bag',arguments:{name:'mc_Alex'}}}});
  expect(original.data.next_safe_read.tool).toBe('mc_bag');
});

it.each([
  { path: '/properties' }, { full: true }, { name: 'not_installed' }, { name: 'mc_do', path: 'steps' },
  { name: 'mc_do', path: '/properties/steps/items/oneOf/99' }, { name: 'mc_do', path: '/__proto__' },
  { name: 'mc_do', path: '/properties/steps/items/oneOf/length' }, { name: 'mc_do', path: '/properties/a~2b' },
  { name: 'mc_do', path: 1 }, { name: 'mc_do', full: 'yes' }, { name: 'mc_do', unknown: true },
])('rejects an unavailable or malformed selector without running any tool: %j', args => {
  expect(readToolHelp([target], args).failed).toBe(true);
  expect(handler).not.toHaveBeenCalled();
});

it('uses the same actual declaration in the lower-level engine and returns cancellation', async () => {
  const world = new MinecraftWorld({ cfg: structuredClone(MINECRAFT_DEFAULTS) });
  const tools = world.tools();
  const help = tools.find(tool => tool.name === 'mc_tool_help')!;
  expect(MINECRAFT_TOOL_DECLS.find(tool => tool.name === 'mc_tool_help')?.parameters).toEqual(TOOL_HELP_TOOL.parameters);
  const outcome = await help.handler({ name: 'mc_blueprint', full: true }, { role: 'test', log: nullLogger() });
  expect(JSON.parse((outcome as any).text).schema).toEqual(tools.find(tool => tool.name === 'mc_blueprint')!.parameters);
  const abort = new AbortController(); abort.abort();
  await expect(createToolHelpTool(() => [target]).handler({}, { role: 'test', log: nullLogger(), signal: abort.signal })).rejects.toThrow();
});

it('maps recovery calls and tool-help selectors while preserving game arguments, evidence and original results', () => {
  const outcome = { text: 'Rejected', failed: true, meta: { admission: { accepted: false, dispatched: false,
    recovery: [
      { tool: 'mc_help', arguments: { skill: 'probe' }, text: 'read mc_help' },
      { tool: 'mc_tool_help', arguments: { name: 'mc_do', path: '/properties/steps' } },
      { tool: 'mc_follow', arguments: { name: 'mc_Alex', code: 'mc_help' } },
    ] }, evidence: { tool: 'mc_do', source: 'unchanged' } } };
  const original = structuredClone(outcome);
  const rename = (name: string) => name.replace(/^mc_/, 'mounted_');
  const result = mapToolRecovery(outcome, rename, text => text.replaceAll('mc_help', 'mounted_help'));
  expect(result).toMatchObject({ failed: true, meta: { admission: { accepted: false, dispatched: false,
    recovery: [
      { tool: 'mounted_help', arguments: { skill: 'probe' }, text: 'read mounted_help' },
      { tool: 'mounted_tool_help', arguments: { name: 'mounted_do', path: '/properties/steps' } },
      { tool: 'mounted_follow', arguments: { name: 'mc_Alex', code: 'mc_help' } },
    ] }, evidence: original.meta.evidence } });
  expect(outcome).toEqual(original);
  expect(mapToolRecovery({ text: 'ordinary result' }, rename)).toEqual({ text: 'ordinary result' });
  expect(handler).not.toHaveBeenCalled();
});
