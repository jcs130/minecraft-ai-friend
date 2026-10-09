// Same final JAR after a normal isolation-server shutdown/start; no live connection.
import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';import {fix1206PotionProtocol} from 'file:///E:/MC/ops/minecraft-1206-potion.mjs';
const root='E:/MC/ops/repairs/structure-practice-20261009',stage='E:/MC/staging/structure-practice-20261009',file=process.argv[2];assert.match(file,/^practice-test-[0-9]+\.json$/);
const prior=JSON.parse(readFileSync(root+'/'+file,'utf8'));assert.ok(prior.passed&&!prior.previousEvidence);
const req=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(req);const {Vec3}=req('vec3'),bots=[];
const rc=q=>command(q,15000,{port:25591,properties:stage+'/server.properties'}),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={passed:false,previousEvidence:file,checks:[],messages:{},camera:[]};
const check=(name,ok)=>{assert.ok(ok,name);report.checks.push(name);console.log('PASS '+name);};
async function until(fn,label,ms=10000){for(const end=Date.now()+ms;Date.now()<end;){if(await fn())return;await sleep(100);}throw Error(label+' timeout');}
async function make(username){await rc('minecraft:whitelist add '+username);const b=req('mineflayer').createBot({host:'127.0.0.1',port:25590,username,version:'1.20.6',auth:'offline'});bots.push(b);report.messages[username]=[];b.on('messagestr',s=>report.messages[username].push(s));b._client.on('camera',p=>report.camera.push({player:username,...p}));await new Promise((r,j)=>{b.once('spawn',r);b.once('error',j);b.once('kicked',j);});return b;}
async function query(b,command,prefix){const n=report.messages[b.username].length;b.chat(command);await sleep(650);const line=report.messages[b.username].slice(n).find(s=>s.startsWith(prefix));assert.ok(line,'response '+command);return JSON.parse(line.slice(prefix.length));}
try{
 await until(async()=>{try{return(await rc('version AgentFriend')).includes('0.4.6');}catch{return false;}},'startup',150000);
 report.jarSha256=createHash('sha256').update(readFileSync(stage+'/plugins/AgentFriend-0.4.6.jar')).digest('hex').toUpperCase();check('normal restart uses the same final candidate',report.jarSha256===prior.jarSha256);
 const a=await make(prior.actor);const proof=await query(a,'/mycli world practice status','MC_WORLD ');report.proof=proof;
 check('both native action proofs survive normal server restart',proof.completed&&proof.steps.every((s,i)=>s.done&&JSON.stringify(s.evidence)===JSON.stringify(prior.proof.steps[i].evidence)));
 check('completed practice remains inactive after restart',!proof.active&&proof.verifiedSteps===2);
 a.physicsEnabled=false;await rc(`minecraft:tp ${a.username} -1181.5 18 -1546.5`);await until(()=>a.blockAt(new Vec3(-1182,18,-1547))!==null,'native bunker chunk');await sleep(500);a.entity.velocity.set(0,0,0);a.physicsEnabled=true;
 const denial=await query(a,'/mycli protect break -1184 18 -1547','MC_PROTECTION ');check('generated building protection is active after normal restart',denial.reason==='generated_structure'&&denial.allowed===false);
 report.audit=await rc('mycli admin structures audit');check('native bounds read succeeds without linkage errors',report.audit.includes('errors=0')&&report.audit.includes('loadPolicy=loaded_only'));
 const corti=await make('CortiLan'),eye=await make('CortiEye');eye.physicsEnabled=false;
 // The external production Eye watcher is intentionally absent in isolation.
 // Attach this controlled spectator through native server commands, then verify
 // the actual camera packet and server target before testing private delivery.
 report.eyeSetup=[];
 for(const q of ['minecraft:gamemode spectator CortiEye','minecraft:tp CortiEye CortiLan','minecraft:spectate CortiLan CortiEye'])report.eyeSetup.push({command:q,response:await rc(q)});
 await until(async()=>{report.eyeStatus=await rc('cortieye');return report.eyeStatus.includes('attached=true');},'native Eye attachment');
 check('registered native spectator is actually attached',report.camera.some(p=>p.player===eye.username&&p.cameraId===corti.entity.id)&&report.eyeStatus.includes('attached=true'));
 const n=report.messages[eye.username].length;await query(corti,'/mycli world practice status','MC_WORLD ');await sleep(400);
 check('private practice status reaches the actual paired Eye',report.messages[eye.username].slice(n).some(s=>s.includes('MC_WORLD ')&&s.includes('"type":"practice"')));
 check('other player receives no paired practice status',!report.messages[a.username].some(s=>s.includes('MC_WORLD ')&&s.includes('"verifiedSteps":0')));
 report.passed=true;
}catch(e){report.error=String(e.stack||e);console.error(e);process.exitCode=1;}
finally{for(const b of bots){b.clearControlStates();b.quit();if(b.username.startsWith('Traverse46'))await rc('minecraft:whitelist remove '+b.username).catch(()=>{});}writeFileSync(root+'/restart-test-'+Date.now()+'.json',JSON.stringify(report,null,2));}
