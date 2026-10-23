import {expect,it,vi} from 'vitest';
import {MethodRunner,type MethodRun} from '../core/method-runner.ts';

function fixture(call: ConstructorParameters<typeof MethodRunner>[0]['call']) {
  let finish!: (run: MethodRun) => void;
  const ended=new Promise<MethodRun>(resolve=>{finish=resolve;});
  const onFinish=vi.fn(finish);
  return {runner:new MethodRunner({call,onFinish}),ended,onFinish};
}

it('retains pure validation through a game disconnect and never calls the game',async()=>{
  const call=vi.fn(()=>{throw new Error('validation reached the game');});
  const {runner,ended,onFinish}=fixture(call);
  try {
    runner.start({code:'return 1;',validate:true});
    expect(runner.cancelForDisconnect('network unavailable')).toBe(false);
    expect(await ended).toMatchObject({status:'validated',trace:[]});
    expect(call).not.toHaveBeenCalled();expect(onFinish).toHaveBeenCalledOnce();
  } finally {runner.stop('test cleanup');}
});

it('revokes a running game operation on disconnect without replaying it',async()=>{
  let entered!:()=>void,signal:AbortSignal|undefined;
  const called=new Promise<void>(resolve=>{entered=resolve;});
  const call=vi.fn((_method:unknown,_args:unknown,scope:AbortSignal)=>{
    signal=scope;entered();return new Promise(()=>{});
  });
  const {runner,ended,onFinish}=fixture(call);
  try {
    runner.start({code:'return await mc.state();'});await called;
    expect(runner.cancelForDisconnect('network unavailable')).toBe(true);
    expect(await ended).toMatchObject({status:'cancelled',error:'network unavailable'});
    expect(signal?.aborted).toBe(true);expect(call).toHaveBeenCalledOnce();
    expect(runner.cancelForDisconnect('late close')).toBe(false);
    expect(onFinish).toHaveBeenCalledOnce();
  } finally {runner.stop('test cleanup');}
});

it('retains an explicit operator stop while validating',async()=>{
  const {runner,ended}=fixture(()=>{throw new Error('validation reached the game');});
  runner.start({code:'return 1;',validate:true});
  expect(runner.stop('operator stop')).toBe(true);
  expect(await ended).toMatchObject({status:'cancelled',error:'operator stop'});
});
