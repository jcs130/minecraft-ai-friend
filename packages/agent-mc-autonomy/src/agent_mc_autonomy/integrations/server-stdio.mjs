/** Headless composition uses the same body and optional server engine as the viewer. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serverEnginePort } from './server-engine-port.mjs';
import { managedRuntime } from './managed-runtime.mjs';
const config = JSON.parse(readFileSync(process.argv[2],'utf8'));
const cfg = config.serverEngineIntegration;
const require = createRequire(resolve(cfg.packageDirectory,'package.json'));
const load = name=>import(pathToFileURL(require.resolve(name)).href);
const {Bridge} = await load('agent-mc-world/extension');
const {TacticalMinecraftWorld} = await load('agent-mc-world/tactics');
const port = await serverEnginePort(cfg,{World:TacticalMinecraftWorld,Bridge});
if (!port) throw Error('Explicit server engine is required');
const {startMcpStdio} = await load('agent-mc-world/mcp/stdio');
const {MinecraftAgentClient,loadMinecraftClientConfig} = await load('agent-mc-world/client');
const {MinecraftClientWorld} = await load('agent-mc-world/extension');
await startMcpStdio((path,log)=>{
 const options=loadMinecraftClientConfig(path);
 const world=new MinecraftClientWorld({cfg:options.cfg,dataDir:options.dataDir,timezone:options.timezone,botName:options.cfg.username,
   extension:{module:pathToFileURL(port.module).href,tools:port.SERVER_TOOLS}});
 return managedRuntime(config.bodyHandoffDevice,options,bodyHandoff=>
   new MinecraftAgentClient({...options,bodyHandoff,log,agentName:options.cfg.username,
     modelFacts:{model:()=>'',accepts:mime=>options.acceptsImages&&mime.startsWith('image/'),contextWindow:()=>undefined}},world),log);
},'minecraft-server-mcp');
