import { EventEmitter } from 'node:events';
import Ajv from 'ajv';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';
import { observeSpatial, parseSpatialObservation, spatialObservationText } from '../core/spatial-observation.ts';
import { parseScoutSteps, readSkillHelp, SCOUT_STEP_SCHEMA } from '../core/skills.ts';
import { methodHarness } from './method-harness.ts';

// Geometry/visibility itself is covered by perception.test.ts; leave deliberately
// unloaded samples here to distinguish returned unknowns from unread coverage.
vi.mock('../core/perception-sight.ts', async load => ({ ...await load<typeof import('../core/perception-sight.ts')>(), observedBlock: () => true, observedEntity: () => true }));
function scene() {
  const reads: string[] = [];
  const bot = Object.assign(new EventEmitter(), {
    entity: { id: 1, position: new Vec3(-20.5, 64, -10.5), yaw: 0, pitch: 0 },
    entities: {}, game: { dimension: 'overworld' },
    blockAt: (p: Vec3) => { reads.push(p.toString()); return p.x === -26 ? null : {
      name: 'stone', stateId: 1, shapes: [[0,0,0,1,1,1]], getProperties: () => ({}),
    }; },
  }) as unknown as Bot;
  return { bot, reads };
}
function query(bot: Bot, input: Record<string, unknown>) {
  const parsed = parseSpatialObservation({...input,format:"dense"});
  if ('error' in parsed) throw Error(parsed.error);
  const r = JSON.parse(spatialObservationText(bot, parsed));
  expect(r.kind).toBe('voxels');
  return r;
}
function keys(bounds: number[]) {
  const result: string[] = [];
  for (let y=bounds[1];y<=bounds[4];y++) for(let z=bounds[2];z<=bounds[5];z++) for(let x=bounds[0];x<=bounds[3];x++) result.push(`${x},${y},${z}`);
  return result;
}
describe('actual bounded voxel results', () => {
  it('returns real data on the first 1089-cell request and continues without drift, gaps or duplicates', () => {
    const {bot, reads} = scene(), input = { mode: 'voxels', bounds: [-5,-3,-5,5,5,5] }, original = structuredClone(input);
    let r = query(bot,input), previousTime = r.observedAt;
    const requested = r.coverage.requestedBounds, origin = r.coverage.origin, all = new Set<string>();
    expect(r).toMatchObject({status:'partial',complete:false,coverage:{requestedCount:1089,previouslyReturnedCount:0,partialReasons:expect.arrayContaining(['cell_budget'])}});
    expect(r.cells.length).toBeGreaterThan(0); expect(r.cells.length).toBeLessThanOrEqual(512);
    expect(r.cells.some((id:number)=>id>=0)).toBe(true); expect(reads.length).toBeGreaterThan(0);
    expect(input).toEqual(original);
    for (let page=0;page<10;page++) {
      expect(r.coverage.origin).toEqual(origin); expect(r.coverage.requestedBounds).toEqual(requested);
      expect(r.cells).toHaveLength(keys(r.bounds).length);
      expect(r.coverage.returnedCount).toBe(r.cells.length);
      expect(r.coverage.previouslyReturnedCount+r.coverage.returnedCount+r.coverage.remainingCount).toBe(1089);
      expect(r.coverage.observedCount+r.unknownCells).toBe(r.cells.length);
      const remaining=r.coverage.remainingRegions.flatMap(keys);
      expect(remaining).toHaveLength(r.coverage.remainingCount);expect(new Set(remaining).size).toBe(remaining.length);
      for(const key of remaining)expect(all.has(key)).toBe(false);
      for(const key of keys(r.bounds)){expect(all.has(key)).toBe(false);all.add(key);}
      if(!r.next) break;
      expect(r.next.tool).toBe('mc_scout'); expect(parseScoutSteps(r.next.arguments.steps)).not.toHaveProperty('error');
      bot.entity.position = new Vec3(-18.5,65,-9.5);
      vi.useFakeTimers();vi.setSystemTime(new Date(Date.parse(previousTime)+1000));
      try { r=query(bot,r.next.arguments.steps[0]); } finally { vi.useRealTimers(); }
      expect(r.observedAt).not.toBe(previousTime);previousTime=r.observedAt;
    }
    expect(all).toEqual(new Set(keys(requested))); expect(r.next).toBeNull();
    expect(r.coverage.remainingCount).toBe(0);
  });
  it('preserves a <=512-cell dense result, including honest unknowns', () => {
    const {bot}=scene(); const bounds:[number,number,number,number,number,number]=[-5,0,0,-5,0,0];
    const r=observeSpatial(bot,{mode:'voxels',bounds,format:'dense'});
    expect(r).toMatchObject({kind:'voxels',status:'partial',complete:false,cells:[-1],unknownCells:1,
      coverage:{requestedCount:1,returnedCount:1,remainingCount:0,coverageComplete:true,partialReasons:['unknown_cells']},next:null});
    const known=query(bot,{mode:'voxels',bounds:[0,0,0,0,0,0]});
    expect(known).toMatchObject({status:'complete',complete:true,cells:[0],coverage:{partialReasons:[]}});
  });
  it('keeps valid input intact and rejects malformed coordinates or mixed continuation before dispatch',()=>{
    const valid={mode:'voxels',bounds:[-4,-4,-4,3,3,3]};expect(parseSpatialObservation(valid)).toEqual(valid);
    for(const input of [{mode:'voxels',bounds:[0,0,0,-1,1,1]},{mode:'voxels',bounds:[0,0,0,17,0,0]},
      {mode:'voxels',bounds:[0,0,0,1,1,1],cursor:'x'},{mode:'rays',cursor:'x'}, {mode:'sites',sites:[[0,64,0]],cursor:'x'}]) {
      expect(parseSpatialObservation(input)).toHaveProperty('error');
    }
  });
  it.each(['tampered','other-connection','dimension','respawn','end'])('does not silently reanchor a %s continuation',reason=>{
    const {bot,reads}=scene(),r=query(bot,{mode:'voxels',bounds:[-5,-3,-5,5,5,5]});
    const input=structuredClone(r.next.arguments.steps[0]);let target=bot;
    if(reason==='tampered')input.cursor=input.cursor.slice(0,-2)+'aa';
    if(reason==='other-connection')target=scene().bot;
    if(reason==='dimension')bot.game.dimension='the_nether';
    if(reason==='respawn')bot.emit('respawn');
    if(reason==='end')bot.emit('end');
    const before=reads.length;expect(()=>query(target,input)).toThrow(/cursor/);expect(reads.length).toBe(before);
  });
  it('shrinks an over-budget text result rather than losing all observed data',()=>{
    const {bot}=scene(); let id=0;
    bot.blockAt=()=>({name:'stone',stateId:++id,shapes:[[0,0,0,1,1,1]],getProperties:()=>({detail:'x'.repeat(150)})}) as never;
    const r=query(bot,{mode:'voxels',bounds:[-4,-4,-4,3,3,3]});
    expect(r.status).toBe('partial'); expect(r.coverage.partialReasons).toContain('text_budget');
    expect(r.cells.length).toBeGreaterThan(0);expect(r.coverage.observedCount).toBeGreaterThan(0);
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(24000);expect(r.next).not.toBeNull();
    expect(r.coverage.readAttemptedCount).toBe(512);
    expect(r.coverage.unreturnedAttemptedCount).toBe(512-r.cells.length);
  });
  it('keeps a single unrepresentable block unknown and reports detail omission',()=>{
    const {bot}=scene();bot.blockAt=()=>({name:'stone',stateId:1,shapes:Array(4000).fill([0,0,0,1,1,1]),getProperties:()=>({})}) as never;
    const r=query(bot,{mode:'voxels',bounds:[0,0,0,0,0,0]});
    expect(r).toMatchObject({status:'partial',complete:false,cells:[-1],palette:[],coverage:{partialReasons:['text_budget','unknown_cells']}});
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(24000);
  });
  it('covers text-limited pages once and reads changed blocks freshly on a repeated read cursor',()=>{
    const {bot}=scene();let state=1;
    bot.blockAt=(p)=>({name:'stone',stateId:state+p.x+100*p.z+10000*p.y,shapes:[[0,0,0,1,1,1]],getProperties:()=>({detail:'x'.repeat(300)})}) as never;
    let r=query(bot,{mode:'voxels',bounds:[-4,-4,-4,3,3,3]}), cursor=r.next.arguments.steps[0];
    const second=query(bot,cursor);state++;
    const repeated=query(bot,cursor);expect(repeated.bounds).toEqual(second.bounds);
    expect(repeated.palette[0].stateId).toBe(second.palette[0].stateId+1);
    const all=new Set<string>();
    for(let page=0;page<100;page++) {
      expect(JSON.stringify(r).length).toBeLessThanOrEqual(24000);
      for(const key of keys(r.bounds)){expect(all.has(key)).toBe(false);all.add(key);}
      if(!r.next)break;r=query(bot,r.next.arguments.steps[0]);
    }
    expect(all.size).toBe(512);expect(r.next).toBeNull();
  });
  it('covers the largest legal volume exactly once within the per-page cap',()=>{
    const {bot}=scene();let input:Record<string,unknown>={mode:'voxels',bounds:[-16,-16,-16,16,16,16]},count=0;
    const all=new Set<string>();
    for(let page=0;page<200;page++) {
      const r=query(bot,input);expect(r.cells.length).toBeLessThanOrEqual(512);
      expect(r.coverage.previouslyReturnedCount).toBe(count);count+=r.cells.length;
      for(const key of keys(r.bounds)){expect(all.has(key)).toBe(false);all.add(key);}
      if(!r.next)break;input=r.next.arguments.steps[0];
    }
    expect(count).toBe(33**3);expect(all.size).toBe(count);
  });
  it('reports omitted voxel entities without throwing away block data; rays retain their strict cap',()=>{
    const {bot}=scene();bot.entities=Object.fromEntries(Array.from({length:600},(_,i)=>[i+2,
      {id:i+2,name:'pig',position:bot.entity.position.clone(),height:1,width:1}])) as never;
    const r=query(bot,{mode:'voxels',bounds:[0,0,0,0,0,0]});
    expect(r.cells).toEqual([0]);expect(r.complete).toBe(false);expect(r.coverage.partialReasons).toContain('entity_budget');
    expect(r.entities.length+r.coverage.omittedEntityCount).toBe(600);
    expect(()=>observeSpatial(bot,{mode:'rays',rays:[[0,0,1]]})).toThrow(/512/);
  });
  it('delivers an oversized query and its independent following read through the sole native queue',async()=>{
    const r=methodHarness('1.21.1');
    try {
      const submit=vi.spyOn(r.exec,'submit'), position=r.bot.entity.position.clone(), chat=vi.spyOn(r.bot,'chat');
      const receipt=await r.world.tools().find(t=>t.name==='mc_scout')!.handler({steps:[
        {skill:'observe',mode:'voxels',format:'dense',bounds:[-5,-3,-5,5,5,5]},
        {skill:'observe',mode:'sites',sites:[[0,64,0]],needs:[]},
      ]},{role:'test',log:r.host.log});
      expect(receipt).not.toHaveProperty('failed');expect(submit).toHaveBeenCalledTimes(1);
      await expect.poll(()=>r.host.events.some(e=>e.execution?.terminal),{timeout:3000}).toBe(true);
      const end=r.host.events.find(e=>e.execution?.terminal)!;
      expect(end.execution).toMatchObject({kind:'task',phase:'completed',goalCompleted:false});
      expect(end.text).toContain('"status":"partial"');expect(end.text).toContain('"requestedCount":1089');
      expect(end.text).toContain('"kind":"sites"');
      expect(r.bot.entity.position.equals(position)).toBe(true);expect(chat).not.toHaveBeenCalled();
      expect(r.exec.status().waiting).toHaveLength(0);
    } finally {r.close();}
  });
  it('documents partial coverage and continuation in help and generated fields',()=>{
    expect((readSkillHelp({skill:'observe'}) as {text:string}).text).toContain('partial');
    const props=SCOUT_STEP_SCHEMA.properties as Record<string,Record<string,unknown>>;
    expect(props.cursor).toMatchObject({type:'string'});expect(props.bounds.description).toContain('512');
    const variants=(SCOUT_STEP_SCHEMA['x-agent-mc-skill-contracts'] as Record<string,unknown[]>).observe;
    const validate=new Ajv({strict:false}).compile({anyOf:variants});
    expect(validate({skill:'observe',mode:'voxels',bounds:[-5,-3,-5,5,5,5]})).toBe(true);
    const actual=query(scene().bot,{mode:'voxels',bounds:[-5,-3,-5,5,5,5]}).next.arguments.steps[0].cursor;
    expect(validate({skill:'observe',mode:'voxels',cursor:actual})).toBe(true);
    expect(validate({skill:'observe',mode:'voxels',cursor:'returned-cursor',bounds:[0,0,0,0,0,0]})).toBe(false);
    expect(validate({skill:'observe',mode:'sites'})).toBe(false);
  });
});
