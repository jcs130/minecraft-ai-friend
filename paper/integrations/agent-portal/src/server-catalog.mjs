import { createHash } from 'node:crypto';
const fail=(status,reason,message)=>Object.assign(Error(message),{status,reason});
export const DEFAULT_SERVER='qiandengji';
const validId=id=>typeof id==='string'&&/^[a-z][a-z0-9_-]{1,39}$/.test(id);
function address(value){
 if(typeof value!=='string'||value.length>253||!/^([A-Za-z0-9][A-Za-z0-9.-]*):([0-9]{1,5})$/.test(value))throw Error('INVALID_GAME_SERVER_ADDRESS');
 const port=Number(value.slice(value.lastIndexOf(':')+1));if(port<1||port>65535)throw Error('INVALID_GAME_SERVER_PORT');return value;
}
/** Configuration-owned catalogue. Never resolve an arbitrary URL/module supplied by a request. */
export class ServerCatalog{
 constructor(config){
  const defaults={id:DEFAULT_SERVER,name:'千灯纪',description:'Paper RPG 与长期生活世界',core:'Paper',version:'1.21.1',state:'open',
   addresses:{mineflayer:config.publicGameAddress,java:config.publicGameAddress},loginAuthority:'LoginGuard',minPasswordLength:6,
   guide:{help:'/mycli help',status:'/mycli status'},adapter:'vanilla-mineflayer'};
  const supplied=config.gameServers||[];if(!Array.isArray(supplied)||supplied.length>32)throw Error('INVALID_GAME_SERVER_CATALOG');
  this.entries=new Map();
  for(const raw of [defaults,...supplied]){
   if(!validId(raw.id)||this.entries.has(raw.id))throw Error('DUPLICATE_OR_INVALID_SERVER_ID');
   if(typeof raw.name!=='string'||!raw.name||raw.name.length>80||!['open','testing','preparing','closed'].includes(raw.state))throw Error('INVALID_GAME_SERVER');
   if(!['Paper','NeoForge','Fabric','Forge','Other'].includes(raw.core)||!/^\d+\.\d+(?:\.\d+)?$/.test(raw.version))throw Error('INVALID_GAME_SERVER_RUNTIME');
   if(!Number.isInteger(raw.minPasswordLength)||raw.minPasswordLength<6||raw.minPasswordLength>64)throw Error('INVALID_GAME_PASSWORD_POLICY');
   const addresses={};for(const kind of ['java','mineflayer','bedrock'])if(raw.addresses?.[kind])addresses[kind]=address(raw.addresses[kind]);
   if(!addresses.mineflayer)throw Error('AGENT_GAME_ADDRESS_REQUIRED');
   const guide={};for(const key of ['help','status']){const value=raw.guide?.[key];if(typeof value!=='string'||!value.startsWith('/')||value.length>120)throw Error('SERVER_GUIDE_REQUIRED');guide[key]=value;}
   this.entries.set(raw.id,Object.freeze({...raw,addresses:Object.freeze(addresses),guide:Object.freeze(guide)}));
  }
 }
 get(id=DEFAULT_SERVER){const row=this.entries.get(id);if(!row)throw fail(404,'SERVER_NOT_FOUND','这个游戏世界尚未接入，请从世界目录选择。');return row;}
 requireOpen(id){const r=this.get(id);if(r.state==='preparing')throw fail(409,'WORLD_COMING_SOON','这个世界尚未正式开放，敬请期待。请先加入千灯纪。');if(r.state==='closed')throw fail(409,'WORLD_CLOSED','这个世界暂未开放，请选择其他世界。');return r;}
 public(id){const r=this.get(id),joinable=['open','testing'].includes(r.state);return {id:r.id,name:r.name,description:r.description||'',core:r.core,version:r.version,state:r.state,joinable,addresses:joinable?r.addresses:{},
  loginAuthority:r.loginAuthority||'server-native',minPasswordLength:r.minPasswordLength,guide:joinable?r.guide:{},adapter:r.adapter||'native-mineflayer',
  progressScope:'server',identityScope:'website-owner',passwordPolicy:'shared-per-character'};}
 list(){return [...this.entries.keys()].map(id=>this.public(id));}
 roleId(serverId,uuid){this.get(serverId);return createHash('sha256').update(serverId+':'+uuid).digest('hex').slice(0,24);}
}
