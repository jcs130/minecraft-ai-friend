import { afterEach, expect, it } from 'vitest';
import { methodHarness, methodEnded } from './method-harness.ts';
import { methodCapabilities } from '../core/method-capabilities.ts';
import { MINECRAFT_TOOL_DECLS } from '../core/world.ts';
import { NATIVE_API } from '../core/method-mineflayer.ts';

const fixtures: ReturnType<typeof methodHarness>[] = [];
afterEach(() => fixtures.splice(0).forEach(h => h.close()));
it('discovers shared movement through the worker capability query before claiming the body', async () => {
  const h = methodHarness(); fixtures.push(h);
  const id = h.runner.start({ code: `const caps=await mc.capabilities();
    const canSwim=caps.mcMethods.includes('swimPlan');
    const flying=await bot.read('entity.elytraFlying');return {caps,canSwim,flying};` }).id;
  const run = await methodEnded(h,id);
  expect(run).toMatchObject({ status:'completed', result:{canSwim:true,flying:null} });
  const caps = (run.result as any).caps;
  expect(caps.botMethods).toEqual(expect.arrayContaining(['pathfinder.goto','elytraFly','mount','dismount','moveVehicle']));
  expect(h.exec.currentTask).toBeNull();
});
it('keeps backend support explicit instead of advertising unsupported Java-client movement', () => {
  const java = methodCapabilities('java-client',['read','look','setControlState']);
  expect(java.botMethods).toEqual(['read','look','setControlState']);
  expect(java.mcMethods).not.toContain('swimPlan');
  expect(methodCapabilities('mineflayer',Object.keys(NATIVE_API)).mcMethods).toContain('swimPlan');
  expect(MINECRAFT_TOOL_DECLS.find(t=>t.name==='mc_script')?.parameters.properties).toHaveProperty('routine');
});
