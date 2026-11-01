import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createNativeEnginePort} from './engine.mjs';

const configPath=process.argv[2];
if(!configPath||process.argv.length!==3)throw Error('Usage: node mcp.mjs <private-config.json>');
const raw=JSON.parse(readFileSync(configPath,'utf8'));
const runtimeDirectory=resolve(dirname(configPath),raw.adapter?.runtimeDirectory??'..');
const coreDirectory=dirname(fileURLToPath(import.meta.url));
const adapterDirectory=coreDirectory;
const requireCore=createRequire(resolve(coreDirectory,'package.json'));
const load=name=>import(pathToFileURL(requireCore.resolve(name)).href);
const {SERVER_TOOLS}=await createNativeEnginePort({runtimeDirectory,coreDirectory,adapterDirectory});
const {loadMinecraftClientConfig,MinecraftAgentClient}=await load('agent-mc-world/client');
const {MinecraftClientWorld}=await load('agent-mc-world/extension');
const {startMcpStdio}=await load('agent-mc-world/mcp/stdio');
await startMcpStdio((path,log)=>{
  const options=loadMinecraftClientConfig(path);
  if(options.cfg.version!=='26.3'||options.cfg.viewerPort!==0)throw Error('Native 26.3 requires version=26.3 and viewerPort=0; use the real Java client for visuals.');
  mkdirSync(options.dataDir,{recursive:true});
  const wrapper=resolve(options.dataDir,'native-engine.mjs');
  const source='import {createNativeEnginePort} from '+JSON.stringify(pathToFileURL(resolve(adapterDirectory,'engine.mjs')).href)+';\n'+
    'export const {createEngine}=await createNativeEnginePort('+JSON.stringify({runtimeDirectory,coreDirectory,adapterDirectory})+');\n';
  if(existsSync(wrapper)&&readFileSync(wrapper,'utf8')!==source)throw Error('Existing engine assembly differs; review it before replacing.');
  if(!existsSync(wrapper))writeFileSync(wrapper,source,{flag:'wx'});
  const world=new MinecraftClientWorld({cfg:options.cfg,dataDir:options.dataDir,timezone:options.timezone,botName:options.cfg.username,
    extension:{module:pathToFileURL(wrapper).href,tools:SERVER_TOOLS}});
  return {metricsPort:options.metricsPort,consolePort:options.consolePort,
    runtime:new MinecraftAgentClient({...options,agentName:options.cfg.username,log},world)};
},'minecraft-native263-mcp');
