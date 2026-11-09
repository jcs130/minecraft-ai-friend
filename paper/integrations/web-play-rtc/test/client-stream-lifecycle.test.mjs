import test from 'node:test';import assert from 'node:assert/strict';
import {createPlayRtcClient} from '../public/play-rtc-client.mjs';
test('ending a partial world stream terminates control rather than mixing the next snapshot',async()=>{
 let peer,closed=0;const lost=[];
 class Peer{
  constructor(){peer=this;this.channels=new Map();this.iceGatheringState='complete';this.localDescription={type:'offer',sdp:'fixture'};}
  createDataChannel(name){const c={readyState:'open',bufferedAmount:0,send(){}};this.channels.set(name,c);return c;}
  async createOffer(){return this.localDescription;}
  async setLocalDescription(){this.channels.get('qd.play.control').onmessage({data:JSON.stringify({schemaVersion:1,kind:'clock',token:'fixture'})});}
  async setRemoteDescription(){}
  close(){closed++;}
 }
 const client=createPlayRtcClient({Peer,offer:async()=>({answer:{type:'answer',sdp:'fixture'}}),onLost:r=>lost.push(r)});
 assert.equal(await client.connect(),true);
 const stop=client.subscribeWorld(()=>assert.fail('partial event is not a snapshot'),()=>{});
 peer.channels.get('qd.play.world').onmessage({data:new TextEncoder().encode('data: {"partial":')});
 stop();assert.equal(closed,1);assert.equal(client.status().ready,false);assert.deepEqual(lost,['WORLD_SUBSCRIPTION_ENDED']);
 assert.equal(client.subscribeWorld(()=>{},()=>{}),null);assert.equal((await client.action({type:'primary'})).status,'not_sent');
});
