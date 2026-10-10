// Bedrock 2193 wire test on the loopback copy; no phone/Xbox rendering or input is claimed.
import {createRequire} from 'node:module';import {randomUUID} from 'node:crypto';
import {writeFileSync,root,suffix,sleep,rc,report,check,until} from './skill-certifications-fixture.mjs';
const be=createRequire('E:/MC/research/bedrock-ysm-20261010/protocol-client/package.json')('bedrock-protocol');
const username='CertBE'+suffix,name='.'+username;let client,finishing=false;const texts=[],opens=[],contents=[],abilities=[];
function send(q){client.write('command_request',{command:q,origin:{type:'player',uuid:randomUUID(),request_id:'',player_entity_id:0n},internal:false,version:'52'});}
async function query(q,needle){const n=texts.length;send(q);await until(()=>texts.slice(n).some(t=>t.includes(needle)),q);await sleep(350);return texts.slice(n);}
try{
 client=be.createClient({host:'127.0.0.1',port:19158,version:'1.26.51',offline:true,username,raknetBackend:'raknet-native',useRaknetWorkers:false,connectTimeout:15000});
 client.on('session',p=>{p.xuid='90000000000'+suffix;}); // Declared isolated self-signed Floodgate fixture.
 let spawned=false;client.on('spawn',()=>spawned=true);client.on('error',e=>report.errors.push(String(e)));
 client.on('disconnect',p=>{if(!finishing)report.errors.push('disconnect: '+JSON.stringify(p));});
 client.on('text',p=>texts.push(p.message.replace(/§[0-9a-fk-or]/gi,'')));client.on('container_open',p=>opens.push(p));client.on('inventory_content',p=>contents.push({window:p.window_id,slots:p.input?.length,nonempty:p.input?.filter(i=>i.network_id!==0).length}));client.on('update_abilities',p=>abilities.push(p));
 await until(()=>spawned,'actual Bedrock spawn',30000);check('actual Bedrock fixture joins candidate Paper via Geyser',(await rc('minecraft:list uuids')).includes(name));
 await query('/mycli guild join','欢迎加入');await sleep(700);
 const state=await query('/mycli guild exam promotion','MC_GUILD_EXAM');check('Bedrock receives self scoped grade and exam CLI',state.some(s=>s.includes('"subjectUuid"')&&s.includes('"gradeIndex":0')));
 await query('/mycli skills info mage_soar','MC_SPELL_DETAIL');check('Bedrock skill details expose new paid profession skill',texts.some(s=>s.startsWith('MC_SPELL_DETAIL ')&&s.includes('mage_soar')));
 send('/mycli guild exam menu');await until(()=>opens.length>0&&contents.some(p=>p.window!==0&&p.slots>=45),'native Bedrock exam inventory');
 check('exam menu translates to native Bedrock container with items',contents.some(p=>p.window!==0&&p.slots>=45&&p.nonempty>=10),{opens,contents});
 const win=opens.at(-1);client.write('container_close',{window_id:win.window_id,window_type:win.window_type,server:false});await sleep(500);
 await query('/mycli profession choose mage','MC_PROFESSION_RESULT');await sleep(1000);await query('/mycli skills learn mage_soar','MC_PROFESSION_RESULT');await sleep(1000);
 const abilityCount=abilities.length,cast=await query('/mycli cast mage_soar','MC_PROFESSION_RESULT');check('Bedrock can learn and cast native paid soar',cast.some(s=>s.startsWith('MC_PROFESSION_RESULT ')&&s.includes('"reason":"success"')));
 await until(()=>abilities.length>abilityCount,'new native flight abilities');const flying=await rc('minecraft:data get entity '+name+' abilities.flying'),allowed=await rc('minecraft:data get entity '+name+' abilities.mayfly');
 check('Geyser sends new abilities for actual temporary survival flight',flying.trim().endsWith('1b')&&allowed.trim().endsWith('1b'),{beforePackets:abilityCount,afterPackets:abilities.length,flying,allowed});
 report.passed=true;
}catch(e){report.error=e.stack;console.error(e.stack);process.exitCode=1;}
finally{report.bedrock={protocol:2193,version:'1.26.51',texts,opens,contents,abilities};finishing=true;client?.close();await sleep(500);writeFileSync(root+'/bedrock-'+suffix+'.json',JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,2));}
