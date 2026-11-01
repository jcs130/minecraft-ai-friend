import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

/** The shared core remains the sole scheduler, queue, lease and request ledger. */
export async function createNativeEnginePort({runtimeDirectory,coreDirectory,adapterDirectory}) {
  const core=createRequire(resolve(coreDirectory,'package.json'));
  const load=name=>import(pathToFileURL(core.resolve(name)).href);
  const {Bridge}=await load('agent-mc-world/extension');
  const {TacticalMinecraftWorld}=await load('agent-mc-world/tactics');
  const adapter=createRequire(resolve(adapterDirectory,'create_bot.cjs'));
  const {createBot}=adapter('./create_bot.cjs');
  const {NATIVE_TOOL,nativeRead}=adapter('./native_tools.cjs');
  class NativeBridge extends Bridge {
    createBot(options){return createBot({...options,runtime:runtimeDirectory})}
  }
  class NativeWorld extends TacticalMinecraftWorld {
    createBridge(options){return new NativeBridge(options)}
    tools(){return [...super.tools(),{...NATIVE_TOOL,handler:async args=>({text:JSON.stringify(nativeRead(this.bridge?.bot,args))})}]}
  }
  return {SERVER_TOOLS:[NATIVE_TOOL],NativeBridge,NativeWorld,createEngine:options=>new NativeWorld(options)};
}
