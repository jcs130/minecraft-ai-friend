import { onConnectionEnd } from './connection-end.ts';
/** Real sound receipts, deliberately separated from tracked entity knowledge. */
import type { Bot } from 'mineflayer';
import type { EventEmitter } from 'node:events';
import { observeViewerSounds, type ViewerSound } from './viewer-sound-packets.ts';
import { loadViewerSoundRegistry } from './viewer-sound-registry.ts';

export interface HearingHint {
  source: 'sound-packet'; kind: string; direction: string; distance: string; heardAt: number; expiresAt: number;
}
type Point = { x: number; y: number; z: number };
const finite = (p: Point | null | undefined): p is Point => !!p && [p.x,p.y,p.z].every(Number.isFinite);
export function audibleHint(event: ViewerSound, self: { id?: number; position: Point }, now: number): HearingHint | null {
  const p = self.position, s = event.position;
  if (!finite(p) || !finite(s) || (event.entityId !== undefined && event.entityId === self.id) || !(event.volume > 0)) return null;
  const dx=s.x-p.x, dz=s.z-p.z, distance=Math.hypot(dx,s.y-p.y,dz);
  const range=event.fixedRange ?? 16*Math.max(1,event.volume);
  if (!Number.isFinite(range) || distance >= range || distance < 1.5) return null;
  const name=event.name;
  const kind=/step|swim|splash/.test(name)?'脚步或移动声':/creeper.*primed|tnt.*primed/.test(name)?'引信声'
    :/explode/.test(name)?'爆炸声':/hurt|attack|shoot|bow/.test(name)?'战斗声'
    :event.category==='hostile'?'怪物声':event.category==='neutral'?'生物声':null;
  if (!kind) return null;
  const directions=['北','东北','东','东南','南','西南','西','西北'];
  return {source:'sound-packet',kind,direction:directions[(Math.round(Math.atan2(dx,-dz)/(Math.PI/4))+8)%8]!,
    distance:distance<4?'近处（约4格内）':distance<12?'中距离（约4–12格）':'远处（约12格外）',heardAt:now,expiresAt:now+8_000};
}

export class HearingLedger {
  private hints: HearingHint[] = [];
  source: 'loading' | 'exact-assets' | 'minecraft-data' | 'named-only' | 'unavailable' = 'loading';
  clear(): void { this.hints=[]; }
  add(event: ViewerSound, self: {id?:number;position:Point}, now=Date.now()): void {
    const hint=audibleHint(event,self,now); if(!hint)return;
    this.hints=this.hints.filter(h=>h.expiresAt>now && (h.kind!==hint.kind || h.direction!==hint.direction));
    this.hints.push(hint);this.hints=this.hints.slice(-16);
  }
  read(limit=3, now=Date.now()): HearingHint[] {
    this.hints=this.hints.filter(h=>h.expiresAt>now);
    return this.hints.slice(-limit).reverse().map(h=>({...h}));
  }
}
const ledgers=new WeakMap<object,HearingLedger>();
const subscriptions=new WeakMap<object,{assetsDir:string;dispose:()=>void}>();
export function hearingOf(bot: object | null | undefined): HearingLedger | undefined { return bot?ledgers.get(bot):undefined; }

/** Immediately returns a disposer, including while the exact registry is loading.
 * No messages, logs, timers or model calls; consumers explicitly query the ring. */
export function attachHearing(bot: Bot, assetsDir: string): () => void {
  const old=subscriptions.get(bot);if(old?.assetsDir===assetsDir)return old.dispose;old?.dispose();
  const ledger=new HearingLedger();ledgers.set(bot,ledger);
  let stopped=false, detach: (()=>void)|undefined;
  const lifecycle=bot as unknown as EventEmitter;
  const reset=()=>ledger.clear();
  const dispose=()=>{
    if(stopped)return;stopped=true;subscriptions.delete(bot);detach?.();ledger.clear();ledger.source='unavailable';
    for(const event of ['respawn','death'])lifecycle.off(event,reset);
    detachEnd();
  };
  for(const event of ['respawn','death'])lifecycle.on(event,reset);
  const detachEnd=onConnectionEnd(lifecycle,dispose);
  subscriptions.set(bot,{assetsDir,dispose});
  void loadViewerSoundRegistry(assetsDir,bot.version,bot.registry as never).then(result=>{
    if(stopped)return;
    ledger.source=result.source==='unavailable'?'named-only':result.source;
    detach=observeViewerSounds(bot._client,result.registry,id=>bot.entities[id]?.position,event=>{
      if(!stopped && bot.entity?.position)ledger.add(event,bot.entity);
    },()=>ledger.clear());
  }).catch(()=>{if(!stopped)ledger.source='unavailable';});
  return dispose;
}

export function hearingReadout(bot: object | null | undefined, limit=3, now=Date.now()): string {
  const ledger=hearingOf(bot);
  if(!ledger || ledger.source==='loading' || ledger.source==='unavailable')return '听觉未就绪；不能推断周围安静。';
  const hints=ledger.read(limit,now);
  return JSON.stringify({sampledAt:now,source:ledger.source,
    sounds:hints.map(h=>({kind:h.kind,direction:h.direction,distance:h.distance,ageMs:now-h.heardAt})),
    note:'发生时的声源方位及距离档；非实体定位；无记录不等于安全。'});
}
