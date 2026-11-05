import {expect,it} from 'vitest';
import {MethodRunner} from '../core/method-runner.ts';
import {methodLearningCall} from '../src/learning/method-capability.ts';

it('keeps a live program and its pending call across successful and failed background validations',async()=>{
  let release!:(value:unknown)=>void;let entered!:(value?:unknown)=>void;
  const ready=new Promise(resolve=>{entered=resolve;});let aborted=false;
  const runner=new MethodRunner({call:async(_m,_a,signal)=>{
    signal.addEventListener('abort',()=>{aborted=true;});entered();return new Promise(resolve=>{release=resolve;});
  },onFinish:()=>{}});
  try {
    const live=runner.start({code:'return await mc.state();'});await ready;
    for(let i=0;i<10;i++){
      const test=runner.start({validate:true,code:i%2?'return (;':'return await mc.state();'});
      await runner.wait(test.id,5000);
      expect(runner.read(test.id)[0]).toMatchObject({mode:'validation',status:i%2?'failed':'validated',trace:[]});
      expect(runner.current?.id).toBe(live.id);expect(runner.read(live.id)[0].status).toBe('running');expect(aborted).toBe(false);
    }
    release({health:20});await runner.wait(live.id,5000);expect(runner.read(live.id)[0]).toMatchObject({status:'completed',result:{health:20}});
  }finally{runner.stop();}
},15000);

it('only declares offline validation and explicit method-library branches for background learning',()=>{
  for(const args of [{validate:true,code:'return 1;',params:{speed:1}},{library:{op:'save'}},{library:{op:'adopt'}},{runId:3}])expect(methodLearningCall(args)).toBe(true);
  for(const args of [{code:'await mc.do([])'},{stop:true},{validate:true,stop:true,code:'x'},{library:{op:'save'},code:'x'},{routine:{op:'run'}}])expect(methodLearningCall(args)).toBe(false);
});
