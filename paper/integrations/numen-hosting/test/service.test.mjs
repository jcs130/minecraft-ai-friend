import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {startHostingService} from '../src/service.mjs';
import {PROTOCOL} from '../src/protocol.mjs';
const role=n=>({ownerId:'owner',serverId:'isolated',roleUuid:`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`,numenOwnerUuid:'00000000-0000-0000-0000-000000000099',name:'HostedTest'+n});
const waitFor=async check=>{const until=Date.now()+10000;while(!check()){if(Date.now()>until)throw new Error('Timed out waiting for maintenance evidence');await new Promise(r=>setTimeout(r,20));}};
test('an unresponsive role does not starve others and a late heartbeat cannot revoke a new controller',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'hosted-service-'));let service,release;
  t.after(async()=>{release?.();await service?.close();await rm(directory,{recursive:true,force:true});});
  const beats=new Map();let oldHeartbeat;
  const sessionFor=async selected=>({listTools:async()=>({tools:[{name:'hosted_body'}]}),close:async()=>{},
    async callTool({arguments:a}){
      let response={protocol:PROTOCOL,bodyKind:'numen',roleUuid:selected.roleUuid,name:selected.name,serverId:selected.serverId,
        fenced:true,ready:true,mode:a.mode??'paused',epoch:a.epoch};
      if(a.op==='capabilities')response={protocol:PROTOCOL,stableIdentity:true,serverFence:true,inputTimeout:true,persistedReceipts:true,modes:['paused','numen','harness','manual']};
      if(a.op==='heartbeat'){
        beats.set(selected.roleUuid,(beats.get(selected.roleUuid)??0)+1);
        if(selected.roleUuid===role(1).roleUuid&&!oldHeartbeat){
          oldHeartbeat=new Promise((_,reject)=>{release=()=>reject(new Error('old-generation transport failure'));});
          await oldHeartbeat;
        }
      }
      return{structuredContent:response};
    }});
  service=await startHostingService({database:join(directory,'host.sqlite'),dataRoot:directory,coreDirectory:resolve('../../../packages/agent-mc-world'),
    port:0,grantKey:randomBytes(32),serviceKey:randomBytes(32),sessionFor});
  await service.hosting.attach(role(1));await service.hosting.attach(role(2));
  await waitFor(()=>(beats.get(role(2).roleUuid)??0)>=2);
  assert.equal(beats.get(role(1).roleUuid),1);
  const active=await service.hosting.switch(role(1),'manual',{controllerId:'new-browser'});release();
  await new Promise(r=>setTimeout(r,100));
  const actual=service.hosting.status(role(1));assert.equal(actual.mode,'manual');assert.equal(actual.epoch,active.epoch);assert.equal(actual.state,'ready');
});
