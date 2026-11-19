import {expect,it,vi} from 'vitest';
import {Vec3} from 'vec3';
import {IdleRoamAttention,IdleRoamBlocked} from '../src/decisions/idle-behavior.ts';
import {methodHarness} from './method-harness.ts';

const at = new Vec3(5.5,64,2.5);
const stopped = new IdleRoamBlocked(at.offset(0,0,5),at.offset(0,0,1));

it('delivers one attributable observation with the next normal decision',()=>{
 const h=methodHarness('1.21.1');
 try {
  const w=h.world as any;
  const diag=vi.spyOn(w.diag,'write');
  for(let i=0;i<4;i++)w.noteIdleRoamBlocked('1:4:overworld',at,at,stopped);
  expect(diag.mock.calls.filter((args:any[])=>args[0]?.event==='idle-stroll-obstructed')).toHaveLength(4);
  expect(h.host.events).toHaveLength(1);expect(h.host.pushOpts[0]?.trigger).toBe('piggyback');
  expect(h.host.events[0]).toMatchObject({type:'minecraft.event',meta:{idleRoamObstruction:{
   schema:'agent-mc-idle-obstruction/v1',generation:'1:4:overworld',attempts:2,
   firstOrigin:{x:5.5,y:64,z:2.5},destination:{x:5.5,y:64,z:7.5},next:{x:5.5,y:64,z:3.5},
  }}});
 }finally{h.close();}
});

it('starts a fresh episode after actual movement, replacement of the body job or expiry',()=>{
 const attention=new IdleRoamAttention();
 expect(attention.blocked('first',at,at,stopped,0)).toBeNull();
 attention.observe('first',at.offset(0,0,2),500);
 expect(attention.blocked('first',at,at,stopped,1000)).toBeNull();
 expect(attention.blocked('second',at,at,stopped,1500)).toBeNull();
 expect(attention.blocked('second',at,at,stopped,310000)).toBeNull();
 expect(attention.blocked('second',at,at.offset(.3,0,0),stopped,310500)).toBeNull();
 expect(attention.blocked('second',at,at,stopped,311000)).toBeNull();
 expect(attention.blocked('second',at,at,new IdleRoamBlocked(at.offset(0,0,4),null),312000))
   .toMatchObject({attempts:2,firstAtMs:311000,lastAtMs:312000,next:null});
});
