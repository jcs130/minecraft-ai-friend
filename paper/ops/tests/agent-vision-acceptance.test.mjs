import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMspt,parseVision,accumulate} from '../agent-vision-acceptance.mjs';
const mspt=raw=>parseMspt('§6Server tick times§e(§7avg§e/§7min§e/§7max§e)§6 from last 5s, 10s, 1m:\n§6◴ '+raw);
const sample=(at,tick,peak=40)=>({at,ok:true,vision:{enabled:true,tick},mspt:{fiveSeconds:{avg:13,min:5,max:peak},minute:{avg:13,min:5,max:peak}}});
test('parse all three actual Paper/Youer windows, including red peak',()=>{
 const value=mspt('§a15.4§7/§a8.1§7/§a29.9, §a15.6/8.1/33.7, §a16.5/7.8/§c101.9');assert.equal(value.minute.max,101.9);assert.equal(value.fiveSeconds.avg,15.4);
});
test('unknown and incomplete responses never become healthy zeros',()=>{
 for(const raw of ['','Permission denied','Server tick times(avg/min/max) from last 5s, 10s, 1m: 0.0'])assert.throws(()=>parseMspt(raw));
 for(const raw of ['','MC_VISION {}','MC_VISION {"enabled":true,"tick":-1}'])assert.throws(()=>parseVision(raw));
});
test('parse current running filter without confusing it with the global MSPT',()=>assert.deepEqual(parseVision('MC_VISION {"enabled":true,"tick":200,"maxTickMicros":10}').tick,200));
test('restart does not stitch two process epochs into a 24 hour pass',()=>{
 let s=accumulate(null,sample(1,5000));s=accumulate(s,sample(5001,100));assert.equal(s.restarts,1);assert.equal(s.observedMs,0);assert.equal(s.continuousObservation24h,false);
});
test('missing observations and disabled filter keep acceptance open',()=>{
 let s=accumulate(null,sample(1,1));s=accumulate(s,{at:5001,ok:false});s=accumulate(s,sample(70001,100));assert.equal(s.errors,1);assert.equal(s.coverageGaps,1);
 const row=sample(75001,200);row.vision.enabled=false;s=accumulate(s,row);assert.equal(s.disabledSamples,1);assert.equal(s.continuousObservation24h,false);
});
test('high global peak fails performance without inventing a vision failure',()=>{
 const s=accumulate(null,sample(1,1,101.9));assert.equal(s.performanceTargetObserved,false);assert.equal(s.disabledSamples,0);assert.equal(s.errors,0);
});
test('even complete sampler evidence cannot replace log and actual mixed-scene acceptance',()=>{
 let s=null;for(let n=0;n<=86400;n+=5)s=accumulate(s,sample(n*1000,n*20));assert.equal(s.continuousObservation24h,true);assert.equal(s.performanceTargetObserved,true);assert.equal(s.accepted24h,false);assert.equal(s.pendingEvidence.length,2);
 s=accumulate(s,{at:86405000,ok:false});assert.equal(s.continuousObservation24h,false);
});
