import {it,expect} from 'vitest';
import {Vec3} from 'vec3';
import {methodHarness} from './method-harness.ts';
import {executeIdleAction,sampleIdleActions} from '../core/idle-actions.ts';

it.each([0,1,2,3,4,5,6,7])('uses settled 1.21.1 physics in direction %s and hides movement near hostiles',async(direction)=>{
 const r=methodHarness('1.21.1'),w=r.world as any,b=r.bot as any;
 try{
  Object.assign(w.cfg.idle,{enabled:true,allowMovement:true});
  b.getControlState=(key:string)=>!!r.keys[key as keyof typeof r.keys];b.pathfinder.isMoving=()=>false;
  await new Promise(resolve=>setTimeout(resolve,250));
  const scene=w.idleScene();expect(scene.candidates.some((c:any)=>c.id==='wander')).toBe(true);
  scene.state=sampleIdleActions(b,{allowMovement:true,random:()=>direction/8}).state;
  const origin=b.entity.position.clone();
  await executeIdleAction(b,'wander',scene.state,new AbortController().signal,{available:()=>true,inventoryPreview:()=>{}});
  expect(b.entity.position.distanceTo(origin)).toBeGreaterThan(1.5);
  expect(b.entity.position.distanceTo(origin)).toBeLessThan(3);
  expect(r.keys.forward).toBe(false);
  await new Promise(resolve=>setTimeout(resolve,300));
  b.entities[2]={id:2,type:'mob',name:'zombie',position:b.entity.position.offset(3,0,0),isValid:true};
  const danger=w.idleScene();expect(danger?.candidates.some((c:any)=>c.category==='move')??false).toBe(false);
 }finally{r.close();}
});

it('honors body holds, scripts and local anchor without moving as a side effect of sampling',()=>{
 const r=methodHarness('1.21.1'),w=r.world as any,b=r.bot as any;
 try{
  Object.assign(w.cfg.idle,{enabled:true,allowMovement:true});
  b.getControlState=(key:string)=>!!r.keys[key as keyof typeof r.keys];b.pathfinder.isMoving=()=>false;
  w.idleScene();const anchor=w.idleMovementAnchor.position.clone();
  b.vehicle={id:3,name:'horse'};
  expect(w.idleScene().candidates.some((c:any)=>c.category==='move')).toBe(false);delete b.vehicle;
  b.entity.position=anchor.offset(0,0,-5.5);w.idleScene();expect(w.idleMovementAnchor.position).toEqual(anchor);
  w.methods={current:{id:1}};w.nativeMethod={runId:1,session:{ownsBody:true}};
  expect(w.idleUnavailableReason()).toBe('method');
  w.methods=r.runner;w.nativeMethod=null;
  const status=r.exec.status.bind(r.exec);r.exec.status=()=>({...status(),hold:{reason:'stay'}} as any);
  expect(w.idleUnavailableReason()).toBe('task');
  expect(Object.values(r.keys).some(Boolean)).toBe(false);
 }finally{r.close();}
});
