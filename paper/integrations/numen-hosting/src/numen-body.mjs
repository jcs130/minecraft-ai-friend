import { PROTOCOL, fail } from './protocol.mjs';

// Uses an injected, authenticated Numen MCP session. It never opens a Minecraft
// socket, invokes create_companion, derives a UUID, or reads saved credentials.
// Production Numen must explicitly advertise this extension before activation.
export class NumenHostedBody {
  async message(role,value){
    const caps=this.decode(await (await this.session(role)).callTool({name:'hosted_body',arguments:{op:'capabilities',companion:role.roleUuid}}));
    if(caps.spectatorMessages!==true)throw fail('NUMEN_CHAT_NOT_INSTALLED','当前 Numen 尚未安装观众对话入口。',503);
    return this.rpc(role,'web_message',value);
  }
  async messageResult(role,id){return this.rpc(role,'web_message_result',{id});}
  async replies(role){return(await this.rpc(role,'web_replies')).replies;}
  constructor({sessionFor,admitRole}){this.sessionFor=sessionFor;this.admitRole=admitRole;this.sessions=new Map();}
  async session(role){
    const id=`${role.serverId}/${role.roleUuid}`;
    if(this.sessions.has(id))return this.sessions.get(id);
    let opened;
    const pending=(async()=>{
      const session=opened=await this.sessionFor(role);
      const catalog=await session.listTools();
      if(!catalog.tools?.some(t=>t.name==='hosted_body'))
        throw fail('NUMEN_HOSTING_NOT_INSTALLED','当前 Numen 尚未加载同 UUID 托管和控制租约扩展；不能退回普通召唤。',503);
      const probe=await session.callTool({name:'hosted_body',arguments:{op:'capabilities',companion:role.roleUuid}});
      const caps=this.decode(probe);
      if(caps.protocol!==PROTOCOL||caps.stableIdentity!==true||caps.serverFence!==true||caps.inputTimeout!==true
          ||caps.persistedReceipts!==true||!['paused','numen','harness','manual'].every(m=>caps.modes?.includes(m)))
        throw fail('NUMEN_HOSTING_INCOMPATIBLE','Numen 托管扩展不满足身份、停止确认或断线松键要求。',503);
      return session;
    })();
    this.sessions.set(id,pending);
    try{return await pending;}catch(error){this.sessions.delete(id);await opened?.close?.();throw error;}
  }
  decode(reply){
    // Numen MCP uses a single JSON text block; never parse prose as success.
    let value=reply?.structuredContent;
    if(!value&&reply?.content?.length===1&&reply.content[0].type==='text'){
      try{value=JSON.parse(reply.content[0].text);}catch{}
    }
    if(reply?.isError||!value||typeof value!=='object')throw fail('NUMEN_RECEIPT_INVALID','Numen 未返回结构化回执；保持暂停。',503);
    return value;
  }
  async rpc(role,op,args={}){
    const session=await this.session(role);
    try{return this.decode(await session.callTool({name:'hosted_body',arguments:{...args,op,companion:role.roleUuid,
      expectedName:role.name,expectedOwner:role.numenOwnerUuid,serverId:role.serverId}}));}
    catch(error){
      // A server restart invalidates scoped MCP tokens. Drop the failed session
      // so the next explicit query can reauthenticate; never replay this call.
      const id=`${role.serverId}/${role.roleUuid}`,pending=this.sessions.get(id);
      if(pending&&await pending.catch(()=>null)===session){this.sessions.delete(id);await session.close?.().catch(()=>{});}
      throw error;
    }
  }
  async attach(role,lease){await this.admitRole?.(role);return this.rpc(role,'attach',lease);}
  async prepare(role,mode){
    if(mode==='numen'){
      const caps=await this.rpc(role,'capabilities');
      if(caps.nativeModelReady!==true)throw fail('NUMEN_MODEL_UNAVAILABLE','先在 Numen 中配置此角色可用的模型档案并确认配额，再启用原生循环。',503);
    }
  }
  transition(role,lease){return this.rpc(role,'transition',lease);}
  release(role,lease){return this.rpc(role,'release',lease);}
  input(role,frame){return this.rpc(role,'input',frame);}
  call(role,request){return this.rpc(role,'call',request);}
  result(role,id){return this.rpc(role,'result',{id});}
  observe(role){return this.rpc(role,'observe');}
  catalog(role){return this.rpc(role,'catalog');}
  heartbeat(role,lease){return this.rpc(role,'heartbeat',lease);}
  async close(){await Promise.allSettled([...this.sessions.values()].map(async pending=>(await pending).close?.()));this.sessions.clear();}
}
