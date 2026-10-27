/** Real signed skin delivery through the existing commands, loopback QA only. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/vortex-takeover-20261027';assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const require=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json'),mf=require('mineflayer'),bots=[];
const label=process.argv[2]??'skins';assert(/^[a-z0-9]+$/.test(label));
const wait=ms=>new Promise(r=>setTimeout(r,ms)),report={checks:[],errors:[],productionChanged:false};
async function until(f,label){for(let i=0;i<150;i++){if(await f())return;await wait(100);}throw Error(label+' timed out');}
async function connect(username){
 const b=mf.createBot({host:'127.0.0.1',port:25928,username,auth:'offline',version:'1.21.1',hideErrors:true,checkTimeoutInterval:60000});bots.push(b);b.profiles=[];b.messages=[];
 b.on('messagestr',s=>b.messages.push(s));b.on('error',e=>report.errors.push(String(e)));b.on('kicked',r=>report.errors.push(JSON.stringify(r)));b._client.on('packet',(data,meta)=>{if(meta.name.startsWith('player_info'))b.profiles.push(JSON.stringify(data));});installRecipePacketBypass(b._client);
 await until(()=>b.entity,username+' spawn');return b;
}
try{
 const witness=await connect('ag_SkinSee'+label);
 const ops=JSON.parse(await fs.readFile(stage+'/ops.json','utf8'));
 const hot='afu_link_hot_'+label,hotPath=stage+'/plugins/SkinsRestorer/skins/'+hot+'.customskin';
 const original=JSON.parse(await fs.readFile(stage+'/plugins/SkinsRestorer/skins/afu_link.customskin','utf8'));
 await fs.writeFile(hotPath,JSON.stringify({...original,skinName:hot}),{flag:'wx'});
 report.checks.push('new public preset added after plugin startup');
 for(const[index,preset]of ['afu_link','afu_samus','afu_frog_girl',hot].entries()){
  const b=await connect('ag_Skin'+label+index);assert(!ops.some(o=>o.name===b.username));await wait(1300);
  const signed=JSON.parse(await fs.readFile(stage+'/plugins/SkinsRestorer/skins/'+preset+'.customskin','utf8'));
  b.chat('/skin set '+preset);
  await until(async()=>{try{return JSON.parse(await fs.readFile(stage+'/plugins/SkinsRestorer/players/'+b._client.uuid+'.player','utf8')).skinIdentifier.identifier===preset;}catch{return false;}},'saved self skin '+preset);
  report.checks.push('self selection persisted '+preset);
  await until(()=>witness.profiles.some(s=>s.includes(b._client.uuid)&&s.includes(signed.value)),'signed profile '+preset);report.checks.push('second vanilla client received exact signed property '+preset);
  report.checks.push('no operator grant '+b.username);
 }
}catch(e){report.errors.push(e.stack);}finally{
 for(const b of bots)b.quit();await wait(500);await fs.writeFile(stage+'/skin-gallery-receipt-'+label+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}process.exit(report.errors.length?1:0);
