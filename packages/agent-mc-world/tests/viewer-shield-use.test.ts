import {it,expect} from 'vitest';
import {observeViewerShieldUse} from '../core/viewer-entity-state.ts';
it('mirrors the actually used shield hand and clears on release, slot changes or another item',()=>{
 const packets:unknown[]=[],states:unknown[]=[];
 const protocol={write:(name:string,p?:Record<string,unknown>)=>{packets.push([name,p]);}};
 const original=protocol.write;let main='shield',off='shield';
 const stop=observeViewerShieldUse(protocol,()=>off,(raised,hand)=>states.push([raised,hand]),()=>main);
 protocol.write('use_item',{hand:1});protocol.write('use_item',{hand:0});protocol.write('block_dig',{status:5});
 protocol.write('use_item',{hand:0});protocol.write('held_item_slot',{slotId:3});
 main='bread';protocol.write('use_item',{hand:0});
 off='totem_of_undying';protocol.write('use_item',{hand:1});
 expect(states).toEqual([[true,'offhand'],[true,'mainhand'],[false,'mainhand'],[true,'mainhand'],[false,'mainhand'],[false,'offhand']]);
 expect(packets).toHaveLength(7);stop();expect(protocol.write).toBe(original);
});
