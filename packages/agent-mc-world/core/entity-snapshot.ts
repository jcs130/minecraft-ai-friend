/** Detached client observations. Online membership never establishes proximity or visibility. */
import type { Bot } from 'mineflayer';
export function entitySnapshot(bot: Bot) {
  const point = (p: {x:number;y:number;z:number} | undefined) => p ? {x:p.x,y:p.y,z:p.z} : null;
  const pack = (e: Bot['entity'] | undefined) => e ? {id:e.id,uuid:e.uuid ?? null,name:e.name ?? null,
    username:e.username ?? null,type:e.type ?? null,position:point(e.position),velocity:point(e.velocity),
    yaw:e.yaw ?? null,pitch:e.pitch ?? null,onGround:e.onGround ?? null,isValid:e.isValid ?? null,
    width:e.width ?? null,height:e.height ?? null} : null;
  return {sampledAt:new Date().toISOString(),source:'mineflayer-client-observation',dimension:String(bot.game?.dimension ?? 'unknown'),
    coverage:'client-tracked; online is not nearby, tracked is not necessarily visible',
    availability:{self:!!bot.entity,entities:bot.entities!=null,players:bot.players!=null},self:pack(bot.entity),
    entities:Object.fromEntries(Object.entries(bot.entities ?? {}).map(([id,e])=>[id,pack(e)])),
    players:Object.fromEntries(Object.entries(bot.players ?? {}).map(([name,p])=>[name,{username:p.username ?? name,uuid:p.uuid ?? null,
      entityId:p.entity?.id ?? null,ping:p.ping ?? null,gamemode:p.gamemode ?? null}]))};
}
