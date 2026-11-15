import { describe, expect, it } from 'vitest';
import { Vec3 } from 'vec3';
import { footingFromBot } from '../core/footing.ts';

const full = [[0, 0, 0, 1, 1, 1]];
function bot(onGround: boolean, vy: number, y = 69) {
  return {
    entity: { position: new Vec3(-1075.5, y, -574.5), onGround, width: 0.6, velocity: new Vec3(0, vy, 0) },
    blockAt: (p: Vec3) => p.y < 69
      ? { name: 'light_blue_stained_glass', shapes: full }
      : { name: 'air', shapes: [] },
  };
}

describe('footing after a server position correction', () => {
  it('keeps support when feet sit on a top face with one gravity tick of velocity', () => {
    const r = footingFromBot(bot(false, -0.0784));
    expect(r.kind).toBe('support');
    expect(r.block).toBe('light_blue_stained_glass');
  });
  it('still reports air while really falling past a block top', () => {
    expect(footingFromBot(bot(false, -0.6)).kind).toBe('air');
  });
  it('reports air above the surface regardless of velocity', () => {
    expect(footingFromBot(bot(false, 0, 70.4)).kind).toBe('air');
  });
});
