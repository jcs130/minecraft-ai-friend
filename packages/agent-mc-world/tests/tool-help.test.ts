import { expect, it, vi } from 'vitest';
import { createToolHelpTool, readToolHelp, withToolHelp, TOOL_HELP_TOOL, nullLogger } from '../src/client/index.ts';
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
