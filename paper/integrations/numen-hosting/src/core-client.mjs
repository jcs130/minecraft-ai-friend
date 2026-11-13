import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Consume the shared core's public build and its existing MCP implementation.
// There is no second tool schema, model loop or Minecraft socket here.
export async function coreClientFactory({coreDirectory,dataRoot,combatAttention,checkControl}){
  const root=resolve(coreDirectory),require=createRequire(join(root,'package.json'));
  const core=await import(pathToFileURL(join(root,'dist/runtime/src/client/index.js')));
  const {createMinecraftMcpServer}=await import(pathToFileURL(join(root,'dist/runtime/src/mcp/server.js')));
  const {Client}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')));
  const {InMemoryTransport}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/inMemory.js')));
  const manifest=require('./package.json');
  if(!core.NumenClientWorld)throw new Error('The supplied MC core has no Numen body port');
  const combat=combatAttention
    ?await import(pathToFileURL(join(root,'dist/runtime/src/decisions/index.js'))):null;
  if(combat&&typeof core.NumenClientWorld.prototype.combatFrame!=='function')
    throw new Error('The supplied MC core has no Numen battlefield support');
  return async(role,port,epoch)=>{
    const realm=createHash('sha256').update(role.serverId).digest('hex');
    const directory=join(resolve(dataRoot),realm,role.roleUuid,'core');await mkdir(directory,{recursive:true});
    const world=new core.NumenClientWorld(port);
    const runtime=new core.MinecraftAgentClient({cfg:{...structuredClone(core.MINECRAFT_CLIENT_DEFAULTS),
      host:role.serverId,port:25565,username:role.name,auth:'offline',memoryAgentId:role.roleUuid},
      dataDir:directory,log:core.nullLogger()},world);
    const server=createMinecraftMcpServer(runtime,manifest.version);
    const client=new Client({name:'numen-hosted-harness',version:'0.1.0'});
    const [front,back]=InMemoryTransport.createLinkedPair();
    try{await server.connect(back);await client.connect(front);}
    catch(error){await runtime.disconnect();await server.close();throw error;}
    const attention=combat?combatObserver({combat,settings:combatAttention,world,runtime,role,epoch,checkControl}):null;
    return{role,epoch,runtime,mcp:client,attention,async stop(){
      attention?.stop();
      try{await runtime.disconnect();}finally{await client.close();await server.close();}
    }};
  };
}

function combatObserver({combat,settings,world,runtime,role,epoch,checkControl}){
  const lifetime=new AbortController();
  const cfg={enabled:true,mode:'shadow',connection:'host',selectionMode:'single',
    minIntervalMs:4000,timeoutMs:1500,maxAgeMs:2500};
  const {endpoint,model,apiKeyEnv,token,onProblem}=settings;
  const decisions=combat.createHttpDecisionPort(()=>({endpoint,model,apiKeyEnv,timeoutMs:cfg.timeoutMs}),
    {secret:()=>token,signal:lifetime.signal});
  let lastUnavailableAt=0;
  const driver=new combat.HostCombatDriver(()=>({hostDecisions:{combat:cfg}}),{
    decisions,
    attentionInShadow:true,
    async call(args,signal){
      if(args.battlefield!==true)throw new Error('Hosted combat attention only accepts battlefield reads');
      const frame=await world.combatFrame(epoch,signal);
      return {text:'Numen battlefield',meta:{protocol:'agent-mc-tactics/v1',frame}};
    },
    async attention(evidence){
      lifetime.signal.throwIfAborted();
      const frame=await world.combatFrame(epoch,lifetime.signal);
      if(!frame||frame.battlefield.connectionGeneration!==evidence.connectionGeneration
        ||frame.battlefield.dimension!==evidence.world
        ||Math.hypot(...frame.battlefield.self.position.map((n,i)=>n-evidence.position[i]))>1.5
        ||evidence.threats.some(threat=>!frame.battlefield.actors.some(actor=>
          actor.entityId===threat.entityId&&actor.nativeReference===threat.nativeReference)))return false;
      lifetime.signal.throwIfAborted();
      checkControl?.(role,epoch);
      await runtime.journal.pushEvent(combat.combatAttentionEvent(evidence,'minecraft'),{trigger:'debounce'});
    },
    report(event){
      if(!['unavailable','error','attention-delivery-error'].includes(event)||Date.now()-lastUnavailableAt<60000)return;
      lastUnavailableAt=Date.now();
      onProblem?.({roleUuid:role.roleUuid,code:'COMBAT_ATTENTION_UNAVAILABLE'});
    }
  });
  return{start:()=>driver.start(),stop(){lifetime.abort();driver.stop();}};
}
