import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve,sep} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {MinecraftAgentClient,MINECRAFT_CLIENT_DEFAULTS,nullLogger} from '../src/client/index.ts';
import {createMinecraftMcpServer} from '../src/mcp/server.ts';
import {TOOL_HELP_TOOL} from '../src/client/tool-help.ts';
const dirs:string[]=[];afterEach(()=>{for(const d of dirs.splice(0)){if(!resolve(d).startsWith(resolve(tmpdir())+sep))throw Error('Unexpected fixture directory');rmSync(d,{recursive:true,force:true});}});
describe('SDK measured motion admission',()=>{
 for(const prefix of ['mc','mymc'] as const)it(`${prefix}: inspects real receipt metadata, preserves requests and refuses dispatch without cancelling`,async()=>{
  const dataDir=mkdtempSync(join(tmpdir(),'mc-motion-review-'));dirs.push(dataDir);let dispatched=0;const epoch='11111111-1111-4111-8111-111111111111';
  const runtime=new MinecraftAgentClient({cfg:{...structuredClone(MINECRAFT_CLIENT_DEFAULTS),host:'fixture.invalid',username:'MotionQA'},dataDir,log:nullLogger()},
   {id:'fixture',start:async()=>{},stop:async()=>{},envPromptVars:()=>({}),tools:()=>[{...TOOL_HELP_TOOL,name:`${prefix}_tool_help`,handler:async()=>({text:'fixture help'})},
    {name:`${prefix}_do`,tags:['act'],description:'inert control fixture',parameters:{type:'object'},handler:async()=>({text:'accepted',execution:{kind:'task',id:`${epoch}:${++dispatched}`,phase:'accepted',terminal:false,goalCompleted:false}})}]},
   {profile:'fixture',toolPrefix:prefix});
  const server=createMinecraftMcpServer(runtime,'fixture'),client=new Client({name:'motion-fixture',version:'1'}),[left,right]=InMemoryTransport.createLinkedPair();
  const args={steps:[{skill:'control',keys:['forward'],yawDeg:-90,durationMs:2000}]},points=[[0,64,0],[8,64,0],[8,64,8],[0,64,8]],base=Date.now()-21000;
  try{await runtime.connect();await server.connect(left);await client.connect(right);
   for(let n=0;n<8;n++){
    await runtime.call(`${prefix}_do`,args,{requestId:'control-'+n});
    await runtime.host.pushEvent({type:`${prefix}.task`,ts:new Date(base+n*3000).toISOString(),text:'measured fixture',execution:{kind:'task',id:`${epoch}:${n+1}`,phase:'completed',terminal:true,goalCompleted:false,
     evidence:{steps:[{step:1,outcome:'ok',observedEffect:{schema:'agent-mc-observed-effect/v1',skill:'control',dimension:'overworld',before:{position:points[n%4]},after:{position:points[(n+1)%4]}}}]}}});
   }
   const before=runtime.executionState(),blocked=await runtime.call(`${prefix}_do`,args,{requestId:'ninth'});
   expect(blocked.failed).toBe(true);expect(blocked.data?.reason).toBe('observed_motion_requires_review');expect(dispatched).toBe(8);expect(runtime.executionState()).toEqual(before);
   const replay=await runtime.call(`${prefix}_do`,args,{requestId:'control-0'});expect(replay.execution?.id).toBe(`${epoch}:1`);expect(dispatched).toBe(8);
   await runtime.events({});await client.callTool({name:`${prefix}_events`,arguments:{}});
   expect((await runtime.call(`${prefix}_do`,args,{requestId:'still-blocked'})).failed).toBe(true);expect(dispatched).toBe(8);
   const help=await client.callTool({name:`${prefix}_tool_help`,arguments:{name:`${prefix}_do`}});expect(help.isError).not.toBe(true);
   expect((await runtime.call(`${prefix}_do`,args,{requestId:'reviewed'})).failed).not.toBe(true);expect(dispatched).toBe(9);
  }finally{await client.close();await server.close();await runtime.disconnect();}
 });
});
