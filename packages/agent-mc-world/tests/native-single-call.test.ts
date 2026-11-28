import { expect, it, vi } from 'vitest';
import { MethodRunner } from '../core/method-runner.ts';
import { nativeInvocation, resolveMineflayerCall } from '../core/mineflayer-call.ts';
import { methodHarness } from './method-harness.ts';

it('passes a native observation and rotation through the actual World and records each result once', async () => {
  const r = methodHarness('1.21.1');
  const script = r.world.tools().find(tool => tool.name === 'mc_script')!;
  const ctx = { role: 'fixture', callId: 'one' } as Parameters<typeof script.handler>[1];
  try {
    const look = vi.spyOn(r.bot, 'look');
    const mapped = resolveMineflayerCall('bot.look', { args: [0.6, -0.3, false] })!;
    const result = await script.handler(mapped.args, ctx);
    expect(result).toMatchObject({ execution: { phase: 'completed', terminal: true, goalCompleted: false } });
    expect(look).toHaveBeenCalledTimes(1);
    expect(look).toHaveBeenCalledWith(0.6,-0.3,false);
    const point = {x:0,y:63,z:0};
    const read = await script.handler({ native:{name:'blockAt',args:[point]}, waitMs:1000 },ctx);
    expect(read).toMatchObject({execution:{phase:'completed'}});
    expect(r.runner.read(2)[0]).toMatchObject({result:{name:'stone',position:point},trace:[{method:'mineflayer',args:{name:'blockAt',args:[point]}}]});
    const items = await script.handler({ native:{name:'inventory.items',args:[]}, waitMs:1000 },ctx);
    expect(items).toMatchObject({execution:{phase:'completed'}});
    expect(r.runner.read(3)[0].result).toEqual([]);
    expect(resolveMineflayerCall('bot.equip',{item:17})?.args.native).toEqual({name:'equip',args:[17]});
  } finally { r.close(); }
});

it('revokes direct calls before dispatch or while outstanding and ignores late resolution',async()=>{
  let finish!: (reply: unknown)=>void;
  const call = vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
  const terminal = vi.fn();
  const runner=new MethodRunner({nativeMethods:['look'],call,onFinish:terminal});
  const native={name:'look' as const,args:[1,0]};
  const skipped=runner.startNative(native);
  runner.cancelForDisconnect('connection changed');
  await Promise.resolve();
  expect(call).not.toHaveBeenCalled();
  expect(runner.read(skipped.id)[0].status).toBe('cancelled');
  const pending=runner.startNative(native);
  await Promise.resolve();
  expect(call).toHaveBeenCalledTimes(1);
  expect(()=>runner.startNative(native)).toThrow();
  runner.stop('explicit stop');
  finish({value:'too late'});
  await Promise.resolve();
  expect(runner.read(pending.id)[0]).toMatchObject({status:'cancelled',trace:[{error:expect.any(String)}]});
  expect(terminal).toHaveBeenCalledTimes(2);
  expect(()=>runner.startNative({name:'blockAt',args:[]})).toThrow(/unavailable/);
});

it.each([
  {native:{name:'look',args:[0,0]},code:'return 1'},
  {native:{name:'look',args:[0,0]},language:'python'},
  {native:{name:'look',args:[0,0]},stop:true},
  {native:{name:'look',args:[0]}},
  {native:{name:'_client.write',args:[]}},
])('rejects mixed or invalid direct invocations before delivery',input=>{
  expect(()=>nativeInvocation(input)).toThrow();
});
