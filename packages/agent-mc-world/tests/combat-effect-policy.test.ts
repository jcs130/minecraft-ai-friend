import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCombatEffectPolicy, type CombatEffectFrame } from '../src/decisions/combat-effect-policy.ts';
import { OperationExperienceBook } from '../core/operation-experience.ts';
import type { DecisionRequest } from '../src/contracts/decision.ts';

const files:string[] = [];
afterEach(() => files.splice(0).forEach(path => rmSync(path,{recursive:true,force:true})));
const scope = {realm:'qq-realm',account:'owner',agent:'adventurer'};
const sample = (age = 0) => ({at:new Date(Date.now()-age).toISOString(),position:{x:1,y:2,z:3},health:20});
const frame = (patch:Partial<CombatEffectFrame> = {}):CombatEffectFrame => ({
  scope, run:'fixture', sceneId:'1'.repeat(64), dimension:'minecraft:overworld',
  goal:'guard', rangeBand:1, threatType:'minecraft:zombie', threatCount:1, injuredAllies:0, durable:true, before:sample(),
  resource:20, baseline:'lance', candidates:[
    {id:'lance',revision:'2'.repeat(64),expectedTargets:1,expectedAllies:0,cost:6,priority:2,effect:'single_target_with_bleed'},
    {id:'bolt',revision:'3'.repeat(64),expectedTargets:1,expectedAllies:0,cost:6,priority:1,effect:'single_target'},
  ], ...patch,
});
const port = () => ({request:vi.fn(async (_input:DecisionRequest) => ({model:'fixture-fast-model',answers:{effect:{type:'choice',choice:'lance',
  confidence:0.57, probabilities:{lance:0.57,bolt:0.43}}}}))});
function setup() {
  const directory = mkdtempSync(join(tmpdir(),'mc-effect-policy-'));
  files.push(directory);
  const system = port();
  return {directory,system,core:createCombatEffectPolicy({directory,port:system}),book:new OperationExperienceBook(join(directory,'minecraft-memory'))};
}
const feedback = (input:CombatEffectFrame, decisionId?:string) => ({frame:input,decisionId,operationId:randomUUID(),candidateId:'lance',
  after:sample(),status:'blocked',damage:0,healing:0,resourceSpent:0});

describe('MC core combat-effect choices and the original physical record',() => {
  it('uses only current eligible IDs and rejects late and ambiguous suggestions', async () => {
    const {core,system} = setup();
    const input = frame();
    await expect(core.choose(input,'d1')).resolves.toMatchObject({choice:'lance',source:'system1'});
    expect(Object.keys(system.request.mock.calls[0]![0].questions.effect.criteria)).toEqual(['lance','bolt']);
    await expect(core.choose(frame({before:sample(1600)}),'late')).rejects.toThrow('expired');
    system.request.mockResolvedValue({model:'fixture-fast-model',answers:{effect:{type:'choice',choice:'lance',
      confidence:0.51, probabilities:{lance:0.51,bolt:0.49}}}});
    await expect(core.choose(frame(),'d2')).resolves.toMatchObject({choice:'lance',source:'rule'});
  });

  it('reuses repeated blocked evidence after restart and does not transfer it to another scene, identity or revision',async () => {
    const {directory,core,system,book} = setup();
    const ids = [];
    for (const round of [1,2]) {
      const input = frame(), id = 'd-' + round;
      const choice = await core.choose(input,id);
      expect(choice.source).toBe('system1');
      const receipt = feedback(input,id);
      const original = core.observe(receipt);
      ids.push(original.experienceId);
      expect(core.observe(receipt)).toMatchObject({experienceId:original.experienceId,deduplicated:true});
      expect(book.get(scope,original.experienceId)).toMatchObject({execution:{phase:'blocked',terminal:true}, attribution:{decisionId:id},
        combatEffect:{damage:0,resourceSpent:0},goalVerified:false});
    }
    const reopened = createCombatEffectPolicy({directory,port:system});
    const adopted = await reopened.choose(frame(),'after-restart');
    expect(adopted).toMatchObject({choice:'bolt',source:'history'});
    expect(adopted.evidenceIds.sort()).toEqual(ids.sort());
    await expect(reopened.choose(frame({dimension:'minecraft:the_nether'}),'other-dimension')).resolves.toMatchObject({source:'system1'});
    await expect(reopened.choose(frame({scope:{...scope,agent:'another-body'}}),'other-agent')).resolves.toMatchObject({source:'system1'});
    const current = frame();
    current.candidates[0]!.revision = '4'.repeat(64);
    await expect(reopened.choose(current,'new-spell-rules')).resolves.toMatchObject({source:'system1'});
  });

  it('requires the original matching scope, scene and selected operation for feedback',async () => {
    const {core,book} = setup();
    const input = frame();
    await core.choose(input,'d1');
    const seen = feedback(input,'d1');
    expect(() => core.observe({...seen,frame:{...input,sceneId:'5'.repeat(64)}})).toThrow('adopted choice');
    expect(() => core.observe({...seen,candidateId:'bolt'})).toThrow('adopted choice');
    expect(() => core.observe({...seen,status:'applied'})).toThrow('Unverified');
    expect(book.list(scope).entries).toHaveLength(0);
    const applied = {...seen,status:'applied',damage:14,resourceSpent:6};
    const saved = core.observe(applied);
    expect(book.get(scope,saved.experienceId)).toMatchObject({combatEffect:{damage:14,healing:0,resourceSpent:6},
      execution:{id:applied.operationId,phase:'completed'},goalVerified:false});
    expect(() => core.observe({...applied,operationId:randomUUID()})).toThrow('adopted choice');
    expect(() => core.observe({...applied,damage:13})).toThrow('Physical receipt conflict');
  });

  it('times out a provider that never answers and keeps a ready rule choice',async () => {
    const {directory} = setup();
    const core = createCombatEffectPolicy({directory,timeoutMs:30,port:{request:() => new Promise(() => {})}});
    await expect(core.choose(frame(),'timeout')).resolves.toMatchObject({choice:'lance',source:'rule',evidenceIds:[]});
  });

  it('accepts measured healing without mislabeling a placed field as a result', async () => {
    const {core,system,book} = setup();
    const input = frame({goal:'heal', injuredAllies:2, baseline:'healing_circle'});
    input.candidates.push({id:'healing_circle',revision:'6'.repeat(64),expectedTargets:0,expectedAllies:2,
      cost:10,priority:3,effect:'group_heal'});
    system.request.mockResolvedValue({model:'fixture-fast-model',answers:{effect:{type:'choice',choice:'healing_circle',
      confidence:.7,probabilities:{healing_circle:.7,lance:.2,bolt:.1}}}});
    await expect(core.choose(input,'circle')).resolves.toMatchObject({choice:'healing_circle',source:'system1'});
    const placed = {...feedback(input,'circle'),candidateId:'healing_circle',status:'applied',resourceSpent:10};
    expect(() => core.observe(placed)).toThrow('Unverified combat effect');
    const saved = core.observe({...placed,healing:6});
    expect(book.get(scope,saved.experienceId)).toMatchObject({combatEffect:{damage:0,healing:6,resourceSpent:10}});
  });
});
