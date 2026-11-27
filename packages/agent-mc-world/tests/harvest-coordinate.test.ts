import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { collectVisible } from '../core/skills-gather.ts';
import { cropAgeAt } from '../core/terrain.ts';

describe('exact crop cells at the Mineflayer boundary', () => {
  it.each([false, true])('accepts plain coordinates and respects a solid obstruction (%s)', blocked => {
    const at = {x:-8,y:64,z:13};
    const wheat = {name:'wheat',boundingBox:'empty',position:new Vec3(at.x,at.y,at.z),getProperties:()=>({age:'7'})};
    const bot = {
      entity:{position:new Vec3(-8,64,10),eyeHeight:1.62},
      blockAt(p: Vec3) { return p.floored().equals(wheat.position) ? wheat : null; },
      canSeeBlock:()=>false,
      world:{raycast:()=>blocked ? {name:'stone',position:new Vec3(-8,65,11)} : null},
    };
    expect(cropAgeAt(bot,at)).toEqual({value:7,max:7});
    expect(collectVisible(bot as never,at)).toBe(!blocked);
  });
});
