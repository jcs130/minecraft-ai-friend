import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';import {EventEmitter} from 'node:events';
import {createPhotoJourneyRecorder} from './photo-journey-recorder.mjs';
import {photoJourneyPreflight} from './photo-journey-preflight.mjs';
const owner='3b71682c-b2e8-4b77-836f-c30e46408991';
function fixture(t){const root=mkdtempSync(path.join(os.tmpdir(),'photo-recorder-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return {root,directory:path.join(root,'run')};}
test('observer is opt-in, isolated, preserves earlier evidence, and never sends commands',t=>{
 const {directory}=fixture(t);
 assert.throws(()=>createPhotoJourneyRecorder({directory,owner,gameAddress:'public.example:25565',evidenceKind:'real-client'}));
 const recorder=createPhotoJourneyRecorder({directory,owner,gameAddress:'127.0.0.1:25914',evidenceKind:'synthetic-fixture'});
 assert.throws(()=>recorder.decision({model:'fixture'}),'no model decision without original trace');
 assert.throws(()=>createPhotoJourneyRecorder({directory,owner,gameAddress:'127.0.0.1:25914',evidenceKind:'synthetic-fixture'}));
 const bot=new EventEmitter();bot.entity={uuid:owner};bot._client=new EventEmitter();bot.chat=()=>assert.fail('observer must never drive the Agent');
 const close=recorder.attach(bot);
 bot.emit('messagestr','unrelated private chat','system');
 bot.emit('messagestr','MC_COACH '+JSON.stringify({type:'adventure_hint',recipient:owner,eventId:'h1',requiresDecision:true}),'chat');
 bot.emit('messagestr','MC_COACH '+JSON.stringify({type:'adventure_hint',recipient:owner,eventId:'h1',requiresDecision:true}),'system');
 bot.emit('messagestr','MC_PHOTO '+JSON.stringify({owner,status:'success'}),'chat');
 bot._client.emit('custom_payload',{channel:'mcagent:photo',data:Buffer.from(JSON.stringify({owner:'other',status:'success'}))});
 bot._client.emit('custom_payload',{channel:'mcagent:photo',data:Buffer.from(JSON.stringify({owner,status:'confirming'}))});
 close();bot.emit('end');
 const rows=readFileSync(path.join(directory,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.deepEqual(rows.map(r=>r.kind),['connected','hint','receipt']);
 assert.equal(rows.some(r=>r.kind==='decision'),false,'a hint never becomes an invented model decision');
});
test('preflight only reads native readiness files and never returns a credential',async t=>{
 const {root}=fixture(t);mkdirSync(path.join(root,'diagnostics'));mkdirSync(path.join(root,'agent-mc-bridge'));
 const state={schema:'qiandeng-native-camera/v1',instanceId:owner,playerUuid:owner,at:new Date().toISOString(),connected:true,renderer:'Intel fixture',server:'127.0.0.1:25914',shadersEnabled:false,cleanHud:true,cleanToasts:true,modelCatalogueSize:1};
 writeFileSync(path.join(root,'diagnostics/qiandeng-native-camera.json'),JSON.stringify(state));
 const token='fixture-private-token-'.repeat(4),connection=path.join(root,'agent-mc-bridge/connection.json');
 writeFileSync(connection,JSON.stringify({protocol:'agent-mc-java/v1',endpoint:'http://127.0.0.1:12345',token}));
 const ready=await photoJourneyPreflight(root);assert.equal(ready.ready,true);assert.ok(!JSON.stringify(ready).includes(token));
 writeFileSync(connection,'{"token":"'+token+'",BROKEN');
 const invalid=await photoJourneyPreflight(root);assert.equal(invalid.ready,false);assert.ok(!JSON.stringify(invalid).includes(token));
});
test('absent camera directory is an explicit blocker, never a simulated ready state',async()=>{
 const result=await photoJourneyPreflight();assert.equal(result.ready,false);assert.equal(result.blockers.length,1);
});
test('worker hook saves exact supplied bytes once and rejects another owner',async t=>{
 const {directory}=fixture(t),job='be6ab292-5195-439b-8b71-c9c13e2d1d5c';
 const recorder=createPhotoJourneyRecorder({directory,owner,gameAddress:'127.0.0.1:25914',evidenceKind:'synthetic-fixture'});
 const supplied=Buffer.from('explicit non-photo fixture');
 await assert.rejects(recorder.onCapture({job,owner:'other',png:supplied}));
 await recorder.onCapture({job,owner,png:supplied,diagnostics:{fixture:true}});
 assert.deepEqual(readFileSync(path.join(directory,job+'.png')),supplied);
 await assert.rejects(recorder.onCapture({job,owner,png:supplied}));
 assert.equal(JSON.parse(readFileSync(path.join(directory,'run.json'))).evidenceKind,'synthetic-fixture');
});
