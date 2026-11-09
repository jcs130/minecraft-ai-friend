import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createTurnCredentials} from '../src/play-rtc-runtime.mjs';
import {createPlayRtcGateway} from '../src/play-rtc-gateway.mjs';
const args={secret:'fixture-only-secret-not-a-real-key-123456',urls:['turn:relay.invalid:35128?transport=udp'],scope:'owner:session',now:1800000000000};
test('TURN credentials are expiring, scoped, stable within quota bucket and never contain shared secret',()=>{
 const a=createTurnCredentials(args),b=createTurnCredentials({...args,now:args.now+1000});
 assert.deepEqual(a,b);assert.equal(a.iceTransportPolicy,'relay');assert.ok(a.expiresAt>args.now);assert.ok(a.expiresAt<=args.now+3600000);
 const ice=a.iceServers[0];assert.equal(ice.credential,createHmac('sha1',args.secret).update(ice.username).digest('base64'));
 assert.ok(!JSON.stringify(a).includes(args.secret));assert.notEqual(createTurnCredentials({...args,scope:'other-owner'}).iceServers[0].username,ice.username);
});
test('relay capabilities never mint browser credentials for anonymous or mismatched bodies',()=>{
 let issued=0;const g=createPlayRtcGateway({runtime:{requiresOwner:true,browserConfiguration:()=>{issued++;return{iceServers:[]}}}});
 assert.throws(()=>g.capabilities(),/OWN_PLAY_REQUIRED/);
 const row={portal:{owner:{id:'a'}},id:'session',play:{ownerId:'b',authorized:true,identityMatches:()=>true}};
 assert.throws(()=>g.capabilities(row),/OWN_PLAY_REQUIRED/);assert.equal(issued,0);
 row.play.ownerId='a';g.capabilities(row);assert.equal(issued,1);
});
test('TURN configuration rejects URL credentials, non-TURN destinations and unbounded expiry',()=>{
 for(const urls of [['https://relay.invalid'],['turn:user:password@relay.invalid:3478?transport=udp']])assert.throws(()=>createTurnCredentials({...args,urls}));
 assert.throws(()=>createTurnCredentials({...args,ttlSeconds:86400}));
});
