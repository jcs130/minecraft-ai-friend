import {expect,it} from 'vitest';
import {TaskRecoveryBook} from '../core/task-recovery.ts';
import {observedEffect} from '../core/observed-effect.ts';
const effect=(skill='build',position:[number,number,number]=[0,64,0])=>observedEffect(skill,'minecraft:overworld',null,
  {at:'2026-01-01T00:00:00Z',target:null,inventory:{},position,window:null},
  {at:'2026-01-01T00:00:01Z',target:null,inventory:{},position,window:null});
const failure=(id:string,skill='build')=>({scope:'epoch',executionId:id,phase:'blocked',steps:[{step:1,outcome:'fail',why:'denied',observedEffect:effect(skill)}]});

it('retains different failed approaches at one measured place and does not select a repair',()=>{
 const b=new TaskRecoveryBook();expect(b.record(failure('1'))).toBeNull();
 const result=b.record(failure('2','tunnel'));
 expect(result).toMatchObject({historical:true,goalVerified:false,automaticReplay:false,position:[0,64,0]});
 expect(result?.attempts.map(a=>a.skill)).toEqual(['build','tunnel']);
 expect(b.record(failure('2','tunnel'))).toBeNull();
 expect(result).not.toHaveProperty('nextAction');
});
it('ignores unknown effects, cancellations and rotation while preserving prior failures',()=>{
 const b=new TaskRecoveryBook();b.record(failure('1'));
 expect(b.record({...failure('unknown'),steps:[{step:1,outcome:'fail'}]})).toBeNull();
 expect(b.record({...failure('cancel'),phase:'cancelled'})).toBeNull();
 const rotated=effect('control');
 expect(b.record({scope:'epoch',executionId:'turn',phase:'completed',steps:[{step:1,outcome:'ok',observedEffect:rotated}]})).toBeNull();
 expect(b.record(failure('2'))?.attempts).toHaveLength(2);
});
it('expires at changed position, epoch, dimension or time and clears after measured work',()=>{
 let now=1000;const b=new TaskRecoveryBook({now:()=>now});b.record(failure('1'));b.record(failure('2'));
 expect(b.current('epoch','minecraft:overworld',[1,64,0])).toBeNull();
 expect(b.current('new','minecraft:overworld',[0,64,0])).toBeNull();
 expect(b.current('epoch','minecraft:the_nether',[0,64,0])).toBeNull();
 now+=120001;expect(b.current('epoch','minecraft:overworld',[0,64,0])).toBeNull();
 b.record(failure('3'));expect(b.record(failure('4'))?.attempts).toHaveLength(2);
 const changed=effect('take');changed.status='changed';changed.changed.inventory=true;
 b.record({scope:'epoch',executionId:'gain',phase:'completed',steps:[{step:1,outcome:'ok',observedEffect:changed}]});
 expect(b.current('epoch','minecraft:overworld',[0,64,0])).toBeNull();
});
