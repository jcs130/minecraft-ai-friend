import test from 'node:test';
import assert from 'node:assert/strict';
import {activityReplacement,projectWorldActivity,validateActivitySnapshot} from '../src/world-activity.mjs';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const NOW=Date.parse('2026-10-26T01:00:00Z');
const roster=[{name:'Resident',playerUuid:A,kind:'agent',available:true},{name:'Hidden',playerUuid:B,kind:'agent',available:true}];
const row=(id,playerUuid=A,status='completed',day='2026-10-26')=>({id,playerUuid,status,day,taskId:'quest',system:'guild',category:'exploration',occurredAt:day+'T00:00:00Z'});
const base=()=>({schemaVersion:1,serverId:'qiandengji',available:true,observedAt:'2026-10-26T01:00:00Z',window:{from:'2026-09-27',through:'2026-10-26',timezone:'Asia/Shanghai'},commissions:[],donations:[],active:[],coverage:{}});
const project=(s,opts={})=>projectWorldActivity(s,roster,{now:NOW,excludedNames:['Hidden'],...opts});
const donation=(id,playerUuid=A,source='public_chest',deposited=2,withdrawn=0)=>({id,playerUuid,source,deposited,withdrawn,net:deposited-withdrawn,transactions:1,material:'minecraft:stone',day:'2026-10-26',occurredAt:null});
test('visibility applied before every count, contribution and active item; no UUID/raw fields leak',()=>{
  const s=base();s.commissions=[row('a'),row('b',B)];s.donations=[donation('a'),donation('b',B,'public_chest',100)];
  s.active=[{playerUuid:A,system:'guild',taskId:'quest',title:'Visible'},{playerUuid:B,system:'guild',taskId:'quest',title:'Secret'}];
  s.secret='TOKEN';s.coverage.logs={errors:['secret-path'],complete:false};
  const p=project(s);assert.equal(p.totals.completed,1);assert.equal(p.totals.active,1);assert.equal(p.contributions[0].materials[0].deposited,2);
  assert.ok(!JSON.stringify(p).includes(B));assert.ok(!JSON.stringify(p).includes(A));assert.ok(!JSON.stringify(p).includes('Secret'));assert.ok(!JSON.stringify(p).includes('secret-path'));assert.ok(!JSON.stringify(p).includes('TOKEN'));
});
test('unlisted identities cannot opt in using source name; observer and archived exclusions hold',()=>{
  const s=base();s.commissions=[{...row('a'),name:'Public'},row('b',B)];
  assert.equal(projectWorldActivity(s,[{...roster[0],kind:'observer'}],{now:NOW}).totals.completed,0);
  assert.equal(projectWorldActivity(s,[{...roster[0],name:'CortiEye'}],{now:NOW}).totals.completed,0);
  assert.equal(projectWorldActivity(s,[{...roster[0],historical:true}],{now:NOW}).totals.completed,0);
});
test('duplicate polling/replacement and duplicate source records never add counts',()=>{
  const s=base();s.commissions=[row('a'),row('a')];s.donations=[donation('a'),donation('a')];
  assert.equal(activityReplacement(s,structuredClone(s),{now:NOW}).changed,false);
  assert.equal(project(s).totals.completed,1);assert.equal(project(s).contributions[0].materials[0].deposited,2);
});
test('old delivery and conflicting timestamp rejected',()=>{
  const s=base();assert.throws(()=>activityReplacement(s,{...s,observedAt:'2026-10-25T01:00:00Z'},{now:NOW}),/STALE/);
  assert.throws(()=>activityReplacement(s,{...s,available:false},{now:NOW}),/CONFLICT/);
});
test('full snapshot replacement removes old events rather than retaining phantom counts',()=>{
  const s=base();s.commissions=[row('a')];const newer={...base(),observedAt:'2026-10-26T01:00:01Z'};
  const p=activityReplacement(s,newer,{now:NOW});assert.equal(project(p.snapshot,{now:NOW+1000}).totals.completed,0);
});
test('seven and thirty day windows filter actual event day, not polling time',()=>{
  const s=base();s.commissions=[row('a'),row('old',A,'completed','2026-10-02')];
  assert.equal(project(s).totals.completed,1);assert.equal(project(s,{days:30}).totals.completed,2);
});
test('accepted and abandoned are not completion; no completion-rate denominator invented',()=>{
  const s=base();s.commissions=[row('a',A,'accepted'),row('b',A,'abandoned')];const p=project(s);
  assert.deepEqual(p.totals,{completed:0,accepted:1,abandoned:1,active:0,participants:1});assert.equal(p.completionRate,undefined);
});
test('contribution sources and materials stay separate; withdrawing does not become a donation',()=>{
  const s=base();s.donations=[donation('a'),donation('b',A,'public_chest',0,5),donation('c',A,'commission_delivery',10),{...donation('d'),material:'minecraft:diamond'}];
  const p=project(s);assert.equal(p.contributions[0].materials.find(r=>r.material==='minecraft:stone').net,-3);assert.equal(p.contributions[1].materials[0].deposited,10);
  assert.equal(p.contributions[0].materials.length,2);assert.equal(p.donationValue,undefined);
});
test('partial thirty-day logs can have a complete retained-file seven-day window',()=>{
  const s=base();s.coverage.logs={available:true,complete:false,completeDays:Array.from({length:7},(_,i)=>'2026-10-'+(20+i)),unreadDays:['2026-10-01']};
  assert.equal(project(s).coverage.logs.windowFilesComplete,true);assert.equal(project(s,{days:30}).coverage.logs.windowFilesComplete,false);
});
test('unavailable and stale are explicit, not success or known zero',()=>{
  assert.equal(projectWorldActivity(null,roster).totals,null);const s=base();s.available=false;assert.equal(project(s).totals,null);
  assert.equal(project(base(),{now:NOW+180001}).stale,true);
});
test('malformed bounds, future timestamp and inconsistent item quantities rejected',()=>{
  assert.throws(()=>validateActivitySnapshot({...base(),observedAt:'2099-01-01T00:00:00Z'},{now:NOW}),/INVALID/);
  const s=base();s.donations=[{...donation('a'),net:99}];assert.throws(()=>project(s),/INVALID/);
  assert.throws(()=>project(base(),{days:8}),/INVALID_ACTIVITY_WINDOW/);
});
test('conflicting trusted roster identity fails closed',()=>{
  const s=base();s.commissions=[row('a')];assert.equal(projectWorldActivity(s,[roster[0],{...roster[0],name:'Different'}],{now:NOW}).totals.completed,0);
});
