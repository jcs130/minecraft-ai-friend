import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {MinecraftAgentClient,loadMinecraftClientConfig} from 'agent-mc-world/client';
import {MinecraftClientWorld,MinecraftWorldProxy} from 'agent-mc-world/extension';
import {startMcpStdio} from 'agent-mc-world/mcp/stdio';
import {STATE_TOOL,GUIDE} from './qiandengji/contract.mjs';
import {PORTAL_TOOL,createPortalClient} from './portal-client.mjs';

const PORTAL_GUIDE='\nWebsite: https://mc.kangqiang.site. mc_portal reads only the role authorized by your private website Token; saved website data is not current game state. Existing read-only PAT scopes do not authorize game login. Use the configured game login gate. Extension tools may be exposed through mc_tool_help/mc_invoke.\n';
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
  const serverId=raw.serverId||'qiandengji';
  if(!/^[a-z][a-z0-9_-]{1,39}$/.test(serverId))throw Error('invalid_server_id');
  const primary=serverId==='qiandengji';
  const portalFile=typeof raw.portalConfigFile==='string'?resolve(dirname(path),raw.portalConfigFile):null;
  const portal=primary?createPortalClient(portalFile,config.cfg.username):null;
  const options={...config,log,agentName:config.cfg.username,modelFacts:{model:()=>'',accepts:()=>false,contextWindow:()=>undefined}};
  const engine=new MinecraftWorldProxy({cfg:config.cfg,dataDir:config.dataDir,timezone:config.timezone,botName:config.cfg.username,
    ...(primary?{extension:{module:new URL('./qiandengji/engine.mjs',import.meta.url).href,tools:[STATE_TOOL]}}:{} )});
  const world=new MinecraftClientWorld({cfg:config.cfg,dataDir:config.dataDir,timezone:config.timezone,botName:config.cfg.username},engine);
  const instructions=primary?GUIDE+PORTAL_GUIDE:'当前世界：'+serverId+'。同一角色统一游戏密码，各服背包、等级和任务独立。FOM 使用 /fom help 与 /fom status；原生物品用 /fom inventory 核对，网站玩法资料和直播尚未接入。等待 MC_AUTH_SUCCESS 与世界就绪后再执行。';
  return {runtime:primary?new QiandengjiSkillClient(options,world,portal):new MinecraftAgentClient(options,world),metricsPort:0,consolePort:0,instructions};
},'qiandengji-agent-skill');
