import {describe, expect, it, vi} from 'vitest';
import {mapWorldEventNamespace, namespaceWorldHost, namespaceWorldStorage,extendWorldHost,mapWorldOutcomeNamespace} from '../src/client/world-namespace.ts';
import {messageInboxHost,MessageInbox} from '../src/client/message-inbox.ts';
import type {WorldHost} from '../src/contracts/index.ts';

describe('host-independent World naming boundary', () => {
  it('maps immediate/deferred events and pending filters without altering provenance or quoted evidence', async () => {
    const event = {source:'minecraft',type:'minecraft.chat',senderKey:'minecraft:player',text:'minecraft.chat 是玩家原话',
      meta:{dimension:'minecraft:overworld'},cursor:5,origin:'external' as const,contextDelivery:'deliver' as const,ts:'now'};
    let capability = 'first'; const pushed: any[] = [], deferred: any[] = [];
    const host = {get cognition(){return capability;},pushEvent:async(e:any)=>{pushed.push(e);return {...e,cursor:5};},
      pushDeferred:(e:any)=>deferred.push(e),drainPendingEvents:async(filter:any)=>[mapWorldEventNamespace(event,'minecraft','mymc')].filter(filter),
      store:{range:(q:any)=>{expect(q.source).toBe('mymc');return [mapWorldEventNamespace(event,'minecraft','mymc')];}}} as unknown as WorldHost & {cognition:string};
    const adapter = namespaceWorldHost(host,'minecraft','mymc');
    const result = await adapter.pushEvent(event);
    expect(pushed[0]).toMatchObject({source:'mymc',type:'mymc.chat',senderKey:'mymc:player',text:event.text,meta:event.meta,origin:'external'});
    expect(result.type).toBe('minecraft.chat');
    adapter.pushDeferred({type:'minecraft.task',senderKey:'minecraft.jobs',render:async()=>event.text});
    expect(deferred[0].type).toBe('mymc.task');expect(await deferred[0].render()).toBe(event.text);
    expect(await adapter.drainPendingEvents(e=>e.type==='minecraft.chat')).toEqual([event]);
    expect(adapter.store.range({source:'minecraft'})).toEqual([event]);
    expect(mapWorldOutcomeNamespace({text:event.text,events:[event]},'minecraft','mymc')).toMatchObject({text:event.text,events:[{source:'mymc',type:'mymc.chat'}]});
    capability='second';expect(adapter.cognition).toBe('second');
  });
  it('keeps foreign sources and original clear/stat closures', () => {
    expect(mapWorldEventNamespace({source:'other',type:'other.chat',senderKey:'minecraftish'},'minecraft','mymc')).toEqual({source:'other',type:'other.chat',senderKey:'minecraftish'});
    expect(mapWorldEventNamespace({source:'minecraft',type:'minecraft.chat',senderKey:'minecraft'},'minecraft','mymc'))
      .toEqual({source:'mymc',type:'mymc.chat',senderKey:'minecraft'});
    const clear=vi.fn(),stat=()=> 'retained';const parts=namespaceWorldStorage([{key:'minecraft-chests',label:'chests',kind:'disk',clear,stat}],'minecraft','mymc');
    expect(parts[0].key).toBe('mymc-chests');parts[0].clear();expect(clear).toHaveBeenCalledOnce();expect(parts[0].stat()).toBe('retained');
  });
  it('preserves dynamically supplied ports through observational wrappers',()=>{
    let decision={request:vi.fn()};const host={}as WorldHost;
    Object.defineProperty(host,'decisions',{get:()=>decision,enumerable:false});
    const observed=extendWorldHost(messageInboxHost(host,new MessageInbox('fixture')),{recallGameLessons:()=>[]});
    expect(observed.decisions).toBe(decision);decision={request:vi.fn()};expect(observed.decisions).toBe(decision);
  });
});
