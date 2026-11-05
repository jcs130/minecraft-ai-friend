import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger } from '../src/client/index.ts';
import { workReportReceipt, inspectReportReview, nativeExecutionKey, selectExecutionWait, matchesExecutionWait,
  WORK_EVIDENCE_SCHEMA, type ReportRecord, type ReviewProposal, type ExecutionObservation, type World } from '../src/contracts/index.ts';
import { createMinecraftMcpServer } from '../src/mcp/server.ts';

const report = {status:'ready',text:'取得护腿；墓穴尚未开始。',evidence:['call-1','event:世界:42']};
const record = (): ReportRecord => ({assignmentId:'assignment-1',reportRevision:2,report:structuredClone(report)});
const proposal = (): ReviewProposal => ({assignmentId:'assignment-1',expectedReportRevision:2,
  reportReceipt:workReportReceipt('assignment-1',2,report)!,decision:'release',text:'已核对原始回执，继续主目标。'});
const observed = (kind:string,id:string,terminal=false,world='minecraft',at=200): ExecutionObservation => ({world,at,execution:{kind,id,terminal}});

it('keeps existing UTF-8 report receipts while rejecting stale/different/summary-only reports', () => {
  const receipt=workReportReceipt('assignment-1',2,report);
  expect(receipt).toBe(createHash('sha256').update(JSON.stringify(['assignment-1',2,report])).digest('hex'));
  expect(workReportReceipt('assignment-1',2,{evidence:report.evidence,text:report.text,status:report.status})).toBe(receipt);
  for(const changed of [{...report,text:'取得护腿'}, {...report,status:'waiting'}, {...report,evidence:[...report.evidence,'call-2']}])
    expect(workReportReceipt('assignment-1',2,changed)).not.toBe(receipt);
  expect(workReportReceipt('assignment-1',3,report)).not.toBe(receipt);
  expect(workReportReceipt('assignment-2',2,report)).not.toBe(receipt);
  expect(workReportReceipt('assignment-1',0,null)).toBeNull();
  expect(()=>workReportReceipt('assignment-1',0,report)).toThrow();
  expect(()=>workReportReceipt('assignment-1',2,{...report,completion:true} as typeof report)).toThrow();
});

it('checks report identity/version and full receipt without applying a decision or completion', () => {
  const current=record(), input=proposal(), before=structuredClone([current,input]);
  expect(inspectReportReview(current,input)).toMatchObject({disposition:'reviewable',code:null,mutated:false,goalCompleted:false,source:'caller-supplied'});
  expect(inspectReportReview(current,{...input,assignmentId:'other'}).code).toBe('ASSIGNMENT_IDENTITY_CONFLICT');
  expect(inspectReportReview(current,{...input,expectedReportRevision:1}).code).toBe('REPORT_REVISION_CONFLICT');
  expect(inspectReportReview(current,{...input,reportReceipt:undefined}).code).toBe('FULL_REPORT_REQUIRED');
  expect(inspectReportReview({...current,report:null},input).code).toBe('NO_REPORT');
  expect(inspectReportReview({...current,ended:true},input).code).toBe('ASSIGNMENT_ENDED');
  expect(inspectReportReview(current,{...input,text:'   '}).code).toBe('INVALID_REVIEW');
  expect([current,input]).toEqual(before);
});

it('recognizes the same persisted review before ended checks, never replays or overwrites it', () => {
  const input=proposal(), current={...record(),ended:true,review:{reportRevision:2,decision:input.decision,text:input.text}};
  expect(inspectReportReview(current,input)).toMatchObject({disposition:'idempotent',mutated:false,goalCompleted:false});
  expect(inspectReportReview(current,{...input,decision:'continue'}).code).toBe('REPORT_ALREADY_REVIEWED');
  expect(inspectReportReview(current,{...input,text:'different'}).code).toBe('REPORT_ALREADY_REVIEWED');
  expect(inspectReportReview({...current,review:{...current.review,reportRevision:1},ended:false},input).disposition).toBe('reviewable');
});

it('waits only for one current native unfinished execution, with order-independent terminal dominance', () => {
  const pending=observed('task','42'), done=observed('task','42',true), other=observed('task','43');
  const options={world:'minecraft',after:100};
  expect(selectExecutionWait([pending,pending],options)).toMatchObject({disposition:'unique',wait:{world:'minecraft',kind:'task',id:'42'}});
  for(const rows of [[pending,done],[done,pending]])expect(selectExecutionWait(rows,options).disposition).toBe('none');
  expect(selectExecutionWait([pending,other],options)).toMatchObject({disposition:'ambiguous',wait:null});
  expect(selectExecutionWait([pending],{...options,settled:[{world:'minecraft',kind:'task',id:'42'}]}).disposition).toBe('none');
  expect(selectExecutionWait([observed('task','42',false,'other'),observed('task','43',false,'minecraft',99)],options).disposition).toBe('none');
  expect(selectExecutionWait([observed('task','42',true,'other'),pending],options).disposition).toBe('unique');
  expect(selectExecutionWait([pending],{...options,settled:[{world:'minecraft',kind:'method',id:'42'}]}).disposition).toBe('unique');
});

it('isolates tuple identities and wakes only on the exact world/kind/id terminal', () => {
  const wait={world:'minecraft',kind:'task',id:'42'};
  expect(nativeExecutionKey({world:'a:b',kind:'c',id:'d'})).not.toBe(nativeExecutionKey({world:'a',kind:'b:c',id:'d'}));
  expect(matchesExecutionWait(wait,observed('task','42',true))).toBe(true);
  for(const o of [observed('task','42'),observed('task','43',true),observed('method','42',true),observed('task','42',true,'dungeon')])
    expect(matchesExecutionWait(wait,o)).toBe(false);
});

it.each(['full','compact'] as const)('exports pure disconnected SDK/MCP queries with %s catalogues', async catalog => {
  const directory=await mkdtemp(join(tmpdir(),'work-evidence-'));
  const start=vi.fn(async()=>{throw Error('must not connect');});
  const world:World={id:'minecraft',tools:()=>[],envPromptVars:()=>null,start,stop:async()=>{}};
  const runtime=new MinecraftAgentClient({cfg:structuredClone(MINECRAFT_CLIENT_DEFAULTS),dataDir:directory,log:nullLogger()},world);
  const server=createMinecraftMcpServer(runtime,'test',{catalog,turnOwnership:'host'});
  const client=new Client({name:'neutral-consumer',version:'1'}),[left,right]=InMemoryTransport.createLinkedPair();
  try {
    await server.connect(left);await client.connect(right);
    expect((await client.listTools()).tools.find(t=>t.name==='mc_protocol')?._meta)
      .toMatchObject({'agent-mc/v1':{workEvidence:{schema:WORK_EVIDENCE_SCHEMA,source:'caller-supplied'}}});
    const requests=[{action:'report_review',reportRecord:record(),review:proposal()},
      {action:'execution_wait',observations:[observed('task','42')],waitOptions:{world:'minecraft',after:100}}];
    const expected=[runtime.inspectReportReview(record(),proposal()),runtime.selectExecutionWait([observed('task','42')],{world:'minecraft',after:100})];
    for(let i=0;i<requests.length;i++) {
      const reply=await client.callTool({name:'mc_protocol',arguments:{protocol:'agent-mc/v1',...requests[i]}});
      expect(reply.isError).not.toBe(true);
      expect(JSON.parse((reply.structuredContent as {text:string}).text)).toEqual(expected[i]);
      expect(reply.structuredContent).toMatchObject({meta:{readAccess:{readOnly:true}}});
    }
    for(const args of [{action:'report_review',reportRecord:record()},
      {action:'execution_wait',observations:[{...observed('task','42'),execution:{kind:'task',id:'42',terminal:'false'}}],waitOptions:{world:'minecraft',after:0}}]) {
      const reply=await client.callTool({name:'mc_protocol',arguments:{protocol:'agent-mc/v1',...args}});
      expect(reply.isError).toBe(true);
    }
    expect(runtime.status().phase).toBe('disconnected');expect(start).not.toHaveBeenCalled();
  } finally {await client.close();await server.close();await runtime.disconnect();await rm(directory,{recursive:true,force:true});}
});
