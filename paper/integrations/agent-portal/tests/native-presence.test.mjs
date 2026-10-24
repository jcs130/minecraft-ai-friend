import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {GameData,freshNativePresence} from '../src/game-data.mjs';
import {WorldView} from '../src/world-view.mjs';
const uuid='12345678-1234-4234-8234-123456789abc';
const record=now=>({name:'ag_Native',uuid,kind:'agent',source:'Numen.live-owner-tag',nativeOnline:true,nativeObservedAt:now});
test('only a current live Numen census establishes positive native presence',()=>{
 const now=Date.now(),row=record(now);
 assert.equal(freshNativePresence(row,now),true);
 assert.equal(freshNativePresence({...row,nativeObservedAt:now-45000},now),true);
 for(const change of [{nativeObservedAt:now-60001},{nativeObservedAt:now+1001},{nativeObservedAt:undefined},{nativeOnline:false},{kind:'player'},{source:'Numen.CompanionRegistry'}])assert.equal(freshNativePresence({...row,...change},now),false);
});
async function roster(row,cacheUuid=uuid){
 const now=Date.now(),config={serverDir:path.resolve('no-real-server'),agentRegistry:path.resolve('pairs.json'),authHeartbeat:path.resolve('heartbeat.json'),portalIdentitiesFile:path.resolve('identities.json'),publicRoster:[],hiddenPlayers:[],includeKnownPlayers:true};
 const game=new GameData(config,'test',async()=>({sample:[{name:'Anonymous Player',uuid:'00000000-0000-0000-0000-000000000000'}],observedAt:new Date(now).toISOString()}));
 game.document=async file=>({data:file.endsWith('usercache.json')?[{name:row.name,uuid:cacheUuid}]:file===config.authHeartbeat?{ready:true,at:now,authorizedNames:[]}:file===config.portalIdentitiesFile?{identities:[row]}:null});
 return (await game.roster()).find(r=>r.name===row.name);
}
test('anonymous ping entry does not hide an independently verified live Numen UUID',async()=>{
 const row=await roster(record(Date.now()));
 assert.equal(row.online,true);assert.equal(row.authenticated,null);assert.equal(row.playerUuid,uuid);assert.equal(row.statusSource,'Numen.live-owner-tag');
 assert.equal(new WorldView({},{}).online(row),true);
});
test('stale census and static registry never make a native body online',async()=>{
 for(const change of [{nativeObservedAt:Date.now()-61000},{source:'Numen.CompanionRegistry'},{nativeOnline:false}]){
  const row=await roster({...record(Date.now()),...change});assert.equal(row.online,false);assert.equal(new WorldView({},{}).online(row),false);
 }
});
test('native evidence cannot cross UUID conflicts or authenticate ordinary Java roles',async()=>{
 const conflict=await roster(record(Date.now()),'22345678-1234-4234-8234-123456789abc');assert.equal(conflict.playerUuid,null);assert.notEqual(conflict.online,true);
 const ordinary=await roster({...record(Date.now()),source:'Paper.usercache',kind:'player'});assert.equal(ordinary.authenticated,false);assert.equal(new WorldView({},{}).online(ordinary),false);
});
test('even a live native identity never overrides an explicit authentication rejection at the web gate',()=>{
 const row={online:true,authenticated:false,statusSource:'Numen.live-owner-tag',identitySource:'Numen.live-owner-tag'};
 assert.equal(new WorldView({},{}).online(row),false);
});

test('verified live Geyser session is a player, without fabricating Java authorization',async()=>{
 const bedrockUuid='00000000-0000-0000-0009-00000d9f9c7b';
 const record={name:'.Example',uuid:bedrockUuid,kind:'player',source:'Geyser.live-session',nativeOnline:true,nativeObservedAt:Date.now()};
 const row=await roster(record,bedrockUuid);
 assert.equal(row.kind,'player');assert.equal(row.online,true);assert.equal(row.authenticated,null);assert.equal(row.statusSource,'Geyser.live-session');
 assert.equal(new WorldView({},{}).online(row),true);
 for(const change of [{nativeObservedAt:Date.now()-60001},{nativeOnline:false},{source:'Paper.usercache'},{name:'Example'},{uuid}])assert.equal(freshNativePresence({...record,...change}),false);
 const gate=new WorldView({},{});
 for(const change of [{authenticated:false},{identitySource:'Paper.usercache'},{statusSource:'minecraft.server-list-ping.uuid'},{kind:'agent'},{playerUuid:uuid}])assert.equal(gate.online({...row,...change}),false);
});
