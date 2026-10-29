/** Reproduction only: measured native auction delivery on disposable local QA identities. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';import {command} from '../../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/vortex-takeover-20261027',label=process.argv[2];assert(/^[a-z0-9]{1,6}$/.test(label));assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const mf=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer'),bots=[],report={productionChanged:false,receipts:[]};let last=0;
const until=async(f,n)=>{for(let end=Date.now()+20000;Date.now()<end;){const value=await f();if(value)return value;await sleep(100);}throw Error(n);};
const rc=async q=>{const result=await command(q,15000,{port:25929,properties:stage+'/server.properties'});report.receipts.push({q,result});return result;};
async function connect(suffix){const b=mf.createBot({host:'127.0.0.1',port:25928,username:'ag_RUAU'+suffix+label,auth:'offline',version:'1.21.1',hideErrors:true});bots.push(b);b.messages=[];b.on('messagestr',s=>b.messages.push(s));b.on('error',()=>{});installRecipePacketBypass(b._client);await until(()=>b.entity&&b.world.getColumnAt(b.entity.position),'world');b.physicsEnabled=false;await sleep(2000);return b;}
async function query(b,q,pattern){await sleep(Math.max(0,1200-(Date.now()-last)));last=Date.now();const at=b.messages.length;b.chat(q);await until(()=>b.messages.slice(at).some(s=>pattern.test(s)),'reply '+q);const messages=b.messages.slice(at);report.receipts.push({player:b.username,q,messages});return messages;}
async function state(b){const lines=await query(b,'/mycli status --json',/^MC_RPG /);return JSON.parse(lines.find(s=>s.startsWith('MC_RPG ')).slice(7));}
const bread=b=>b.inventory.items().filter(x=>x.name==='bread').reduce((n,x)=>n+x.count,0);
try{
 const a=await connect('a'),b=await connect('b');await state(a);await state(b);await rc('essentials:eco give '+a.username+' 50');await rc('essentials:eco give '+b.username+' 50');await rc('minecraft:give '+a.username+' bread 3');await until(()=>bread(a)===3,'seller items');await a.equip(a.inventory.items().find(x=>x.name==='bread'),'hand');
 report.before={sellerBread:bread(a),buyerBread:bread(b),sellerBalance:(await state(a)).economy.balance,buyerBalance:(await state(b)).economy.balance};
 await query(a,'/auction sell 5',/listed|listing|auction|fee|拍卖|上架/i);await sleep(1500);
 const listings=JSON.parse(await fs.readFile(stage+'/plugins/VortexRPG/auctions.json','utf8'));const listing=listings.find(x=>String(x.sellerUuid).toLowerCase()===a.player.uuid.toLowerCase());assert(listing,'actual native listing persisted');report.listing=listing;
 b.chat('/auction browse');await until(()=>b.currentWindow,'native menu');const slot=b.currentWindow.slots.slice(0,b.currentWindow.inventoryStart).findIndex(x=>x?.name==='bread');assert(slot>=0,'listed bread icon');await b.clickWindow(slot,0,0);await sleep(2500);
 report.after={sellerBread:bread(a),buyerBread:bread(b),sellerBalance:(await state(a)).economy.balance,buyerBalance:(await state(b)).economy.balance,serverBuyerBread:await rc('minecraft:data get entity '+b.username+' Inventory[{id:"minecraft:bread"}].count')};
 report.deliveryConfirmed=report.after.buyerBread===report.before.buyerBread+3;report.buyerCharged=report.after.buyerBalance===report.before.buyerBalance-5;
 report.sellerMessages=a.messages.slice(-8);report.buyerMessages=b.messages.slice(-8);console.log(JSON.stringify({before:report.before,after:report.after,deliveryConfirmed:report.deliveryConfirmed,buyerCharged:report.buyerCharged}));
}catch(error){report.error=error.stack;throw error;}finally{await fs.writeFile(stage+'/auction-audit-'+label+'.json',JSON.stringify(report,null,2));for(const b of bots)b.quit();}
