import assert from 'node:assert/strict';
import test from 'node:test';
import {createGoddessDialogueState} from './goddess-dialogue.mjs';

test('duplicate suppression expires and a later intentional identical question is admissible',()=>{
 let time=0;const d=createGoddessDialogueState({now:()=>time});
 d.begin('Guest','你好','original');d.complete('Guest','original','你好。');
 time=119999;assert.deepEqual(d.inspect('gUeSt',' 你好 '),{ok:false,reason:'duplicate',quiet:true});
 time=120000;assert.equal(d.inspect('Guest','你好').ok,true);
});

test('stale completions cannot release or replace another original request',()=>{
 const d=createGoddessDialogueState();d.begin('Guest','问题','original');
 assert.throws(()=>d.complete('Guest','stale','旧答复'),/Unmatched/);
 d.fail('Guest','stale');assert.equal(d.inspect('Guest','新问题').reason,'inflight');
 d.complete('Guest','original',null);assert.equal(d.context('Guest').lastDecision,'silent');
});

test('bounded context evicts idle peers and expires history without forgetting active requests',()=>{
 let time=0;const d=createGoddessDialogueState({now:()=>time,maxPeers:2});
 d.begin('Active','问题','pending');time=1;d.begin('Old','你好','old');d.complete('Old','old','旧答复');
 time=2;d.begin('New','你好','new');d.complete('New','new','新答复');
 assert.equal(d.inspect('Active','问题').reason,'inflight');
 assert.equal(d.context('Old').lastReply,null);
 time=900003;assert.equal(d.context('New').lastReply,null);assert.equal(d.inspect('Active','问题').reason,'inflight');
});
