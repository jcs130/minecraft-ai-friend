// Real Nether portals in the dedicated synthetic loopback server.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const stage=process.env.MAID_PORTAL_QA_STAGE;
const reportPath=process.env.MAID_PORTAL_QA_REPORT;
const fixture=JSON.parse(await fs.readFile(process.env.MAID_PORTAL_QA_FIXTURE,'utf8'));
const baseline=process.argv.includes('--baseline');
const commandOnly=process.argv.includes('--command-only');
assert(fixture.synthetic&&fixture.username==='MaidBrainQA');
assert.equal(await fs.readFile(stage+'/.maid-lifecycle-qa','utf8'),'FRESH_MAID_LIFECYCLE_QA_NO_PLAYER_DATA');
const props=await fs.readFile(stage+'/server.properties','utf8');
assert(/^server-ip=127\.0\.0\.1$/m.test(props)&&/^server-port=25938$/m.test(props)&&/^rcon\.port=25939$/m.test(props));
const {command}=await import(pathToFileURL(process.env.MAID_PORTAL_QA_RCON));
const rc=q=>command(q,30000,{port:25939,properties:stage+'/server.properties'});
const require=createRequire(process.env.MAID_PORTAL_QA_CLIENT_ANCHOR);
const owner=fixture.username,maid=fixture.maid;
const report={baseline,synthetic:true,checks:[],cases:[]};
let bot;
const travelMessages=[];
const world=name=>'minecraft:'+name;
const inWorld=(name,q)=>rc('minecraft:execute in '+world(name)+' run '+q);
const located=async(id,w)=>(await rc('minecraft:execute as '+id+' at @s if dimension '+world(w))).includes('Test passed');
async function until(fn,label,timeout=20000){
    for(const end=Date.now()+timeout;Date.now()<end;){
        const value=await fn();
        if(value)return value;
        await delay(220);
    }
    throw Error('Timed out '+label);
}
const check=(label,ok)=>{
    report.checks.push({label,passed:!!ok});
    assert(ok,label);
    console.log('PASS '+label);
};
const portalCoord={overworld:{x:800,z:800},the_nether:{x:110,z:100}};
const forceBoxes={overworld:[751,791,849,809],the_nether:[51,91,149,109]};
async function setup(w){
    const {x,z}=portalCoord[w],box=forceBoxes[w];
    await inWorld(w,'minecraft:forceload add '+box.join(' '));
    for(const [cx,cz] of [[box[0],box[1]],[box[2],box[3]]])
        await until(async()=>(await rc('minecraft:execute in '+world(w)+' if loaded '+cx+' 90 '+cz)).includes('Test passed'),'loaded fixture chunk');
    await inWorld(w,'minecraft:fill '+(x-47)+' 89 '+(z-8)+' '+(x+47)+' 89 '+(z+8)+' minecraft:stone');
    await inWorld(w,'minecraft:fill '+(x-47)+' 90 '+(z-8)+' '+(x+47)+' 95 '+(z+8)+' minecraft:air');
    await inWorld(w,'minecraft:fill '+(x-1)+' 89 '+z+' '+(x+2)+' 93 '+z+' minecraft:obsidian');
    await inWorld(w,'minecraft:fill '+x+' 90 '+z+' '+(x+1)+' 92 '+z+' minecraft:nether_portal[axis=x]');
    check(w+' portal is active',(await rc('minecraft:execute in '+world(w)+' if block '+x+' 90 '+z+' minecraft:nether_portal[axis=x]')).includes('Test passed'));
}
async function snapshot(){
    const fields=['UUID','Owner','HandItems','ArmorItems','MaidInventory','MaidBaubleInventory',
        'MaidHideInventory','MaidTaskInventory','YsmModelId','YsmModelTexture','MaidAIChat.LLMSite','NeoForgeData.qiandengji_follow'];
    const out={};
    for(const field of fields){
        out[field]=(await rc('minecraft:data get entity '+maid+' '+field)).trim();
        assert(out[field].includes('entity data'), 'Missing fixture field '+field);
    }
    return out;
}
async function positionCase(from, offset, mode='follow'){
    const {x,z:portalZ}=portalCoord[from],z=portalZ+3;
    await inWorld(from,'minecraft:tp '+owner+' '+(x+.5)+' 90 '+(portalZ+2.5));
    await until(async()=>(await rc('minecraft:data get entity '+owner+' PortalCooldown')).trim().endsWith(': 0'),'portal cooldown',26000);
    await inWorld(from,'minecraft:fill '+(x+offset-1)+' 90 '+(z-1)+' '+(x+offset+1)+' 91 '+(z+1)+' minecraft:glass');
    await inWorld(from,'minecraft:fill '+(x+offset)+' 90 '+z+' '+(x+offset)+' 91 '+z+' minecraft:air');
    await inWorld(from,'minecraft:tp '+maid+' '+(x+offset+.5)+' 90 '+(z+.5));
    await until(()=>located(maid,from),'original synthetic maid at source');
    for(const [key,value] of [['NoAI','0b'],['Sitting',mode==='stay'?'1b':'0b'],['MaidTask','"touhou_little_maid:idle"'],
        ['MaidScheduleMode','"DAY"'],['NeoForgeData.qiandengji_follow','{schemaVersion:1,walkDistance:32,stopDistance:16,returnDistance:64}']]){
        await rc('minecraft:data modify entity '+maid+' '+key+' set value '+value);
    }
    await rc('minecraft:data remove entity '+maid+' Brain.memories."minecraft:home"');
    const result=await rc('portalqa track '+maid);
    assert(result.includes('PORTAL_QA_READY'));
}
const distance=(a,b)=>Math.hypot(...a.map((n,i)=>n-b[i]));
async function coordinates(id){
    const receipt=await rc('minecraft:data get entity '+id+' Pos');
    const match=receipt.match(/\[([^\]]+)\]\s*$/);
    assert(match,'Position unavailable for '+id);
    return match[1].split(',').map(n=>Number(n.trim().replace(/d$/i,'')));
}
const readEvents=async()=>JSON.parse((await rc('portalqa read')).split('PORTAL_QA ')[1].trim());
async function passPortal(from,to,offset,{cancel=false,stay=false,denyMaid=false,rejectJoin=false}={}){
    const tag=stay?' stay':cancel?' cancel':denyMaid?' maid veto':rejectJoin?' registration veto':'';
    await positionCase(from,offset,stay?'stay':'follow');
    const messageStart=travelMessages.length;
    const {x,z}=portalCoord[from];
    const before=await snapshot();
    if(cancel)await rc('portalqa cancel');
    if(denyMaid)await rc('portalqa cancel-maid');
    if(rejectJoin)await rc('portalqa reject-join');
    // Place the test client in the active source portal. The world transition
    // itself uses the server's normal survival portal timer and portal search.
    await inWorld(from,'minecraft:tp '+owner+' '+(x+.5)+' 90 '+(z+.5));
    if(!cancel)await until(()=>located(owner,to),'real portal arrival',16000);
    else await delay(5200);
    await delay(1000);
    const events=await readEvents();
    const row={from,to,offset,stay,cancel,denyMaid,rejectJoin,ownerArrived:await located(owner,to),maidArrived:await located(maid,to),events,messages:travelMessages.slice(messageStart)};
    report.cases.push(row);
    const portal=events.find(e=>e.event==='portal'&&e.cause==='NETHER_PORTAL'&&e.cancelled===cancel);
    check('actual Nether portal event at distance '+offset+tag,portal);
    check('maid starts at expected departure distance '+offset, Math.abs(portal.maidDistanceFromDeparture-offset)<2);
    if(!cancel){
        const arrival=events.find(e=>e.event==='changed_world');
        check('portal exit is more than 8 blocks from the search origin '+from, arrival&&distance(portal.target,arrival.target)>8);
    }
    check('owner world changed only on accepted portal '+offset, row.ownerArrived!==cancel);
    if(cancel||stay||denyMaid||rejectJoin||offset>32||baseline){
        check('original maid stays at source '+offset+tag,!row.maidArrived&&await located(maid,from));
        if(denyMaid||rejectJoin){
            const type=denyMaid?'maid_transfer_cancelled':'maid_join_rejected';
            check(type+' actually exercised',events.some(event=>event.event===type));
            check('failed transfer preserves original data'+tag,JSON.stringify(await snapshot())===JSON.stringify(before));
            check('Bukkit still resolves the valid original in its source'+tag,
                (await rc('portalqa maid-world')).includes('PORTAL_QA_MAID '+world(from)+' true'));
        }
    }else{
        check('original maid follows actual portal at '+offset,row.maidArrived);
        const arrival=events.find(event=>event.event==='changed_world');
        const transfers=events.filter(event=>event.event==='maid_transfer'&&!event.cancelled&&event.from===world(from)&&event.to===world(to));
        check('one approved landing within three blocks of portal exit '+offset,
            transfers.length===1&&distance(transfers[0].target,arrival.target)<3);
        row.distanceToOwner=distance(await coordinates(owner),await coordinates(maid));
        check('original maid remains nearby after arrival '+offset,row.distanceToOwner<8);
        const cooldown=Number((await rc('minecraft:data get entity '+maid+' PortalCooldown')).trim().split(': ').at(-1));
        check('arrival has native portal cooldown '+offset,cooldown>0);
        check('original UUID, owner, inventory, model and follow profile survived '+offset,
            JSON.stringify(await snapshot())===JSON.stringify(before));
    }
    const safeWorld=cancel?from:to,safeSpot=portalCoord[safeWorld];
    await inWorld(safeWorld,'minecraft:tp '+owner+' '+(safeSpot.x+.5)+' 90 '+(safeSpot.z+2.5));
}
async function passCommand(from,to,unsafe=false){
    await positionCase(from,8);
    const x=portalCoord[to].x-24,z=portalCoord[to].z;
    if(unsafe){
        await inWorld(to,'minecraft:fill '+(x-2)+' 89 '+(z-2)+' '+(x+2)+' 93 '+(z+2)+' minecraft:glass');
        await inWorld(to,'minecraft:fill '+x+' 90 '+z+' '+x+' 92 '+z+' minecraft:air');
    }
    const before=await snapshot();
    await inWorld(to,'minecraft:tp '+owner+' '+(x+.5)+' 90 '+(z+.5));
    await until(()=>located(owner,to),'command arrival');
    await delay(1500);
    const events=await readEvents(),label=from===to?'same-world command':'cross-world command';
    const ownerPosition=await coordinates(owner);
    const maidPosition=await coordinates(maid);
    const row={from,to,command:true,unsafe,events,ownerPosition,maidPosition,maidInTarget:await located(maid,to)};
    report.cases.push(row);
    check(label+' reached the requested coordinates',distance(ownerPosition,[x+.5,90,z+.5])<1);
    if(unsafe){
        check('blocked landing keeps original maid at source',await located(maid,from));
    }else{
        check(label+' keeps original maid in range',row.maidInTarget&&distance(ownerPosition,maidPosition)<8);
    }
    check(label+' preserves original data',JSON.stringify(await snapshot())===JSON.stringify(before));

}
try{
    const version=baseline?'0.1.24-fast-followup':'0.1.25-native-portal-travel';
    check('expected bridge '+version,(await rc('version QiandengjiMaidBridge')).includes(version));
    bot=require('mineflayer').createBot({host:'127.0.0.1',port:25938,version:'1.21.1',username:owner,auth:'offline',hideErrors:true});
    bot.on('error',()=>{});
    bot.on('messagestr', line=>{if(line.includes('[女仆·随行]'))travelMessages.push(line);});
    await until(()=>bot.entity,'synthetic owner login',30000);
    await rc('minecraft:difficulty peaceful');
    await rc('minecraft:time set 1000');
    await rc('minecraft:gamemode survival '+owner);
    await setup('overworld');
    await setup('the_nether');
    check('existing fixture original UUID is loaded',(await rc('minecraft:data get entity '+maid+' Owner')).includes('entity data'));
    await rc('companionqa arm '+maid);
    check('fixture starts with a real equipped sword',(await rc('minecraft:data get entity '+maid+' HandItems[0].id')).includes('iron_sword'));
    if(!commandOnly){
        await passPortal('overworld','the_nether',8);
        await passPortal('overworld','the_nether',26);
    }
    if(!baseline&&!commandOnly){
        await passPortal('the_nether','overworld',26);
        await passPortal('overworld','the_nether',36);
        await passPortal('overworld','the_nether',8,{stay:true});
        await passPortal('overworld','the_nether',8,{cancel:true});
        await passPortal('overworld','the_nether',8,{denyMaid:true});
        await passPortal('overworld','the_nether',8,{rejectJoin:true});
    }
    if(commandOnly||!baseline){
        await passCommand('overworld','overworld');
        if(!baseline){
            await passCommand('overworld','the_nether');
            await passCommand('the_nether','overworld',true);
        }
    }
    report.passed=true;
}catch(error){
    report.error=String(error);
    console.error(report.error);
    process.exitCode=1;
}finally{
    if(bot){
        try{
            await inWorld('overworld','minecraft:tp '+owner+' 300.5 90 300.5');
            await inWorld('overworld','minecraft:tp '+maid+' 302.5 90 300.5');
            await rc('minecraft:data modify entity '+maid+' Sitting set value 0b');
            for(const [w,box] of Object.entries(forceBoxes))await inWorld(w,'minecraft:forceload remove '+box.join(' '));
        }catch(error){report.cleanupError=String(error);process.exitCode=1;}
        bot.quit();
    }
    await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({baseline,passed:report.passed??false,checks:report.checks.length,cases:report.cases.map(({from,offset,ownerArrived,maidArrived,events})=>({from,offset,ownerArrived,maidArrived,events:events.map(e=>e.event+':'+e.cause)}))}));
}
