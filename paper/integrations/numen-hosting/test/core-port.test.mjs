import test from 'node:test';
import assert from 'node:assert/strict';
import {HarnessHubDriver,numenCorePort} from '../src/core-port.mjs';

const role={serverId:'test-server',roleUuid:'role-uuid',name:'TestRole'};
test('existing Hub runtime receives the exact shared-core client; stop is explicit',async()=>{
  let received,closed=0;const client={stop:async()=>closed++};
  const driver=new HarnessHubDriver({runtimes:{existing:{check:async()=>{},start:async value=>{received=value;return{stop:async()=>({stopped:true})};}}},
    createClient:async(r,port)=>{assert.equal(port,'same-numen-body');return client;}});
  await driver.prepare(role,'existing');await driver.start(role,{runtime:'existing',epoch:7,port:'same-numen-body'});
  assert.equal(received.client,client);assert.equal(received.epoch,7);
  assert.deepEqual(await driver.stop(role),{stopped:true});assert.equal(closed,1);
});
test('an unconfirmed Hub start cannot be discarded and started again',async()=>{
  const driver=new HarnessHubDriver({runtimes:{existing:{check:async()=>{},start:async()=>{throw Error('lost receipt');}}},createClient:async()=>({stop:async()=>{}})});
  await assert.rejects(driver.start(role,{runtime:'existing',epoch:7,port:{}}));
  assert.deepEqual(await driver.stop(role),{stopped:false});
  await assert.rejects(driver.start(role,{runtime:'existing',epoch:8,port:{}}),{code:'HARNESS_ALREADY_RUNNING'});
});
test('core port rejects stale-epoch calls before reaching the actual body',async()=>{
  let epoch=3,calls=0;const hosting={status:()=>({state:'ready',mode:'harness',epoch}),
    body:{observe:async()=>({ready:true,roleUuid:role.roleUuid,serverId:role.serverId})},call:async()=>{calls++;}};
  const port=numenCorePort(hosting,role,3);assert.equal((await port.connect()).uuid,role.roleUuid);
  epoch=4;await assert.rejects(port.call({id:'original-request',tool:'lua',args:{}}),{code:'CONTROL_CHANGED'});assert.equal(calls,0);
});
