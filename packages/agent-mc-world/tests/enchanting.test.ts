import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { Vec3 } from 'vec3';
import { skillEnchant, awaitOffers } from '../core/skills-container.ts';
import { parseSteps, SKILL_STEP_SCHEMA } from '../core/skills.ts';
import Ajv from 'ajv';

vi.mock('../core/travel.ts', async original => ({...await original<typeof import('../core/travel.ts')>(), reachCell:vi.fn(async()=>{})}));
const require = createRequire(import.meta.url), dependency = createRequire(require.resolve('mineflayer'));
const registry = dependency('prismarine-registry')('1.21.1'), Item = dependency('prismarine-item')(registry);
const enchantPlugin = require('mineflayer/lib/plugins/enchantment_table.js');
afterEach(()=>vi.useRealTimers());
function rig(mode:'complete'|'timeout'|'replace'='complete') {
  vi.useFakeTimers();
  const input = (name:string,label:string) => { const it=new Item(registry.itemsByName[name].id,1);
    it.componentMap.set('custom_name',{type:'custom_name',data:{text:label}});return it; };
  const other=input('iron_sword','收藏剑'), target=input('iron_sword','实用剑');
  const lapis=new Item(registry.itemsByName.lapis_lazuli.id,5);
  const slots=Array(38).fill(null);[other,target,lapis].forEach((it,i)=>{it.slot=i+2;slots[i+2]=it;});
  const win:any=Object.assign(new EventEmitter(),{id:7,type:'minecraft:enchantment',slots,inventoryStart:2,inventoryEnd:38,
    items:()=>slots.slice(2).filter(Boolean),close:vi.fn(()=>{bot.currentWindow=null;win.emit('close');})});
  let aborted=false;
  const bot:any=Object.assign(new EventEmitter(),{registry,version:'1.21.1',experience:{level:30},
    entity:{position:new Vec3(.5,64,.5)},currentWindow:null,
    inventory:{items:()=>win.items()},_client:Object.assign(new EventEmitter(),{state:'play',write:vi.fn((name:string)=>{
      if(name!=='enchant_item')return;
      if(mode==='replace'){bot.currentWindow={id:99};return;}
      if(mode==='complete')setTimeout(()=>{
        const old=slots[0],out=new Item(old.type,1);out.slot=0;out.componentMap=new Map(old.componentMap);
        out.componentMap.set('enchantments',{type:'enchantments',data:{enchantments:[{id:registry.enchantmentsByName.sharpness.id,level:2}]}});
        slots[0]=out;slots[1].count--;bot.experience.level--;win.emit('updateSlot:0',old,out);
      },160);
    })}),
    blockAt:(p:Vec3)=>({name:p.x===0&&p.y===64&&p.z===0?'enchanting_table':'air'}),
    openBlock:vi.fn(async()=>{bot.currentWindow=win;return win;}),
    moveSlotItem:vi.fn(async(from:number,to:number)=>{
      slots[to]=slots[from];slots[to].slot=to;slots[from]=null;
      if(to===0)for(let i=0;i<3;i++)bot._client.emit('craft_progress_bar',{windowId:7,property:i,value:[5,15,30][i]});
    }),
    putAway:vi.fn(async(slot:number)=>{const at=slots.findIndex((v,i)=>i>=2&&!v);slots[at]=slots[slot];slots[at].slot=at;slots[slot]=null;}),
    closeWindow:vi.fn(),
  });
  enchantPlugin(bot);
  return {bot,win,other,target,ctx:{aborted:()=>aborted},abort:()=>{aborted=true;}};
}
const call={skill:'enchant',at:[0,64,0],item:'iron_sword',pick:'实用剑'} as const;

it('uses the 1.21.1 native table plugin to quote without spending or choosing the other sword',async()=>{
  const r=rig();const parsed=parseSteps([call]);expect(parsed).toHaveProperty('steps');
  expect(new Ajv({strict:false}).compile(SKILL_STEP_SCHEMA)(call)).toBe(true);
  const task=skillEnchant(r.bot,call as never,r.ctx as never);await vi.runAllTimersAsync();
  expect(await task).toContain('只看了报价');expect(r.bot._client.write).not.toHaveBeenCalled();
  expect(r.bot.moveSlotItem.mock.calls[0]).toEqual([3,0]);expect(r.win.items()).toContain(r.target);
  expect(r.bot._client.listenerCount('craft_progress_bar')).toBe(0);
});
it('sends one native paid click and reports only an observed component enchantment',async()=>{
  const r=rig();const task=skillEnchant(r.bot,{...call,index:1} as never,r.ctx as never);await vi.runAllTimersAsync();
  const text=await task;expect(text).toContain('锋利II');expect(text).toContain('30 → 29');
  expect(r.bot._client.write.mock.calls).toEqual([['enchant_item',{windowId:7,enchantment:0}]]);
  expect(r.win.items().find((it:any)=>it.componentMap.has('enchantments')).componentMap.get('custom_name').data.text).toBe('实用剑');
  expect(r.win.listenerCount('updateSlot:0')).toBe(0);
});
it('a server that never returns an enchantment releases the task with an unknown result, without repeat clicks or listeners',async()=>{
  const r=rig('timeout');const task=skillEnchant(r.bot,{...call,index:1} as never,r.ctx as never).catch(e=>e);
  await vi.advanceTimersByTimeAsync(7000);expect(String(await task)).toContain('结果未知');
  expect(r.bot._client.write).toHaveBeenCalledTimes(1);expect(r.win.close).toHaveBeenCalledTimes(1);
  expect(r.win.listenerCount('updateSlot:0')).toBe(0);expect(r.win.items()).toContain(r.target);
});
it('does not click without sufficient resources',async()=>{
  const r=rig();r.bot.experience.level=1;const task=skillEnchant(r.bot,{...call,index:3} as never,r.ctx as never).catch(e=>e);
  await vi.runAllTimersAsync();expect(String(await task)).toContain('要 30 级');expect(r.bot._client.write).not.toHaveBeenCalled();
});
it('cancels a pending result and never resumes a paid click later',async()=>{
  const r=rig('timeout');const task=skillEnchant(r.bot,{...call,index:1} as never,r.ctx as never).catch(e=>e);
  await vi.advanceTimersByTimeAsync(100);r.abort();await vi.runAllTimersAsync();
  expect(String(await task)).toContain('aborted');expect(r.bot._client.write).toHaveBeenCalledTimes(1);
  expect(r.win.listenerCount('updateSlot:0')).toBe(0);
});
it('never performs cleanup through a replacement window',async()=>{
  const r=rig('replace');const task=skillEnchant(r.bot,{...call,index:1} as never,r.ctx as never).catch(e=>e);
  await vi.runAllTimersAsync();expect(String(await task)).toContain('结果未知');
  expect(r.bot.putAway).not.toHaveBeenCalled();expect(r.win.close).not.toHaveBeenCalled();
});
it('empty quote arrays are not ready and invalid pick arguments are rejected',async()=>{
  vi.useFakeTimers();const task=awaitOffers({enchantments:[]} as never,{aborted:()=>false} as never);
  await vi.runAllTimersAsync();expect(await task).toBe(false);
  expect(parseSteps([{...call,pick:1}])).toHaveProperty('error');
});
