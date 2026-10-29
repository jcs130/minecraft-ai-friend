// Cold-started operated catalogue: no upstream examples or inaccessible realms.
import fs from 'node:fs/promises';import {createRequire} from 'node:module';import assert from 'node:assert/strict';
import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/vortex-takeover-20261027';assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const require=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json'),wait=ms=>new Promise(r=>setTimeout(r,ms));let bot;const report={checks:[],errors:[],messages:[],productionChanged:false};
try{
 bot=require('mineflayer').createBot({host:'127.0.0.1',port:25928,username:'ag_Profile30',auth:'offline',version:'1.21.1',checkTimeoutInterval:60000,hideErrors:true});installRecipePacketBypass(bot._client);bot.on('messagestr',s=>report.messages.push(s));bot.on('error',e=>report.errors.push(String(e)));
 await Promise.race([new Promise(r=>bot.once('spawn',r)),wait(25000).then(()=>{throw Error('spawn timeout');})]);await wait(1400);bot.chat('/mycli tasks list --json');
 for(let i=0;i<100&&!report.messages.some(s=>s.startsWith('MC_RPG '));i++)await wait(100);
 const row=JSON.parse(report.messages.find(s=>s.startsWith('MC_RPG ')).slice(7));const ids=row.quests.map(q=>q.id);assert.equal(ids.length,8);assert(ids.includes('qd_first_hunt')&&ids.includes('qd_floor_clear'));report.checks.push('cold live registry contains exactly eight operated quests');
 assert(!ids.some(id=>['gathering_basics','realm_warden','daily_hunt'].includes(id)));report.checks.push('unconfigured upstream examples are not reintroduced');
 const file=await fs.readFile(stage+'/plugins/VortexRPG/quests.yml','utf8');assert.match(file,/resource-version: 2/);report.checks.push('authored resource version survives cold migration');
}catch(e){report.errors.push(e.stack);}finally{bot?.quit();await wait(400);await fs.writeFile(stage+'/catalogue-'+process.argv[2]+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks,errors:report.errors}));}process.exit(report.errors.length?1:0);
