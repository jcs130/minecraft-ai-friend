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
  it('settles multiple terminal waiters while cancellation and expiry leave the original program alive',async()=>{
    let release!:(value:unknown)=>void,entered!:()=>void;
    const called=new Promise<void>(resolve=>{entered=resolve;});let finishes=0;
    const runner=new MethodRunner({nativeMethods:['read'],onFinish:()=>{finishes++;},call:async()=>{entered();return new Promise(resolve=>{release=resolve;});}});
    const program=runner.start({name:'shared-wait',code:'return await bot.read("health");'});
    try{
      await called;await runner.wait(program.id,1);expect(runner.current?.id).toBe(program.id);
      const abort=new AbortController(),cancelled=runner.wait(program.id,30000,abort.signal);
      abort.abort(new Error('Wait ended'));await expect(cancelled).rejects.toThrow('Wait ended');expect(runner.current?.id).toBe(program.id);
      const a=runner.wait(program.id,2000),b=runner.wait(program.id,2000);release({value:20});await Promise.all([a,b]);
      expect(runner.read(program.id)[0]).toMatchObject({status:'completed',result:20});expect(finishes).toBe(1);
    }finally{runner.stop('test cleanup');}
  });
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
