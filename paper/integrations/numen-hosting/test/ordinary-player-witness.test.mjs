import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {hostedBootstrapClient} from '../src/bootstrap-client.mjs';

const endpoint='http://127.0.0.1:19085/v1/hosted-role';
const role={roleUuid:randomUUID(),numenOwnerUuid:randomUUID(),ownerId:'site-account',serverId:'qa',name:'QaWitness'};
const scope={characterId:randomUUID(),requestId:randomUUID(),generation:4,expect:'saved'};

test('ordinary player observation signs the scope and obtains a nonce only when explicitly armed',async()=>{
  const controlKey=randomBytes(32), calls=[];
  const port=hostedBootstrapClient({endpoint,controlKey,fetcher:async(url,options)=>{
    assert.equal(url.href,endpoint);
    const envelope=JSON.parse(options.body);
    assert.equal(envelope.signature,createHmac('sha256',controlKey).update(envelope.payload).digest('base64url'));
    const request=JSON.parse(Buffer.from(envelope.payload,'base64url'));
    calls.push(request.op);
    assert.deepEqual([request.roleUuid,request.ownerUuid,request.name],[role.roleUuid,role.numenOwnerUuid,role.name]);
    for(const [key,value] of Object.entries(scope))assert.equal(request[key],value);
    return Response.json({roleUuid:role.roleUuid,uuid:role.roleUuid,...scope,online:false,saved:false,witnessed:false,kind:'offline',
      ...(request.op==='arm_player_witness'?{nonce:'a'.repeat(64),channel:'qiandengji:handoff'}:{})});
  }});
  assert.equal((await port.armPlayer(role,scope)).channel,'qiandengji:handoff');
  const read=await port.playerState(role,scope);
  assert.equal(read.saved,false);assert.equal(read.nonce,undefined);
  assert.deepEqual(calls,['arm_player_witness','player_state']);
});

test('a foreign, ambiguous or stale player witness cannot confirm a save',async()=>{
  const controlKey=randomBytes(32);
  const good={roleUuid:role.roleUuid,uuid:role.roleUuid,...scope,online:false,saved:true,witnessed:true,kind:'offline'};
  let reply;
  const port=hostedBootstrapClient({endpoint,controlKey,fetcher:async()=>Response.json(reply)});
  for(const change of [{characterId:randomUUID()},{generation:3},{requestId:randomUUID()},{uuid:randomUUID()},
    {online:true},{witnessed:false},{kind:'mineflayer'}]) {
    reply={...good,...change};
    await assert.rejects(port.playerState(role,scope),{code:'PLAYER_WITNESS_MISMATCH'});
  }
  await assert.rejects(port.armPlayer(role,{...scope,generation:0}),{code:'INVALID_PLAYER_WITNESS'});
});
