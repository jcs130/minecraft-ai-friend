import {expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {startModernViewer} from '../core/modern-viewer.ts';
import {viewerBot,freeViewerPort} from './fixtures/viewer-bot.ts';

it('starts a 1.21.4 viewer without a prebuilt pack, bootstraps the actual registry and never controls or reconnects its body',async()=>{
  const root=await mkdtemp(join(tmpdir(),'mc-viewer-compat-'));
  const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
  const version='1.21.1',client='/* fixture browser */',worker='/* fixture worker */',jar='a'.repeat(64);
  let handle:Awaited<ReturnType<typeof startModernViewer>>|undefined;
  try{
    for(const file of ['dist/modern-viewer.js','public/mesher.js','public/mesherWasm.js','public/threeWorker.js',
      `public/blocksStates/${version}.json`,`public/textures/${version}.png`,'render-assets/blockStatesModels.json',
      'render-assets/blocksAtlases.json','render-assets/itemsAtlases.json']){
      await mkdir(dirname(join(root,file)),{recursive:true});
      await writeFile(join(root,file),file==='dist/modern-viewer.js'?client:file==='public/mesher.js'?worker:'{}');
    }
    await writeFile(join(root,'viewer-assets.json'),JSON.stringify({minecraftVersion:version}));
    await writeFile(join(root,'public/asset-source.json'),JSON.stringify({minecraftVersion:version,clientJarSha256:jar}));
    await writeFile(join(root,'viewer-client.json'),JSON.stringify({minecraftVersion:version,clientJarSha256:jar,
      browserBundleSha256:hash(client),mesherSha256:hash(worker),runtimeRegistryVersion:1,preset:null}));
    const old=join(root,'old-config');await mkdir(old);
    await writeFile(join(old,'viewer-assets.json'),JSON.stringify({minecraftVersion:version}));
    await writeFile(join(old,'viewer-client.json'),JSON.stringify({minecraftVersion:version}));
    const {bot}=viewerBot('1.21.4');
    handle=await startModernViewer(bot as never,{assetsDir:old,fallbackAssetsDir:root,port:await freeViewerPort(),remoteTextures:false});
    expect(handle.resources).toEqual({mode:'compatible',requestedVersion:'1.21.4',assetVersion:'1.21.1'});
    const response=await fetch(handle.url+'/');expect(response.status).toBe(200);
    const html=await response.text();expect(html.indexOf('/viewer-runtime.js')).toBeLessThan(html.indexOf('/index.js'));
    const scope:Record<string,any>={};
    runInNewContext(await (await fetch(handle.url+'/viewer-runtime.js')).text(),{globalThis:scope});
    expect(scope.__MC_VIEWER_REGISTRY__.data.version.minecraftVersion).toBe('1.21.4');
    expect(scope.__MC_VIEWER_RESOURCE_INFO__).toEqual(handle.resources);
    expect(JSON.stringify(scope)).not.toContain(root);
    expect(await (await fetch(handle.url+'/mesher.js')).text()).toBe('importScripts("/viewer-runtime.js");\n'+worker);
    expect((await fetch(handle.url+'/blocksStates/1.21.4.json')).status).toBe(200);
    expect(await (await fetch(handle.url+'/healthz')).json()).toMatchObject({ok:true,version:'1.21.4',resources:handle.resources});
    // Optional painting records, fonts, item icons and audio are deliberately absent.
    expect((await fetch(handle.url+'/fonts/not-provided.json')).status).toBe(404);
  }finally{
    await handle?.close();
    expect(dirname(root)).toBe(resolve(tmpdir()));expect(root.split(/[\\/]/).at(-1)).toMatch(/^mc-viewer-compat-/);
    await rm(root,{recursive:true,force:true});
  }
});
