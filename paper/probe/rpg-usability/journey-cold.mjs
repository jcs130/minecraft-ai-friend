/** Rejoin the exact prior non-OP identity after a normal QA JVM restart. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';import {installRecipePacketBypass} from '../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/vortex-takeover-20261027',label=process.argv[2];assert(/^[a-z0-9]{1,6}$/.test(label));assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const original=JSON.parse(await fs.readFile(stage+'/rpg-journey-'+label+'.json','utf8'));assert(original.passed&&original.identity.name.startsWith('ag_RUJ'));
const mf=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer'),report={checks:[],productionChanged:false};let last=0;
const until=async(f,n)=>{for(let end=Date.now()+25000;Date.now()<end;){if(f())return;await sleep(100);}throw Error(n);};
const check=(n,v)=>{assert(v,n);report.checks.push(n);console.log('PASS '+n);};
const b=mf.createBot({host:'127.0.0.1',port:25928,username:original.identity.name,version:'1.21.1',auth:'offline',hideErrors:true});b.messages=[];b.on('messagestr',s=>b.messages.push(s));b.on('error',()=>{});installRecipePacketBypass(b._client);
async function json(q,prefix='MC_RPG'){await sleep(Math.max(0,1150-(Date.now()-last)));last=Date.now();const at=b.messages.length;b.chat(q);await until(()=>b.messages.slice(at).some(s=>s.startsWith(prefix+' ')),q);return JSON.parse(b.messages.slice(at).find(s=>s.startsWith(prefix+' ')).slice(prefix.length+1));}
try{await until(()=>b.entity&&b.world.getColumnAt(b.entity.position),'spawn');b.physicsEnabled=false;await sleep(2500);
 check('original native UUID retained',b.player.uuid===original.identity.uuid);
 const status=await json('/mycli status --json');check('chosen profession survives cold restart',status.class==='knight');check('actual quest coins retained once',status.economy.balance===50);
 const quest=await json('/mycli tasks info qd_first_hunt --json');check('completed quest not reintroduced as available after restart',quest.state==='completed'&&quest.nextCommand==='/mycli tasks list');
 const g=await json('/mycli intro --json','MC_INTRO');check('unfinished craft remains a world action after restart',g.guide.requiresWorldAction&&g.nextAction.includes('持有旧装备')&&!g.nextCommand);
 const detail=await json('/mycli tasks info qd_field_kit --json');check('active exact objective still incomplete',detail.state==='active'&&detail.summary.includes('0/1'));report.passed=true;
}finally{await fs.writeFile(stage+'/rpg-journey-cold-'+label+'.json',JSON.stringify(report,null,2));b.quit();}
