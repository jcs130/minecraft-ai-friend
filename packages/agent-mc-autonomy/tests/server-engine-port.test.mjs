import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {serverEnginePort} from '../src/agent_mc_autonomy/integrations/server-engine-port.mjs';
test('default does not import any server engine, and a hash mismatch cannot execute it',async()=>{
 assert.equal(await serverEnginePort(null),null);
 const root=mkdtempSync(join(tmpdir(),'engine-port-'));
 try{const module=join(root,'engine.mjs');writeFileSync(module,'throw Error("must not execute");');await assert.rejects(serverEnginePort({module,sha256:'0'.repeat(64)}),/hash mismatch/);}
 finally{rmSync(root,{recursive:true,force:true});}
});
test('composed engines retain both server world and bridge behavior; incompatible cores fail closed',async()=>{
 const root=mkdtempSync(join(tmpdir(),'engine-port-'));
 try{
  const module=join(root,'engine.mjs');const source='export class EngineWorld { status(){return "native-rpg";} } export class EngineBridge { server(){return "explicit";} } export function createEngine(options){return new EngineWorld(options);} export const SERVER_TOOLS=[{name:"mc_cast"}];';
  writeFileSync(module,source);const sha256=createHash('sha256').update(source).digest('hex');
  const port=await serverEnginePort({module,sha256});
  class ViewedWorld extends port.EngineWorld {view(){return 'viewer';}}
  class ViewedBridge extends port.EngineBridge {view(){return 'viewer';}}
  assert.equal(new ViewedWorld().status(),'native-rpg');assert.equal(new ViewedWorld().view(),'viewer');assert.equal(new ViewedBridge().server(),'explicit');
  await assert.rejects(serverEnginePort({module,sha256},{World:class{},Bridge:class{}}),/contract mismatch/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
