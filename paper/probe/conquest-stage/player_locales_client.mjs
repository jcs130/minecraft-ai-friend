/** English client locale must still see reviewed Chinese player messages. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {command} from '../../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/aincrad-conquest-20261027',label=process.argv[2];assert(/^[a-z0-9]+$/.test(label));assert.match(await fs.readFile(stage+'/server.properties','utf8'),/QD_AINCRAD_CONQUEST_QA_ONLY/);
const require=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json'),mf=require('mineflayer'),wait=ms=>new Promise(r=>setTimeout(r,ms));
const report={checks:[],errors:[],receipts:[],messages:[],productionModified:false};let b;
const check=(name,ok)=>{assert.ok(ok,name);report.checks.push(name);};
const rc=async q=>{const t=await command(q,15000,{properties:stage+'/server.properties',port:25925});report.receipts.push({q,t});return t;};
try{
 for(const [name,version] of [['Shopkeepers','2.23.3'],['SkinsRestorer','15.'],['MagicSpells','4.']])check(name+' actually enabled',(await rc('version '+name)).includes(version));
 b=mf.createBot({host:'127.0.0.1',port:25924,username:'LocalePlayerQA20',version:'1.21.1',auth:'offline',defaultChatPatterns:false,checkTimeoutInterval:60000});
 b.on('messagestr',s=>report.messages.push(s));b.on('error',e=>report.errors.push(e.message));b.on('kicked',e=>report.errors.push(JSON.stringify(e)));installRecipePacketBypass(b._client);
 await Promise.race([new Promise(r=>b.once('spawn',r)),wait(30000).then(()=>{throw Error('spawn timeout');})]);b.setSettings({locale:'en_US'});await wait(700);
 for(const [cmd,tag] of [['/skin help','SkinsRestorer'],['/shopkeepers help','Shopkeepers']]){
  const start=report.messages.length;b.chat(cmd);await wait(1800);const text=report.messages.slice(start).join('\n');
  check(tag+' returns readable Chinese to an English client',/[\u3400-\u9fff]/.test(text)&&!text.includes('You do not have permission')&&!text.includes('You are now using'));
 }
 const log=await fs.readFile(stage+'/logs/latest.log','utf8');
 check('Shopkeepers accepts all reviewed language entries',!log.includes('Switching back to the default language')&&!/\[Shopkeepers\].*(?:Missing language|missing message|language file.*(?:invalid|error))/i.test(log));
 for(const [q,pattern] of [['shopkeepers reload',/重载|重新加载|reloaded/i],['ms reload',/重载|重新加载|reloaded|完成/i]])check('native reload: '+q,pattern.test(await rc(q)));
 // SkinsRestorer replies asynchronously; RCON's empty result is not failure
 // and not success. Use a canary operator to receive the real final message.
 await rc('minecraft:op '+b.username);const reloadStart=report.messages.length;b.chat('/sr reload');await wait(2500);
 check('SkinsRestorer native reload has an actual completion reply',report.messages.slice(reloadStart).some(s=>/重载|重新加载|reloaded|加载成功/i.test(s)));
 await rc('minecraft:deop '+b.username);
 check('locale checks do not disconnect the player',b._client.state==='play');
}catch(e){report.errors.push(e.stack||String(e));}
finally{if(b)await rc('minecraft:deop '+b.username);b?.quit();await fs.writeFile(stage+'/client-'+label+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,errors:report.errors}));process.exit(report.errors.length?1:0);}
