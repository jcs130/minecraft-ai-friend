import { describe, expect, it } from 'vitest';
import { createServerToolRouter } from '../src/client/server-tools.ts';
import type { ToolCallContext, ToolDef, ToolOutcome } from '../src/contracts/host.ts';
const context = (signal?: AbortSignal): ToolCallContext => ({ role: 'player', log: {} as ToolCallContext['log'], callId: 'call-1', signal });
function fixture() {
  const commands: string[] = [];
  let ready = true;
  const tool: ToolDef = { name: 'server_cast', description: 'Send a registered ability', tags: ['act'],
    parameters: { type: 'object', additionalProperties: false, required: ['ability'],
      properties: { ability: { type: 'string', pattern: '^[a-z_]+$' } } },
    runtimeAvailable: () => ready,
    handler: async (args, ctx) => {
      commands.push('/ability ' + args.ability);
      return { text: 'Command sent; await server feedback', meta: { callId: ctx.callId },
        data: { phase: 'sent', outcomeUnknown: true, goal_completed: false } };
    } };
  return { router: createServerToolRouter([tool]), commands, tool, setReady: (value: boolean) => { ready = value; } };
}
describe('explicit server tool port', () => {
  it('lists the same registered schema offline without invoking a handler', async () => {
    const f = fixture(); f.setReady(false);
    const result = await f.router.handler({}, context()) as ToolOutcome;
    expect(result.data?.operations).toEqual([{ name: f.tool.name, description: f.tool.description,
      parameters: f.tool.parameters, tags: ['act'], available: false }]);
    ((result.data!.operations as any[])[0].parameters.properties as any).ability.pattern = '.*';
    expect((await f.router.handler({ operation: 'server_cast', arguments: { ability: 'bad ability' } }, context()) as ToolOutcome).failed).toBe(true);
    expect(f.commands).toEqual([]);
  });
  it('dispatches the explicit operation once and preserves its sending evidence and call identity', async () => {
    const f = fixture(), result = await f.router.handler({ operation: 'server_cast', arguments: { ability: 'marked_shot' } }, context()) as ToolOutcome;
    expect(f.commands).toEqual(['/ability marked_shot']);
    expect(result).toMatchObject({ meta: { callId: 'call-1' }, data: { phase: 'sent', outcomeUnknown: true, goal_completed: false } });
    expect(f.router.barrierAfter).toBe(true);
  });
  it.each([
    { command: '/ability marked_shot' }, { operation: 'server_cast' }, { arguments: {} },
    { operation: 'missing', arguments: {} }, { operation: 'server_cast', arguments: { ability: 'bad ability' } },
    { operation: 'server_cast', arguments: { ability: 'marked_shot', command: '/other' } },
    { operation: 'server_cast', arguments: { ability: 1 } },
  ])('rejects malformed or unregistered invocation %j without dispatch', async args => {
    const f = fixture(), result = await f.router.handler(args, context()) as ToolOutcome;
    expect(result.failed).toBe(true); expect(result.data?.notInvoked).toBe(true); expect(f.commands).toEqual([]);
  });
  it('observes provider readiness again on each call and does not retry a refused operation', async () => {
    const f = fixture(); f.setReady(false);
    expect((await f.router.handler({ operation: 'server_cast', arguments: { ability: 'marked_shot' } }, context()) as ToolOutcome).data?.notInvoked).toBe(true);
    expect(f.commands).toEqual([]); f.setReady(true);
    await f.router.handler({ operation: 'server_cast', arguments: { ability: 'marked_shot' } }, context());
    expect(f.commands).toHaveLength(1);
  });
  it('does not invoke an operation cancelled before dispatch', async () => {
    const f = fixture(), controller = new AbortController(); controller.abort();
    const result = await f.router.handler({ operation: 'server_cast', arguments: { ability: 'marked_shot' } }, context(controller.signal)) as ToolOutcome;
    expect(result.data?.notInvoked).toBe(true); expect(f.commands).toEqual([]);
  });
  it('preserves a provider refusal and its control/evidence fields', async () => {
    const f = fixture(), refusal: ToolOutcome = { text: 'current mana unknown', failed: true, endsTurn: true,
      data: { mana: null, goal_completed: false }, meta: { source: 'native-state' } };
    const router = createServerToolRouter([{ ...f.tool, handler: async () => refusal }]);
    expect(await router.handler({ operation: 'server_cast', arguments: { ability: 'marked_shot' } }, context())).toBe(refusal);
  });
  it('keeps effects unknown when a handler throws after sending, with no hidden resend', async () => {
    const f = fixture(); let sent = 0;
    const router = createServerToolRouter([{ ...f.tool, handler: async () => { sent++; throw Error('receipt channel closed'); } }]);
    const result = await router.handler({ operation: 'server_cast', arguments: { ability: 'marked_shot' } }, context()) as ToolOutcome;
    expect(result).toMatchObject({ failed: true, data: { outcomeUnknown: true, goal_completed: false } });
    expect(result.data?.notInvoked).toBeUndefined(); expect(result.text).toContain('receipt channel closed'); expect(sent).toBe(1);
  });
  it('classifies a validated read operation separately from actions', () => {
    const f = fixture(), router = createServerToolRouter([{ ...f.tool, name: 'server_status', tags: ['read'] }, f.tool]);
    expect(router.readOnlyCall?.({})).toBe(true);
    expect(router.readOnlyCall?.({ operation: 'server_status', arguments: { ability: 'marked_shot' } })).toBe(true);
    expect(router.readOnlyCall?.({ operation: 'server_cast', arguments: { ability: 'marked_shot' } })).toBe(false);
    expect(router.readOnlyCall?.({ operation: 'server_status', arguments: { ability: 1 } })).toBe(false);
  });
  it('rejects ambiguous registration before any call can run', () => {
    const f = fixture(); expect(() => createServerToolRouter([f.tool, f.tool])).toThrow('unique');
  });
});
