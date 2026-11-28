import { expect, it } from 'vitest';
import { CarriedInventoryObserver } from '../src/observations.ts';
import { methodHarness } from './method-harness.ts';
import { inventorySlotReadout } from '../core/readouts.ts';

it('retains one frame, separates native variants, and ignores rearrangements and non-carried slots', () => {
  const state = new CarriedInventoryObserver();
  const slots = Array(46).fill(null);
  const item = (n:number,c:number) => ({type:19,name:'paper',count:c,components:[{type:'custom_data',data:{serial:BigInt(n)}}]});
  slots[9]=item(1,5); slots[36]=item(2,5); slots[45]=item(3,2);
  const read = (at:string,publish=false) => state.read(slots, at, publish);
  expect(read('A',true).reading).toMatchObject({kind:'baseline',usedSlots:2,changes:[]});
  [slots[9],slots[10]]=[slots[10],slots[9]];
  expect(read('B',true).changed).toBe(false);
  slots[10]=item(2,5); slots[45]=null;
  const pending=read('C');
  expect(pending.reading.changes.map(r=>[r.before,r.after])).toEqual(expect.arrayContaining([[5,0],[5,10]]));
  expect(new Set(pending.reading.changes.map(r=>r.variant)).size).toBe(2);
  expect(inventorySlotReadout(slots,'paper').occupied[0].variant).toBe(pending.reading.changes.find(r=>r.after===10)?.variant);
  expect(read('D',true)).toMatchObject({changed:true,reading:{previousAt:'A',observedAt:'C'}});
  expect(read('E',true)).toMatchObject({changed:false,reading:{observedAt:'C'}});
  for (let i=10;i<30;i++) slots[i]={name:'material_'+i,count:2};
  const many=read('F',true).reading;
  expect(many.changes).toHaveLength(8); expect(many.omittedChanges).toBeGreaterThan(0);
  expect(many.next_safe_read.arguments).toEqual({detail:'changes',offset:8,revision:many.revision});
  const next=state.page(many,many.revision,8)!;
  expect(next.changes.length).toBe(8); expect(next.totalChanges).toBe(many.totalChanges);
  expect(next.changes.some(row=>many.changes.some(prior=>prior.name===row.name&&prior.variant===row.variant))).toBe(false);
  expect(state.page(many,'old',8)).toBeNull();
});

it('publishes net changes while current facts omit the full bag; item reads use self slots and unknown stays null', async () => {
  const r=methodHarness('1.21.1');
  try {
    const slots=r.bot.inventory.slots as any[];
    r.bot.inventory.items=()=>slots.slice(9,45).filter(Boolean) as never;
    slots[9]={name:'netherrack',count:64}; slots[38]={name:'netherrack',count:51};
    const world=r.world as any;
    const tool=r.world.tools().find(t=>t.name==='mc_bag')!;
    const read=async (args:Record<string,unknown>)=>await tool.handler(args,{role:'test',log:r.host.log}) as any;
    // The first two server observations must work even if no personality/request has read the bag.
    world.reportWorldDelta();
    const first=await read({detail:'changes'});
    expect(first.data).toMatchObject({kind:'baseline',usedSlots:2,freeSlots:34,changes:[]});
    const named=await read({item:'netherrack'});
    expect(named.data).toMatchObject({scope:'self',synced:true,count:115,stacks:2,freeSlots:34});
    expect(named.text).not.toMatch(/容器|箱/);
    world.reportWorldDelta(); world.reportWorldDelta();
    const baseline=first.data;
    slots[38]=null;
    const peek=await read({detail:'changes'});
    expect(peek.data.changes).toEqual([{name:'netherrack',before:115,after:64}]);
    world.reportWorldDelta();
    const facts=r.world.requestFacts()!;
    expect(facts.parts!.find(p=>p.key==='carriedInventory')?.text).toContain('115→64');
    expect(facts.parts!.find(p=>p.key==='gear')?.text).not.toContain('包里有');
    expect(facts.parts!.find(p=>p.key==='inventoryIds')?.text).not.toContain('netherrack');
    expect(facts.text).not.toContain('包里有：');
    const passiveEvent=world.renderSnapshotEvent();
    expect(passiveEvent).toContain('115→64');
    expect(passiveEvent).not.toMatch(/包里有：|当前随身物品 ID：|mc_bag/);
    expect(facts.parts!.find(p=>p.key==='inventoryIds')?.text).not.toContain('mc_bag');
    expect(facts.parts!.find(p=>p.key==='carriedInventory')?.text).not.toContain('明细 mc_bag');
    expect(r.host.events.find(e=>e.meta?.carriedInventory)?.text).not.toContain('明细 mc_bag');
    expect(peek.data.next_safe_read).toEqual({tool:'mc_bag',arguments:{detail:'slots'}});
    expect(peek.text).toContain('mc_bag');
    expect(world.requestFactsCache.text).not.toContain('包里有：');
    expect(world.requestFactsCache.parts.find((part:any)=>part.key==='carriedInventory').text).toContain('115→64');
    const events=r.host.events.map(e=>e.meta?.carriedInventory as any).filter(Boolean);
    expect(events.map(f=>f.kind)).toEqual(['delta']);
    expect(events[0].previousAt).toBe(baseline.observedAt);
    world.bridge.invSynced=false;
    expect((await read({item:'netherrack'})).data).toMatchObject({count:null,freeSlots:null,synced:false});
    expect((await read({detail:'changes'})).data.kind).toBe('unknown');
    expect((await read({item:'minecraft:'})).failed).toBe(true);
    expect(r.said).toEqual([]);
  } finally { r.close(); }
});

it('preserves the first confirmed sample before the first bag query or personality read', async () => {
  const r=methodHarness('1.21.1');
  try {
    const slots=r.bot.inventory.slots as any[];
    slots[9]={name:'netherrack',count:64};
    r.bot.inventory.items=()=>slots.slice(9,45).filter(Boolean) as never;
    const world=r.world as any;
    world.reportWorldDelta(); slots[9]=null; world.reportWorldDelta();
    const result=await r.world.tools().find(t=>t.name==='mc_bag')!.handler({detail:'changes'},{role:'test',log:r.host.log}) as any;
    expect(result.data).toMatchObject({kind:'delta',freeSlots:36,changes:[{name:'netherrack',before:64,after:0}]});
  } finally {r.close();}
});
