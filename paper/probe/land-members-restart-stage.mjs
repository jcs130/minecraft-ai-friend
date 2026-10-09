// Normal-restart integration for the same candidate JAR; fixed disposable ports only.
import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {command} from '../ops/rcon-client.mjs';import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const root='E:/MC/ops/repairs/land-members-20261009',stage='E:/MC/staging/structure-practice-20261009',file=process.argv[2];assert.match(file,/^stage-test-\d+\.json$/);
const prior=JSON.parse(readFileSync(root+'/'+file)),legacy=JSON.parse(readFileSync('E:/MC/ops/repairs/structure-practice-20261009/practice-test-1791532566013.json'));assert.ok(prior.passed&&legacy.passed);
const req=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(req);const {Vec3}=req('vec3'),bots=[];
const rc=q=>command(q,15000,{port:25591,properties:stage+'/server.properties'}),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={passed:false,previousEvidence:file,checks:[],messages:{},camera:[]};
const check=(name,ok)=>{assert.ok(ok,name);report.checks.push(name);console.log('PASS '+name);};
async function until(fn,label,ms=10000){for(const end=Date.now()+ms;Date.now()<end;){if(await fn())return;await sleep(100);}throw Error(label+' timeout');}
async function make(username){await rc('minecraft:whitelist add '+username);const b=req('mineflayer').createBot({host:'127.0.0.1',port:25590,username,version:'1.20.6',auth:'offline'});bots.push(b);report.messages[username]=[];b.on('messagestr',s=>report.messages[username].push(s));b._client.on('camera',p=>report.camera.push({player:username,...p}));b.on('error',e=>report.connectionError=String(e));await new Promise((r,j)=>{b.once('spawn',r);b.once('error',j);b.once('kicked',j);});await sleep(200);if(b.currentWindow)b.closeWindow(b.currentWindow);await b.unequip('hand');return b;}
async function query(b,q,prefix){const n=report.messages[b.username].length;b.chat(q);let line;await until(()=>line=report.messages[b.username].slice(n).find(s=>s.startsWith(prefix+' ')),'response '+q);return JSON.parse(line.slice(prefix.length+1));}
async function tp(b,x,y,z){b.clearControlStates();b.physicsEnabled=false;await rc(`minecraft:tp ${b.username} ${x} ${y} ${z}`);await until(()=>b.blockAt(new Vec3(x,y,z))!==null,'chunk');await sleep(400);b.entity.velocity.set(0,0,0);b.physicsEnabled=true;}
try{
 await until(async()=>{try{return(await rc('version AgentFriend')).includes('0.4.7');}catch{return false;}},'startup',150000);
 report.jarSha256=createHash('sha256').update(readFileSync(stage+'/plugins/AgentFriend-0.4.7.jar')).digest('hex').toUpperCase();check('normal restart uses the same final JAR',report.jarSha256===prior.jarSha256);
 const owner=await make('CortiLan'),guest=await make('LandGuest47'),eye=await make('CortiEye');eye.physicsEnabled=false;
 const members=await query(owner,'/mycli land members member_test47','MC_LAND_MEMBERS');check('owner and collaborator persist across normal restart',members.ownerUuid===prior.finalMembers.ownerUuid&&members.count===1&&members.canManageMembers);
 const board=await query(owner,'/mycli land board member_test47','MC_LAND_BOARD');check('physical board index retains the same location',['x','y','z','world'].every(k=>board[k]===prior.board[k])&&board.indexReady);report.board=board;
 await tp(owner,board.x+.5,board.y,board.z+1.5);const loaded=await query(owner,'/mycli land board member_test47','MC_LAND_BOARD');check('native tagged sign remains usable after restart',loaded.status==='ready'&&owner.blockAt(new Vec3(board.x,board.y,board.z)).name==='oak_sign');
 await owner.activateBlock(owner.blockAt(new Vec3(board.x,board.y,board.z)));await until(()=>owner.currentWindow,'restarted board menu');check('restarted board opens native member management page',owner.currentWindow.inventoryStart===27&&owner.currentWindow.slots[20]?.name==='lime_dye');owner.closeWindow(owner.currentWindow);
 await tp(guest,1203.5,150,1205.5);await guest.openContainer(guest.blockAt(new Vec3(1204,150,1204)));check('persisted collaborator actually opens private barrel',guest.currentWindow.inventoryStart===27);
 for(const q of ['minecraft:gamemode spectator CortiEye','minecraft:tp CortiEye CortiLan','minecraft:spectate CortiLan CortiEye'])await rc(q);
 await until(async()=>{report.eyeStatus=await rc('cortieye');return report.eyeStatus.includes('attached=true');},'actual Eye after restart');check('native spectator Eye is actually attached after restart',report.camera.some(p=>p.player==='CortiEye'&&p.cameraId===owner.entity.id));
 const eyeStart=report.messages.CortiEye.length,guestStart=report.messages.LandGuest47.length;
 const removed=await query(owner,'/mycli land untrust member_test47 LandGuest47','MC_LAND_MEMBER_RESULT');await until(()=>!guest.currentWindow,'restarted revocation closes barrel');check('revocation after restart immediately closes private inventory',removed.status==='success');
 await sleep(300);check('restarted mutation receipt stays private and reaches paired Eye',report.messages.CortiEye.slice(eyeStart).some(s=>s.includes('MC_LAND_MEMBER_RESULT'))&&!report.messages.LandGuest47.slice(guestStart).some(s=>s.startsWith('MC_LAND_MEMBER_RESULT')));
 const blocked=await query(guest,'/mycli protect container 1204 150 1204','MC_PROTECTION');await guest.activateBlock(guest.blockAt(new Vec3(1204,150,1204)));await sleep(400);check('revoked collaborator remains unable to reopen barrel',!blocked.allowed&&blocked.reason==='land_permission_denied'&&!guest.currentWindow);
 const sign=await rc(`minecraft:data get block ${board.x} ${board.y} ${board.z} front_text.messages[3]`);check('restarted physical board follows current membership',sign.includes('协作 0'));
 await sleep(1100);check('owner can grant again after restart',(await query(owner,'/mycli land trust member_test47 LandGuest47','MC_LAND_MEMBER_RESULT')).status==='success');
 await rc('minecraft:op Goddess');const goddess=await make('Goddess');await until(()=>goddess.game.gameMode==='spectator','Goddess observer role');check('Goddess retains cross-land administrative authority',(await query(goddess,'/mycli land members member_test47','MC_LAND_MEMBERS')).administrator);
 report.mcp=JSON.parse(execFileSync('C:/Users/lzl19/AppData/Local/hermes/bin/uv.exe',['run','--offline','--no-project','--with','mcp<2','--python','D:/qwenpaw/runtime/python312/python.exe','python','-X','utf8',root+'/mcp-stage.py'],{encoding:'utf8',timeout:20000}));check('actual candidate Goddess tool functions complete isolated reads and changes',report.mcp.passed&&report.mcp.checks===6);
 const veteran=await make(legacy.actor);const proof=await query(veteran,'/mycli world practice status','MC_WORLD');report.proof=proof;check('previous door and ladder native evidence is preserved unchanged',proof.completed&&!proof.active&&proof.steps.every((s,i)=>s.done&&JSON.stringify(s.evidence)===JSON.stringify(legacy.proof.steps[i].evidence)));
 await tp(veteran,-1181.5,18,-1546.5);const protection=await query(veteran,'/mycli protect break -1184 18 -1547','MC_PROTECTION');check('inherited generated building protection still rejects destruction',!protection.allowed&&protection.reason==='generated_structure');
 report.audit=await rc('mycli admin structures audit');check('native structure integration has no linkage or bounds errors',report.audit.includes('errors=0')&&report.audit.includes('loadPolicy=loaded_only'));
 report.finalMembers=await query(owner,'/mycli land members member_test47','MC_LAND_MEMBERS');report.passed=true;
}catch(error){report.error=String(error.stack||error);console.error(error);process.exitCode=1;}
finally{for(const b of bots){b.clearControlStates();b.quit();}writeFileSync(root+'/restart-test-'+Date.now()+'.json',JSON.stringify(report,null,2));}
