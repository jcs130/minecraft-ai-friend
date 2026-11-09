import { describe,it,expect } from 'vitest';
import { methodHarness } from './method-harness.ts';

describe('exact inventory slot reads through the public tool',()=>{
  it.each(['1.20.6','1.21.1'])('reads self slots, including stacks and hotbar, without executing or reading a container (%s)',async version=>{
    const r=methodHarness(version);
    try{
      const slots=r.bot.inventory.slots as any[];
      slots[9]={name:'bone',count:64};slots[35]={name:'iron_chestplate',count:1};
      slots[36]={name:'bone',count:25};slots[44]={name:'rotten_flesh',count:2};
      slots[5]={name:'diamond_helmet',count:1};slots[45]={name:'shield',count:1};
      r.bot.inventory.items=()=>slots.slice(9,45).filter(Boolean) as never;
      (r.bot as any).currentWindow={title:'Chest',slots:[{name:'diamond',count:64}],selectedItem:null};
      const tool=r.world.tools().find(t=>t.name==='mc_bag')!,ctx={role:'test',log:r.host.log};
      const before=r.exec.status();
      const summary=await tool.handler({},ctx);
      expect(typeof summary==='string'?summary:summary.text).not.toContain('windowSlot');
      const result=await tool.handler({detail:'slots'},ctx) as any;
      expect(result.data.occupied.map((s:any)=>[s.windowSlot,s.name,s.count])).toEqual([
        [9,'bone',64],[35,'iron_chestplate',1],[36,'bone',25],[44,'rotten_flesh',2]]);
      expect(result.data.emptyWindowSlots).toHaveLength(32);
      expect(result.data.emptyWindowSlots).not.toContain(36);
      expect(result.text).not.toContain('diamond');
      const filtered=await tool.handler({detail:'slots',item:'骨头'},ctx) as any;
      expect(filtered.data.occupied.map((s:any)=>s.windowSlot)).toEqual([9,36]);
      // Same aggregate quantity, different physical slots: do not return the old repeated-read pointer.
      [slots[9],slots[10]]=[slots[10],slots[9]];
      const moved=await tool.handler({detail:'slots',item:'minecraft:bone'},ctx) as any;
      expect(moved.data.occupied.map((s:any)=>s.windowSlot)).toEqual([10,36]);
      expect(moved.text).toContain('windowSlot');
      expect(r.exec.status()).toEqual(before);expect(r.said).toEqual([]);
    }finally{r.close()}
  });
  it('does not label initial unsynchronized inventory as 36 empty slots',async()=>{
    const r=methodHarness('1.21.1');try{
      (r.world as any).bridge.invSynced=false;
      const result=await r.world.tools().find(t=>t.name==='mc_bag')!.handler({detail:'slots'},{role:'test',log:r.host.log});
      expect((result as any).data).toBeUndefined();
      expect(typeof result==='string'?result:result.text).not.toContain('emptyWindowSlots');
    }finally{r.close()}
  });
});
