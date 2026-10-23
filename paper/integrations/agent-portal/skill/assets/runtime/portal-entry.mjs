import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {MinecraftAgentClient,loadMinecraftClientConfig} from 'agent-mc-world/client';
import {MinecraftClientWorld,MinecraftWorldProxy} from 'agent-mc-world/extension';
import {startMcpStdio} from 'agent-mc-world/mcp/stdio';
import {STATE_TOOL,GUIDE} from './qiandengji/contract.mjs';
import {PORTAL_TOOL,createPortalClient} from './portal-client.mjs';

const PORTAL_GUIDE='\n网站资料用实际公布的 mc_portal 按需查询；仅限私有 Token 授权的角色。保存资料不是游戏现场，网站 Token 不能代替游戏密码或授权。\n';
class QiandengjiSkillClient extends MinecraftAgentClient {
  constructor(options,world,portal){super(options,world);this.portal=portal;}
  tools(){return [...super.tools(),{...PORTAL_TOOL,handler:args=>this.portal.read(args)}];}
  async environment(){return (await super.environment())+'\n'+GUIDE+PORTAL_GUIDE;}
  async call(name,args,options={},signal){
    if(name!=='mc_portal')return super.call(name,args,options,signal);
    try{return {text:JSON.stringify(await this.portal.read(args,{signal:typeof options==='object'?options.signal:signal}))};}
    catch(error){const message=error instanceof Error?error.message:'portal_read_failed';return {text:JSON.stringify({available:false,reason:/^[a-z0-9_]+$/.test(message)?message:'portal_read_failed',gameLoginAuthorized:false}),failed:true};}
  }
}
await startMcpStdio((path,log)=>{
  const config=loadMinecraftClientConfig(path),raw=JSON.parse(readFileSync(path,'utf8'));
  const portalFile=typeof raw.portalConfigFile==='string'?resolve(dirname(path),raw.portalConfigFile):null;
  const portal=createPortalClient(portalFile,config.cfg.username);
  const options={...config,log,agentName:config.cfg.username,modelFacts:{model:()=>'',accepts:()=>false,contextWindow:()=>undefined}};
  const engine=new MinecraftWorldProxy({cfg:config.cfg,dataDir:config.dataDir,timezone:config.timezone,botName:config.cfg.username,
    extension:{module:new URL('./qiandengji/engine.mjs',import.meta.url).href,tools:[STATE_TOOL]}});
  const world=new MinecraftClientWorld({cfg:config.cfg,dataDir:config.dataDir,timezone:config.timezone,botName:config.cfg.username},engine);
  return {runtime:new QiandengjiSkillClient(options,world,portal),metricsPort:0,consolePort:0,instructions:GUIDE+PORTAL_GUIDE};
},'qiandengji-agent-skill');
