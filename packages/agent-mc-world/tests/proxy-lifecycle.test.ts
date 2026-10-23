import {EventEmitter} from 'node:events';
import {afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({children:[] as any[]}));
vi.mock('node:child_process',()=>({fork:vi.fn(()=>{
  const child=new EventEmitter() as any;
  Object.assign(child,{connected:true,exitCode:null,killed:false,pid:123,stdout:null,stderr:null,sent:[]});
  child.send=(message:any)=>{
    child.sent.push(message);
    if(message.t==='req' && message.req.kind==='shutdown')queueMicrotask(()=>{
      child.emit('message',{t:'rep',id:message.id,ok:true,value:null});
      child.exitCode=0;child.connected=false;child.emit('exit',0);
    });
  };
  child.kill=()=>{child.killed=true;child.exitCode=0;child.emit('exit',0);};
  state.children.push(child);return child;
})}));
import {MinecraftWorldProxy} from '../core/proxy.ts';
import {MINECRAFT_CLIENT_DEFAULTS} from '../src/client/config.ts';
import {FakeHost} from './method-host.ts';
afterEach(()=>{vi.useRealTimers();state.children.length=0;});
it('forwards fresh server readiness through the child proxy and expires missing or stale status without RPC',async()=>{
  vi.useFakeTimers();
  const proxy=new MinecraftWorldProxy({cfg:structuredClone(MINECRAFT_CLIENT_DEFAULTS)}),host=new FakeHost();
  const started=proxy.start(host),child=state.children[0],init=child.sent.find((m:any)=>m.req?.kind==='init');
  child.emit('message',{t:'rep',id:init.id,ok:true,value:null});await started;
  const status=(connection?:unknown)=>child.emit('message',{t:'note',note:{kind:'status',decl:{},storage:[],promptVars:{},requestFacts:null,connection}});
  expect(proxy.connectionReadiness()).toBeNull();
  status({ready:true,phase:'online',observedAt:Date.now(),deviceCode:'MUST_NOT_ESCAPE'});
  const sent=child.sent.length;
  expect(proxy.connectionReadiness()).toEqual({ready:true,phase:'online'});
  expect(child.sent).toHaveLength(sent);
  await vi.advanceTimersByTimeAsync(5100);
  expect(proxy.connectionReadiness()).toBeNull();
  status({ready:false,phase:'retrying',observedAt:Date.now()});
  expect(proxy.connectionReadiness()).toEqual({ready:false,phase:'retrying'});
  status();expect(proxy.connectionReadiness()).toBeNull();
  await proxy.stop();expect(proxy.connectionReadiness()).toBeNull();
});
it.each(['SIGINT','SIGTERM'])('does not auto-restart an interrupted child (%s)',async signal=>{
  vi.useFakeTimers();
  const proxy=new MinecraftWorldProxy({cfg:structuredClone(MINECRAFT_CLIENT_DEFAULTS)}),host=new FakeHost();
  const started=proxy.start(host),child=state.children[0],init=child.sent.find((m:any)=>m.req?.kind==='init');
  child.emit('message',{t:'rep',id:init.id,ok:true,value:null});await started;
  child.emit('exit',null,signal);
  await vi.advanceTimersByTimeAsync(10000);expect(state.children).toHaveLength(1);
  expect(host.events.some(e=>e.text.includes('崩了'))).toBe(false);await proxy.stop();
});
it('revokes a pending startup and ignores late IPC and exits from an older child',async()=>{
  const proxy=new MinecraftWorldProxy({cfg:structuredClone(MINECRAFT_CLIENT_DEFAULTS)});
  const host=new FakeHost(),starting=proxy.start(host);
  const cancelled=expect(starting).rejects.toThrow();
  const old=state.children[0],init=old.sent.find((m:any)=>m.req?.kind==='init');
  await proxy.stop();await cancelled;
  old.emit('message',{t:'rep',id:init.id,ok:true,value:null});
  old.emit('exit',1);
  vi.useFakeTimers();await vi.advanceTimersByTimeAsync(4000);expect(state.children).toHaveLength(1);
  const next=proxy.start(host),child=state.children[1],request=child.sent.find((m:any)=>m.req?.kind==='init');
  child.emit('message',{t:'rep',id:request.id,ok:true,value:null});await next;
  old.emit('exit',1);
  const controller=new AbortController(),pending=proxy.tools().find(t=>t.name==='mc_help')!.handler({}, {role:'host',log:host.log,signal:controller.signal,turnId:'t',round:3});
  const rejected=expect(pending).resolves.toMatchObject({failed:true,text:expect.stringContaining('cancelled')});
  controller.abort();await rejected;
  expect(child.sent).toEqual(expect.arrayContaining([expect.objectContaining({t:'cast',cast:expect.objectContaining({kind:'cancel'})})]));
  expect(child.sent.find((m:any)=>m.req?.kind==='tool').req).toMatchObject({turnId:'t',round:3});
  await proxy.stop();await vi.advanceTimersByTimeAsync(10000);expect(state.children).toHaveLength(2);
});
