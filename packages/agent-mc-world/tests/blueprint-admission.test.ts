import { describe, expect, it, vi } from 'vitest';
import { parseBlueprintArgs, MINECRAFT_TOOL_DECLS, MinecraftWorld } from '../core/world.ts';
import { readSkillHelp } from '../core/skills.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger } from '../src/client/index.ts';

describe('blueprint operation admission', () => {
  it.each([null,[],{save:null},{unload:null},{design:null},{accept:null},{reserve_override:null},{save:undefined},{design:{key:'shelter',brief:'A home'}}])('rejects supplied null/undefined or unsupported design: %j',args=>{
    expect(parseBlueprintArgs(args as never)).toHaveProperty('error');
  });
  it('returns structured failures through the real handler without querying or mutating the catalogue',async()=>{
    const world=Object.create(MinecraftWorld.prototype) as any;
    Object.assign(world,{toolLog:(_name:string,_args:unknown,text:string)=>text,syncRealm:vi.fn(),blueprintQuery:vi.fn(()=> 'catalogue'),
      extensionTools:()=>[],blueprintReadyDrafts:new Map(),blueprintStreams:new Map(),blueprints:{get:vi.fn(),save:vi.fn()},designInFlight:null});
    const tool=world.tools().find((t:any)=>t.name==='mc_blueprint');
    for(const args of [{save:null},{unload:null},{design:null},{action:'design'},{op:'save'},
      {design:{key:'shelter',brief:'A home'}},{save:{key:'shelter'}},{save:{key:'shelter',append:true}},
      {accept:{key:'shelter',version_id:'missing',content_hash:'a'.repeat(64)}}]) {
      const result=await tool.handler(args,{role:'test'});
      expect(result).toMatchObject({failed:true,text:expect.any(String)});
    }
    expect(world.blueprintQuery).not.toHaveBeenCalled();expect(world.blueprints.save).not.toHaveBeenCalled();
    expect(world.blueprintStreams.size).toBe(0);expect(world.blueprintReadyDrafts.size).toBe(0);
    const read=await tool.handler({},{role:'test'});
    expect(typeof read==='string'?{text:read}:read).toMatchObject({text:'catalogue'});
  });
  it('retains blueprint rejection metadata through the native SDK outcome normalizer',async()=>{
    const body=Object.create(MinecraftWorld.prototype) as any;
    Object.assign(body,{toolLog:(_name:string,_args:unknown,text:string)=>text,syncRealm:vi.fn(),blueprintQuery:vi.fn(()=> 'catalogue'),extensionTools:()=>[]});
    const tool=body.tools().find((t:any)=>t.name==='mc_blueprint');
    const world={id:'fixture',tools:()=>[tool],start:async()=>{},stop:async()=>{},envPromptVars:async()=>({})};
    const dataDir=mkdtempSync(join(tmpdir(),'blueprint-admission-'));
    const cfg={...structuredClone(MINECRAFT_CLIENT_DEFAULTS),host:'fixture.test',username:'Fixture'};
    const client=new MinecraftAgentClient({cfg,dataDir,log:nullLogger(),autoAcknowledgeBarriers:true},world as never);
    try {
      await client.connect();
      for(const args of [{save:null},{action:'design'},{design:{key:'shelter',brief:'A home'}}]) {
        const reply=await client.call('mc_blueprint',args);
        expect(reply.failed).toBe(true);expect(reply.control).toHaveProperty('requestId');
      }
      expect(body.blueprintQuery).not.toHaveBeenCalled();expect(body.syncRealm).not.toHaveBeenCalled();
      expect((await client.call('mc_blueprint',{})).failed).not.toBe(true);
    }finally{await client.disconnect();rmSync(dataDir,{recursive:true,force:true});}
  });
  it('rejects hallucinated operation envelopes instead of silently listing empty blueprints', () => {
    for (const args of [{action:'design'}, {op:'save',key:'shelter'}, {help:true}, {save:{key:'shelter'},action:'save'}]) {
      const result = parseBlueprintArgs(args);
      expect('error' in result).toBe(true);
      if ('error' in result) expect(result.error).toContain('{save:');
    }
  });
  it('retains exact empty reads and publishes strict top-level schema', () => {
    expect(parseBlueprintArgs({})).toEqual({kind:'query'});
    expect(parseBlueprintArgs({unload:'shelter'})).toEqual({kind:'unload',key:'shelter'});
    expect(MINECRAFT_TOOL_DECLS.find(tool=>tool.name==='mc_blueprint')?.parameters.additionalProperties).toBe(false);
  });
  it('describes actual craft count units and does not advertise a hidden design model',()=>{
    const help=readSkillHelp({skill:'craft'});
    expect('text' in help && help.text).toContain('count 是本次要新增的产物个数');
    expect('text' in help && help.text).toContain('grid 模式的 count 是重复配方次数');
    const schema=MINECRAFT_TOOL_DECLS.find(tool=>tool.name==='mc_blueprint')?.parameters;
    expect(schema?.description).not.toContain('交给后台去构思');
  });
});
