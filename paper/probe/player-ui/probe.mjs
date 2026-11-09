/** Real vanilla inventory clicks on synthetic actors, only on the marked loopback QA server. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import{createHash}from'node:crypto';import{createRequire}from'node:module';import{setTimeout as wait}from'node:timers/promises';
import{command}from'file:///E:/MC/ops/rcon-client.mjs';
const stage='E:/MC/staging/dungeon-integration-20261109-r1',out=process.env.PLAYER_UI_REPORT_ROOT;assert(out);
assert.equal((await fs.readFile(stage+'/.dungeon-integration-qa','utf8')).trim(),'FRESH_DUNGEON_INTEGRATION_NO_PLAYER_INVENTORIES');
const props=await fs.readFile(stage+'/server.properties','utf8');assert(/^server-ip=127\.0\.0\.1\r?$/m.test(props)&&/^server-port=25960\r?$/m.test(props)&&/^rcon.port=25961\r?$/m.test(props));
assert.equal(createHash('sha256').update(await fs.readFile(stage+'/plugins/Minepacks-2.5.9-Release.jar')).digest('hex'),'185dd911d7dd6e0f93b56d35924e8b61c6452e29b79c2a73c31e48f83c777a04','pin the live compatibility build; no QA self-update');
const backpackConfig=await fs.readFile(stage+'/plugins/Minepacks/config.yml','utf8');assert(/^  UseDynamicTitle: false\r?$/m.test(backpackConfig),'Database.UseDynamicTitle must match live false');
const mf=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer');
const rc=s=>command(s,25000,{port:25961,properties:stage+'/server.properties'}),baseline=process.argv.includes('--baseline');
const report={baseline,productionChanged:false,checks:[],windows:[],errors:[],messages:[]};let bot,finishing=false;
const until=async(fn,label,ms=25000)=>{for(const end=Date.now()+ms;Date.now()<end;){if(report.errors.length)throw Error(report.errors.join('; '));const x=await fn();if(x)return x;await wait(80);}throw Error('Timeout '+label);};
const check=(label,ok)=>{report.checks.push({label,ok:!!ok});assert(ok,label);console.log('PASS '+label);};
const title=w=>typeof w?.title==='string'?w.title:JSON.stringify(w?.title??'');
async function menu(){if(bot.currentWindow){bot.closeWindow(bot.currentWindow);await wait(200);}bot.chat('/mycli menu');await until(()=>bot.currentWindow,'hall');await wait(180);return bot.currentWindow;}
async function click(slot){const old=bot.currentWindow;assert(old);await bot.clickWindow(slot,0,0);await until(()=>bot.currentWindow&&bot.currentWindow!==old,'next window from '+slot);await wait(180);report.windows.push({from:title(old),slot,to:title(bot.currentWindow),size:bot.currentWindow.inventoryStart});return bot.currentWindow;}
try{
    await until(async()=>{try{return(await rc('version AgentFriend')).includes(baseline?'0.4.47.67':'0.4.47.68');}catch{return false;}},'startup',180000);
    bot=mf.createBot({host:'127.0.0.1',port:25960,version:'1.21.1',username:'ag_UiQA1',auth:'offline',hideErrors:true,checkTimeoutInterval:60000});
    bot.on('error',e=>report.errors.push(String(e)));bot.on('kicked',e=>report.errors.push('kicked '+JSON.stringify(e)));
    bot.on('end',reason=>{if(!finishing)report.errors.push('unexpected_disconnect '+reason);});
    bot.on('messagestr',s=>report.messages.push(s));
    await until(()=>bot.entity&&bot.player?.uuid,'login',45000);bot.physicsEnabled=false;await wait(2000);
    // A returning class regenerates mana after login. Start the no-write comparison at full mana.
    await until(async()=>{const state=JSON.parse(await rc('playeruiqa read '+bot.username));if(state.mana&&state.mana.current+0.0001>=state.mana.max)return true;await wait(700);return false;},'native passive mana recovery',45000);
    report.before=await rc('playeruiqa read '+bot.username);
    let window=await menu();check('default menu is the adventure hall',title(window).includes('冒险大厅'));
    check('hall fits four vanilla rows',window.inventoryStart===36);
    for(const [slot,label]of[[10,'角色与技能'],[13,'冒险与任务'],[16,'背包与仓库'],[19,'商城与交易'],[22,'队伍与伙伴'],[25,'留影与生活']]){
        await menu();await click(slot);check('category '+label,title(bot.currentWindow).includes(label));await click(27);check('back returns to hall',title(bot.currentWindow).includes('冒险大厅'));
    }
    await menu();await click(10);await click(20);
    check('all 13 common skills are visible',[10,11,12,13,14,15,16,19,20,21,22,23,24].every(s=>bot.currentWindow.slots[s]&&bot.currentWindow.slots[s].name!=='gray_stained_glass_pane'));
    await click(13);check('blink opens a description before casting',title(bot.currentWindow).includes('闪现'));
    await click(27);check('skill detail back returns to common skills',title(bot.currentWindow).includes('通用生存技能'));
    await menu();await click(16);await click(14);check('tidy requires explicit confirmation',title(bot.currentWindow).includes('确认无损合并'));
    await menu();await click(16);await click(16);check('all-page stash tidy also requires confirmation',title(bot.currentWindow).includes('确认无损合并'));
    report.afterBrowse=await rc('playeruiqa read '+bot.username);check('browsing preserves real RPG and inventory state',report.afterBrowse===report.before);
    // All supported top-level destinations must open a real private inventory.
    await menu();await click(13);window=bot.currentWindow;const trainingAt=report.messages.length;await bot.clickWindow(10,0,0);await wait(1200);
    report.trainingGeometryPresent=!!bot.currentWindow&&bot.currentWindow!==window;
    check('training opens or gives an explicit unbuilt-site recovery',report.trainingGeometryPresent||report.messages.slice(trainingAt).some(s=>s.includes('试炼塔尚未建成')&&s.includes('/mycli dungeon list')));
    for(const [home,slot,label]of[[10,10,'character'],[10,12,'class'],[10,14,'skills'],[10,16,'talent'],[10,24,'quick'],[13,12,'conquest'],[13,14,'dungeons'],[13,16,'quests'],[13,20,'contracts'],[13,24,'guild'],[16,10,'backpack'],[16,12,'stash'],[19,10,'shop'],[19,13,'recycler'],[19,16,'auction'],[22,10,'party'],[22,13,'players'],[22,16,'waypoints'],[22,22,'help'],[25,10,'camera'],[25,13,'archives'],[25,16,'appearance'],[25,22,'places']]){
        await menu();await click(home);window=await click(slot);check('real ordinary-player destination '+label,!!window&& !title(window).includes('入口暂不可用'));
        if(label==='backpack')check('Minepacks really opens its own 54-slot inventory',window.inventoryStart===54&&title(window).includes('Backpack'));
    }
    await menu();window=bot.currentWindow;const items=bot.inventory.items().map(i=>[i.slot,i.name,i.count]);
    await bot.clickWindow(10,0,1);await wait(300);check('shift click cannot activate a button',bot.currentWindow===window);
    await bot.clickWindow(10,2,2);await wait(300);check('number key cannot move a menu icon',bot.currentWindow===window);
    check('menu icons never enter player inventory',JSON.stringify(items)===JSON.stringify(bot.inventory.items().map(i=>[i.slot,i.name,i.count])));
    report.forms=await rc('playeruiqa forms '+bot.username);check('installed Cumulus API builds and validates touch forms',report.forms.includes('passed=true'));
    const partyBefore=JSON.parse(await rc('playeruiqa read '+bot.username));
    if(!partyBefore.inParty){
        await menu();await click(22);await click(10);await click(10);check('creating a party first opens confirmation',title(bot.currentWindow).includes('确认组队操作'));
        check('opening confirmation does not create a party',!JSON.parse(await rc('playeruiqa read '+bot.username)).inParty);
        await click(22);check('explicit party creation returns to status',title(bot.currentWindow).includes('组队大厅'));
        check('explicit party creation has a real native receipt',JSON.parse(await rc('playeruiqa read '+bot.username)).inParty===true);
    }
    await menu();await click(22);await click(10);window=await click(10);check('members can open the real native party management GUI',!title(window).includes('组队大厅')&&!title(window).includes('确认组队操作'));
    const before=JSON.parse(report.before);
    if(!before.combat||before.combat==='none'){
        bot.closeWindow(bot.currentWindow);const at=report.messages.length;bot.chat('/mycli profession choose knight --json');
        const chosen=await until(()=>report.messages.slice(at).find(s=>s.startsWith('MC_RPG ')),'synthetic explicit class choice');
        const choice=JSON.parse(chosen.slice(7));check('synthetic explicit class choice is saved',choice.saved===true);
    }
    const selected=JSON.parse(await rc('playeruiqa read '+bot.username));check('selected synthetic profile is knight',selected.combat==='knight');
    await menu();await click(10);window=await click(16);check('selected-class talent GUI opens',!title(window).includes('入口暂不可用')&&!title(window).includes('职业选择'));
    check('no protocol disconnect',report.errors.length===0);
}catch(e){report.error=String(e);console.log(report.error);}
finally{finishing=true;bot?.quit();report.passed=!report.error;await fs.writeFile(out+'/'+(baseline?'before':'after')+'-'+Date.now()+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}));if(!report.passed)process.exitCode=1;}
