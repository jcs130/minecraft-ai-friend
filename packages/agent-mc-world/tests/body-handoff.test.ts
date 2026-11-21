import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger, type CharacterBodyRequest } from '../src/client/index.ts';
import type { WorldHost, ToolDef } from '../src/client/contracts.ts';

const uuid='f30d75e1-9497-3d4e-8fbf-8abb2816be3c', characterId='synthetic-player';
const paths:string[]=[];
afterEach(()=>{ for(const path of paths.splice(0)) rmSync(path,{recursive:true,force:true}); });

function rig(opts:{directory?:string; generation?:number; managed?:boolean; player?:string; witnessChannel?:string}={}) {
  const directory=opts.directory??mkdtempSync(join(tmpdir(),'mc-character-'));
  if (!opts.directory) paths.push(directory);
  const counts={start:0,stop:0,actions:0,tactics:0,writes:0},messages:CharacterBodyRequest[]=[];
  const witnesses: Array<[string,string,string]>=[];
  let worldHost:WorldHost;
  let run: ToolDef['handler']=async()=>({text:'done'});
  let current:Record<string,unknown>={characterId,generation:1,activeKind:'mineflayer',status:'ready',targetKinds:['numen'],autonomous:true};
  let receipt:Record<string,unknown>={};
  let post:(msg:Extract<CharacterBodyRequest,{op:'controllerSwitch'}>)=>Promise<unknown>=async msg=>({
    characterId,requestId:msg.requestId,targetKind:msg.targetKind,generation:1,status:'switching',activeKind:'mineflayer',phase:'releasing'});
  const request=async(msg:CharacterBodyRequest)=>{
    messages.push(msg);
    if(msg.op==='current')return current;
    if(msg.op==='lookup')return receipt;
    counts.writes++;return post(msg);
  };
  const config={...structuredClone(MINECRAFT_CLIENT_DEFAULTS),username:'Synthetic',host:'127.0.0.1'};
  const world={id:'minecraft', envPromptVars:()=>({}),start:async(h:WorldHost)=>{worldHost=h;counts.start++;},stop:async()=>{counts.stop++;},
    sendHandoffWitness:async(uuid:string,channel:string,nonce:string)=>{witnesses.push([uuid,channel,nonce]);},
    requestFacts:()=>({text:'',snapshotTypes:[],decision:{sampledAtMs:Date.now(),state:{connection:{ready:true},action:{fighting:false,task:null,queued:0}}},
      decisionStability:{identity:['world',opts.player??uuid]}}),
    tools:():ToolDef[]=>['mc_do','mc_combat_tactic'].map(name=>({name,tags:['act'],description:'test action',parameters:{type:'object'},
      handler:async(args,ctx)=>{if(name==='mc_do')counts.actions++;else counts.tactics++;return run(args,ctx);}}))};
  const client=new MinecraftAgentClient({cfg:config,log:nullLogger(),dataDir:directory,
    ...(opts.managed!==false?{bodyHandoff:{characterId,playerUuid:uuid,generation:opts.generation??1,witnessChannel:opts.witnessChannel,request}}:{})},world as never);
  return {client,counts,messages,witnesses,directory,setCurrent:(c:Record<string,unknown>)=>{current=c;},
    setReceipt:(r:Record<string,unknown>)=>{receipt=r;},setPost:(p:typeof post)=>{post=p;},setRun:(r:typeof run)=>{run=r;},
    terminal:async(id:string)=>worldHost.pushEvent({type:'minecraft.task',source:'minecraft',origin:'internal',ts:new Date().toISOString(),text:id,
      execution:{kind:'task',id,phase:'completed',terminal:true,goalCompleted:false}},{trigger:'flush'})};
}

describe('host-bound Mineflayer body handoff',()=>{
  it('rotates only the disconnected original player to a verified later generation',async()=>{
    const a=rig({witnessChannel:'qa:handoff'});await a.client.connect();
    const requestId='back-from-numen';
    let response:Record<string,unknown>={characterId,requestId,generation:2,activeKind:'numen',
      status:'switching',phase:'releasing',targetKind:'mineflayer'};
    const current={characterId,generation:3,activeKind:null,status:'switching',pendingRequestId:requestId};
    const next={characterId,playerUuid:uuid,generation:3,witnessChannel:'qa:handoff',
      request:(message:CharacterBodyRequest)=>message.op==='current'?current:response};
    expect(await a.client.prepareTargetBodyHandoff(next,requestId)).toBe(false);
    expect(await a.client.releaseForBodyHandoff({requestId:'to-numen',generation:1})).toEqual({state:'disconnected'});
    expect(await a.client.prepareTargetBodyHandoff({...next,characterId:'different'},requestId)).toBe(false);
    await expect(a.client.prepareTargetBodyHandoff(next,'wrong-request')).rejects.toThrow('Unconfirmed original body receipt');
    expect(await a.client.prepareTargetBodyHandoff(next,requestId)).toBe(true);
    await expect(a.client.connect()).rejects.toThrow('does not own');
    response={...response,generation:3,phase:'acquiring'};
    expect(await a.client.connectForBodyHandoff(requestId)).toEqual({state:'connected',playerUuid:uuid});
    await expect(a.client.call('mc_do',{},'early-write')).rejects.toThrow('fenced');
    response={...response,status:'completed',activeKind:'mineflayer'};
    await a.client.refreshBodyHandoff(requestId);
    expect((await a.client.call('mc_do',{},'verified-new-generation')).text).toBe('done');
    expect(a.counts.start).toBe(2);
    expect(a.counts.actions).toBe(1);
    await a.client.disconnect();
  });
  it('sends the server challenge only through the bound live connection for its exact operation and generation',async()=>{
    const a=rig({witnessChannel:'qa:handoff'});await a.client.connect();
    const nonce='a'.repeat(48),requestId='witness-one';
    a.setReceipt({characterId,requestId,status:'switching',phase:'releasing',generation:1,activeKind:'mineflayer',targetKind:'numen'});
    await expect(a.client.witnessBodyHandoff({requestId,generation:2,nonce})).rejects.toThrow();
    await expect(a.client.witnessBodyHandoff({requestId:'other',generation:1,nonce})).rejects.toThrow();
    expect(a.witnesses).toEqual([]);await a.client.witnessBodyHandoff({requestId,generation:1,nonce});
    expect(a.witnesses).toEqual([[uuid,'qa:handoff',nonce]]);
    expect(a.client.tools().some(tool=>tool.name.includes('witness'))).toBe(false);
    expect(JSON.stringify(a.messages)).not.toContain(nonce);await a.client.disconnect();
  });
  it('stops a misconfigured account before body work or a handoff can run',async()=>{
    const a=rig({player:'e1aab921-c801-389e-892d-1711c28c8796'});
    await expect(a.client.connect()).rejects.toThrow('original player UUID');
    expect(a.client.status().phase).toBe('disconnected');expect(a.counts.actions).toBe(0);expect(a.counts.writes).toBe(0);
  });
  it('only advertises an injected grant and refuses model identity/generation fields',async()=>{
    const ordinary=rig({managed:false}),a=rig();
    expect(ordinary.client.tools().some(t=>t.name==='mc_character_body')).toBe(false);
    expect(a.client.tools().filter(t=>t.name==='mc_character_body')).toHaveLength(1);
    await a.client.connect();
    await expect(a.client.call('mc_character_body',{action:'switch',targetKind:'numen',characterId:'other'})).rejects.toThrow('Use current');
    expect(a.counts.writes).toBe(0);await a.client.disconnect();
  });
  it('closes the original driver, keeps the switch receipt through disconnect and never posts it twice',async()=>{
    const a=rig();await a.client.connect();const id='call-one';
    const wireId='turn-'+createHash('sha256').update(id).digest('hex');
    a.setPost(async msg=>{
      expect(msg).toEqual({op:'controllerSwitch',characterId,expectedGeneration:1,requestId:wireId,targetKind:'numen'});
      expect(await a.client.releaseForBodyHandoff({generation:1,requestId:msg.requestId})).toEqual({state:'disconnected'});
      return {characterId,requestId:wireId,targetKind:'numen',generation:2,status:'completed',activeKind:'numen',secret:'private-token'};
    });
    const args={action:'switch',targetKind:'numen'};
    const out=await a.client.call('mc_character_body',args,id);
    expect(out.endsTurn).toBe(true);expect(out.data?.requestId).toBe(wireId);expect(out.text).not.toContain('private-token');
    expect(await a.client.call('mc_character_body',args,id)).toEqual(out);
    expect(a.client.request(id).status).toBe('returned');expect(a.counts.writes).toBe(1);
    await expect(a.client.connect()).rejects.toThrow('fenced');expect(a.counts.actions).toBe(0);
  });
  it('blocks an in-flight effect and a later running execution, then accepts its exact terminal',async()=>{
    const a=rig();await a.client.connect();let done!:()=>void;
    a.setRun(async()=>{await new Promise<void>(r=>{done=r;});
      return {text:'queued',execution:{kind:'task',id:'7',phase:'accepted',terminal:false,goalCompleted:false}};});
    const action=a.client.call('mc_do',{},'walk-7');await new Promise(resolve=>setImmediate(resolve));
    const original='switch-7';
    expect((await a.client.releaseForBodyHandoff({requestId:original,generation:1})).state).toBe('blocked');
    await expect(a.client.tools().find(t=>t.name==='mc_do')!.handler({},{role:'agent',log:nullLogger(),callId:'other'})).rejects.toThrow('fenced');
    await expect(a.client.hostTactics({choice:{}})).rejects.toThrow('fenced');done();await action;
    expect((await a.client.releaseForBodyHandoff({requestId:original,generation:1})).state).toBe('blocked');
    await a.terminal('8');
    expect((await a.client.releaseForBodyHandoff({requestId:original,generation:1})).state).toBe('blocked');
    await a.terminal('7');
    expect((await a.client.releaseForBodyHandoff({requestId:original,generation:1})).state).toBe('disconnected');
    expect(a.counts.actions).toBe(1);
  });
  it('retains an indeterminate effect across SDK restart and requires same generation to reopen a denied source',async()=>{
    const a=rig();await a.client.connect();a.setRun(async()=>{throw Error('unknown transport result');});
    await expect(a.client.call('mc_do',{},'unknown-action')).rejects.toThrow();await a.client.disconnect();
    const b=rig({directory:a.directory});await b.client.connect();
    const receipt=await b.client.releaseForBodyHandoff({requestId:'switch',generation:1});
    expect(receipt).toMatchObject({state:'blocked',requestId:'unknown-action'});
    b.setReceipt({characterId,requestId:'switch',generation:2,activeKind:'mineflayer',status:'blocked'});
    await b.client.refreshBodyHandoff('switch');await expect(b.client.call('mc_do',{},'test-fence')).rejects.toThrow('fenced');
    b.setReceipt({characterId,requestId:'switch',generation:1,activeKind:'mineflayer',status:'blocked'});
    await b.client.refreshBodyHandoff('switch');expect((await b.client.call('mc_do',{},'fresh-other')).text).toBe('done');
    expect(b.counts.actions).toBe(1);await b.client.disconnect();
  });
  it('does not retry after losing the switch ACK; acquisition works only for its authorized target generation',async()=>{
    const a=rig();await a.client.connect();a.setPost(async()=>{throw Error('credential must not enter tool output');});
    const out=await a.client.call('mc_character_body',{action:'switch',targetKind:'numen'},'lost-ack');
    expect(out.data).toMatchObject({status:'unknown',retryable:false});expect(out.text).not.toContain('credential');
    await expect(a.client.call('mc_do',{})).rejects.toThrow('fenced');expect(a.counts.writes).toBe(1);await a.client.disconnect();
    const b=rig({generation:3}),r='return';
    b.setReceipt({characterId,requestId:r,status:'switching',phase:'releasing',generation:2,targetKind:'mineflayer',activeKind:'numen'});
    expect(await b.client.readyForHandoff(r,3)).toBe(true);expect(b.counts.start).toBe(0);
    b.setCurrent({characterId,generation:3,activeKind:null,status:'switching',pendingRequestId:r});
    b.setReceipt({characterId,requestId:r,status:'switching',phase:'acquiring',generation:3,targetKind:'mineflayer',activeKind:null});
    await expect(b.client.connectForBodyHandoff(r)).resolves.toEqual({state:'connected',playerUuid:uuid});
    await expect(b.client.call('mc_do',{})).rejects.toThrow('fenced');
    b.setReceipt({characterId,requestId:r,status:'completed',generation:3,targetKind:'mineflayer',activeKind:'mineflayer'});
    await b.client.refreshBodyHandoff(r);expect((await b.client.call('mc_do',{})).text).toBe('done');await b.client.disconnect();
  });
});
