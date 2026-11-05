import { expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger } from '../src/client/index.ts';
import { inspectToolCall, toolRequiresBodyControl, CALL_CAPABILITY_SCHEMA, type ToolDef, type World } from '../src/contracts/index.ts';
import {PROXIMITY_VOICE_TOOL} from '../core/proximity-voice-lane.ts';
import { createMinecraftMcpServer } from '../src/mcp/server.ts';

const tool = (): ToolDef => ({ name: 'mc_method', description: 'Read, edit or execute a method', tags: ['read','write','act'],
  parameters: { type: 'object', properties: { op: { enum: ['read','save','run'] } }, required: ['op'], additionalProperties: false },
  readOnlyCall: args => args.op === 'read', learningCall: args => args.op === 'save',
  handler: vi.fn(async () => ({ text: 'must not execute' })) });

it('separates voice side effects from the body lease without treating speech as a read', () => {
  const voice:ToolDef={...PROXIMITY_VOICE_TOOL,handler:vi.fn(async()=> 'never execute')};
  expect(inspectToolCall(voice,voice.name,{action:'speak',text:'One complete line.'}))
    .toMatchObject({valid:true,readOnly:false,backgroundLearning:false,requiresBody:false,dispatched:false});
  expect(toolRequiresBodyControl({...voice,bodyControl:undefined})).toBe(true);
  expect(toolRequiresBodyControl({...voice,bodyControl:'exclusive'})).toBe(true);
  expect(inspectToolCall(voice,voice.name,{action:'invalid'})).toMatchObject({valid:false,requiresBody:null});
  expect(inspectToolCall(tool(),'mc_method',{op:'read'}).requiresBody).toBe(false);
  expect(inspectToolCall(tool(),'mc_method',{op:'save'}).requiresBody).toBe(false);
  expect(inspectToolCall(tool(),'mc_method',{op:'run'}).requiresBody).toBe(true);
  expect(voice.handler).not.toHaveBeenCalled();
});

it('uses full argument validation and explicit branch predicates without calling handlers', () => {
  const t = tool();
  expect(inspectToolCall(t,t.name,{op:'read'})).toMatchObject({valid:true,readOnly:true,backgroundLearning:false,available:null,dispatched:false});
  expect(inspectToolCall(t,t.name,{op:'save'})).toMatchObject({readOnly:false,backgroundLearning:true});
  expect(inspectToolCall(t,t.name,{op:'run'})).toMatchObject({readOnly:false,backgroundLearning:false});
  for(const args of [{op:'read',code:'attack'}, {}, [], null])
    expect(inspectToolCall(t,t.name,args)).toMatchObject({valid:false,readOnly:null,backgroundLearning:null,reason:'invalid_arguments'});
  expect(inspectToolCall(undefined,'missing',{})).toMatchObject({reason:'unknown_tool',readOnly:null});
  expect(t.handler).not.toHaveBeenCalled();
});

it('never treats missing or failed capability declarations as permission', () => {
  const t = tool();
  expect(inspectToolCall({...t,readOnlyCall:undefined,learningCall:undefined},t.name,{op:'read'})).toMatchObject({readOnly:false,backgroundLearning:false});
  expect(inspectToolCall({...t, runtimeAvailable:()=>false},t.name,{op:'save'}).available).toBe(false);
  expect(inspectToolCall({...t,readOnlyCall:()=>{throw Error('unavailable');}},t.name,{op:'save'}))
    .toMatchObject({reason:'classification_unavailable',readOnly:null,backgroundLearning:null});
});

it.each(['full','compact'] as const)('serves identical SDK/MCP capabilities with %s schemas and a disconnected body', async catalog => {
  const dir=await mkdtemp(join(tmpdir(),'call-capability-')), t=tool();
  const voice:ToolDef={...PROXIMITY_VOICE_TOOL,handler:vi.fn(async()=> 'never execute')};
  const start=vi.fn(async()=>{throw Error('inspection cannot connect');});
  const world:World={id:'minecraft',tools:()=>[t,voice],envPromptVars:()=>null,start,stop:async()=>{}};
  const runtime=new MinecraftAgentClient({cfg:structuredClone(MINECRAFT_CLIENT_DEFAULTS),dataDir:dir,log:nullLogger()},world);
  const server=createMinecraftMcpServer(runtime,'test',{catalog,turnOwnership:'host'});
  const client=new Client({name:'python-compatible-consumer',version:'1'});
  const [left,right]=InMemoryTransport.createLinkedPair();
  try {
    await server.connect(left); await client.connect(right);
    const listed=(await client.listTools()).tools.find(t=>t.name==='mc_method')!;
    expect(listed._meta).toMatchObject({'agent-mc/v1':{callCapabilities:{schema:CALL_CAPABILITY_SCHEMA,tool:'mc_protocol',action:'inspect_call'}}});
    for(const args of [{op:'read'},{op:'save'},{op:'run'},{op:'read',unexpected:true}]) {
      const result=await client.callTool({name:'mc_protocol',arguments:{protocol:'agent-mc/v1',action:'inspect_call',tool:t.name,arguments:args}});
      expect(result.isError).not.toBe(true);
      expect(JSON.parse((result.structuredContent as {text:string}).text)).toEqual(runtime.inspectCall(t.name,args));
    }
    expect(runtime.status().phase).toBe('disconnected');
    const args={action:'speak',text:'Independent game speech'};
    const voiceResult=await client.callTool({name:'mc_protocol',arguments:{protocol:'agent-mc/v1',action:'inspect_call',tool:voice.name,arguments:args}});
    const capability=JSON.parse((voiceResult.structuredContent as {text:string}).text);
    expect(capability).toEqual(runtime.inspectCall(voice.name,args));
    expect(capability).toMatchObject({readOnly:false,requiresBody:false,dispatched:false});
    expect(voice.handler).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();expect(t.handler).not.toHaveBeenCalled();
  }finally{await client.close();await server.close();await runtime.disconnect();await rm(dir,{recursive:true,force:true});}
});
