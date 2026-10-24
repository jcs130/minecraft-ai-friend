import {expect,it,vi} from 'vitest';
import {configureChatDedup,noteChatInput,sendDeduplicatedChat} from '../core/chat-dedup.ts';
import {methodHarness} from './method-harness.ts';
it('deduplicates the observed five identical replies at dispatch, without ending unrelated steps',async()=>{
  const r=methodHarness();
  try {
    configureChatDedup(r.bot,()=>120000);
    const text='Jojo 太客气啦，该我谢谢你陪聊～我往钟那边仓库走…';
    for(let i=0;i<5;i++) {
      const decision=r.exec.submitDetailed([{skill:'chat',text}],'append');
      expect(decision.accepted).toBe(true);
      await vi.waitFor(()=>expect((r.world as any).methodTerminals.has(decision.taskId)).toBe(true));
    }
    expect(r.said).toEqual([text]);
    expect(r.host.events.some(e=>e.text.includes('本次未重复发送'))).toBe(true);
    expect(r.host.events.some(e=>e.text.includes('技能内部错误'))).toBe(false);
  }finally{r.close();}
});
it('separates recipients/content, releases on new inbound conversation and expiry, and never throttles commands',()=>{
  const bot={},send=vi.fn();let window=120000;configureChatDedup(bot,()=>window);
  const chat=(text:string,now=0)=>sendDeduplicatedChat(bot,text,send,now);
  expect(chat('/msg Alice 收到').sent).toBe(true);
  expect(chat('/tell alice 收到',1).sent).toBe(false);
  expect(chat('/msg Bob 收到',2).sent).toBe(true);
  expect(chat('/msg Alice 新内容',3).sent).toBe(true);
  noteChatInput(bot,'Bob',true);expect(chat('/msg Alice 收到',4).sent).toBe(false);
  noteChatInput(bot,'Alice',true);expect(chat('/msg Alice 收到',5).sent).toBe(true);
  expect(chat('/msg Alice 收到',120005).sent).toBe(true);
  expect(chat('/mycli status',6).sent).toBe(true);expect(chat('/mycli status',7).sent).toBe(true);
  window=0;expect(chat('/msg Alice 收到',120006).sent).toBe(true);
});
it('does not remember a message when native dispatch throws',()=>{
  const bot={},bad=()=>{throw new Error('socket closed');};configureChatDedup(bot,()=>120000);
  expect(()=>sendDeduplicatedChat(bot,'hello',bad)).toThrow('socket closed');
  expect(sendDeduplicatedChat(bot,'hello',()=>{}).sent).toBe(true);
});
it('sends ordinary targeted speech as public text on 1.21.11 without inventing a private-message command',async()=>{
  const r=methodHarness('1.21.11');
  try{
    const text='Alice，大家好，我先看看附近的环境。';
    await r.world.tools().find(tool=>tool.name==='mc_do')!.handler({steps:[{skill:'chat',text}]},{role:'test',log:r.host.log});
    expect(r.said).toEqual([text]);
    expect(r.said.some(line=>/^\/(?:msg|tell|w)\b/.test(line))).toBe(false);
  }finally{r.close();}
});
