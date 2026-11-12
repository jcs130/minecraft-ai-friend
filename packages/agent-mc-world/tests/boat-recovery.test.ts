import { it, expect, vi, afterEach } from 'vitest';
import { Vec3 } from 'vec3';
import { recoverBoat } from '../core/boat-recovery.ts';
import { methodHarness } from './method-harness.ts';
afterEach(()=>vi.useRealTimers());
it.each(['occupied','unknown','far','chest','mounted','airborne'])('does not strike an unsafe recovery target: %s',async mode=>{
 const h=methodHarness('1.21.1');h.close();
 const boat={id:9,name:mode==='chest'?'chest_boat':'boat',position:new Vec3(mode==='far'?9:1.5,64,.5),isValid:true,height:.6,width:1.4,
   passengers:mode==='unknown'?undefined:mode==='occupied'?[h.bot.entity]:[]};
 const attack=vi.fn();Object.assign(h.bot,{entities:{9:boat},attack,lookAt:vi.fn(async()=>{})});
 if(mode==='mounted')Object.assign(h.bot,{vehicle:boat});if(mode==='airborne')h.bot.entity.onGround=false;
 await expect(recoverBoat(h.bot as never,9,{aborted:()=>false} as never)).rejects.toThrow();expect(attack).not.toHaveBeenCalled();
});
it('does not confuse a disappeared boat with an inventory pickup, or repeat after disappearance',async()=>{
 vi.useFakeTimers();const h=methodHarness('1.21.1');h.close();Object.assign(h.bot.world,{raycast:()=>null});
 const boat={id:9,name:'boat',position:new Vec3(1.5,64,.5),isValid:true,height:.6,width:1.4,passengers:[]};
 const attack=vi.fn(()=>{boat.isValid=false;});Object.assign(h.bot,{entities:{9:boat},attack,lookAt:vi.fn(async()=>{})});
 const result=recoverBoat(h.bot as never,9,{aborted:()=>false} as never);await vi.advanceTimersByTimeAsync(1000);
 expect(await result).toContain('尚未确认收进背包');expect(attack).toHaveBeenCalledTimes(1);
});
it('rechecks passengers after turning toward the boat',async()=>{
 const h=methodHarness('1.21.1');h.close();Object.assign(h.bot.world,{raycast:()=>null});const passengers:any[]=[];
 const boat={id:9,name:'boat',position:new Vec3(1.5,64,.5),isValid:true,height:.6,width:1.4,passengers};
 const attack=vi.fn();Object.assign(h.bot,{entities:{9:boat},attack,lookAt:async()=>{passengers.push(h.bot.entity);}});
 await expect(recoverBoat(h.bot as never,9,{aborted:()=>false} as never)).rejects.toThrow('已有乘客');expect(attack).not.toHaveBeenCalled();
});
