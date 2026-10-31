import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {installRecipePacketBypass} from 'file:///E:/MC/ops/mineflayer-client-compat.mjs';
const [stage,output]=process.argv.slice(2);
if(!stage||!output||!path.isAbsolute(stage)||!path.isAbsolute(output)||!stage.replaceAll('\\','/').startsWith('E:/MC/staging/')
    ||fs.readFileSync(stage+'/.communication-qa','utf8').trim()!=='127.0.0.1:29397 20261030'||fs.existsSync(output))throw Error('Fresh marked loopback result required');
const require=createRequire('E:/MC/probe/package.json');
const report={passed:false,productionChanged:false,checks:[],samples:{},errors:[]};
const rc=q=>command(q,15000,{properties:stage+'/server.properties',port:29398});
const check=(ok,name)=>{if(!ok)throw Error(name);report.checks.push(name);console.log('PASS '+name);};
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>Math.abs(v-b[i])<.01);
let bot;
async function until(fn,label,ms=18000){const end=Date.now()+ms;while(Date.now()<end){const r=await fn();if(r)return r;await sleep(80);}throw Error('TIMEOUT '+label);}
async function fixture(action='state',extra=''){
    const text=await rc('homeqa '+action+' '+bot.username+(extra?' '+extra:''));
    if(text.includes('HOME_QA loading'))return null;
    const found=text.match(/HOME_QA (\{[^\r\n]+\})/);if(!found)throw Error('Fixture unavailable: '+text.slice(0,200));return JSON.parse(found[1]);
}
async function cast(accept){const index=bot.lines.length;await sleep(350);bot.chat('/mycli cast home');await until(()=>bot.lines.slice(index).find(accept),'home receipt');await sleep(150);return bot.lines.slice(index);}
async function setup(kind){const state=await fixture('setup',kind);await sleep(160);return state;}
try{
    bot=require('mineflayer').createBot({host:'127.0.0.1',port:29397,version:'1.21.1',username:'ag_HM'+Date.now().toString(36).slice(-8),auth:'offline',checkTimeoutInterval:60000});
    installRecipePacketBypass(bot._client,{enabled:true});bot.lines=[];bot.on('messagestr',s=>bot.lines.push(s));bot.on('error',e=>report.errors.push(e.name));
    await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject);setTimeout(()=>reject(Error('SPAWN_TIMEOUT')),40000).unref();});
    await until(()=>fixture(),'native profile');
    const guideStart=bot.lines.length;bot.chat('/mycli skills info home');
    const guide=await until(()=>bot.lines.slice(guideStart).find(s=>s.includes('附近3格')),'updated home skill guide');
    check(guide.includes('上下2格'),'home skill query explains the actual bounded fallback');
    for(const kind of ['clear','blocked','slab']){
        const before=await setup(kind);const lines=await cast(s=>s.startsWith('MC_TRAVEL id=home'));const after=await fixture();
        check(!before.op,'ordinary home actor: '+kind);
        check(after.world==='minecraft:overworld'&&same(after.position,before.destination),'actual body reaches checked '+kind+' destination');
        check(before.mana-after.mana>=4&&before.mana-after.mana<=6.01,'home charges six mana once with native regeneration: '+kind);
        check(lines.filter(s=>s.startsWith('MC_TRAVEL id=home')).length===1,'one native home success receipt: '+kind);
        check(after.blockReads<=512,'bounded block reads: '+kind);
        if(kind==='blocked'){
            check(lines.some(s=>s.includes('home_alternate')&&s.includes('minecraft:oak_planks')),'fallback explains the actual obstructing block');
            const destination=lines.find(s=>s.startsWith('MC_DESTINATION id=village'));
            check(destination&&destination.includes('x='+Math.floor(after.position[0])),'destination receipt contains the real alternate position');
        }
        if(kind==='slab')check(after.position[1]===125.5,'native half slab top is used exactly');
        report.samples[kind]={before,after,receipts:lines.filter(s=>/MC_TRAVEL|MC_DESTINATION|home_alternate/.test(s))};
    }
    for(const kind of ['sealed','hazard','waterlogged','fence']){
        const before=await setup(kind);const lines=await cast(s=>s.includes('[unsafe_destination]'));const after=await fixture();
        check(before.destination===undefined||before.destination===null,'no unsafe alternative selected: '+kind);
        check(same(before.position,after.position)&&after.mana>=before.mana,'unsafe rejection neither moves nor charges: '+kind);
        check(lines.some(s=>s.includes('/mycli waypoint list')&&s.includes('未耗魔')),'refusal gives usable next step: '+kind);
        check(!lines.some(s=>s.startsWith('MC_TRAVEL id=home')),'no false success: '+kind);
        report.samples[kind]={before,after,receipt:lines.find(s=>s.includes('[unsafe_destination]'))};
    }
    for(const behavior of ['cancel','bad_redirect','far_redirect','late_redirect']){
        const before=await setup('blocked');await fixture('arm',behavior);
        const lines=await cast(s=>s.includes('未耗魔'));const after=await fixture();
        check(same(before.position,after.position)&&after.mana>=before.mana,'teleport hook cannot bypass safety or charge: '+behavior);
        check(!lines.some(s=>s.startsWith('MC_TRAVEL id=home')),'no success after cancellation/redirection: '+behavior);
        report.samples[behavior]={before,after,receipts:lines.filter(s=>s.includes('未耗魔'))};
    }
    const before=await setup('blocked');await fixture('arm','safe_redirect');const lines=await cast(s=>s.startsWith('MC_TRAVEL id=home'));const after=await fixture();
    check(same(after.position,[306.5,126,98.5]),'safe listener redirection is permitted');
    check(lines.some(s=>s.startsWith('MC_DESTINATION id=village')&&s.includes('x=306')),'safe redirected receipt reports actual position');
    report.samples.safe_redirect={before,after,receipts:lines.filter(s=>/MC_TRAVEL|MC_DESTINATION/.test(s))};
    await setup('blocked');const other=await fixture('otherworld');await cast(s=>s.startsWith('MC_TRAVEL id=home'));const returned=await fixture();
    check(other.world!=='minecraft:overworld'&&returned.world==='minecraft:overworld','home fallback returns from a different dimension');
    check(same(returned.position,[304.5,126,98.5]),'cross-world body reaches the same verified alternate');
    report.samples.cross_world={before:other,after:returned};
    await setup('blocked');await fixture('drain');const low=await fixture();await cast(s=>s.includes('魔力'));const lowAfter=await fixture();
    check(same(low.position,lowAfter.position),'insufficient mana does not move the actor');
    check(report.errors.length===0,'no client protocol error');report.passed=true;
}catch(error){report.error=String(error.stack);process.exitCode=1;console.error(report.error);}
finally{if(bot)bot.quit('Own home return verification complete');await sleep(250);fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}));}
