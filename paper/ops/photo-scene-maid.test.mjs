import test from 'node:test';import assert from 'node:assert/strict';
import {captureNativeScene,readSceneArchive} from './photo-scene-archive.mjs';
import {readSceneArchive as portalRead} from '../integrations/agent-portal/src/viewer/photo-scene-archive.mjs';
const id='11111111-1111-3111-8111-111111111111',maidId='22222222-2222-3222-8222-222222222222';
async function capture(change={}){
 const identity={uuid:id,server:'127.0.0.1:29999'},base={...identity,protocol:'agent-mc-visual/v1',minecraftVersion:'1.21.1',epoch:id,sampledAt:1},zero=Buffer.alloc(2048).toString('base64');
 const actor={id:1,uuid:id,name:'minecraft:player',position:[0,64,0]},maid={id:2,uuid:maidId,name:'touhou_little_maid:maid',position:[1,64,0],maidModel:'authors_and_credits:wine_fox_maid',nativeEntity:true,...change};
 const frame={...base,source:'same_java_client_world',dimension:'minecraft:overworld',self:actor,entities:[maid],columns:[{x:0,z:0,revision:1}]};
 return captureNativeScene({identity,job:{job:id,world:id,owner:id,entityId:1,mode:'third',x:0,y:64,z:3,yaw:0,pitch:0},image:{sha256:'a'.repeat(64),width:1280,height:1280},radius:0,now:()=>1,
 rpc:async method=>method==='visual_frame'?frame:method==='visual_registry'?{...base,registry:{blocks:[{id:0,name:'minecraft:air',properties:{}}],biomes:[{id:0,name:'minecraft:plains'}]}}:{...base,x:0,z:0,revision:1,minY:0,height:16,sections:'AA==',skyLight:[zero],blockLight:[zero]}});
}
test('native maid identity and selected appearance survive the real capture and portal archive readers',async()=>{
 const result=await capture();for(const reader of [readSceneArchive,portalRead]){const read=await reader(result.bytes);const row=read.frame.entities[0];assert.equal(row.name,'touhou_little_maid:maid');assert.equal(row.maidModel,'authors_and_credits:wine_fox_maid');assert.equal(row.nativeEntity,true);assert.equal(read.coverage.completeSceneParityVerified,false);}
});
test('native maid appearance metadata does not accept arbitrary text or an Allay mapping',async()=>{
 for(const change of [{maidModel:'../../private'},{maidModel:'https://example.org/model'},{name:'minecraft:allay'},{nativeEntity:false}])await assert.rejects(capture(change),/MAID_MODEL/);
});
