import type { Bot } from 'mineflayer';
import { expect, it } from 'vitest';
import { nearCameraWall } from '../core/spatial-observation.ts';
import { methodHarness } from './method-harness.ts';

it('skips a truly close opaque wall and keeps images eligible for openings, glass and signs', () => {
  const h = methodHarness('1.21.11');
  try {
    for(let x=-3;x<=3;x++) for(let y=62;y<=69;y++) h.set(x,y,-1,'stone');
    const bot=h.bot as unknown as Bot;
    expect(nearCameraWall(bot,120)).toMatchObject({
      centralWall:{block:'stone',at:[0,65,-1],distance:.5},opaqueRays:9,
    });
    h.set(0,65,-1,'glass');
    expect(nearCameraWall(bot,120)).toBeNull();
    h.set(0,65,-1,'air');
    expect(nearCameraWall(bot,120)).toBeNull();
    h.set(0,65,-1,'stone');
    h.set(0,65,0,'oak_sign');
    expect(nearCameraWall(bot,120)).toBeNull();
  } finally {h.close();}
});
