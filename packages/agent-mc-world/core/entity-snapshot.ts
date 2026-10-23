/** Detached client observations. Online membership never establishes proximity or visibility. */
import { itemCustomName } from './item-display.ts';
type Point={x:number;y:number;z:number};
type EquipmentItem=Parameters<typeof itemCustomName>[0]&{count?:number};
export interface EntitySnapshotSource {
 entity?:{id:number;uuid?:string;name?:string;username?:string;type?:string;position?:Point;velocity?:Point;
  yaw?:number;pitch?:number;onGround?:boolean;isValid?:boolean;width?:number;height?:number;equipment?:Array<EquipmentItem|null>};
 entities?:Record<string,EntitySnapshotSource['entity']>;
 players?:Record<string,{username?:string;uuid?:string;entity?:{id?:number}|null;ping?:number;gamemode?:number}>;
 game?:{dimension?:string};
}
export function entitySnapshot(bot: EntitySnapshotSource) {
  const point = (p: {x:number;y:number;z:number} | undefined) => p ? {x:p.x,y:p.y,z:p.z} : null;
  const pack = (e: EntitySnapshotSource['entity']) => e ? {id:e.id,uuid:e.uuid ?? null,name:e.name ?? null,
    username:e.username ?? null,type:e.type ?? null,position:point(e.position),velocity:point(e.velocity),
    yaw:e.yaw ?? null,pitch:e.pitch ?? null,onGround:e.onGround ?? null,isValid:e.isValid ?? null,
    width:e.width ?? null,height:e.height ?? null,
    // Preserve protocol equipment indices. Unknown equipment is not an empty hand.
    equipment:Array.isArray(e.equipment)?e.equipment.map((item,index)=>item?{slot:index,name:item.name??null,
      customName:itemCustomName(item),count:Number.isInteger(item.count)?item.count:null}:null):null} : null;
  return {sampledAt:new Date().toISOString(),source:'mineflayer-client-observation',dimension:String(bot.game?.dimension ?? 'unknown'),
    coverage:'client-tracked; online is not nearby, tracked is not necessarily visible',
    availability:{self:!!bot.entity,entities:bot.entities!=null,players:bot.players!=null},self:pack(bot.entity),
    entities:Object.fromEntries(Object.entries(bot.entities ?? {}).map(([id,e])=>[id,pack(e)])),
    players:Object.fromEntries(Object.entries(bot.players ?? {}).map(([name,p])=>[name,{username:p.username ?? name,uuid:p.uuid ?? null,
      entityId:p.entity?.id ?? null,ping:p.ping ?? null,gamemode:p.gamemode ?? null}]))};
}
