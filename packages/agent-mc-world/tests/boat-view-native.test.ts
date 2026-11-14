import {createRequire} from 'node:module';
import type {Bot} from 'mineflayer';
import {Vec3} from 'vec3';
import {afterEach,expect,it,vi} from 'vitest';
import {useOnce} from '../core/skills-interact.ts';
import {methodHarness} from './method-harness.ts';

const mf=createRequire(createRequire(import.meta.url).resolve('mineflayer'));
afterEach(()=>vi.useRealTimers());

it.each(['solid-behind-water','no-solid-hit'])('preserves the selected view through the native 1.21.1 item-use packet: %s',async cursor=>{
  vi.useFakeTimers();const h=methodHarness('1.21.1'),bot=h.bot as unknown as Bot;
  Object.assign(bot,{QUICK_BAR_START:36,supportFeature:bot.registry.supportFeature});
  mf('mineflayer/lib/plugins/inventory.js')(bot,{hideErrors:true});bot.quickBarSlot=0;
  const Item=mf('prismarine-item')(bot.registry);
  bot.inventory.updateSlot(36,new Item(bot.registry.itemsByName.jungle_boat.id,1));
  bot.entity.yaw=.7;bot.entity.pitch=-.2;
  const selected={yaw:bot.entity.yaw,pitch:bot.entity.pitch};
  const lookAt=vi.fn(async(point:Vec3)=>{const d=point.minus(bot.entity.position.offset(0,bot.entity.eyeHeight,0));bot.entity.yaw=Math.atan2(-d.x,-d.z);bot.entity.pitch=Math.atan2(d.y,Math.hypot(d.x,d.z));});
  const blockAtCursor=vi.fn(()=>cursor==='no-solid-hit'?null:bot.blockAt(new Vec3(4,63,1)));
  Object.assign(bot,{lookAt,blockAtCursor,waitForTicks:async()=>{}});
  const packets:Array<{name:string;data:any}>=[];
  bot._client.write=((name:string,data:any)=>{packets.push({name,data});if(name==='use_item'){
    bot.inventory.updateSlot(36,null);
    bot.entities[9]={id:9,name:'boat',isValid:true,position:new Vec3(1,64,1)} as never;
  }}) as never;
  try{
    const p=useOnce(bot,{skill:'use'},{aborted:()=>false} as never).then(text=>({text}),error=>({error}));
    await vi.advanceTimersByTimeAsync(1000);const out=await p;
    expect(out).toHaveProperty('text');expect(lookAt).not.toHaveBeenCalled();expect(blockAtCursor).not.toHaveBeenCalled();
    const use=packets.filter(p=>p.name==='use_item');expect(use).toHaveLength(1);
    const conv=mf('mineflayer/lib/conversions.js');
    expect(use[0].data.rotation).toEqual({x:conv.toNotchianYaw(selected.yaw),y:conv.toNotchianPitch(selected.pitch)});
    expect((out as {text:string}).text).toContain('entityId=9');
  }finally{h.close();}
});
