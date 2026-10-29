/** Private, persistent suggestion, selected models and skins, and reconnect. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/vortex-takeover-20261027';assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const label=process.argv[2];assert(/^[a-z0-9]{1,5}$/.test(label));const require=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');
const report={checks:[],errors:[],productionChanged:false},bots=[],states=new Map(),wait=ms=>new Promise(r=>setTimeout(r,ms));let timer;
async function until(fn,text,ms=25000){for(let end=Date.now()+ms;Date.now()<end;){if(await fn())return;await wait(100);}throw Error(text+' timeout');}
async function connect(name,model='default'){
 const b=require('mineflayer').createBot({host:'127.0.0.1',port:25928,username:name,auth:'offline',version:'1.21.1',hideErrors:true,checkTimeoutInterval:60000});bots.push(b);b.lines=[];
 b.on('messagestr',t=>b.lines.push(t));b.on('error',e=>report.errors.push(String(e)));installRecipePacketBypass(b._client);await until(()=>b.entity,'spawn');
 states.set(b._client.uuid,{playerUuid:b._client.uuid,entityId:b.entity.id,available:true,modelId:model});return b;
}
const hints=b=>b.lines.filter(t=>t.includes('[外观]'));
try{
 const witness=await connect('ag_HSee'+label,'custom_test');const target=await connect('ag_Hint'+label);const skin=await connect('ag_HSkin'+label);
 const refresh=async()=>fs.writeFile(stage+'/appearance-test-state.json',JSON.stringify({source:'freesia_worker',writtenAt:Date.now(),players:[...states.values()]}));await refresh();timer=setInterval(()=>refresh().catch(e=>report.errors.push(String(e))),700);
 skin.chat('/skin set afu_link');await until(async()=>{try{return JSON.parse(await fs.readFile(stage+'/plugins/SkinsRestorer/players/'+skin._client.uuid+'.player','utf8')).skinIdentifier.identifier==='afu_link';}catch{return false;}},'chosen ordinary skin saved');
 await until(()=>hints(target).length===1,'one private default suggestion');
 assert(hints(target)[0].includes('/skins')&&hints(target)[0].includes('/appearance list'));report.checks.push('default agent receives both self-selection paths');
 await wait(1800);assert.equal(hints(witness).length,0);report.checks.push('custom YSM is not mistaken for default');
 assert.equal(hints(skin).length,0);report.checks.push('selected ordinary skin is respected');
 assert.equal(hints(target).length,1);report.checks.push('message is private, no broadcast to witness');
 const name=target.username;target.quit();await wait(700);const again=await connect(name);await wait(17000);
 assert.equal(hints(again).length,0);report.checks.push('saved once-per-role flag survives reconnect');
}catch(e){report.errors.push(e.stack);}finally{clearInterval(timer);for(const b of bots)b.quit();await wait(400);await fs.writeFile(stage+'/appearance-hint-'+label+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
process.exit(report.errors.length?1:0);
