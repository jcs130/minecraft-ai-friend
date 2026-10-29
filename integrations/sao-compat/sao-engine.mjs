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
  const SERVER_TOOLS=[
    {name:'mc_native',description:'Read this connection’s real mod state, inventory, menu or capabilities. Includes namespaced item IDs and complete ItemStack evidence. Read-only; does not click menus or change the body. Missing providers remain explicitly unavailable.',parameters:{type:'object',properties:{section:{type:'string',enum:['state','inventory','menu','capabilities']}},required:['section'],additionalProperties:false}},
    {name:'mc_protect',description:'Read the server’s current break/place rule for one absolute integer block coordinate within 64 blocks. deny/unknown never mean air or permission. This read does not change a block or load a chunk.',parameters:{type:'object',properties:{action:{type:'string',enum:['break','place']},x:{type:'integer'},y:{type:'integer'},z:{type:'integer'}},required:['action','x','y','z'],additionalProperties:false}}
  ];
  for(const tool of SERVER_TOOLS)tool.tags=['read'];
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
    createProtectionPort(bot,onReply){return bot.saoProtection??=(attachProtection(bot,onReply))}
  }
  class EngineWorld extends TacticalMinecraftWorld {
    createBridge(options){return new EngineBridge(options)}
    tools(){
      return [...super.tools().map(tool=>tool.name!=='mc_do'?tool:{...craftFenceDeclaration(tool),handler:(args,ctx)=>blockedCraft(args.steps)?unavailableCraft():tool.handler(args,ctx)}),...SERVER_TOOLS.filter(tool=>tool.name!=='mc_do').map(decl=>({...decl,handler:async args=>{
        const bot=this.bridge?.bot;
        if(!bot)return {text:JSON.stringify({status:'offline',reason:'body_not_connected'}),failed:true};
        await bot.nativeReady;
        if(decl.name==='mc_protect'){
          const value=await bot.saoProtection.check(args.action,String(bot.game.dimension),args,true);
          return {text:JSON.stringify(value)};
        }
        let value;
        switch(args.section){
          case 'state': value=await bot.native.snapshot();break;
          case 'inventory':value=await bot.native.call('menu.current',{});break;
          case 'menu':value=await bot.native.call('menu.current',{});break;
          case 'capabilities':value=await bot.native.operations();break;
          default:return {text:JSON.stringify({status:'invalid_arguments',field:'section',expected:['state','inventory','menu','capabilities']}),failed:true};
        }
        return {text:JSON.stringify(value),failed:value.ok===false};
      }}))];
    }
  }
  return {EngineBridge,EngineWorld,SERVER_TOOLS,createEngine:options=>new EngineWorld(options)};
}
