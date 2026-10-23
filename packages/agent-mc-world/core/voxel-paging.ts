/** Stateless, connection-bound cursors. They retain coordinates, never world samples. */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Bot } from 'mineflayer';
import { onConnectionEnd } from './connection-end.ts';
import { SkillBlocked } from './skill-context.ts';

export type VoxelPoint = [number, number, number];
export type VoxelBox = [number, number, number, number, number, number];
export type VoxelInput = { mode: 'voxels'; format?: 'visible' | 'dense' } & ({ bounds: VoxelBox; cursor?: never } | { cursor: string; bounds?: never });
const secret = randomBytes(32), scopes = new WeakMap<Bot, { id: string }>();
const volume = (b: VoxelBox): number => (b[3]-b[0]+1)*(b[4]-b[1]+1)*(b[5]-b[2]+1);
export interface VoxelQuery { v: 1; scope: string; dimension: string | null; origin: VoxelPoint; bounds: VoxelBox; offset: number; format: 'visible' | 'dense' }
function scope(bot: Bot): string {
  let state = scopes.get(bot);
  if (!state) {
    state = { id: randomUUID() }; scopes.set(bot, state);
    // Plain read-only Bot fixtures need no lifecycle subscription.
    if (typeof bot.on === 'function') {
      const reset = () => { state!.id = randomUUID(); };
      bot.on('respawn', reset);
      onConnectionEnd(bot, () => { reset(); bot.off('respawn', reset); });
    }
  }
  return state.id;
}
const signature = (body: string) => createHmac('sha256', secret).update(body).digest();
function encode(q: VoxelQuery): string {
  const body = Buffer.from(JSON.stringify(q)).toString('base64url');
  return `${body}.${signature(body).toString('base64url')}`;
}
export function openVoxelQuery(bot: Bot, input: VoxelInput): VoxelQuery {
  const dimension = bot.game?.dimension ?? null, id = scope(bot);
  if (input.cursor === undefined) return { v: 1, scope: id, dimension, format: input.format ?? 'visible',
    origin: [Math.floor(bot.entity.position.x),Math.floor(bot.entity.position.y),Math.floor(bot.entity.position.z)], bounds: [...input.bounds], offset: 0 };
  try {
    const [body, mac, extra] = input.cursor.split('.'), received = Buffer.from(mac ?? '', 'base64url'), expected = signature(body);
    if (extra !== undefined || received.length !== expected.length || !timingSafeEqual(received, expected)) throw Error('signature');
    const q = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as VoxelQuery;
    if (q.v !== 1 || q.scope !== id || q.dimension !== dimension || input.format !== undefined && q.format !== input.format) throw Error('scope');
    return q; // Only this module can issue a signed, bounded Query.
  } catch {
    throw new SkillBlocked('observe.cursor 无效或连接/维度/重生作用域已变化；未读取、未改用当前位置。需要当前现场时，以 bounds 发起新查询。');
  }
}

/** A rectangular prefix of the remaining y/z/x scan, x fastest. */
export function voxelContinuation(q: VoxelQuery, offset: number) {
  return offset < volume(q.bounds) ? { tool: 'mc_scout' as const, arguments: { steps: [{ skill: 'observe' as const,
    mode: 'voxels' as const, format: q.format, cursor: encode({...q,offset}) }] } } : null;
}

/** Nearby original-foot cells first; stable across movement and fresh-page reads. */
export function visibleVoxelCells(q: VoxelQuery): VoxelPoint[] {
  const b=q.bounds, cells: VoxelPoint[]=[];
  for(let y=b[1];y<=b[4];y++)for(let z=b[2];z<=b[5];z++)for(let x=b[0];x<=b[3];x++)cells.push([x,y,z]);
  cells.sort((a,b)=>a.reduce((n,v)=>n+v*v,0)-b.reduce((n,v)=>n+v*v,0)||a[1]-b[1]||a[2]-b[2]||a[0]-b[0]);
  return cells.map(p=>p.map((n,i)=>n+q.origin[i]) as VoxelPoint);
}

export function voxelPage(q: VoxelQuery, cap: number) {
  const b=q.bounds, width=b[3]-b[0]+1, depth=b[5]-b[2]+1;
  const x=b[0]+q.offset%width, z=b[2]+Math.floor(q.offset/width)%depth, y=b[1]+Math.floor(q.offset/(width*depth));
  let w=Math.min(b[3]-x+1,cap), d=1, h=1;
  if(x===b[0] && w===width) {
    d=Math.min(b[5]-z+1,Math.floor(cap/w));
    if(z===b[2] && d===depth) h=Math.min(b[4]-y+1,Math.floor(cap/(w*d)));
  }
  const relative: VoxelBox=[x,y,z,x+w-1,y+h-1,z+d-1];
  const bounds=relative.map((n,i)=>n+q.origin[i%3]) as VoxelBox;
  const count=w*d*h, remaining=volume(b)-q.offset-count;
  const remainingRegions: VoxelBox[]=[];
  if(remaining) {
    const next=q.offset+count;
    const nx=b[0]+next%width;
    let nz=b[2]+Math.floor(next/width)%depth, ny=b[1]+Math.floor(next/(width*depth));
    if(nx!==b[0]) { remainingRegions.push([nx,ny,nz,b[3],ny,nz]);if(++nz>b[5]){nz=b[2];ny++;} }
    if(nz!==b[2]) { remainingRegions.push([b[0],ny,nz,b[3],ny,b[5]]);ny++; }
    if(ny<=b[4]) remainingRegions.push([b[0],ny,b[2],b[3],b[4],b[5]]);
  }
  return { bounds, count, coverage: {
    coordinateFrame: 'absolute block coordinates; inclusive bounds' as const, origin: q.origin,
    requestedBounds: b.map((n,i)=>n+q.origin[i%3]) as VoxelBox,
    requestedCount: volume(b), previouslyReturnedCount: q.offset, returnedBounds: bounds,
    returnedCount: count, remainingCount: remaining, coverageComplete: remaining===0,
    remainingRegions: remainingRegions.map(region=>region.map((n,i)=>n+q.origin[i%3]) as VoxelBox),
    selection: 'contiguous rectangular prefix in y,z,x order; x fastest' as const,
    pageTime: 'observedAt applies only to this page; continuation reads fresh visible data, not a retained snapshot' as const,
  }, next: voxelContinuation(q,q.offset+count) };
}
