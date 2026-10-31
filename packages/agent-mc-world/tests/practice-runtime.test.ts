import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe,it,expect} from 'vitest';
import {MinecraftAgentClient,MINECRAFT_CLIENT_DEFAULTS,nullLogger} from '../src/client/index.ts';
import {createClientMethodPractice} from '../src/learning/client-practice.ts';
import {PracticeUnknownEffect} from '../src/learning/practice.ts';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createMinecraftMcpServer} from '../src/mcp/server.ts';
describe('practice belongs to the public core runtime',()=>{
  it('advertises MCP discovery and honest offline help without connecting, a model, or body control',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'practice-discovery-'));
    const runtime=new MinecraftAgentClient({cfg:{...structuredClone(MINECRAFT_CLIENT_DEFAULTS),host:'offline.invalid',username:'fixture'},dataDir:directory,log:nullLogger()});
    const server=createMinecraftMcpServer(runtime,'test'),client=new Client({name:'agent',version:'test'}),[a,b]=InMemoryTransport.createLinkedPair();
    try{
      await server.connect(a);await client.connect(b);
      expect((await client.listTools()).tools.some(t=>t.name==='mc_practice')).toBe(true);
      const result=await client.callTool({name:'mc_practice',arguments:{op:'help'}});
      expect(result.isError).not.toBe(true);expect(JSON.parse((result.structuredContent as any).text)).toMatchObject({available:false,adopted:false});
      expect(runtime.status().phase).toBe('disconnected');expect(runtime.experiments().jobs).toEqual([]);
    }finally{await client.close();await server.close();await runtime.disconnect();rmSync(directory,{recursive:true,force:true});}
  });
  it('rejects changed body scope and persisted unknown trials before dispatch, including a new ID',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'practice-identity-'));
    try{
      let realm='dedicated',generation=1,calls=0;
      const client={toolPrefix:'mc',status:()=>({phase:'started',run:'dedicated-run',facts:{decisionStability:{route:{generation}},experience:{scope:{realm,account:'offline:fixture',agent:'fixture'}}}}),call:async()=>{calls++;throw Error('must not dispatch');}};
      const fixtures=[1,2].map(n=>({id:'fixture-'+n,snapshotId:'snapshot-'+n,environmentVersion:'test/v1',goal:{kind:'inventory-gain' as const,item:'wooden_pickaxe',count:1,maxHealthLoss:0}}));
      const options={directory,client,fixtures,agent:'fixture',control:{reset:async()=>{throw Error('must not reset');},settle:async()=> 'unknown' as const}};
      const p=createClientMethodPractice(options),request={trialId:'original',methodId:'method',candidate:{code:'return true;',params:{},guidance:''},fixture:fixtures[0],durationMs:1000};
      await expect(p.executor.execute({...request,durationMs:0},new AbortController().signal)).rejects.toThrow('duration');expect(calls).toBe(0);
      realm='another-server';await expect(p.executor.execute(request,new AbortController().signal)).rejects.toBeInstanceOf(PracticeUnknownEffect);expect(calls).toBe(0);
      realm='dedicated';generation=2;await expect(p.executor.execute(request,new AbortController().signal)).rejects.toBeInstanceOf(PracticeUnknownEffect);expect(calls).toBe(0);generation=1;
      realm='dedicated';writeFileSync(join(directory,'active.json'),JSON.stringify({status:'pending',trialId:'original',executeRequestId:'original:execute'}));
      const restarted=createClientMethodPractice(options);
      await expect(restarted.executor.execute({...request,trialId:'new-id'},new AbortController().signal)).rejects.toBeInstanceOf(PracticeUnknownEffect);expect(calls).toBe(0);
    }finally{rmSync(directory,{recursive:true,force:true});}
  });
});
