import { describe, expect, it } from 'vitest';
import { methodHarness, methodEnded } from './method-harness.ts';
import { methodApiHelp } from '../core/method-api.ts';
import { gameLibrary } from '../core/mindcraft/catalog.mjs';

describe('model-authored Mindcraft programs on the existing Mineflayer body', () => {
  it('reads a current native slot array from an actual program, keeping null, equipment and hotbar indices',async()=>{
    const h=methodHarness('1.21.1');
    try {
      const iron=h.bot.registry.itemsByName.iron_ingot.id;
      h.bot.inventory.slots[5]={name:'iron_helmet',type:h.bot.registry.itemsByName.iron_helmet.id,count:1,slot:5};
      h.bot.inventory.slots[36]={name:'iron_ingot',type:iron,count:16,slot:36};
      const run=h.runner.start({code:`const slots=bot.inventory.slots;
        return {length:slots.length,free:slots.slice(9,45).filter(s=>s===null).length,
          helmet:slots[5].name,iron:slots[36].count,same:(await bot.read("inventory.slots"))[36].instanceHash===slots[36].instanceHash};`});
      const end=await methodEnded(h,run.id);
      expect(end.status,end.error).toBe('completed');
      expect(end.result).toEqual({length:46,free:35,helmet:'iron_helmet',iron:16,same:true});
      expect(h.exec.currentTask).toBeNull();
    } finally {h.close();}
  });

  it('uses the visible block and actual footing for a read-only escape digging program',async()=>{
    const h=methodHarness('1.21.1');
    try {
      const tool={name:'iron_pickaxe',type:h.bot.registry.itemsByName.iron_pickaxe.id,slot:36,enchants:[]};
      Object.assign(h.bot,{physicsEnabled:false,getEquipmentDestSlot:()=>5});
      Object.assign(h.bot.inventory,{items:()=>[tool]});
      h.set(1,64,0,'stone');
      const sample=async()=>{const run=h.runner.start({code:'return world.getEscapeDigPlan(bot,1,64,0);'});
        const end=await methodEnded(h,run.id);expect(end.status,end.error).toBe('completed');
        return end.result as {tool:string;digMs:number;inWater:boolean};};
      const dry=await sample();
      expect(dry).toMatchObject({tool:'iron_pickaxe',slot:36,inWater:false});
      h.set(0,65,0,'water');h.bot.entity.onGround=false;
      const wet=await sample();expect(wet.inWater).toBe(true);expect(wet.digMs).toBeGreaterThan(dry.digMs*10);
      expect(h.exec.currentTask).toBeNull();
    } finally {h.close();}
  });
  it('uses synchronous observations, branches, awaits a native equipment change, and reads its identity back',async()=>{
    const h=methodHarness('1.21.1');
    try {
      const stack={name:'iron_pickaxe',count:1,type:h.bot.registry.itemsByName.iron_pickaxe.id,slot:36,metadata:0};
      Object.assign(h.bot,{inventory:{slots:[stack],items:()=>[stack]},heldItem:null,equip:async()=>{Object.assign(h.bot,{heldItem:stack});}});
      const id=h.runner.start({code:`const counts=world.getInventoryCounts(bot);
        const before=await bot.read("heldItem.name");
        if (counts.iron_pickaxe !== 1) throw Error("wrong observation");
        if (!await skills.equip(bot,"iron_pickaxe")) throw Error("failed equip");
        return {before,after:await bot.read("heldItem.name"),x:world.getPosition(bot).x};`}).id;
      const run=await methodEnded(h,id);
      expect(run.error).toBeUndefined();
      expect(run.result).toMatchObject({before:null,after:'iron_pickaxe',x:expect.any(Number)});
      expect(run.trace.map(t=>t.method)).toEqual(['mindcraft','mineflayer','mindcraft','mineflayer','mindcraft']);
      expect(run.trace[0]?.result).toMatchObject({taskId:null});
      expect(run.trace[2]?.result).toMatchObject({taskId:expect.any(Number)});
    } finally { h.close(); }
  });
  it('keeps invisible blocks unknown and exposes a recoverable missing-recipe result in one program',async()=>{
    const h=methodHarness('1.21.1');
    try {
      const run=await methodEnded(h,h.runner.start({code:`
        const blocked=world.getBlockAtPosition(bot,0,-12,0);
        const crafted=await skills.craftRecipe(bot,"no_such_item");
        return {blocked,crafted,detail:bot.output};`}).id);
      expect(run.error).toBeUndefined();
      expect(run.result).toMatchObject({blocked:null,crafted:false,detail:expect.stringContaining('recipe')});
    } finally { h.close(); }
  });
  it('cancels an awaited skill without replaying its continuation or taking the body for a wait',async()=>{
    const h=methodHarness('1.21.1');
    try {
      const {id}=h.runner.start({code:'await skills.wait(bot,8000); await bot.setControlState("forward",true);'});
      const timeout=Date.now()+4000;
      while (!h.runner.read(id)[0]?.trace.length && Date.now()<timeout) await new Promise(r=>setTimeout(r,10));
      expect(h.runner.read(id)[0]?.trace).toHaveLength(1);
      expect(h.exec.status().running).toBeFalsy();
      h.runner.stop('cancel test');
      expect((await methodEnded(h,id)).status).toBe('cancelled');
      expect(h.keys.forward).toBe(false);
    } finally {h.close();}
  });
  it('explains a declaration-only program with no game calls without executing the function twice',async()=>{
    const h=methodHarness('1.21.1');
    try {
      const run=await methodEnded(h,h.runner.start({code:'async function BODY(){return skills.equip(bot,"stone_axe");}'}).id);
      expect(run.status).toBe('completed');
      expect(run.trace).toEqual([]);
      expect(h.runner.inspect(run.id)).toMatchObject({executionNote:expect.stringContaining('没有调用游戏')});
    } finally {h.close();}
  });
  it.each(['oak','birch'])('plans intermediates from the actual %s logs without using the body',async wood=>{
    const h=methodHarness('1.21.1');
    try {
      const name=wood+'_log',stack={name,count:2,type:h.bot.registry.itemsByName[name].id};
      Object.assign(h.bot.inventory,{items:()=>[stack]});
      const run=await methodEnded(h,h.runner.start({code:'return world.getDetailedCraftingPlan(bot,"wooden_pickaxe",1);'}).id);
      expect(run.error).toBeUndefined();
      const plan=run.result as {limited:boolean;missing:unknown;steps:{item:string;applications:number}[]};
      expect(plan).toMatchObject({ready:true,missing:{}});
      expect(plan.limited).toBe(false);
      expect(plan.steps.at(-1)).toMatchObject({item:'wooden_pickaxe',applications:1});
      expect(plan.steps.filter(s=>s.item===wood+'_planks').reduce((n,s)=>n+s.applications,0)).toBe(2);
      expect(run.trace[0]?.result).toMatchObject({taskId:null});
    } finally {h.close();}
  });
  it('keeps a plan with missing ingredients unready',async()=>{
    const h=methodHarness('1.21.1');
    try {
      const run=await methodEnded(h,h.runner.start({code:'return world.getDetailedCraftingPlan(bot,"wooden_pickaxe",1);'}).id);
      expect(run.result).toMatchObject({ready:false,limited:false});
      expect(Object.keys((run.result as {missing:object}).missing).length).toBeGreaterThan(0);
    } finally {h.close();}
  });
  it('publishes the same helper names that are mounted in the worker',()=>{
    for(const [group,methods] of Object.entries(gameLibrary)) for(const name of Object.keys(methods))
      expect(methodApiHelp(group+'.'+name)).toContain(name+'(');
  });
});
