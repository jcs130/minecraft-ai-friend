import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { installInventorySession } from '../ops/mineflayer-inventory-session.mjs';

const wire = (count, name='compass', variant='original') => count ? { itemId: name, itemCount: count, components: [{name:'custom_data',data:variant}] } : {itemCount:0};
const Item = { fromNotch: w => !w?.itemCount ? null : {name:w.itemId,count:w.itemCount,stackSize:64,wire:structuredClone(w)},
  toNotch: i => i ? {...structuredClone(i.wire),itemCount:i.count} : wire(0) };
function harness({delay=2,timeout=150,quiet=5}={}) {
  const bot=new EventEmitter(),client=new EventEmitter();bot._client=client;bot.version='1.20.6';
  bot.player={uuid:'00000000-0000-4000-8000-000000000001'};
  bot.inventory={slots:Array(46).fill(null),selectedItem:null,updateSlot(i,item){this.slots[i]=item;}};
  let bag=Array.from({length:54},()=>wire(0)),player=Array.from({length:36},()=>wire(0)),cursor=wire(0),id=1,state=0;
  player[0]=wire(4);player[1]=wire(3,'paper');
  const calls=[],timers=[];let policy=()=>({}),open=true,refreshes=0;
  const later=(fn,ms=delay)=>{const timer=setTimeout(fn,ms);timers.push(timer);};
  const slots=()=>[...bag,...player].map(i=>structuredClone(i));
  // The Mineflayer-shaped consumer is deliberately imperfect: local inventory
  // lags behind open container slots, and a cursor-only packet is ignored.
  client.on('open_window',p=>{bot.currentWindow={id:p.windowId,type:'minecraft:generic_9x6',slots:Array(90).fill(null),inventoryStart:54,inventoryEnd:90,selectedItem:null};});
  client.on('window_items',p=>{if(bot.currentWindow?.id===p.windowId){bot.currentWindow.slots=p.items.map(Item.fromNotch);bot.currentWindow.selectedItem=Item.fromNotch(p.carriedItem);bot.emit('windowOpen',bot.currentWindow);}});
  client.on('set_slot',p=>{if(bot.currentWindow?.id===p.windowId&&p.slot>=0)bot.currentWindow.slots[p.slot]=Item.fromNotch(p.item);});
  client.on('close_window',()=>{const old=bot.currentWindow;bot.currentWindow=null;bot.emit('windowClose',old);});
  const full=()=>client.emit('window_items',{windowId:id,stateId:state,items:slots(),carriedItem:structuredClone(cursor)});
  function show() {open=true;state=0;client.emit('open_window',{windowId:id,inventoryType:5,windowTitle:'本人背包'});later(full);}
  bot.chat=q=>{calls.push({kind:'command',q});if(q==='/minepacks:backpack open')show();else if(q==='/mycli inventory refresh'){refreshes++;later(full);}};
  bot.closeWindow=w=>{calls.push({kind:'close',id:w.id});open=false;bot.currentWindow=null;bot.emit('windowClose',w);};
  client.write=(name,p)=>{
    assert.equal(name,'window_click');calls.push({kind:'click',...structuredClone(p)});
    const behavior=policy(calls.filter(c=>c.kind==='click').length,p);
    if(behavior.ignore)return;
    assert(open);assert.equal(p.windowId,id);assert.deepEqual(p.changedSlots,[]);
    const before=slots(),current=before[p.slot];
    if(!cursor.itemCount){cursor=structuredClone(current);if(p.mouseButton===1)cursor.itemCount=Math.ceil(current.itemCount/2);before[p.slot]=wire(current.itemCount-cursor.itemCount,current.itemId);}
    else{const n=p.mouseButton===1?1:cursor.itemCount;before[p.slot]={...structuredClone(cursor),itemCount:(current.itemCount??0)+n};cursor.itemCount-=n;if(!cursor.itemCount)cursor=wire(0);}
    bag=before.slice(0,54);player=before.slice(54);state++;
    const after=slots(),stateId=state;
    if(!behavior.dropSlots)for(let i=0;i<after.length;i++)if(JSON.stringify(after[i])!==JSON.stringify(i===p.slot?current:slots()[i])){
      later(()=>client.emit('set_slot',{windowId:id,stateId,slot:i,item:structuredClone(after[i])}));
    }
    if(!behavior.dropCursor)later(()=>client.emit('set_slot',{windowId:-1,stateId:-1,slot:-1,item:structuredClone(cursor)}),delay*2);
    if(behavior.end)later(()=>{open=false;bot.emit('end');},1);
  };
  const log=[],api=installInventorySession(bot,{Item,timeoutMs:timeout,quietMs:quiet,onReceipt:r=>log.push(r),requestRefresh:()=>{refreshes++;later(full);}});
  const total=s=>s.slots.reduce((n,i)=>n+(i?.count??0),s.cursor?.count??0);
  return {bot,client,api,calls,log,total,full,show,setId:n=>id=n,setPolicy:fn=>policy=fn,refreshes:()=>refreshes,
    server:()=>({bag:structuredClone(bag),player:structuredClone(player),cursor:structuredClone(cursor)}),setBag:(i,item)=>bag[i]=item,
    setServer:s=>{bag=structuredClone(s.bag);player=structuredClone(s.player);cursor=structuredClone(s.cursor);},
    destroy:()=>{api.dispose();timers.forEach(clearTimeout);}};
}
async function opened(h){assert.equal((await h.api.open()).status,'opened');}

test('deposit, close, reopen and retrieve use authoritative quantities and empty cursor',async()=>{
  const h=harness();try{
    await opened(h);const start=h.api.snapshot().snapshot;assert.equal(h.bot.inventory.slots[9].count,4);
    const put=await h.api.transfer({operationId:'put',direction:'deposit',slot:54,count:2});assert.equal(put.status,'confirmed');
    assert.equal(h.total(put.before),h.total(put.after));assert.equal(put.after.cursor,null);assert.equal(h.bot.inventory.slots[9].count,2);
    assert.equal((await h.api.close()).status,'close_requested');await opened(h);
    const take=await h.api.transfer({operationId:'take',direction:'withdraw',slot:0,count:2});assert.equal(take.status,'confirmed');
    assert.equal(h.total(take.after),h.total(start));assert.equal(take.after.cursor,null);assert.equal(take.after.slots[54].count,4);
    assert.equal(h.server().cursor.itemCount,0);
  }finally{h.destroy();}
});
test('two requests are serialized; replaying an operation id returns its receipt',async()=>{
  const h=harness({delay:10});try{await opened(h);
    const a=h.api.transfer({operationId:'a',direction:'deposit',slot:54}),b=h.api.transfer({operationId:'b',direction:'deposit',slot:55});
    assert.equal((await a).status,'confirmed');assert.equal((await b).status,'confirmed');const n=h.calls.length;
    assert.equal((await h.api.transfer({operationId:'a',direction:'deposit',slot:54})).status,'confirmed');assert.equal(h.calls.length,n);
    assert.equal(h.log.filter(r=>r.status==='confirmed').length,2);
  }finally{h.destroy();}
});
test('delayed source and cursor signals cannot produce premature success',async()=>{
  const h=harness({delay:25,timeout:300});try{await opened(h);let settled=false;
    const task=h.api.transfer({direction:'deposit',slot:54}).then(r=>{settled=true;return r;});await sleep(30);
    assert.equal(settled,false);assert.equal(h.calls.filter(c=>c.kind==='click').length,1);
    assert.equal((await task).status,'confirmed');
  }finally{h.destroy();}
});
test('duplicate window callbacks do not open again or dispatch another transfer',async()=>{
  const h=harness();try{await opened(h);const epoch=h.api.snapshot().snapshot.epoch;
    h.bot.emit('windowOpen',h.bot.currentWindow);h.bot.emit('windowOpen',h.bot.currentWindow);
    assert.equal(h.api.snapshot().snapshot.epoch,epoch);assert.equal(h.calls.filter(c=>c.kind==='command').length,1);
    assert.equal((await h.api.transfer({direction:'deposit',slot:54})).status,'confirmed');assert.equal(h.calls.filter(c=>c.kind==='click').length,2);
  }finally{h.destroy();}
});
test('old full packets with a lower state id cannot overwrite a completed operation',async()=>{
  const h=harness();try{await opened(h);const old=h.api.snapshot().snapshot;
    const result=await h.api.transfer({direction:'deposit',slot:54});assert.equal(result.status,'confirmed');
    h.client.emit('window_items',{windowId:1,stateId:0,items:old.slots.map(i=>i?.wire??wire(0)),carriedItem:wire(0)});
    assert.deepEqual(h.api.snapshot().snapshot.slots,result.after.slots);
  }finally{h.destroy();}
});
test('missing final cursor signal returns unknown, blocks queued actions, then read-only query confirms',async()=>{
  const h=harness();try{await opened(h);h.setPolicy(n=>n===2?{dropCursor:true}:{});
    const a=h.api.transfer({operationId:'uncertain',direction:'deposit',slot:54}),b=h.api.transfer({operationId:'queued',direction:'deposit',slot:55});
    assert.equal((await a).status,'unknown');assert.equal((await b).status,'blocked');assert.equal(h.calls.filter(c=>c.kind==='click').length,2);
    const recovered=await h.api.reconcile();assert.equal(recovered.status,'confirmed');assert.equal(recovered.reconciled,true);assert.equal(recovered.after.cursor,null);
    assert.equal(h.calls.filter(c=>c.kind==='click').length,2);assert.equal(h.refreshes(),1);
  }finally{h.destroy();}
});
test('ignored click remains unknown until a fresh snapshot proves not applied; never replays',async()=>{
  const h=harness();try{await opened(h);h.setPolicy(()=>({ignore:true}));
    assert.equal((await h.api.transfer({operationId:'ignored',direction:'deposit',slot:54})).status,'unknown');
    assert.equal((await h.api.reconcile()).status,'not_applied');assert.equal(h.calls.filter(c=>c.kind==='click').length,1);
    assert.equal((await h.api.transfer({operationId:'ignored',direction:'deposit',slot:54})).status,'not_applied');assert.equal(h.calls.filter(c=>c.kind==='click').length,1);
  }finally{h.destroy();}
});
test('partial pickup stays unknown with visible carried items, no compensation or drop',async()=>{
  const h=harness();try{await opened(h);h.setPolicy(()=>({dropSlots:true,dropCursor:true}));
    assert.equal((await h.api.transfer({direction:'deposit',slot:54})).status,'unknown');
    const recovered=await h.api.reconcile();assert.equal(recovered.status,'unknown');assert.equal(recovered.reason,'partial_or_conflicting_state');
    assert.equal(recovered.observed.cursor.count,4);assert.equal((await h.api.close()).status,'blocked');assert.equal(h.calls.filter(c=>c.kind==='click').length,1);
  }finally{h.destroy();}
});
test('disconnect in an operation makes result unknown and prevents all following writes',async()=>{
  const h=harness();try{await opened(h);h.setPolicy(()=>({dropSlots:true,dropCursor:true,end:true}));
    const first=h.api.transfer({direction:'deposit',slot:54}),next=h.api.transfer({direction:'deposit',slot:55});
    assert.equal((await first).status,'unknown');assert.equal((await next).status,'blocked');assert.equal(h.calls.filter(c=>c.kind==='click').length,1);
  }finally{h.destroy();}
});
test('window id reuse invalidates the old epoch; unknown is not cleared against a new window',async()=>{
  const h=harness();try{await opened(h);const epoch=h.api.snapshot().snapshot.epoch;h.setPolicy(()=>({ignore:true}));
    assert.equal((await h.api.transfer({direction:'deposit',slot:54})).status,'unknown');h.client.emit('close_window',{windowId:1});
    // A stale pre-open packet must not initialize a later reused numeric id.
    h.full();h.show();await sleep(20);assert(h.api.snapshot().snapshot.epoch>epoch);
    const result=await h.api.reconcile();assert.equal(result.status,'unknown');assert.equal(result.reason,'window_epoch_changed_inspect_before_resuming');
    assert.equal(h.calls.filter(c=>c.kind==='click').length,1);
  }finally{h.destroy();}
});
test('custom item components prevent unlike stacks from being merged',async()=>{
  const h=harness();try{h.setBag(0,wire(60,'compass','different'));await opened(h);
    const result=await h.api.transfer({direction:'deposit',slot:54});assert.equal(result.status,'confirmed');assert.equal(result.destinationSlot,1);
    assert.equal(result.after.slots[0].count,60);assert.notEqual(result.after.slots[0].key,result.after.slots[1].key);
  }finally{h.destroy();}
});
test('1.20.6 unsigned cursor sentinel 255 synchronizes inventory and rejects older cursor state',async()=>{
  const h=harness();try{await opened(h);
    h.client.emit('set_slot',{windowId:255,stateId:3,slot:-1,item:wire(2)});
    assert.equal(h.api.snapshot().snapshot.cursor.count,2);assert.equal(h.bot.inventory.selectedItem.count,2);
    h.client.emit('set_slot',{windowId:255,stateId:2,slot:-1,item:wire(0)});
    assert.equal(h.api.snapshot().snapshot.cursor.count,2);
    h.client.emit('set_slot',{windowId:255,stateId:4,slot:-1,item:wire(0)});
    assert.equal(h.api.snapshot().snapshot.cursor,null);assert.equal(h.bot.inventory.selectedItem,null);
  }finally{h.destroy();}
});
test('component map order is not item identity; lore line order remains meaningful',async()=>{
  const h=harness();try{
    const components=[{type:'custom_name',data:'tool'},{type:'lore',data:['first','second']}];
    h.setBag(0,{...wire(2),components});h.setBag(1,{...wire(2),components:[...components].reverse()});
    h.setBag(2,{...wire(2),components:[components[0],{type:'lore',data:['second','first']}]});
    await opened(h);const s=h.api.snapshot().snapshot;
    assert.equal(s.slots[0].key,s.slots[1].key);assert.notEqual(s.slots[0].key,s.slots[2].key);
  }finally{h.destroy();}
});
test('invalid parameters, no room, and occupied cursor perform no clicks',async()=>{
  const h=harness();try{for(let i=0;i<54;i++)h.setBag(i,wire(64,'paper'));await opened(h);
    assert.equal((await h.api.transfer({direction:'deposit',slot:54})).status,'not_executed');
    assert.equal((await h.api.transfer({direction:'withdraw',slot:54})).reason,'invalid_source_or_direction');
    h.client.emit('set_slot',{windowId:-1,stateId:-1,slot:-1,item:wire(2)});
    assert.equal((await h.api.transfer({direction:'deposit',slot:54})).reason,'cursor_not_empty');assert.equal(h.calls.filter(c=>c.kind==='click').length,0);
  }finally{h.destroy();}
});
test('installation is per bot, disposal removes every listener, unsupported versions are explicit',()=>{
  const h=harness();assert.equal(installInventorySession(h.bot,{Item}),h.api);h.destroy();assert.equal(h.client.listenerCount('set_slot'),1);
  h.bot.version='1.21.1';assert.throws(()=>installInventorySession(h.bot,{Item}),/1.20.6/);
});
test('durable intent blocks reconnect replay; only a fresh same-owner personal bag can reconcile',async()=>{
  let saved=null;const journal={load:()=>structuredClone(saved),save:s=>{saved=structuredClone(s);}};
  const h=harness(),second=harness();
  try {
    h.api.dispose();h.api=installInventorySession(h.bot,{Item,timeoutMs:150,quietMs:5,journal,requestRefresh:h.full});
    await opened(h);h.setPolicy(n=>n===2?{dropCursor:true}:{});
    assert.equal((await h.api.transfer({operationId:'reconnect-put',direction:'deposit',slot:54})).status,'unknown');
    assert.equal(saved.pending.id,'reconnect-put');assert.equal(h.server().cursor.itemCount,0);
    second.api.dispose();second.setServer(h.server());
    second.api=installInventorySession(second.bot,{Item,timeoutMs:150,quietMs:5,journal,requestRefresh:second.full});
    await opened(second);
    assert.equal((await second.api.transfer({operationId:'new-write',direction:'deposit',slot:55})).status,'blocked');
    assert.equal((await second.api.reconcile()).status,'unknown');
    const r=await second.api.reconcile({allowPersonalReopen:true});assert.equal(r.status,'confirmed');assert(r.reconciled);assert.equal(saved.pending,null);
    assert.equal(second.calls.filter(c=>c.kind==='click').length,0);
    assert.equal((await second.api.transfer({operationId:'reconnect-put',direction:'deposit',slot:54})).status,'confirmed');
    assert.equal(second.calls.filter(c=>c.kind==='click').length,0);
  }finally{h.destroy();second.destroy();}
});
test('journal owner mismatch and write failure never dispatch a click',async()=>{
  const h=harness();try{
    h.api.dispose();assert.throws(()=>installInventorySession(h.bot,{Item,journal:{load:()=>({schemaVersion:1,ownerUuid:'wrong',receipts:[]}),save(){}}}),/wrong_owner/);
    h.api=installInventorySession(h.bot,{Item,timeoutMs:150,quietMs:5,journal:{load:()=>null,save:()=>{throw Error('disk_full');}}});
    await opened(h);const r=await h.api.transfer({direction:'deposit',slot:54});assert.equal(r.status,'not_executed');assert.equal(r.reason,'disk_full');assert.equal(h.calls.filter(c=>c.kind==='click').length,0);
  }finally{h.destroy();}
});
