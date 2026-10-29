import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger } from '../src/client/index.ts';
import { methodHarness } from './method-harness.ts';
import type { WorldHost } from '../src/client/contracts.ts';

afterEach(() => vi.useRealTimers());

it.each([false, true])('closes every accepted queue identity on safety preemption (running=%s)', async running => {
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-30T00:00:00Z'));
  const h=methodHarness('1.21.1'),directory=await mkdtemp(join(tmpdir(),'mc-preempt-terminals-'));
  const environment={id:h.world.id,tools:()=>h.world.tools(),envPromptVars:()=>null,
    start:async(host:WorldHost)=>{Object.assign(h.world,{host});},stop:async()=>{}};
  const client=new MinecraftAgentClient({cfg:{...structuredClone(MINECRAFT_CLIENT_DEFAULTS),host:'fixture.invalid',username:'PreemptQA'},
    dataDir:directory,log:nullLogger()},environment);
  const ids:string[]=[];
  try{
    await client.connect();
    if(!running)h.exec.pauseForExternal('fixture owner');
    const first=await client.call('mc_do',{steps:[{skill:'control',keys:['forward'],durationMs:2000}]},{requestId:'first'});
    expect(first.execution?.terminal).toBe(false);ids.push(first.execution!.id);
    if(first.control?.barrierAfter)client.acknowledgeBarrier('first');
    for(let i=0;i<2;i++){
      const requestId='queued-'+i;
      const result=await client.call('mc_do',{steps:[{skill:'chat',text:'never send '+i}],queue:'append'},{requestId});
      expect(result.execution?.terminal).toBe(false);ids.push(result.execution!.id);
      if(result.control?.barrierAfter)client.acknowledgeBarrier(requestId);
    }
    expect(client.executionState().activeCount).toBe(3);
    h.exec.preempt('fixture safety escape');await vi.advanceTimersByTimeAsync(10);
    const receipts=ids.map(id=>client.task('task',id));
    expect(receipts.map(r=>r?.terminal)).toEqual([true,true,true]);
    expect(receipts.every(r=>r?.goalCompleted===false&&['superseded','cancelled'].includes(r.phase))).toBe(true);
    expect(client.executionState()).toMatchObject({activeCount:0,pendingCalls:0,pendingTactics:0});
    const events=await client.events({includeArchived:true});
    expect(events.events.filter(e=>e.execution?.terminal&&ids.includes(e.execution.id))).toHaveLength(3);
    expect(h.said).toEqual([]);
    expect(h.exec.status()).toMatchObject({running:null,waiting:[],hold:null});
  }finally{h.close();await client.disconnect();await rm(directory,{recursive:true,force:true});}
});
