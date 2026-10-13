import { describe, expect, it } from 'vitest';
import { MethodRunner, type MethodRun } from '../core/method-runner.ts';

async function run(code: string, nativeMethods?: string[]) {
  let finish!: (run: MethodRun) => void;
  const ended = new Promise<MethodRun>(resolve => { finish = resolve; });
  const runner = new MethodRunner({ nativeMethods, onFinish: finish,
    call: async operation => operation === 'state'
      ? { sampledAt: '2030-01-01T00:00:00Z', snapshot: { position: { x: 1, y: 64, z: 2 } } }
      : { value: [{ name: 'rail', count: 3 }] } });
  runner.start({ name: 'async-contract', code });
  return ended;
}

describe('asynchronous method result contract', () => {
  it('reports missing await instead of accepting an invented absent snapshot', async () => {
    const result = await run("const s=mc.state(); if(!s.snapshot) return {why:'snapshot null'};");
    expect(result).toMatchObject({ status: 'failed', error: expect.stringContaining('await it before reading snapshot') });
    expect(result.result).toBeUndefined();
  });

  it('reports the native method name when a result is read before await', async () => {
    const result = await run('return bot.inventory.items().length;', ['inventory.items']);
    expect(result).toMatchObject({ status: 'failed', error: expect.stringContaining('bot.inventory.items() returns a Promise') });
  });

  it.each([
    'return (await mc.state()).snapshot.position;',
    'return mc.state().then(s=>s.snapshot.position);',
    'const [s]=await Promise.all([mc.state()]); return s.snapshot.position;',
    'return (await mc.state().finally(()=>{})).snapshot.position;',
  ])('retains standard Promise consumption: %s', async code => {
    expect(await run(code)).toMatchObject({ status: 'completed', result: { x: 1, y: 64, z: 2 } });
  });
});
