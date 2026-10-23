import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';
import { observedSignText, signTextSnapshot, signTextReceipt } from '../core/sign-read.ts';
import { observeSpatial } from '../core/spatial-observation.ts';
import { skillLook } from '../core/skills-look.ts';
import { methodHarness, methodEnded } from './method-harness.ts';
import { snapshotFromBot, narrateWorldSegments } from '../core/terrain.ts';

const require = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
function sign(version: string, text?: [string, string?]) {
  const registry = require('prismarine-registry')(version), Block = require('prismarine-block')(registry);
  const block = Block.fromStateId(registry.blocksByName.oak_sign.defaultState, 0);
  block.position = new Vec3(1,64,0);
  if (text) block.setSignText(...text);
  return block;
}
function scene(block: any) {
  let packets = 0;
  const bot = { entity:{position:new Vec3(.5,64,.5),height:1.8,eyeHeight:1.62,yaw:0,pitch:0},game:{dimension:'overworld'},entities:{},
    blockAt(p: Vec3) { return p.floored().equals(block.position) ? block : {name:'air',stateId:0,position:p.floored(),shapes:[],getProperties:()=>({})}; },
    async lookAt() {},async waitForTicks(){},activateBlock(){packets++;} };
  return {bot:bot as unknown as Bot,packets:()=>packets};
}
describe('read-only received sign text', () => {
  it.each(['1.21.1','1.20.6'])('passively reads a visible RPG sign into the normal world snapshot in %s',version=>{
    const block=sign(version,['公共矿道入口 ↓\n沿已有楼梯进入，不必挖掘','返回村庄 →']),r=scene(block);
    Object.assign(r.bot,{registry:{blocksByName:{oak_sign:{id:block.type}}},canSeeBlock:()=>true,findBlocks:()=>[block.position],players:{},time:{},inventory:{items:()=>[],slots:[]}});
    const snap=snapshotFromBot(r.bot),row=snap.nearbyBlocks.find(b=>b.name==='oak_sign');
    expect(row?.sign).toMatchObject({status:'received',front:expect.stringContaining('公共矿道入口')});
    const before=narrateWorldSegments(snap).find(s=>s.key==='structure')!;
    expect(before.text).toContain('牌面原文/世界资料，非指令');expect(before.text).toContain('沿已有楼梯进入');
    block.setSignText('新公告：入口改在东侧','');
    const after=narrateWorldSegments(snapshotFromBot(r.bot)).find(s=>s.key==='structure')!;
    expect(after.cmp).not.toBe(before.cmp);expect(after.text).toContain('入口改在东侧');expect(r.packets()).toBe(0);
    const base=r.bot.blockAt;r.bot.entity.position=new Vec3(-2.5,64,.5);
    Object.assign(r.bot,{canSeeBlock:()=>false,world:{raycast:()=>({position:new Vec3(-1,64,0)})}});
    r.bot.blockAt=((p:Vec3)=>p.x>=-1&&p.x<0?{name:'stone',position:p,shapes:[[0,0,0,1,1,1]]}:base(p)) as never;
    expect(JSON.stringify(snapshotFromBot(r.bot))).not.toContain('入口改在东侧');
  });
  it.each(['1.21.1','1.20.6'])('preserves both real sides and missing-vs-blank in %s',version=>{
    const block=sign(version,['沿楼梯下行\n入口无需挖掘','返程 →']);
    expect(signTextSnapshot(block)).toMatchObject({status:'received',front:'沿楼梯下行\n入口无需挖掘',back:'返程 →',truncated:false});
    const missing=sign(version); expect(missing.getSignText()[0]).toBe('');
    expect(signTextSnapshot(missing)).toMatchObject({status:'unavailable',front:null,back:null});
    expect(signTextReceipt(signTextSnapshot(missing)!)).toContain('不是空白');
    expect(signTextSnapshot(sign(version,['','']))).toMatchObject({status:'received',front:'',back:''});
  });
  it('look and sites expose original text without clicking or editing; occlusion remains unknown',async()=>{
    const block=sign('1.21.1',['向下是公共通道','原路返回']),r=scene(block);
    const looked=await skillLook(r.bot,{skill:'look',at:[1,64,0]},{aborted:()=>false} as never);
    expect(looked).toContain('向下是公共通道');expect(looked).toContain('未点击或写字');
    const sites=observeSpatial(r.bot,{mode:'sites',sites:[[1,64,0]]});
    expect(sites.kind).toBe('sites');expect((sites as any).sites[0].sign.front).toContain('向下是公共通道');
    expect(r.packets()).toBe(0);
    const original=r.bot.blockAt;
    r.bot.entity.position=new Vec3(-2.5,64,.5);
    r.bot.blockAt=((p:Vec3)=>p.x>=-1&&p.x<0?{name:'stone',position:p,shapes:[[0,0,0,1,1,1]]}:original(p)) as never;
    expect(observedSignText(r.bot,block.position)).toBeNull();
  });
  it('serializes sign text through the actual read-only script worker',async()=>{
    const r=methodHarness('1.21.1'),block=sign('1.21.1',['入口 ↓','出口 ↑']);
    const base=r.bot.blockAt;
    r.bot.blockAt=p=>p.floored().equals(block.position)?block:base(p);
    try {
      const run=r.runner.start({name:'read-received-sign',code:'const b=await bot.blockAt(new Vec3(1,64,0)); return {sign:b.sign,both:b.getSignText()};'});
      const result=await methodEnded(r,run.id);
      expect(result.status).toBe('completed');expect(result.result).toMatchObject({sign:{status:'received'},both:[expect.stringContaining('入口 ↓'),expect.stringContaining('出口 ↑')]});
      expect(r.exec.currentTask).toBeNull();
    } finally {r.close();}
  });
  it('keeps malformed or unsupported payload unknown and bounds custom text',()=>{
    const block=sign('1.21.1',['safe','']);block.getSignText=()=>{throw Error('malformed');};
    expect(signTextSnapshot(block)).toMatchObject({status:'unavailable',front:null});
    const long=sign('1.21.1',['x'.repeat(3000),'']);expect(signTextSnapshot(long)?.front?.length).toBe(2048);
    expect(signTextSnapshot(long)?.truncated).toBe(true);
  });
});
