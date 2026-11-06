import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Consume the shared core's public build and its existing MCP implementation.
// There is no second tool schema, model loop or Minecraft socket here.
export async function coreClientFactory({coreDirectory,dataRoot}){
  const root=resolve(coreDirectory),require=createRequire(join(root,'package.json'));
  const core=await import(pathToFileURL(join(root,'dist/runtime/src/client/index.js')));
  const {createMinecraftMcpServer}=await import(pathToFileURL(join(root,'dist/runtime/src/mcp/server.js')));
  const {Client}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')));
  const {InMemoryTransport}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/inMemory.js')));
  const manifest=require('./package.json');
  if(!core.NumenClientWorld)throw new Error('The supplied MC core has no Numen body port');
  return async(role,port,epoch)=>{
    const realm=createHash('sha256').update(role.serverId).digest('hex');
    const directory=join(resolve(dataRoot),realm,role.roleUuid,'core');await mkdir(directory,{recursive:true});
    const runtime=new core.MinecraftAgentClient({cfg:{...structuredClone(core.MINECRAFT_CLIENT_DEFAULTS),
      host:role.serverId,port:25565,username:role.name,auth:'offline',memoryAgentId:role.roleUuid},
      dataDir:directory,log:core.nullLogger()},new core.NumenClientWorld(port));
    const server=createMinecraftMcpServer(runtime,manifest.version);
    const client=new Client({name:'numen-hosted-harness',version:'0.1.0'});
    const [front,back]=InMemoryTransport.createLinkedPair();
    try{await server.connect(back);await client.connect(front);}
    catch(error){await runtime.disconnect();await server.close();throw error;}
    return{role,epoch,runtime,mcp:client,async stop(){try{await runtime.disconnect();}finally{await client.close();await server.close();}}};
  };
}
