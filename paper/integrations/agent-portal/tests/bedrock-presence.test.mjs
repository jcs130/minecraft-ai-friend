import test from 'node:test';
import assert from 'node:assert/strict';
import {bedrockPresence,readBedrockPresence} from '../scripts/bedrock-presence.mjs';
const uuid='00000000-0000-0000-0009-00000d9f9c7b';
const paper=`There are 2 players online: ag_Example (12345678-1234-4234-8234-123456789abc), .Example (${uuid})`;
test('Geyser English/Chinese session names intersect exact current Paper Floodgate UUIDs',()=>{
 for(const reply of ['Online players (1): Example','§e在线玩家 (1): §fExample\n'])assert.deepEqual(bedrockPresence(reply,paper),[{name:'.Example',playerUuid:uuid,source:'Geyser.live-session'}]);
});
test('a dotted nickname, arbitrary UUID or static absent record never establishes a Bedrock session',()=>{
 assert.deepEqual(bedrockPresence('Online players (0):',paper),[]);
 assert.deepEqual(bedrockPresence('Online players (1): Other',paper),[]);
 assert.deepEqual(bedrockPresence('Online players (1): Example',paper.replace(uuid,'12345678-1234-4234-8234-123456789abc')),[]);
 assert.deepEqual(bedrockPresence('Online players (1): Example',paper.replace(uuid,'00000000-0000-0000-0000-000000000000')),[]);
 assert.deepEqual(bedrockPresence('Online players (2): Example',paper),[]);
});
test('Bedrock name normalization matches configured Floodgate behavior without accepting guessed prefixes',()=>{
 const row=paper.replace('.Example ','.Example_Name ');
 assert.equal(bedrockPresence('Online players (1): Example Name',row).length,1);
 assert.deepEqual(bedrockPresence('Online players (1): Example Name',row,{replaceSpaces:false}),[]);
 assert.throws(()=>bedrockPresence('Online players (1): Example',paper,{usernamePrefix:'ag_'}));
});
test('presence collection runs only two fixed read-only commands and no owner operation',async()=>{
 const calls=[];const result=await readBedrockPresence({},async command=>{calls.push(command);return command==='geyser list'?'Online players (1): Example':paper});
 assert.deepEqual(calls,['geyser list','minecraft:list uuids']);assert.equal(result.players[0].playerUuid,uuid);assert.ok(Date.now()-result.observedAt<1000);
});
