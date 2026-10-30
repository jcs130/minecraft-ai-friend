// Run in a disposable image without production volumes or credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=process.env.QD_PORTAL_ROOT??'/app';
const {loadConfig}=await import(pathToFileURL(root+'/src/config.mjs'));
const {createPortal}=await import(pathToFileURL(root+'/src/server.mjs'));
const {packageReleases,packageAt}=await import(pathToFileURL(root+'/src/download-catalog.mjs'));
const data='/tmp/maid-download-qa-'+randomUUID();await fs.mkdir(data+'/game/logs',{recursive:true});
const base='https://qiandengji-downloads-hk-20261023.oss-cn-hongkong.aliyuncs.com/releases/';
const config=loadConfig({skipLocalConfig:true,host:'127.0.0.1',port:0,dataDir:data+'/data',serverDir:data+'/game',emailAuth:{registrationMode:'username'},downloads:{baseUrl:base,enabledPackages:packageReleases.map(p=>p.id)}});
const game={cached:async(_key,_ttl,fn)=>fn(),roster:async()=>[],serverSummary:async()=>({online:false,playersOnline:0})};
const portal=createPortal(config,{game});let checks=0;
const check=(value)=>{assert(value);checks++;};
try{
 await new Promise(resolve=>portal.server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+portal.server.address().port;
 const catalog=await(await fetch(origin+'/api/v1/downloads')).json();check(catalog.packages.some(p=>p.id==='maids-client-pack'&&p.available));check(catalog.packages.some(p=>p.id==='maids-client-mods'&&p.available));
 for(const alias of ['/downloads/maid-client','/downloads/maid-mods']){
  const row=packageAt(alias);check(!!row);
  for(const method of ['GET','HEAD']){
   const response=await fetch(origin+alias+'?token=isolated-test-only',{method,redirect:'manual'});
   check(response.status===307);check(response.headers.get('location')===base+row.sha256+'/'+row.filename);
   check(response.headers.get('x-checksum-sha256')===row.sha256);check(response.headers.get('referrer-policy')==='no-referrer');check((await response.arrayBuffer()).byteLength===0);
  }
 }
 const page=await(await fetch(origin+'/downloads.html')).text();check(page.includes('id="maid-client"'));check(page.includes('NeoForge'));check(page.includes('原版 Java、现有 Fabric、Mineflayer 和基岩版仍可进服'));
 const session=await(await fetch(origin+'/api/v1/session')).json();check(session.owner===null);
 console.log(JSON.stringify({passed:true,checks,productionVolumesUsed:false,accountRequired:false}));
}finally{await portal.close();}
