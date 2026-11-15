import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {setTimeout as wait} from 'node:timers/promises';
import {command} from '../../../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';
const {createBot}=createRequire(process.env.MINEFLAYER_PACKAGE)('mineflayer');
const stage=process.env.PLAYER_NAVIGATION_STAGE,phase=process.env.QA_PHASE;
assert.equal(await readFile(stage+'/.player-navigation-qa','utf8'),'SYNTHETIC_PLAYER_NAVIGATION_ONLY');
const props=await readFile(stage+'/server.properties','utf8');for(const l of ['server-ip=127.0.0.1','server-port=26461','rcon.port=26462'])assert(props.split(/\r?\n/).includes(l));
const rc=text=>command(text,20000,{port:26462,properties:stage+'/server.properties'});
const qa=async action=>{const raw=await rc('rescueqa '+action),m=raw.match(/RESCUE_QA (\{[^\r\n]+\})/);assert(m,raw);return JSON.parse(m[1]);};
const report={synthetic:true,phase,checks:[]},bots=[];
function check(name,v){report.checks.push({name,passed:!!v});console.log(v?'PASS':'FAIL',name);assert(v,name);}
async function until(fn,name,ms=25000){for(let end=Date.now()+ms;Date.now()<end;){let v=await fn();if(v)return v;await wait(200);}throw Error('timeout '+name);}
async function connect(name){const b=createBot({host:'127.0.0.1',port:26461,username:name,version:'1.21.1',auth:'offline',physicsEnabled:false,hideErrors:true});bots.push(b);b.lines=[];b.on('messagestr',s=>b.lines.push(s));b.on('error',()=>{});installRecipePacketBypass(b._client);await until(()=>b.entity&&b.player?.uuid,name,45000);return b;}
try{
 const a=await connect('NavActorQA'),b=await connect('NavTargetQA');await wait(3000);
 await rc('respawnqa setup');await wait(500);await rc('navqa setup trial');const initial=await qa('rescue-setup');report.initial=initial;
 check('configured original companion starts outside rescue radius',initial.maidDistance>4&&initial.eligible);
 await wait(1100);const down=await qa('down');report.down=down;
 check('native lethal damage leaves a solo player downed with a companion available',down.rescue.downed&&down.actorAlive&&down.actorHealth===1);
 const moving=await until(async()=>{const s=await qa('status');report.last=s;return s.companion?.state==='rescuing_teammate'?s:null;},'native rescue decision');
 check('native companion selects rescue using the actual downed state',moving.rescue.rescueNeeded&&moving.rescue.nextAction.includes('4格'));
 const helper=await until(async()=>{const s=await qa('status');report.last=s;return s.rescue.downedTeammates?.some(t=>t.rescuerKind==='native_companion')?s:null;},'real companion arrival');
 check('original native body actually reaches the teammate',helper.maidDistance<=4&&helper.maidX!==initial.maidX);
 const revived=await until(async()=>{const s=await qa('status');report.last=s;return !s.rescue.downed&&s.actorHealth>1?s:null;},'continuous native rescue',20000);
 check('continuous ten-second native assistance revives the same player',revived.maidId===initial.maidId&&a.lines.some(l=>l.includes('status=revived')&&l.includes('native_companion')));
 await qa('sit-with-human');await wait(1700);await qa('down');await wait(2200);const seated=await qa('status');
 check('explicit seated mode remains seated and does not falsely rescue',seated.maidSitting&&!seated.eligible&&seated.rescue.downed&&!seated.rescue.downedTeammates.some(t=>t.rescuerKind==='native_companion'));
 await qa('human-near');await until(async()=>{const s=await qa('status');return !s.rescue.downed&&s.actorHealth>1;},'human rescue');check('ordinary teammate rescue remains usable',a.lines.some(l=>l.includes('status=revived')&&l.includes('nearby_teammate')));
 await qa('soul-setup');const before=await qa('status'),granted=await qa('grant');report.granted=granted;
 check('native first grant gives exactly one correctly bound soul',granted.initialSouls===before.initialSouls+1&&granted.soulOwners.every(id=>id===granted.targetId));
 const duplicate=await qa('grant');check('repeating native advancement does not duplicate the soul',duplicate.initialSouls===granted.initialSouls);
 await qa('own-hand');await wait(700);b._client.write('block_place',{location:{x:200,y:89,z:200},direction:1,hand:0,cursorX:.5,cursorY:1,cursorZ:.5,insideBlock:false,sequence:1});
 const created=await until(async()=>{const s=await qa('status');return s.targetMaids===before.targetMaids+1?s:null;},'native own soul spawn');
 check('vanilla protocol can use its own soul to create one genuinely owned maid',created.initialSouls===before.initialSouls);
 const foreign=await qa('foreign-hand');await wait(700);b._client.write('block_place',{location:{x:201,y:89,z:200},direction:1,hand:0,cursorX:.5,cursorY:1,cursorZ:.5,insideBlock:false,sequence:2});await wait(1200);const rejected=await qa('status');
 check('foreign soul is explained without consumption or ownership theft',rejected.initialSouls===foreign.initialSouls&&rejected.targetMaids===created.targetMaids&&b.lines.some(l=>l.includes('魂符归属不符')&&l.includes('NavActorQA')));
 report.success=true;
}catch(e){report.error=String(e.stack||e);console.error(report.error);process.exitCode=1;}
finally{bots.forEach(b=>b.quit());await writeFile(stage+'/rescue-client.json',JSON.stringify(report,null,2));}
