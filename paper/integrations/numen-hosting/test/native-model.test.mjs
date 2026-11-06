import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {nativeByokAdapter} from '../src/native-model.mjs';
const role={serverId:'test',ownerId:'owner',roleUuid:'00000000-0000-4000-a000-000000000001',numenOwnerUuid:'00000000-0000-4000-a000-000000000002',name:'HostedTest'};
const catalogue={providers:[{id:'custom',connection:{base_url:'https://fixed.invalid/v1',protocol:'chat'},models:[{id:'fixed-model'}]}]};
test('native binding signs exact role and reviewed endpoint, uses only own key and confirms revocation',async()=>{
  const controlKey=randomBytes(32);let bound,stopped=false;
  const adapter=nativeByokAdapter({catalogue,controlKey,body:{async rpc(selected,op,envelope){assert.equal(selected,role);
    if(op==='capabilities')return{isolatedModels:true};
    assert.equal(envelope.signature,createHmac('sha256',controlKey).update(envelope.payload).digest('base64url'));
    const request=JSON.parse(Buffer.from(envelope.payload,'base64url'));assert.equal(request.roleUuid,role.roleUuid);assert.equal(request.ownerUuid,role.numenOwnerUuid);
    if(op==='model_bind'){bound=request;return{isolatedByok:true,model:'fixed-model',bindingId:request.bindingId};}
    assert.equal(request.bindingId,bound.bindingId);stopped=true;return{stopped:true,bindingId:request.bindingId};
  }}});
  const lease=await adapter.bind({role,profile:{provider:'custom',model:'fixed-model',goal:'探险'},apiKey:'synthetic-own-key'});
  assert.equal(bound.apiKey,'synthetic-own-key');assert.equal(bound.profile.base_url,'https://fixed.invalid/v1');assert.equal(lease.ownerId,'owner');
  assert.equal((await lease.close()).stopped,true);assert.equal(stopped,true);
});
