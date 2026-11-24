/** Detached client observations. Online membership never establishes proximity or visibility. */
import { itemCustomName } from './item-display.ts';
import { entityCustomName, observedEntityIdentity, observedEntityLabel } from './entity-identity.ts';
type Point={x:number;y:number;z:number};
function poseOf(bot: EntitySnapshotSource, e: NonNullable<EntitySnapshotSource['entity']>) {
  const keys = bot.registry?.entitiesByName?.[e.name ?? '']?.metadataKeys ?? [];
  const index = keys.indexOf('pose');
  if (index < 0) return null;
  const raw = e.metadata?.[index];
  if (raw == null) return null; // default standing may be omitted from the packet
  if (typeof raw === 'number' || typeof raw === 'string') return raw;
  if (typeof raw === 'object' && raw && 'value' in raw) return (raw as {value: unknown}).value ?? null;
  return raw;
}
function effectsOf(bot: EntitySnapshotSource, e: NonNullable<EntitySnapshotSource['entity']>) {
  const raw = e.effects;
  if (raw == null) return null;
  const entries = Array.isArray(raw)
    ? raw.map((effect, index) => ({ id: Number(effect?.id ?? index), effect }))
    : typeof raw === 'object'
      ? Object.entries(raw).map(([id, effect]) => ({ id: Number(id), effect }))
      : null;
  if (!entries) return null;
  return entries.map(({ id, effect }) => ({
    id,
    name: bot.registry?.effects?.[id]?.name ?? null,
    amplifier: Number.isInteger(effect?.amplifier) ? effect!.amplifier! : null,
    duration: Number.isInteger(effect?.duration) ? effect!.duration! : null,
  }));
}
function effectParticlesOf(bot: EntitySnapshotSource, e: NonNullable<EntitySnapshotSource['entity']>) {
  const keys = bot.registry?.entitiesByName?.[e.name ?? '']?.metadataKeys ?? [];
  const index = keys.indexOf('effect_particles');
  if (index < 0) return null;
  const raw = e.metadata?.[index];
  if (raw == null) return null;
  return raw;
}
type EquipmentItem=Parameters<typeof itemCustomName>[0]&{count?:number};
type EffectEntry={id?:number;amplifier?:number;duration?:number};
export interface EntitySnapshotSource {
 entity?:{id:number;uuid?:string;name?:string;username?:string;type?:string;position?:Point;velocity?:Point;
  yaw?:number;pitch?:number;onGround?:boolean;isValid?:boolean;width?:number;height?:number;metadata?:unknown[];
  equipment?:Array<EquipmentItem|null>;passengers?:Array<{id:number}>;vehicle?:{id:number}|null;
  effects?:Record<string|number,EffectEntry>|EffectEntry[]|null};
 entities?:Record<string,EntitySnapshotSource['entity']>;
 players?:Record<string,{username?:string;uuid?:string;entity?:{id?:number}|null;ping?:number;gamemode?:number}>;
 game?:{dimension?:string};
 registry?:{entitiesByName?:Record<string,{metadataKeys?:string[]}>;effects?:Record<number,{name?:string}>};
}
export function entitySnapshot(bot: EntitySnapshotSource) {
  const point = (p: {x:number;y:number;z:number} | undefined) => p ? {x:p.x,y:p.y,z:p.z} : null;
  const pack = (e: EntitySnapshotSource['entity']) => e ? {id:e.id,uuid:e.uuid ?? null,name:e.name ?? null,
    label:observedEntityLabel(bot,e),customName:entityCustomName(bot,e),
    ...(observedEntityIdentity(bot,e)?{identity:observedEntityIdentity(bot,e)}:{}),
    username:e.username ?? null,type:e.type ?? null,position:point(e.position),velocity:point(e.velocity),
    yaw:e.yaw ?? null,pitch:e.pitch ?? null,onGround:e.onGround ?? null,isValid:e.isValid ?? null,
    width:e.width ?? null,height:e.height ?? null,
    // Preserve protocol equipment indices. Unknown equipment is not an empty hand.
    equipment:Array.isArray(e.equipment)?e.equipment.map((item,index)=>item?{slot:index,name:item.name??null,
      customName:itemCustomName(item),count:Number.isInteger(item.count)?item.count:null}:null):null,
    passengers:Array.isArray(e.passengers)?e.passengers.map(p=>p.id):null,
    vehicle:e.vehicle?.id??null,
    pose:poseOf(bot,e),
    effects:effectsOf(bot,e),
    effectParticles:effectParticlesOf(bot,e)} : null;
  return {sampledAt:new Date().toISOString(),source:'mineflayer-client-observation',dimension:String(bot.game?.dimension ?? 'unknown'),
    coverage:'client-tracked; online is not nearby, tracked is not necessarily visible',
    availability:{self:!!bot.entity,entities:bot.entities!=null,players:bot.players!=null},self:pack(bot.entity),
    entities:Object.fromEntries(Object.entries(bot.entities ?? {}).map(([id,e])=>[id,pack(e)])),
    players:Object.fromEntries(Object.entries(bot.players ?? {}).map(([name,p])=>[name,{username:p.username ?? name,uuid:p.uuid ?? null,
      entityId:p.entity?.id ?? null,ping:p.ping ?? null,gamemode:p.gamemode ?? null}]))};
}
