import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
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

test('a filesystem alias shares the physical core constructors before contract validation',()=>{
 const root=mkdtempSync(join(tmpdir(),'engine-port-alias-'));
 try{
  const physical=join(root,'physical'),alias=join(root,'logical');mkdirSync(physical);
  writeFileSync(join(physical,'base.mjs'),'export class World {} export class Bridge {}');
  const source='import {World,Bridge} from "./base.mjs"; export class EngineWorld extends World {} export class EngineBridge extends Bridge {} export function createEngine(){} export const SERVER_TOOLS=[];';
  writeFileSync(join(physical,'engine.mjs'),source);symlinkSync(physical,alias,'junction');
  const sha256=createHash('sha256').update(source).digest('hex');
  const script=`import assert from 'node:assert/strict';
   import {serverEnginePort} from ${JSON.stringify(new URL('../src/agent_mc_autonomy/integrations/server-engine-port.mjs',import.meta.url).href)};
   import {World,Bridge} from ${JSON.stringify(pathToFileURL(join(physical,'base.mjs')).href)};
   const port=await serverEnginePort(${JSON.stringify({module:join(alias,'engine.mjs'),sha256})},{World,Bridge});
   assert(port.EngineWorld.prototype instanceof World);assert(port.EngineBridge.prototype instanceof Bridge);`;
  // Preserve aliases explicitly to reproduce Windows app-data virtualization
  // on every platform; this child only imports isolated local fixture modules.
  const result=spawnSync(process.execPath,['--preserve-symlinks','--input-type=module','--eval',script],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);
 }finally{rmSync(root,{recursive:true,force:true});}
});
