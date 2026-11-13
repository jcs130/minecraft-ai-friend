import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { movementTouchesHazard } from './hazard-geometry.ts';
import { spatialBody } from './spatial-site.ts';

type Point = { x: number; y: number; z: number };
/** A local, level exit from existing contact. Does not enter new fire/lava,
 * cut through collision shapes, step off support, or assume unloaded air.
 * Clearance from ALL nearby fires is a preference, not a prerequisite for
 * escaping the one touching the body. Used only by the existing body owner. */
export function localHazardExit(bot: Bot, radius = 4): Point | null {
  const from = bot.entity.position;
  if (!bot.entity.onGround) return null;
  type Sample = ReturnType<Parameters<typeof spatialBody>[0]>;
  const cache = new Map<string, Sample>();
  const read = (cell: [number, number, number]): Sample => {
    const key = cell.join(','); if (cache.has(key)) return cache.get(key)!;
    const b = bot.blockAt(new Vec3(...cell), false);
    const sample: Sample = b ? { material: { name: b.name, properties: b.getProperties?.() ?? null,
      collision: b.shapes?.map(s => [...s] as [number, number, number, number, number, number]) ?? null,
      liquid: ['water', 'lava', 'bubble_column'].includes(b.name) } } : { unknown: 'unloaded' };
    cache.set(key, sample); return sample;
  };
  const name = (x: number, y: number, z: number) => { const s = read([x,y,z]); return 'material' in s ? s.material.name : undefined; };
  const options: { cell: Point; distance: number }[] = [];
  for (let dx=-radius; dx<=radius; dx++) for(let dz=-radius; dz<=radius; dz++) {
    const cell={x:Math.floor(from.x)+dx,y:from.y,z:Math.floor(from.z)+dz};
    const to={x:cell.x+.5,y:cell.y,z:cell.z+.5}, distance=Math.hypot(to.x-from.x,to.z-from.z);
    if(distance<.25||distance>radius)continue;
    options.push({cell,distance});
  }
  options.sort((a,b)=>a.distance-b.distance);
  for(const {cell,distance} of options){
    const to={x:cell.x+.5,y:cell.y,z:cell.z+.5};
    // Initial contact may be left through its near side, never crossed through.
    if(movementTouchesHazard(from,to,name)||movementTouchesHazard(to,to,name))continue;
    let valid=true, previous:[number,number,number]=[from.x,from.y,from.z];
    const steps=Math.ceil((distance+.95)/.2);
    for(let i=0;i<=steps;i++){
      const t=i/steps*(1+.95/distance), p:[number,number,number]=[from.x+(to.x-from.x)*t,from.y,from.z+(to.z-from.z)*t];
      const body=spatialBody(read,previous,p);
      let otherHazard=false;
      for(let x=Math.floor(p[0]-.3);x<=Math.floor(p[0]+.3);x++)for(let z=Math.floor(p[2]-.3);z<=Math.floor(p[2]+.3);z++)for(let y=Math.floor(p[1]-.05);y<=Math.floor(p[1]+1.79);y++)
        if(['cactus','sweet_berry_bush','powder_snow','cobweb','campfire','soul_campfire'].includes(name(x,y,z)??''))otherHazard=true;
      if(body.unknown||body.collision||body.water||!body.supported
        ||otherHazard||movementTouchesHazard(from,{x:p[0],y:p[1],z:p[2]},name)&&i===steps){valid=false;break;}
      previous=p;
    }
    if(valid)return cell;
  }
  return null;
}
