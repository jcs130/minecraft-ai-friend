import {it,expect} from 'vitest';
import {Vec3} from 'vec3';
import {methodHarness} from './method-harness.ts';

it('does not label every native correction as a passive teleport or push',()=>{
  const r=methodHarness('1.21.1'),w=r.world as any;
  try{
    w.hookBotEvents(r.bot);w.lastPosForTeleport={x:.5,y:64,z:.5};
    r.bot.entity.position=new Vec3(20.5,64,.5);r.bot.emit('forcedMove');
    const e=r.host.events.find((e:any)=>e.meta?.positionChange);
    expect(e?.text).toContain('原因与发起者未由此事件确认');
    expect(e?.text).not.toContain('(被传送或强推)');
    expect(e?.meta?.positionChange).toMatchObject({cause:null,initiator:null,before:[.5,64,.5],after:[20.5,64,.5]});
    expect(w.decisionPositionEpoch).toBe(1);
  }finally{r.close();}
});
