import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { MinecraftAgentClient } from '../src/client/runtime.ts';
import { CommandRepetitionGuard } from '../src/client/command-repetition.ts';

const operatorAction = MinecraftAgentClient.prototype.operatorAction;
describe('play.inspect local console action', () => {
  it('runs only the read-only bag inspection tool with no arguments and never queues steps', async () => {
    const call = vi.fn(async () => ({ text: 'ok' }));
    const self = { phase: 'started', toolPrefix: 'mc', call, world: {} };
    await operatorAction.call(self as never, 'play.inspect');
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('mc_bag', {});
    await expect(operatorAction.call(self as never, 'play.inspect', { item: 'x' })).rejects.toThrow(/no arguments/);
    await expect(operatorAction.call({ ...self, call: vi.fn(async () => ({ text: 'x', failed: true })) } as never, 'play.inspect')).rejects.toThrow(/Inspection failed/);
    await expect(operatorAction.call({ ...self, phase: 'stopped' } as never, 'play.inspect')).rejects.toThrow();
  });
  it('is an allowlisted console action, and its tool name is one the repetition guard treats as inspection', () => {
    const consoleSource = readFileSync(new URL('../src/client/console-server.ts', import.meta.url), 'utf8');
    expect(consoleSource).toMatch(/'play\.inspect','play\.window','play\.command','play\.menu'/);
    const runtimeSource = readFileSync(new URL('../src/client/runtime.ts', import.meta.url), 'utf8');
    const pattern = /\/_\(\?:observe\|state\|bag[^/]*\/\.test\(name\)\)\s*\n\s*this\.commandRepetition\.inspected\(\)/;
    expect(runtimeSource).toMatch(pattern);
    const guard = new CommandRepetitionGuard(1), menu = { steps: [{ skill: 'chat', text: '/menu' }] };
    expect(guard.admit('mc_do', menu, 'a', 0)?.admitted).toBe(true);
    expect(guard.admit('mc_do', menu, 'b', 0)?.admitted).toBe(false);
    guard.inspected();
    expect(guard.admit('mc_do', menu, 'c', 0)?.admitted).toBe(true);
  });
});
