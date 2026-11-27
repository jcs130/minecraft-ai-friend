import { expect, it, vi } from 'vitest';
import { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';
import { Reflexes } from '../core/executor.ts';
import { eyeObstruction } from '../core/eye-obstruction.ts';
import type { DamageEvidence } from '../core/damage-evidence.ts';
import { methodHarness } from './method-harness.ts';

function camp(version='1.21.1') {
  const h=methodHarness(version);
  h.bot.entity.position = new Vec3(-679.973,63,432.937);
  h.set(-680,64,432,'oak_leaves');
  const dig=vi.fn(async()=>{});
  const bot=Object.assign(h.bot,{dig}) as unknown as Bot;
  const reflex=new Reflexes({getBot:()=>bot,antiLava:()=>false,report:vi.fn(),pauseEnvironment:()=>null} as never);
  const internal=reflex as unknown as {
    onEnvironmentHurt(bot:Bot,now:number,e:DamageEvidence):void;
    antiSuffocate(bot:Bot):Promise<void>;
  };
  const hit=(sourceType:string,origin:'packet'|'event'='packet')=>internal.onEnvironmentHurt(bot,Date.now(),{
    origin,sourceType,sequence:1,causeId:null,directId:null,actor:null,projectile:false,sourcePosition:null,
  });
  return {h,bot,reflex,internal,hit,dig};
}

it.each(['1.21.1','1.21.11'])('reacts to confirmed in_wall in leaves, releases on clearance on %s',async version=>{
  const {h,bot,reflex,internal,hit,dig}=camp(version);
  hit('minecraft:fall'); hit('minecraft:in_wall','event');
  expect(dig).not.toHaveBeenCalled();
  expect(reflex.envActive).toBe(false);
  hit('minecraft:in_wall');await Promise.resolve();
  expect(dig).toHaveBeenCalledTimes(1);
  expect(dig.mock.calls[0]).toMatchObject([{name:'oak_leaves'},true]);
  expect(reflex.environmentOwnerKind).toBe('suffocation');
  h.set(-680,64,432,'air');h.set(-680,64,433,'glass');
  await internal.antiSuffocate(bot);
  expect(dig).toHaveBeenCalledTimes(1);
  expect(reflex.envActive).toBe(false);
});
it('prefers the opaque block actually overlapping the eye box and leaves partial shapes alone',()=>{
  const {h,bot}=camp();
  h.set(-680,64,433,'oak_log');
  expect(eyeObstruction(bot)?.name).toBe('oak_log');
  h.set(-680,64,433,'air');h.set(-680,64,432,'oak_slab');
  expect(eyeObstruction(bot)).toBeNull();
  h.set(-679,64,432,'oak_log');
  expect(eyeObstruction(bot)).toBeNull();
});
