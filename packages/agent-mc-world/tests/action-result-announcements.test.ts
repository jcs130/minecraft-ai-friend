import { expect, it, vi } from 'vitest';
import { Vec3 } from 'vec3';
import { methodEnded, methodHarness } from './method-harness.ts';
import { Ajv } from 'ajv';
import { SKILL_STEP_SCHEMA } from '../core/skills.ts';

it('the advertised dependency schema uses the same positive one-based step identities as execution', () => {
  const validate = new Ajv({strict:false}).compile(SKILL_STEP_SCHEMA);
  expect(validate({skill:'chat',text:'help',needs:[]})).toBe(true);
  expect(validate({skill:'chat',text:'report',needs:[1]})).toBe(true);
  for (const needs of [[0],[-1],['1'],[1.5]]) expect(validate({skill:'chat',text:'report',needs})).toBe(false);
});

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

it('a pickup noop cannot release a dependent material claim; independent help remains available', async () => {
  const r = methodHarness('1.21.1');
  try {
    const run = r.runner.start({ name:'pickup-report-dependency', code:`return await mc.do([
      {skill:'pickup',item:'bread'},
      {skill:'chat',text:'The bread was collected.',needs:[1]},
      {skill:'chat',text:'Please help me find the drop.',needs:[]}
    ]);` });
    const result = await methodEnded(r, run.id);
    expect(result).toMatchObject({status:'completed',result:{done:false,steps:[
      {outcome:'noop'},{outcome:'skip'},{outcome:'ok'}
    ]}});
    expect(r.said).toEqual(['Please help me find the drop.']);
    expect(r.bot.inventory.items()).toEqual([]);
  } finally { r.close(); }
});

it('a definitely invalid take cannot dispatch a dependent handoff claim; help can be sent separately', async () => {
  const r = methodHarness('1.21.1'), toss = vi.fn();
  Object.assign(r.bot,{toss});
  try {
    const run = r.runner.start({name:'failed-take-report-dependency',code:`return await mc.do([
      {skill:'take',at:[0,64,0],item:'bread',count:4},
      {skill:'toss',item:'bread',count:2,needs:[1]},
      {skill:'chat',text:'The bread was thrown.',needs:[2]},
      {skill:'chat',text:'The source needs checking.',needs:[]}
    ]);`});
    expect(await methodEnded(r,run.id)).toMatchObject({status:'completed',result:{done:false,kind:'rejected'}});
    expect(r.said).toEqual([]); expect(toss).not.toHaveBeenCalled();
    const help = r.runner.start({name:'independent-source-help',code:`return await mc.do([
      {skill:'chat',text:'The source needs checking.',needs:[]}
    ]);`});
    expect(await methodEnded(r,help.id)).toMatchObject({status:'completed'});
    expect(r.said).toEqual(['The source needs checking.']);
    expect(r.bot.inventory.items()).toEqual([]);
  } finally { r.close(); }
});
