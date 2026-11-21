import {mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {HostingStore} from './store.mjs';
import {HostedRoles} from './hosting.mjs';
import {NumenHostedBody} from './numen-body.mjs';
import {HarnessHubDriver} from './core-port.mjs';
import {coreClientFactory} from './core-client.mjs';
import {hostingServer} from './http.mjs';
import {fail} from './protocol.mjs';
import {HostedProfiles} from './profiles.mjs';
import {HostedConversations} from './conversations.mjs';
import {BodyHandoffCoordinator,BodyHandoffStore} from './body-handoff.mjs';
import {numenHandoffAdapter} from './player-body-handoff.mjs';
import {combinedBodyHandoffAdapters} from './native-entity-handoff.mjs';
import {bodyHandoffTool} from './body-handoff-tool.mjs';

/** Operator supplies scoped MCP transport and configured existing runtimes.
 * Never discovers credentials, creates a game login or resumes actions at boot. */
export async function startHostingService({database,sessionFor,admitRole,grantKey,serviceKey,port=19084,
  coreDirectory,dataRoot,runtimes=()=>({}),modelProfiles,voice,combatAttention,bodyHandoff,onProblem=()=>{}}){
  if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid loopback port');
  await mkdir(dirname(resolve(database)),{recursive:true});
  const store=new HostingStore(resolve(database)),body=new NumenHostedBody({sessionFor,admitRole});
  let hosting,handoff,timer,closed=false;
  const maintaining=new Map();
  let handoffStore;
  const selected=role=>handoffStore?.forNativeBody(role.roleUuid);
  const bodyControl=role=>{
    const row=selected(role);
    if(row&&(row.active_kind!=='numen'||row.status!=='ready'))
      throw fail('BODY_HANDOFF_CONTROL_CHANGED','此角色目前不能由 Numen 提交新动作。');
  };
  const checkControl=(role,epoch)=>{
    const state=hosting.status(role);
    if(state.state!=='ready'||state.mode!=='harness'||state.epoch!==epoch)throw fail('CONTROL_CHANGED','旧 Harness 已失去控制权。');
  };
  let harness,http;
  try{
    if(bodyHandoff)handoffStore=new BodyHandoffStore(store.db);
    harness=new HarnessHubDriver({runtimes:runtimes(checkControl),createClient:await coreClientFactory({
      coreDirectory,dataRoot,checkControl,combatAttention:combatAttention?{...combatAttention,onProblem}:null,
      bodyTools:(role,epoch)=>{
        const row=selected(role);
        if(!row||row.autonomous!==1)return [];
        const binding=JSON.parse(row.bindings).find(value=>value.kind==='numen');
        if(!binding)return [];
        const controller={characterId:row.character_id,kind:'numen',bodyId:binding.bodyId,generation:row.generation};
        const authority={ownerId:row.owner_id};
        return [bodyHandoffTool({handoff,controller,authority,assertDriver:()=>checkControl(role,epoch)})];
      },
    })});
    if(modelProfiles&&(!Buffer.isBuffer(modelProfiles.key)||modelProfiles.key.length!==32))throw new Error('A separate 32-byte hosting vault key is required');
    if(modelProfiles&&(modelProfiles.key.equals(grantKey)||modelProfiles.key.equals(serviceKey)))throw new Error('Vault key must be separate from transport and grant keys');
    const profiles=modelProfiles?new HostedProfiles({store,...modelProfiles,
      adapters:typeof modelProfiles.adapters==='function'?modelProfiles.adapters(body,store):modelProfiles.adapters}):null;
    hosting=new HostedRoles({store,body,harness,profiles,bodyControl});
    if(bodyHandoff){
      const {registrations,adapters={},numen,custodyProvider,deviceBroker}=bodyHandoff;
      if(!Array.isArray(registrations))throw new Error('Missing operator body registration');
      const ports={};
      const combinedPorts={};
      handoff=new BodyHandoffCoordinator({store:handoffStore,onProblem,adapters:ports,combinedAdapters:combinedPorts});
      Object.assign(ports, typeof adapters === 'function' ? await adapters({handoff,hosting}) : adapters);
      if(numen)ports.numen=numenHandoffAdapter({hosting,...numen});
      if(custodyProvider)Object.assign(combinedPorts,combinedBodyHandoffAdapters(custodyProvider,ports));
      for(const registration of registrations){
        if(registration.combinedCustody&&[registration.active,...registration.targets].some(body=>!combinedPorts[body.kind])){
          throw new Error('Combined body custody requires an installed controller for each registered body');
        }
        handoffStore.register(registration);
      }
      handoffStore.markInterrupted();
      deviceBroker?.attach(handoff);
    }
    const conversations=new HostedConversations({store,hosting,body,voice});
    http=hostingServer({hosting,conversations,bodyHandoff:handoff,deviceBroker:bodyHandoff?.deviceBroker,grantKey,serviceKey});
    const address=await http.listen(port);
    const maintain=()=>{
      if(closed)return;
      // Each role has its own in-flight job. One unresponsive role cannot
      // suppress the next round of heartbeats for all the other roles.
      for(const row of store.rows()){
        if(row.state!=='ready'||hosting.locks.has(row.id)||maintaining.has(row.id))continue;
        const operation=(async()=>{
          const role=JSON.parse(row.binding);
          try{
            await hosting.expire(row.id);
            if(store.get(row.id).epoch!==row.epoch||hosting.locks.has(row.id))return;
            if(row.mode==='harness'&&!harness.alive(role))throw fail('HARNESS_EXITED','Harness 已退出，身体将暂停。');
            const beat=await body.heartbeat(role,{boot:hosting.boot,epoch:row.epoch});
            if(row.mode==='numen'&&beat.modelProblem){
              const code=beat.modelProblem==='llm.unauthorized'?'MODEL_API_KEY_REJECTED':beat.modelProblem==='llm.rate_limited'?'MODEL_QUOTA_OR_RATE_LIMIT':'MODEL_CALL_FAILED';
              throw fail(code,'用户模型调用失败，已暂停；请检查自己的 Key、配额或所选模型，不会使用共享模型。',503);
            }
          }catch(error){
            // Failure from an old heartbeat cannot revoke a newer controller.
            if(store.get(row.id).epoch!==row.epoch||hosting.locks.has(row.id))return;
            store.state(row.id,row.epoch,'recovery_required',error.code??'HEARTBEAT_FAILED');
            try{await hosting.switch(role,'paused');}catch{}
            const paused=store.get(row.id);if(paused.state==='ready'&&paused.mode==='paused')store.state(row.id,paused.epoch,'ready',error.code??'HEARTBEAT_FAILED');
            await harness.stop(role).catch(()=>{});
            onProblem({roleUuid:role.roleUuid,code:error.code??'HEARTBEAT_FAILED'});
          }
        })().catch(()=>onProblem({roleUuid:row.uuid,code:'MAINTENANCE_FAILED'})).finally(()=>maintaining.delete(row.id));
        maintaining.set(row.id,operation);
      }
    };
    timer=setInterval(()=>{try{maintain();}catch{onProblem({code:'MAINTENANCE_FAILED'});}},2000);
    return{hosting,conversations,bodyHandoff:handoff,address,async close(){
      let unconfirmed=false;
      closed=true;clearInterval(timer);http.server.closeAllConnections();await new Promise(resolve=>http.server.close(resolve));
      await handoff?.close();
      await Promise.allSettled([...maintaining.values()]);
      for(const row of store.rows())if(row.state!=='detached'){
        const role=JSON.parse(row.binding);
        try{await hosting.switch(role,'paused');}catch{unconfirmed=true;onProblem({roleUuid:role.roleUuid,code:'STOP_UNCONFIRMED'});}
        try{if((await harness.stop(role))?.stopped!==true)unconfirmed=true;}catch{unconfirmed=true;}
      }
      await body.close();store.close();
      if(unconfirmed)throw fail('STOP_UNCONFIRMED','后台已退出，但有身体未确认暂停；等待服务端租约到期并核对状态，不能自动恢复。',503);
    }};
  }catch(error){clearInterval(timer);await body.close();store.close();throw error;}
}
