import {it,expect} from 'vitest';
import {methodHarness} from './method-harness.ts';
import {installNativeBodyReadiness} from '../core/body-readiness.ts';

it('explicit observation cannot return a pre-respawn spatial frame while the snapshot is unavailable',async()=>{
 const r=methodHarness('1.21.1'),watch=installNativeBodyReadiness(r.bot as never);
 try{
  const tool=r.world.tools().find(t=>t.name==='mc_observe')!,ctx={role:'fixture',log:r.host.log},args={mode:'sites',sites:[[0,64,0]]};
  r.bot.emit('respawn');r.bot.health=20;
  const blocked=await tool.handler(args,ctx) as any;
  expect(blocked.data.status).toBe('blocked');expect(blocked.data.frame).toBeUndefined();
  expect(blocked.text).toContain('旧位置和旧方块');
  r.bot._client.emit('position',{x:.5,y:64,z:.5});r.bot.emit('physicsTick');
  const fresh=await tool.handler(args,ctx) as any;
  expect(fresh.data.status).not.toBe('blocked');expect(fresh.data.frame).toBeDefined();
 }finally{watch.dispose();r.close();}
});
