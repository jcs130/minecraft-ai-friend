import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Explicit server extension; the shared core still owns the only queue and connection lifecycle. */
export async function createSAOEnginePort({ root, packageDirectory, adapterDirectory }) {
  const requireCore=createRequire(resolve(packageDirectory,'package.json'));
  const load=name=>import(pathToFileURL(requireCore.resolve(name)).href);
  const {Bridge,MINECRAFT_TOOL_DECLS}=await load('agent-mc-world/extension');
  const {TacticalMinecraftWorld}=await load('agent-mc-world/tactics');
  const requireAdapter=createRequire(resolve(adapterDirectory,'package.json'));
  const {createSAOBot}=requireAdapter('./sao_bot.cjs');
  const {attachProtection}=requireAdapter('./protection-client.cjs');
  const {blockedCraft,craftFenceDeclaration,fenceVanillaRecipes,unavailableCraft}=requireAdapter('./craft-fence.cjs');
  const {attachSaoGameplay}=requireAdapter('./sao-client.cjs');
  const {SAO_TOOL,executeSaoTool}=requireAdapter('./sao-tools.cjs');
  const {NATIVE_READ_TOOL,executeNativeRead}=requireAdapter('./native-read-tool.cjs');
  const SERVER_TOOLS=[
    NATIVE_READ_TOOL,
    {name:'mc_protect',description:'Read the server’s current break/place rule for one absolute integer block coordinate within 64 blocks. deny/unknown never mean air or permission. This read does not change a block or load a chunk.',parameters:{type:'object',properties:{action:{type:'string',enum:['break','place']},x:{type:'integer'},y:{type:'integer'},z:{type:'integer'}},required:['action','x','y','z'],additionalProperties:false}}
  ];
  for(const tool of SERVER_TOOLS)tool.tags=['read'];
  SERVER_TOOLS.push(SAO_TOOL);
  const coreDo=MINECRAFT_TOOL_DECLS.find(tool=>tool.name==='mc_do');
  if(!coreDo)throw Error('missing_core_do_contract');
  SERVER_TOOLS.push(craftFenceDeclaration(coreDo));
  class EngineBridge extends Bridge {
    constructor(options) {
      let instance;
      super({...options,protectionPreflight:()=>true,onSpawn:()=>{
        const bot=instance?.bot;if(!bot)return;
        bot.nativeReady.then(()=>{if(instance.bot===bot){fenceVanillaRecipes(bot);options.onSpawn()}},()=>{});
      }});instance=this;
    }
    createBot(options){return createSAOBot({root,username:options.username,botOptions:options})}
    attachServerProtocols(bot){bot.sao=attachSaoGameplay(bot)}
    createProtectionPort(bot,onReply){return bot.saoProtection??=(attachProtection(bot,onReply))}
  }
  class EngineWorld extends TacticalMinecraftWorld {
    createBridge(options){return new EngineBridge(options)}
    tools(){
      const base=super.tools(),doTool=base.find(tool=>tool.name==='mc_do');
      return [...base.map(tool=>tool.name!=='mc_do'?tool:{...craftFenceDeclaration(tool),handler:(args,ctx)=>blockedCraft(args.steps)?unavailableCraft():tool.handler(args,ctx)}),...SERVER_TOOLS.filter(tool=>tool.name!=='mc_do').map(decl=>({...decl,handler:async (args,ctx)=>{
        const bot=this.bridge?.bot;
        if(!bot)return {text:JSON.stringify({status:'offline',reason:'body_not_connected'}),failed:true};
        await bot.nativeReady;
        if(decl.name==='mc_sao')return executeSaoTool(bot.sao,args,ctx,(input,context)=>doTool.handler(input,context));
        if(decl.name==='mc_protect'){
          const value=await bot.saoProtection.check(args.action,String(bot.game.dimension),args,true);
          return {text:JSON.stringify(value)};
        }
        return executeNativeRead(bot,args);
      }}))];
    }
  }
  return {EngineBridge,EngineWorld,SERVER_TOOLS,createEngine:options=>new EngineWorld(options)};
}
