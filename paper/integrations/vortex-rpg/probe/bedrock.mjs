// Real Bedrock packets through isolated Geyser/Floodgate; no phone visual claim.
import fs from'node:fs/promises';import{createRequire}from'node:module';import{randomUUID}from'node:crypto';import assert from'node:assert/strict';
const output=process.argv[2];if(!output?.startsWith('E:/MC/staging/vortex-mmo-20261027/'))throw Error('isolated output only');
const bp=createRequire('E:/MC/research/bedrock-ysm-20261010/protocol-client/package.json')('bedrock-protocol');
const result={checks:[],errors:[],texts:[],protocol:2193,clientMods:[]};let client,closing=false,spawned=false,last=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const check=(name,condition)=>{assert.ok(condition,name);result.checks.push(name);};
async function until(fn,label,ms=40000){for(let end=Date.now()+ms;Date.now()<end;){const value=fn();if(value)return value;await sleep(80);}throw Error('timeout '+label);}
async function query(words){await sleep(Math.max(0,1200-(Date.now()-last)));last=Date.now();const n=result.texts.length;client.write('command_request',{command:'/mycli rpg '+words+' --json',origin:{type:'player',uuid:randomUUID(),request_id:'',player_entity_id:0n},internal:false,version:'52'});const line=await until(()=>result.texts.slice(n).find(t=>t.startsWith('MC_RPG ')),words,15000);return JSON.parse(line.slice(7));}
try{
 client=bp.createClient({host:'127.0.0.1',port:19186,version:'1.26.51',offline:true,username:'VRBedrock6',raknetBackend:'raknet-native',useRaknetWorkers:false,connectTimeout:20000});
 client.on('session',p=>{p.xuid='9000000000066';});client.on('spawn',()=>spawned=true);client.on('text',p=>result.texts.push(p.message.replace(/§[0-9a-fk-or]/gi,'')));client.on('error',e=>{if(!closing)result.errors.push(e.message);});
 await until(()=>spawned,'Bedrock spawn',45000);check('real Bedrock world joined',spawned);
 let state;for(let n=0;n<12;n++){state=await query('status');if(state.authority)break;}
 check('same Vortex API profile available',state.authority==='VortexRPG');
 const list=await query('class list');check('six native classes available',list.classes?.length===6);
 const chosen=await query('class choose cleric');check('Bedrock class selection saved',chosen.success&&chosen.saved);
 const skills=await query('skills list');check('native healing spell available',skills.available.includes('mend'));
 const quest=await query('quests list');check('adventure quest board available',quest.quests.some(q=>q.id==='qd_first_hunt'));
 const shop=await query('shop info quartermaster');check('same standard trade prices',shop.currency==='emerald'&&shop.offers[0].emeralds===1);
 let opened=false;client.on('container_open',()=>opened=true);client.on('update_trade',p=>{opened=true;result.tradeWindow={windowId:p.window_id,windowType:p.window_type};});await query('shop open quartermaster');await until(()=>opened,'native Bedrock trade window',10000);check('merchant window protocol received without client mods',opened);
 const town=await query('town info weapon_shop');check('real city building coordinates available',town.world==='aincrad'&&town.entrance[0]===-504&&town.state==='surveyed_not_operating');
}catch(e){result.errors.push(e.stack||String(e));}
finally{closing=true;try{client?.close();}catch{}await fs.writeFile(output,JSON.stringify(result,null,2));console.log(JSON.stringify({bedrockChecks:result.checks.length,errors:result.errors.length}));process.exit(result.errors.length?1:0);}
