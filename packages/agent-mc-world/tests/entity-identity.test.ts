import { expect, it, vi } from 'vitest';
import { Vec3 } from 'vec3';
import { methodHarness } from './method-harness.ts';
import { bindEntityIdentityResolver, observedEntityIdentity, observedEntityLabel, type EntityIdentity } from '../core/entity-identity.ts';
import { snapshotFromBot, narrateWorldSegments, snapshotFingerprint } from '../core/terrain.ts';
import { AttentionReader } from '../core/perception-tools.ts';
import { entitySnapshot } from '../core/entity-snapshot.ts';
import { observationView } from '../core/perception-sight.ts';
import { entityIdentityNote } from '../core/animal-state.ts';

const id='12345678-1234-4234-8234-123456789abc';
const identity:EntityIdentity={uuid:id,kind:'companion',name:'同行者',label:'同伴「同行者」',source:'test-server/v1',observedAt:'2026-11-07T00:00:00Z'};
const entity=()=>({id:7,uuid:id,name:'allay',type:'mob',height:1,position:new Vec3(.5,64,-2),velocity:new Vec3(0,0,0),metadata:[]});

it('uses an attested personal name instead of a protocol display-name prefix',()=>{
  const r=methodHarness('1.21.1'),e=entity();
  const release=bindEntityIdentityResolver(r.bot,()=>({...identity,label:'同行者'}));
  try {e.metadata[r.bot.registry.entitiesByName.allay.metadataKeys.indexOf('custom_name')]=JSON.stringify({text:'[模组角色] 同行者'}) as never;
    expect(entityIdentityNote(r.bot,e)).toContain('名字「同行者」');expect(entityIdentityNote(r.bot,e)).not.toContain('模组角色');
  }finally{release();r.close();}
});

it('retains role and verified owner when the display name is also a food noun',()=>{
  const r=methodHarness('1.21.1'),e=entity();
  const self='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  Object.assign(r.bot,{player:{uuid:self}});r.bot.entities[7]=e;
  const attested={...identity,kind:'maid',name:'小饼干',label:'小饼干',ownerUuid:self};
  const release=bindEntityIdentityResolver(r.bot,()=>attested);
  try {
    const visible=narrateWorldSegments(snapshotFromBot(r.bot,{scanBlocks:false})).find(s=>s.key==='life')!.text;
    expect(visible).toContain('有小饼干（服务端角色身份=maid，归属本人');
    expect(observedEntityLabel(r.bot,e)).toBe('小饼干'); // display name stays personal
    expect(visible).not.toContain('悦灵');
    r.set(0,64,-1,'stone');r.set(0,65,-1,'stone');
    const hidden=narrateWorldSegments(snapshotFromBot(r.bot,{scanBlocks:false})).find(s=>s.key==='life')!.text;
    expect(hidden).toContain('视线被遮挡');expect(hidden).toContain('身份=maid，归属本人');
    const emit=vi.spyOn(r.world as any,'emit').mockImplementation(()=>undefined);
    Object.assign(r.bot.world,{raycast:()=>null});(r.world as any).proximityTick(r.bot);
    expect(emit.mock.calls.map(c=>c[1]).join('\n')).toContain('身份=maid，归属本人');
    release();
    expect(entityIdentityNote(r.bot,e)).not.toMatch(/角色身份|归属本人/);
  }finally{release();r.close();}
});

it('does not infer ownership from the personal name or a missing self UUID',()=>{
  const r=methodHarness('1.21.1'),e=entity();
  const release=bindEntityIdentityResolver(r.bot,()=>({...identity,label:identity.name,ownerUuid:id}));
  try {
    expect(entityIdentityNote(r.bot,e)).toContain('归属未比对');
    Object.assign(r.bot,{player:{uuid:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}});
    expect(entityIdentityNote(r.bot,e)).toContain('归属其他玩家');
    expect(entityIdentityNote(r.bot,e)).not.toContain('归属本人');
  }finally{release();r.close();}
});

it('invalidates quiet snapshots for a newly attested identity, not for its refreshed clock',()=>{
  const r=methodHarness('1.21.1');r.bot.entities[7]=entity();
  let current={...identity,label:identity.name};
  const before=snapshotFingerprint(snapshotFromBot(r.bot,{scanBlocks:false}));
  const release=bindEntityIdentityResolver(r.bot,()=>current);
  try {
    const after=snapshotFingerprint(snapshotFromBot(r.bot,{scanBlocks:false}));expect(after).not.toBe(before);
    current={...current,observedAt:'2026-11-07T00:01:00Z'};
    expect(snapshotFingerprint(snapshotFromBot(r.bot,{scanBlocks:false}))).toBe(after);
    current={...current,kind:'other-role'};
    expect(snapshotFingerprint(snapshotFromBot(r.bot,{scanBlocks:false}))).not.toBe(after);
  }finally{release();r.close();}
});

it.each(['1.21.1','1.20.6'])('keeps attested identity in snapshot, attention, SDK and proximity without changing raw targets (%s)',version=>{
  const r=methodHarness(version);
  const release=bindEntityIdentityResolver(r.bot,e=>e.uuid===id?identity:null);
  try {
    r.bot.entities[7]=entity();
    const s=snapshotFromBot(r.bot,{scanBlocks:false});
    expect(s.entities[0]).toMatchObject({name:'allay',identity});
    const life=narrateWorldSegments(s).find(s=>s.key==='life')!;
    expect(life.text).toContain('同伴「同行者」'); expect(life.text).not.toContain('悦灵');
    expect(new AttentionReader().read(r.bot,3).highlights[0]).toMatchObject({target:'allay',identity,label:identity.label});
    expect(entitySnapshot(r.bot).entities['7']).toMatchObject({name:'allay',identity});
    expect(entitySnapshot(observationView(r.bot as never)).entities['7']).toMatchObject({name:'allay',identity});
    const emit=vi.spyOn(r.world as any,'emit').mockImplementation(()=>undefined);
    Object.assign(r.bot.world,{raycast:()=>null});
    (r.world as any).proximityTick(r.bot);
    expect(emit.mock.calls.some(c=>String(c[1]).includes('看见同伴「同行者」'))).toBe(true);
    expect(emit.mock.calls.some(c=>String(c[1]).includes('悦灵'))).toBe(false);
    const before=life.cmp;release();
    const raw=narrateWorldSegments(snapshotFromBot(r.bot,{scanBlocks:false})).find(s=>s.key==='life')!;
    expect(raw.text).toContain('悦灵');expect(raw.cmp).not.toBe(before);
  } finally {release();r.close();}
});

it('labels already tracked near occluded companions without inventing sound or revealing hidden metadata',()=>{
  const r=methodHarness('1.21.1'),release=bindEntityIdentityResolver(r.bot,()=>identity);
  try {
    r.bot.entities[7]=entity();
    r.set(0,64,-1,'stone');r.set(0,65,-1,'stone');
    const s=snapshotFromBot(r.bot,{scanBlocks:false}),e=s.entities[0];
    expect(e).toMatchObject({visible:false,identity});expect(e.customName).toBeUndefined();
    expect(narrateWorldSegments(s).find(s=>s.key==='life')!.text).toContain('有同伴「同行者」（视线被遮挡');
    const emit=vi.spyOn(r.world as any,'emit').mockImplementation(()=>undefined);
    Object.assign(r.bot.world,{raycast:()=>({name:'stone'})});
    (r.world as any).proximityTick(r.bot);
    const text=emit.mock.calls.map(c=>c[1]).join('\n');
    expect(text).toContain('附近实体同步：同伴「同行者」');expect(text).toContain('未直视');
    expect(text).not.toMatch(/悦灵|的动静|听见/);
    r.bot.entities[7].position=new Vec3(.5,64,-80);
    expect(snapshotFromBot(r.bot,{scanBlocks:false}).entities).toEqual([]);
  } finally {release();r.close();}
});

it('never applies an NPC identity to a player, another UUID, another connection or an old cleanup',()=>{
  const bot={},other={},e=entity();
  const release=bindEntityIdentityResolver(bot,()=>identity);
  expect(observedEntityIdentity(bot,{...e,uuid:'22222222-2222-4222-8222-222222222222'})).toBeNull();
  expect(observedEntityLabel(bot,{...e,type:'player',username:'live'})).toBe('live');
  expect(observedEntityIdentity(other,e)).toBeNull();
  const releaseNew=bindEntityIdentityResolver(bot,()=>({...identity,name:'新名字',label:'同伴「新名字」'}));
  release();expect(observedEntityLabel(bot,e)).toBe('同伴「新名字」');
  releaseNew();expect(observedEntityLabel(bot,e)).toBe('悦灵');
});

it('keeps semantic identity on native death evidence without changing its protocol type or claiming a kill',()=>{
  const r=methodHarness('1.21.1'),release=bindEntityIdentityResolver(r.bot,()=>identity);
  try {
    const emit=vi.spyOn(r.world as any,'emit').mockImplementation(()=>undefined);
    (r.world as any).hookBotEvents(r.bot);r.bot.emit('entityDead',entity());
    const call=emit.mock.calls.find(c=>String(c[1]).includes('死了'))!;
    expect(call[1]).toContain('同伴「同行者」');expect(call[1]).not.toMatch(/悦灵|击杀/);
    expect(call[3]).toMatchObject({meta:{entityLifecycle:{entityType:'allay',identity}}});
  } finally {release();r.close();}
});
