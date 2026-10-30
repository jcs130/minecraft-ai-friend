import { expect, it, vi } from 'vitest';
import { Vec3 } from 'vec3';
import { methodEnded, methodHarness } from './method-harness.ts';

function deliveryHarness(nearby: boolean) {
  const r = methodHarness('1.21.1');
  const coal = { name: 'coal', count: 4, slot: 9, metadata: 0,
    type: r.bot.registry.itemsByName.coal.id };
  Object.assign(r.bot.inventory, { items: () => [coal] });
  r.bot.inventory.slots[9] = coal as never;
  const toss = vi.fn();
  Object.assign(r.bot, { toss });
  if (nearby) Object.assign(r.bot.entities, { 2: {
    id: 2, username: 'Friend', height: 1.8, position: new Vec3(1.5, 64, .5),
  } });
  return { ...r, toss };
}

it.each([
  { nearby: false, reason: '看不见玩家' },
  { nearby: true, reason: '不足2格' },
])('skips a dependent delivery claim after $reason while retaining independent speech', async ({ nearby, reason }) => {
  const r = deliveryHarness(nearby);
  try {
    const run = r.runner.start({ name: 'delivery-result-dependency', code: `return await mc.do([
      {skill:'toss',item:'coal',count:4,target:'Friend'},
      {skill:'chat',text:'煤炭已送达。',needs:[1]},
      {skill:'chat',text:'我在核对附近的路线。',needs:[]}
    ]);` });
    const result = await methodEnded(r, run.id);
    expect(result).toMatchObject({ status: 'completed', result: {
      accepted: true, done: false, kind: 'blocked', steps: [
        { step: 1, outcome: 'fail', why: expect.stringContaining(reason) },
        { step: 2, outcome: 'skip' }, { step: 3, outcome: 'ok' },
      ],
    } });
    expect(r.said).toEqual(['我在核对附近的路线。']);
    expect(r.toss).not.toHaveBeenCalled();
    expect(r.bot.inventory.items()[0].count).toBe(4);
  } finally { r.close(); }
});

it('keeps undeclared chat independent rather than inferring dependencies from its words', async () => {
  const r = deliveryHarness(false);
  try {
    const run = r.runner.start({ name: 'undeclared-chat-boundary', code: `return await mc.do([
      {skill:'toss',item:'coal',count:4,target:'Friend'},
      {skill:'chat',text:'煤炭已送达。'}
    ]);` });
    expect(await methodEnded(r, run.id)).toMatchObject({ status: 'completed', result: {
      done: false, steps: [{ outcome: 'fail' }, { outcome: 'ok' }],
    } });
    expect(r.said).toEqual(['煤炭已送达。']);
    expect(r.toss).not.toHaveBeenCalled();
  } finally { r.close(); }
});
