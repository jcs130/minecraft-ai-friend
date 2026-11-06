import { fail } from './protocol.mjs';

// Implements agent-mc-world's public NumenBodyPort. The shared MC client keeps
// its journal, request/turn IDs and host protocol; Numen keeps its body queue.
export function numenCorePort(hosting, role, epoch) {
  const check=()=>{
    const state=hosting.status(role);
    if(state.state!=='ready'||state.mode!=='harness'||state.epoch!==epoch)
      throw fail('CONTROL_CHANGED','这轮 Harness 已失去控制权，请停止旧决定。');
    return state;
  };
  const outcome=receipt=>({text:receipt.message??`请求 ${receipt.id}：${receipt.state}。`,
    ...(['blocked','cancelled','unknown'].includes(receipt.state)?{failed:true}:{}),
    meta:{backend:'numen',requestId:receipt.id,state:receipt.state},data:receipt});
  return{
    identity:{server:role.serverId,uuid:role.roleUuid,name:role.name},
    async connect(){check();const state=await hosting.body.observe(role);
      return{server:state.serverId,uuid:state.roleUuid,ready:state.ready===true};},
    // Coordinator already fenced the body before stopping the MC client; a late
    // client's close must never release a newer browser's lease.
    async disconnect(){},
    async observe(signal){check();signal?.throwIfAborted();const state=await hosting.body.observe(role);check();
      return{text:state.text,sampledAt:state.sampledAt,uuid:state.roleUuid,server:state.serverId};},
    async catalog(signal){check();signal?.throwIfAborted();const result=await hosting.body.catalog(role);check();return result.tools;},
    async call({id,tool,args,signal}){
      check();signal?.throwIfAborted();return outcome(await hosting.call(role,{id,tool,args,epoch}));
    },
    async result(id,signal){signal?.throwIfAborted();return outcome(await hosting.reconcile(role,id));}
  };
}

// Configured runtimes are existing Hub/Router integrations, not arbitrary shell
// commands from a browser. Their adapter supplies a shared-core client factory.
export class HarnessHubDriver {
  constructor({runtimes,createClient}){this.runtimes=new Map(Object.entries(runtimes));this.createClient=createClient;this.running=new Map();}
  async prepare(role,id){
    if(!this.runtimes.has(id))throw fail('HARNESS_NOT_CONFIGURED','此 Harness 尚未由服务器配置，请选择可用项目。',400);
    await this.runtimes.get(id).check(role);
  }
  async start(role,{runtime,epoch,port}){
    const key=`${role.serverId}/${role.roleUuid}`;
    if(this.running.has(key))throw fail('HARNESS_ALREADY_RUNNING','原 Harness 尚未停止。');
    if(!port)throw fail('CORE_PORT_REQUIRED','必须提供绑定同一身体的 MC 核心端口。',503);
    const instance={client:null,run:null,startUnknown:false,runtime:this.runtimes.get(runtime),epoch};this.running.set(key,instance);
    try{
      instance.client=await this.createClient(role,port,epoch);
      instance.startUnknown=true;
      instance.run=await instance.runtime.start({role,epoch,client:instance.client});
      if(!instance.run||typeof instance.run.stop!=='function')throw fail('HARNESS_START_UNKNOWN','Harness 未返回可核验的停止接口。');
      instance.startUnknown=false;
    }catch(error){
      // Retain failed starts until stop confirms cleanup; deleting this record
      // could otherwise start another loop while the first still holds a tool.
      throw error;
    }
  }
  async stop(role){
    const key=`${role.serverId}/${role.roleUuid}`,instance=this.running.get(key);
    if(!instance)return{stopped:true};
    if(instance.startUnknown){
      if(!instance.runtime.stopUnknown)return{stopped:false};
      const result=await instance.runtime.stopUnknown({role,epoch:instance.epoch});
      if(result?.stopped!==true)return{stopped:false};
    }
    if(instance.run){const receipt=await instance.run.stop();if(receipt?.stopped!==true)return{stopped:false};}
    if(instance.client)await instance.client.stop();
    this.running.delete(key);return{stopped:true};
  }
  alive(role){const instance=this.running.get(`${role.serverId}/${role.roleUuid}`);return !!instance?.run&&!instance.startUnknown&&(instance.run.alive?.()??true);}
}
