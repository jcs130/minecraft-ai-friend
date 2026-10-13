import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it,vi} from 'vitest';
import {loadViewerRelay} from '../core/relay-port.ts';
it('loads compiled SDK, constructs and discovers tools, and reads current facts with all outbound network denied',()=>{
  const directory=mkdtempSync(join(tmpdir(),'mc-no-network-'));
  try {
    const entry=new URL('../dist/runtime/src/index.js',import.meta.url).href;
    const result=execFileSync(process.execPath,['--import',new URL('./fixtures/deny-network.mjs',import.meta.url).href,
      '--import',new URL('./fixtures/deny-cortico.mjs',import.meta.url).href,'--input-type=module','-e',`
      const {MinecraftAgentClient,MINECRAFT_CLIENT_DEFAULTS,nullLogger}=await import(${JSON.stringify(entry)});
      const client=new MinecraftAgentClient({cfg:structuredClone(MINECRAFT_CLIENT_DEFAULTS),dataDir:${JSON.stringify(directory)},log:nullLogger()});
      client.tools();client.currentFacts();await client.environment();await client.disconnect();
      await new Promise(r=>setTimeout(r,100));console.log(client.status().phase);`],
      {encoding:'utf8',env:{...process.env,MINECRAFT_CLIENT_ONLY:'1'}});
    expect(result.trim()).toBe('disconnected');
  }finally{rmSync(directory,{recursive:true,force:true});}
});
it('does not load or probe a performance service unless both endpoint and module are explicit',async()=>{
  const fetchCall=vi.fn(()=>{throw new Error('network');});vi.stubGlobal('fetch',fetchCall);
  try {
    expect(await loadViewerRelay(undefined,'bot')).toBeUndefined();
    expect(await loadViewerRelay({module:'',endpoint:''},'bot')).toBeUndefined();
    await expect(loadViewerRelay({module:'https://module.invalid',endpoint:'http://endpoint.invalid'},'bot')).rejects.toThrow('local');
    const compiled=new URL('../dist/runtime/core/relay-port.js',import.meta.url).href;
    const relayUrl=new URL('../dist/runtime/bridges/performance/relay.mjs',import.meta.url).href;
    execFileSync(process.execPath,['--import',new URL('./fixtures/deny-network.mjs',import.meta.url).href,'--input-type=module','-e',`
      const {loadViewerRelay}=await import(${JSON.stringify(compiled)});
      const relay=await loadViewerRelay({module:${JSON.stringify(relayUrl)},endpoint:'http://explicit.invalid:7000'},'bot');
      relay.close();`]);
    expect(fetchCall).not.toHaveBeenCalled();
    const source=readFileSync(fileURLToPath(new URL('../bridges/performance/relay.mjs',import.meta.url)),'utf8');
    expect(source).not.toMatch(/779[23456]|const PORTS/);
  }finally{vi.unstubAllGlobals();}
});
