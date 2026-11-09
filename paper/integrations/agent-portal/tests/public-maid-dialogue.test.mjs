import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePublicDialogue,publicDialogueSource} from '../src/public-dialogue.mjs';
const data={schemaVersion:1,maidUuid:'11111111-1111-4111-8111-111111111111',ownerName:'ag_Example',name:'肥鱼',dimension:'minecraft:aincrad',operationId:'near_original_1',text:'前面有怪物，先检查护甲。',delivered:1};
const line=value=>'[20:05:06] [Server thread/INFO]: [QiandengjiMaidBridge] QD_PUBLIC_MAID '+JSON.stringify(value);
test('only a delivered original maid public line enters the conversation as its own speaker',()=>{
 const row=parsePublicDialogue(line(data),'2026-11-09');
 assert.ok(row);assert.equal(row.source,'minecraft.maid-nearby-chat');assert.equal(row.playerName,'ag_Example');
 assert.equal(row.title,'肥鱼（女仆·艾恩葛朗特） 说');assert.equal(row.body,data.text);
 assert.equal(row.eventIdentity,'maid:'+data.maidUuid+':'+data.operationId);
 assert.equal(publicDialogueSource(row),true);
 assert.equal(publicDialogueSource({...row,source:'plugin.private-chat'}),false);
});

test('real Youer plugin logger envelope retains public speech while other logger identities stay excluded',()=>{
 const actual='[22:21:47] [Server thread/INFO] [QiandengjiMaidBridge]: QD_PUBLIC_MAID '+JSON.stringify(data);
 assert.equal(parsePublicDialogue(actual,'2026-11-09').source,'minecraft.maid-nearby-chat');
 assert.equal(parsePublicDialogue(actual.replace('[QiandengjiMaidBridge]','[OtherPlugin]'),'2026-11-09'),null);
 assert.equal(parsePublicDialogue(actual.replace('[Server thread/INFO]','[Arbitrary worker/INFO]'),'2026-11-09'),null);
 assert.equal(parsePublicDialogue(actual.replace(JSON.stringify(data),JSON.stringify({...data,delivered:0})),'2026-11-09'),null);
});
test('commands, private replies, malformed identities and zero listeners never become maid speech',()=>{
 for(const patch of [{delivered:0},{delivered:-1},{delivered:9999},{schemaVersion:2},{maidUuid:'not-an-entity'},{ownerName:'not an account'},{operationId:'../operation'},{dimension:'../../private'},{text:'/login never-publish-test'},{text:'我的密码是 never-publish-test'},{text:'MC_AUTH_SUCCESS authenticated'},{text:'Bearer never-publish-test'},{name:'bad\nname'}])assert.equal(parsePublicDialogue(line({...data,...patch}),'2026-11-09'),null);
 for(const prefix of ['[SomePlugin] ','[私聊] '])assert.equal(parsePublicDialogue('[20:05:06] [Server thread/INFO]: '+prefix+'QD_PUBLIC_MAID '+JSON.stringify(data),'2026-11-09'),null);
 const quoted=parsePublicDialogue('[20:05:06] [Server thread/INFO]: <ag_Example> QD_PUBLIC_MAID '+JSON.stringify(data),'2026-11-09');
 assert.equal(quoted.source,'minecraft.public-chat');assert.equal(quoted.playerName,'ag_Example');assert.equal(quoted.eventIdentity,undefined);
 assert.equal(parsePublicDialogue('[20:05:06] [Arbitrary worker/INFO]: [QiandengjiMaidBridge] QD_PUBLIC_MAID '+JSON.stringify(data),'2026-11-09'),null);
});
