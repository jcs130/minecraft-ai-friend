import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import type { Bot } from 'mineflayer';
import minecraftData from 'minecraft-data';
import { afterEach,expect,it,vi } from 'vitest';
import { healthSources,installHealthSources } from '../core/health-sources.ts';
function rig(){const bot=Object.assign(new EventEmitter(),{_client:new EventEmitter(),username:'self',entity:{id:1},registry:minecraftData('1.21.11')}) as unknown as Bot;
 const dispose=installHealthSources(bot);bot._client.emit('login',{entityId:1});return {bot,dispose,health:(health:number)=>bot._client.emit('update_health',{health,food:20,foodSaturation:5}),max:(value:number)=>bot._client.emit('entity_update_attributes',{entityId:1,properties:[{key:'generic.max_health',value,modifiers:[]}]})};}
afterEach(()=>vi.useRealTimers());
it('replays the actual decoded40→28 startup and28→21→28 while retaining the loss and uncertainty',()=>{
 vi.useFakeTimers();const r=rig();const captured=JSON.parse(readFileSync(new URL('./fixtures/mcmoyu-followup-observations.json',import.meta.url),'utf8'));
 for(const p of captured.healthSequence.slice(0,4)){r.max(p.max);r.health(p.actual);vi.advanceTimersByTime(3);}
 expect(healthSources(r.bot)?.baseline).toBeNull();vi.advanceTimersByTime(300);
 expect(healthSources(r.bot)?.baseline).toMatchObject({current:28,maximum:28});
 r.health(21);expect(healthSources(r.bot)?.lastLoss).toMatchObject({from:28,to:21,baselineEstablished:true,rawDelta:7,attribution:'unattributed',recoveredAt:null});
 vi.advanceTimersByTime(3);r.health(28);const result=healthSources(r.bot)!;
 expect(result.native.current).toBe(28);expect(result.lastLoss?.rawDelta).toBe(7);expect(result.lastLoss?.recoveredAt).not.toBeNull();
 expect(result.lastLoss?.attribution).toBe('unattributed');r.dispose();
});
it.each(['damage_event','entity_status'])('preserves correlated %s even if HP immediately recovers',source=>{
 vi.useFakeTimers();const r=rig();r.max(28);r.health(28);vi.advanceTimersByTime(300);r.health(21);
 r.bot._client.emit(source,{entityId:1,entityStatus:2,sourceTypeId:4,sourceCauseId:8,sourceDirectId:8});r.health(28);
 expect(healthSources(r.bot)?.lastLoss?.attribution).toBe('damage-correlated');r.dispose();
});
it('does not hide uncorrelated starvation/environmental or sustained low health, or infer it from display scores',()=>{
 vi.useFakeTimers();const r=rig();r.max(28);r.health(28);vi.advanceTimersByTime(300);
 r.bot._client.emit('scoreboard_objective',{name:'display-hp',action:0,type:1});
 r.bot._client.emit('scoreboard_score',{itemName:'self',scoreName:'display-hp',value:100});r.health(4);vi.advanceTimersByTime(1000);
 const s=healthSources(r.bot)!;expect(s.native).toMatchObject({current:4,maximum:28});expect(s.displayScores).toEqual({'display-hp':100});
 expect(s.lastLoss).toMatchObject({rawDelta:24,attribution:'unattributed',recoveredAt:null});r.dispose();
});
it('keeps capacity changes and raw deltas separately and resets baseline on respawn',()=>{
 vi.useFakeTimers();const r=rig();r.max(40);r.health(40);vi.advanceTimersByTime(300);healthSources(r.bot);
 r.max(28);r.health(28);expect(healthSources(r.bot)?.lastLoss).toMatchObject({rawDelta:12,capacityChangedNearby:true,attribution:'unattributed'});
 r.bot._client.emit('respawn',{});expect(healthSources(r.bot)?.baseline).toBeNull();expect(healthSources(r.bot)?.native.current).toBeNull();r.dispose();
});
it('establishes a quiet initial baseline without requiring a prior diagnostic read',()=>{
 vi.useFakeTimers();const r=rig();r.max(28);r.health(28);vi.advanceTimersByTime(1000);r.health(21);
 expect(healthSources(r.bot)?.lastLoss?.baselineEstablished).toBe(true);r.dispose();
});

it('retains explicitly disconnected postmortem facts without promoting them to a fresh baseline',()=>{
 const r=rig();r.max(28);r.health(28);r.bot.emit('end');
 expect(healthSources(r.bot)).toMatchObject({disconnected:true,synchronisation:'disconnected',native:{current:28},baseline:null});r.dispose();
});

it('settles a quiet existing life before a later capacity update even without a diagnostic read',()=>{
 vi.useFakeTimers();const r=rig();r.max(40);r.health(40);vi.advanceTimersByTime(1000);r.max(28);r.health(28);
 expect(healthSources(r.bot)?.lastLoss).toMatchObject({baselineEstablished:true,capacityChangedNearby:true,rawDelta:12});r.dispose();
});
