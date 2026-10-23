import { afterEach, describe, expect, it, vi } from 'vitest';
import { Vec3 } from 'vec3';
import { methodHarness } from './method-harness.ts';
import { observeSpatial, parseSpatialObservation, spatialObservationText, SPATIAL_QUERY_SCHEMA } from '../core/spatial-observation.ts';
import { voxelVolume, voxelCursorError, type VoxelCursor } from '../core/voxel-query-contract.ts';
import { parseScoutSteps, parseSteps, describeSkillInputCorrection, SCOUT_STEP_SCHEMA } from '../core/skills.ts';
import { skillHarvest } from '../core/skills-harvest.ts';
import { stepDecision } from '../core/step-decision.ts';
import { clearObservationRay } from '../core/perception-sight.ts';
import Ajv from 'ajv';

const rigs: ReturnType<typeof methodHarness>[] = [];
afterEach(() => { for (const r of rigs.splice(0)) r.close(); vi.useRealTimers(); });
function rig() { const r = methodHarness('1.21.1'); rigs.push(r); return r; }
function voxel(r: ReturnType<typeof rig>, input: Record<string,unknown>) {
  const parsed = parseSpatialObservation({ mode: 'voxels', ...input });
  if ('error' in parsed) throw new Error(parsed.error);
  const data = observeSpatial(r.bot as never, parsed);
  if (data.kind !== 'voxels') throw new Error('not voxels');
  return data;
}
describe('real bounded world reads (no mocked visibility)', () => {
  it('returns actual partial data on the first 2205-cell request, with consistent coverage and no automatic read of the remainder', async () => {
    const r = rig(), tool = r.world.tools().find(t => t.name === 'mc_observe')!;
    r.set(-8,65,-8,'glass');
    const out = await tool.handler({ mode: 'voxels', bounds: [-10,-2,-10,10,2,10] }, { role:'test',log:r.host.log });
    const data = (out as any).data;
    expect((out as any).failed).not.toBe(true);
    expect(data).toMatchObject({ status:'partial', requested_count:2205, complete:false,
      coordinate_system:'absolute_block', query_anchor:[0,64,0], retryable:false });
    expect(data.returned_count).toBeGreaterThan(0); expect(data.returned_count).toBeLessThanOrEqual(512);
    expect(data.cells.length).toBe(data.returned_count);
    expect(voxelVolume(data.bounds)).toBe(data.returned_count);
    expect(data.returned_regions).toEqual([data.bounds]);
    expect(data.observed_count).toBeGreaterThan(0);
    expect(data.palette).toEqual(expect.arrayContaining([expect.objectContaining({name:'glass',vision:'transparent',collision:[[0,0,0,1,1,1]]})]));
    expect(data.remaining_count).toBe(2205-data.returned_count);
    expect(data.remaining_after_page).toBe(data.remaining_count);
    expect(data.unobserved_count).toBe(data.remaining_count+data.unknownCells);
    expect(data.next_safe_read).toEqual({ mode:'voxels',cursor:data.next_cursor });
    expect(voxelCursorError(data.next_cursor)).toBeNull();
    expect(Date.parse(data.observed_at)).toBeGreaterThan(0);
    expect(r.exec.status().running).toBeNull();
  });
  it('covers disjoint regions exactly once when the caller explicitly follows cursors, even after movement and a later observation time', () => {
    const r = rig(), seen = new Set<string>();
    let data = voxel(r,{ bounds:[-10,-2,-10,10,2,10] }), pages=0;
    const original = data.requested_bounds, firstTime = data.observed_at;
    vi.useFakeTimers(); vi.setSystemTime(Date.parse(firstTime)+10000);
    while (true) {
      expect(data.requested_bounds).toEqual(original); expect(data.query_anchor).toEqual([0,64,0]);
      expect(data.returned_count).toBeLessThanOrEqual(512);
      const b = data.bounds;
      for(let y=b[1];y<=b[4];y++)for(let z=b[2];z<=b[5];z++)for(let x=b[0];x<=b[3];x++) {
        const key = `${x},${y},${z}`; expect(seen.has(key)).toBe(false); seen.add(key);
      }
      expect(data.remaining_after_page).toBe(2205-seen.size);
      if(!data.next_cursor) break;
      const cursor = structuredClone(data.next_cursor);
      r.bot.entity.position = new Vec3(100.5,80,100.5);
      data = voxel(r,{cursor}); pages++;
      expect(data.observed_at).not.toBe(firstTime);
      expect(data.unknownCells).toBe(data.returned_count); // Remote data stays unknown.
      expect(cursor).toEqual(data.next_cursor ? { ...data.next_cursor, pending_regions:cursor.pending_regions } : cursor);
      expect(pages).toBeLessThan(200);
    }
    expect(seen.size).toBe(2205); expect(data.remaining_after_page).toBe(0);
    expect(data.complete).toBe(false); // Last page is not a claim that all previous observations remain current.
  });
  it('keeps legal small calls and the exact 512-cell budget, including legacy queued observation', async () => {
    const r = rig(), bounds = [-4,0,-4,3,7,3];
    expect(new Ajv({strict:false}).compile(SPATIAL_QUERY_SCHEMA)({mode:'voxels',bounds})).toBe(true);
    expect(voxel(r,{bounds})).toMatchObject({returned_count:512,complete:true,status:'complete',next_cursor:null});
    const step = {skill:'observe',mode:'voxels',bounds};
    expect(parseScoutSteps([step])).toEqual({steps:[step]});
    const report = vi.spyOn(r.world as any,'onTaskReport');
    const admitted = await r.world.tools().find(t=>t.name==='mc_scout')!.handler({steps:[{...step,bounds:[-10,-2,-10,10,2,10]}]}, {role:'test',log:r.host.log});
    expect((admitted as any).execution.phase).toBe('accepted');
    await vi.waitFor(()=>expect(report.mock.calls.some(([v])=>v.kind==='done')).toBe(true));
    const terminal = report.mock.calls.find(([v])=>v.kind==='done')![0];
    const observation=terminal.steps[0].observation;
    expect(observation.status).toBe('partial');
    expect(observation.cells).toHaveLength(observation.returned_count);
    expect(observation.returned_count).toBeLessThanOrEqual(512);
    expect(terminal.steps[0].decision).toMatchObject({status:'partial',unit:'cells',completed:observation.observed_count,
      remaining:observation.unobserved_count,next_safe_read:{tool:'mc_observe'}});
  });
  it('does not replace a running or waiting action to perform an immediate read; invalid writes preserve the queue', async () => {
    const r=rig();
    r.exec.submitDetailed([{skill:'control',keys:['sneak'],durationMs:2000,mode:'ground'}],'append');
    r.exec.submitDetailed([{skill:'control',keys:[],durationMs:100,mode:'ground'}],'append');
    const before = r.exec.status();
    await r.world.tools().find(t=>t.name==='mc_observe')!.handler({mode:'voxels'}, {role:'test',log:r.host.log});
    const bad = await r.world.tools().find(t=>t.name==='mc_do')!.handler({queue:'now',steps:[{skill:'harvest',block:'wheat',to:[1,64,1]}]}, {role:'test',log:r.host.log});
    expect((bad as any).data).toMatchObject({status:'invalid_arguments',executed:false,errors:[{path:'/steps/0/to'}]});
    expect(r.exec.status().running?.id).toBe(before.running?.id);
    expect(r.exec.status().waiting.map(t=>t.id)).toEqual(before.waiting.map(t=>t.id));
  });
  it('rejects contradictory or damaged cursors and dimension drift before reading', () => {
    const r=rig(), first=voxel(r,{bounds:[-10,-2,-10,10,2,10]});
    expect(parseSpatialObservation({mode:'voxels',bounds:[0,0,0,0,0,0],cursor:first.next_cursor})).toHaveProperty('error');
    expect(parseSpatialObservation({mode:'rays',cursor:first.next_cursor})).toHaveProperty('error');
    const malformed=structuredClone(first.next_cursor!); malformed.pending_regions.push(malformed.pending_regions[0]);
    expect(voxelCursorError(malformed)).toContain('overlaps');
    const reads=vi.spyOn(r.bot,'blockAt'); r.bot.game.dimension='the_nether';
    expect(()=>voxel(r,{cursor:first.next_cursor})).toThrow('维度'); expect(reads).not.toHaveBeenCalled();
  });
  it('keeps the requested region intact in diagnostics and never rewrites to into at', () => {
    const raw=[{skill:'observe',mode:'voxels',bounds:[0,-1,0,-12,8,-12]}],before=structuredClone(raw);
    const parsed=parseSteps(raw); expect(parsed).toHaveProperty('error');
    const correction=describeSkillInputCorrection(raw,(parsed as any).error);
    expect(correction.path).toBe('/steps/0/bounds'); expect(correction.errors[0].actual).toEqual(raw[0].bounds);
    expect(parseScoutSteps((correction.minimal_legal_example as any).steps)).not.toHaveProperty('error');
    expect(raw).toEqual(before);
    expect(parseSteps([{skill:'use',item:'stick',to:[1,64,0]}])).toHaveProperty('error');
    const generation=(SCOUT_STEP_SCHEMA['x-agent-mc-skill-contracts'] as any).observe;
    const validate=new Ajv({strict:false}).compile({anyOf:generation});
    expect(validate({skill:'observe',mode:'voxels',bounds:[0,0,0,0,0,0],cursor:{}})).toBe(false);
  });
  it('reports an immature crop as a business block with zero effects and a concrete safe read', async () => {
    const r=rig(); r.set(0,64,-2,'wheat'); r.set(0,63,-2,'farmland');
    const dig=vi.fn(); Object.assign(r.bot,{dig});
    const action=skillHarvest(r.bot as never,{skill:'harvest',block:'wheat',at:[0,64,-2],replant:true},{aborted:()=>false} as never);
    const error=await action.catch(e=>e);
    expect(error.code).toBe('target-not-ready');
    expect(stepDecision('fail',error.code,undefined,error.decision)).toMatchObject({status:'blocked',completed:0,remaining:1,
      retryable:false,next_safe_read:{tool:'mc_observe',arguments:{mode:'sites',sites:[[0,64,-2]]}}});
    expect(dig).not.toHaveBeenCalled();
  });
  it('does not turn malformed scalar fields into broader or mutating defaults, and reports safe whitespace normalization', () => {
    for(const step of [
      {skill:'build',material:'stone',at:[0,64,0],dryRun:'true'},
      {skill:'take',item:'paper',count:1.9},
      {skill:'use',at:[0,64,0],item:123},
    ]) expect(parseSteps([step])).toHaveProperty('error');
    const normalized=parseSteps([{skill:' eat ',item:' bread '}]);
    expect(normalized).toMatchObject({steps:[{skill:'eat',item:'bread'}],notes:[
      {field:'skill',kind:'rewritten'},{field:'item',kind:'rewritten'},
    ]});
  });
  it('keeps verbose mod data bounded without converting missing material into air or dropping continuation', () => {
    const r=rig();
    r.bot.blockAt=(_p:Vec3)=>({name:'modded_glass',stateId:1,shapes:[],getProperties:()=>({payload:'x'.repeat(50000)})}) as never;
    const data=voxel(r,{bounds:[0,0,0,7,7,7]});
    expect(data).toMatchObject({status:'partial',returned_count:1,cells:[-1],palette:[],observed_count:0});
    expect(data.partial_reason).toContain('response_budget'); expect(data.next_cursor).not.toBeNull();
    expect(JSON.stringify(data).length).toBeLessThanOrEqual(24000);
    expect(spatialObservationText(r.bot as never,{mode:'voxels',bounds:[0,0,0,0,0,0]})).toContain('unknown_cells');
  });
  it.each(['glass','red_stained_glass','glass_pane','red_stained_glass_pane'])
    ('sees through %s while preserving its native collision, including collision rays and body clearance', name => {
      const r=rig();r.set(0,65,-2,name);r.set(0,65,-4,'stone');
      expect(clearObservationRay(r.bot,{x:.5,y:65.62,z:.5},{x:.5,y:65.62,z:-2.5})).toBe(true);
      const glass=voxel(r,{bounds:[0,1,-2,0,1,-2]});
      expect(glass.palette[0]).toMatchObject({name,vision:'transparent'});
      expect(glass.palette[0].collision!.length).toBeGreaterThan(0);
      expect(voxel(r,{bounds:[0,1,-4,0,1,-4]}).palette[0].name).toBe('stone');
      const ray=observeSpatial(r.bot as never,{mode:'rays',rays:[[0,0,8]]});
      expect((ray as any).rays[0].terrain).toMatchObject({kind:'block',material:{name}});
      const site=observeSpatial(r.bot as never,{mode:'sites',sites:[[0,65,-2]]});
      expect((site as any).sites[0].body.clear).toBe(false);
    });
  it('keeps tinted glass opaque and never labels the hidden target as air or passable', () => {
    const r=rig();for(let y=64;y<=67;y++)for(let x=-2;x<=2;x++)r.set(x,y,-2,'tinted_glass');
    r.set(0,65,-4,'diamond_ore');
    const data=voxel(r,{bounds:[0,1,-4,0,1,-4]});
    expect(data).toMatchObject({status:'partial',unknownCells:1,cells:[-1],palette:[],complete:false});
    expect(JSON.stringify(data)).not.toContain('diamond_ore');
  });
});
