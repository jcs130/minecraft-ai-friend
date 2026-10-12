// Real Paper/Minepacks; a loopback TCP relay introduces latency. Two explicitly
// labelled client-side faults hide a cursor acknowledgement and cut a connection.
// This is controlled protocol acceptance, not an autonomous LLM test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../rcon-client.mjs';
import {fix1206PotionProtocol} from '../minecraft-1206-potion.mjs';
import {installRecipePacketBypass} from '../mineflayer-client-compat.mjs';
import {installInventorySession,createInventoryJournal} from '../mineflayer-inventory-session.mjs';
const stage=process.env.MC_STAGE_PAPER,root=process.env.MC_TEST_REPORT_DIR;
assert(stage&&root&&path.resolve(stage).toLowerCase().includes('staging'));
const props=fs.readFileSync(stage+'/server.properties','utf8');assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);
const port=Number(props.match(/^server-port=(\d+)/m)?.[1]);assert(port>=25600&&port<25700);
const rcon=q=>command(q,15000,{properties:stage+'/server.properties',port:Number(props.match(/^rcon.port=(\d+)/m)?.[1])});
const require=createRequire(process.env.MF_REQUIRE_FROM??'E:/MC/probe/package.json');fix1206PotionProtocol(require);
const mf=require('mineflayer'),label=process.argv[2]??'1';assert.match(label,/^[a-z0-9]{1,8}$/);
const name='ag_BagFault'+label,report={scope:'isolated TCP latency and labelled decoded-packet faults',mineflayer:require('mineflayer/package.json').version,at:new Date().toISOString(),checks:[],receipts:[],packets:[],writes:[],errors:[]};
report.candidateSha256=createHash('sha256').update(fs.readFileSync(stage+'/plugins/AgentFriend-0.4.27.jar')).digest('hex');
const sockets=new Set(),clients=[];let finishing=false,relay;
function check(name,ok,details){report.checks.push({name,pass:!!ok,details});assert(ok,name);console.log('PASS '+name);}
async function until(fn,name,ms=30000){const end=Date.now()+ms;while(Date.now()<end){if(fn())return;await sleep(20);}throw Error('Timeout '+name);}
async function join(atPort){const bot=mf.createBot({host:'127.0.0.1',port:atPort,username:name,version:'1.20.6',auth:'offline',logErrors:false,defaultChatPatterns:false});installRecipePacketBypass(bot._client);clients.push(bot);
  const c={bot,writeCount:0,fault:'',ended:false,lines:[]},write=bot._client.write.bind(bot._client),emit=bot._client.emit.bind(bot._client);
  bot._client.write=(type,p)=>{if(type==='window_click'){c.writeCount++;report.writes.push({connection:clients.length,type,packet:p,at:Date.now()});}return write(type,p);};
  bot._client.emit=(event,...args)=>{
    const p=args[0];
    if(event==='set_slot'&&p.slot===-1&&(p.windowId===255||p.windowId===-1)){
      if(c.fault==='hide_final_cursor'&&c.writeCount===2&&!p.item.itemCount){c.fault='cursor_hidden';report.packets.push({fault:'hidden final cursor acknowledgement',at:Date.now()});return true;}
      if(c.fault==='disconnect_after_pickup'&&p.item.itemCount){c.fault='connection_cut';report.packets.push({fault:'TCP connection cut after real pickup',at:Date.now()});bot._client.socket.destroy();return true;}
    }
    return emit(event,...args);
  };
  bot._client.on('packet',(p,m)=>{if(['open_window','window_items','set_slot','close_window'].includes(m.name))report.packets.push({connection:clients.length,name:m.name,window:p.windowId,stateId:p.stateId,slot:p.slot,cursor:p.carriedItem?.itemCount,itemCount:p.item?.itemCount,items:p.items?.map(i=>i.itemCount),at:Date.now()});});
  bot.on('messagestr',s=>c.lines.push(s));bot.on('end',()=>c.ended=true);bot.on('error',e=>{if(!finishing&&c.fault!=='connection_cut')report.errors.push(e.message);});
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('spawn timeout')),30000);bot.once('spawn',()=>{clearTimeout(t);bot.physicsEnabled=false;resolve();});bot.once('kicked',p=>reject(Error(JSON.stringify(p))));bot.once('error',reject);});
  await sleep(2200);return c;
}
const count=(snapshot,start,end)=>snapshot.slots.slice(start,end).filter(i=>i?.name==='paper').reduce((n,i)=>n+i.count,0);
const install=c=>installInventorySession(c.bot,{Item:require('prismarine-item')(c.bot.registry),timeoutMs:2500,quietMs:100,journal:createInventoryJournal(root+'/inventory-'+label+'-'+c.bot.player.uuid+'.json'),onReceipt:r=>report.receipts.push(r)});
try {
  relay=net.createServer(front=>{const back=net.connect({host:'127.0.0.1',port});sockets.add(front);sockets.add(back);
    for(const [source,target] of [[front,back],[back,front]]){source.on('data',chunk=>setTimeout(()=>{if(!target.destroyed)target.write(chunk);},180));source.on('error',()=>target.destroy());source.on('close',()=>{sockets.delete(source);target.destroy();});}
  });await new Promise((resolve,reject)=>{relay.once('error',reject);relay.listen(0,'127.0.0.1',resolve);});
  const c=await join(relay.address().port);await rcon('minecraft:give '+name+' paper 8');await until(()=>c.bot.inventory.items().some(i=>i.name==='paper'&&i.count===8),'real eight paper');
  const api=install(c);assert.equal((await api.open()).status,'opened');const before=api.snapshot().snapshot;
  const source=before.slots.findIndex((i,n)=>n>=54&&i?.name==='paper'),pending=api.transfer({operationId:'latency-'+label,direction:'deposit',slot:source,count:3});
  c.bot.emit('windowOpen',c.bot.currentWindow);c.bot.emit('windowOpen',c.bot.currentWindow);
  const put=await pending;check('real latency plus duplicate callbacks transfers only three paper',put.status==='confirmed'&&count(put.after,0,54)===3&&count(put.after,54,90)===5&&put.after.cursor===null);
  await api.close();await sleep(600);const re=await api.open();check('real delayed close/reopen confirms persistence',re.status==='opened'&&count(re.snapshot,0,54)===3);
  c.writeCount=0;c.fault='hide_final_cursor';
  const slot=re.snapshot.slots.findIndex((i,n)=>n<54&&i?.name==='paper');
  const take=api.transfer({operationId:'hidden-ack-'+label,direction:'withdraw',slot,count:3}),queued=api.transfer({operationId:'must-not-repeat-'+label,direction:'withdraw',slot,count:3});
  check('lost cursor acknowledgement yields unknown rather than success',(await take).status==='unknown');
  check('following request is blocked and no extra click is written',(await queued).status==='blocked'&&c.writeCount===2);
  const confirmed=await api.reconcile();check('fresh read confirms completed transfer without replay',confirmed.status==='confirmed'&&confirmed.reconciled&&confirmed.after.cursor===null&&count(confirmed.after,54,90)===8&&c.writeCount===2);
  c.fault='';await api.close();await sleep(600);await api.open();
  c.writeCount=0;c.fault='disconnect_after_pickup';const current=api.snapshot().snapshot,from=current.slots.findIndex((i,n)=>n>=54&&i?.name==='paper'&&i.count>=4);assert(from>=54);
  const lost=api.transfer({operationId:'disconnected-'+label,direction:'deposit',slot:from,count:4}),following=api.transfer({operationId:'queued-after-end-'+label,direction:'deposit',slot:from,count:4});
  check('actual connection interruption returns unknown',(await lost).status==='unknown');await until(()=>c.ended,'actual disconnect');
  check('disconnect prevents queued writes and retains durable intent',(await following).status==='blocked'&&c.writeCount===1&&fs.existsSync(root+'/inventory-'+label+'-'+c.bot.player.uuid+'.json'));
  await sleep(1700);const fresh=await join(port),recovered=install(fresh),opened=await recovered.open();
  check('same UUID reconnect loads unknown gate',opened.status==='opened'&&opened.blocked===true);
  check('fresh session cannot replay a new transfer before reconciliation',(await recovered.transfer({operationId:'new-connection-write-'+label,direction:'deposit',slot:54,count:1})).status==='blocked'&&fresh.writeCount===0);
  const result=await recovered.reconcile({allowPersonalReopen:true});
  check('same-owner fresh backpack proves interrupted pickup returned to inventory',result.status==='not_applied'&&result.reconciled&&count(result.after,0,54)===0&&count(result.after,54,90)===8&&result.after.cursor===null&&fresh.writeCount===0);
  check('old operation id returns reconciliation receipt and never replays',(await recovered.transfer({operationId:'disconnected-'+label,direction:'deposit',slot:54,count:4})).status==='not_applied'&&fresh.writeCount===0);
  report.finalSnapshot=result.after;await recovered.close();await rcon('minecraft:save-all flush');
  const nbt=require('prismarine-nbt'),native=nbt.simplify((await nbt.parse(fs.readFileSync(stage+'/world/playerdata/'+fresh.bot.player.uuid+'.dat'))).parsed);
  report.finalNativeInventory=native.Inventory;check('native saved inventory independently preserves all eight paper',native.Inventory.filter(i=>i.id==='minecraft:paper').reduce((n,i)=>n+i.count,0)===8);
  check('no unexpected native errors',report.errors.length===0);
}catch(e){report.errors.push(e.stack??String(e));}
finally{finishing=true;for(const b of clients)if(!b._client.ended)b.quit();for(const s of sockets)s.destroy();relay?.close();await sleep(500);report.passed=report.errors.length===0&&report.checks.every(c=>c.pass);fs.writeFileSync(root+'/inventory-native-'+label+'.json',JSON.stringify(report,(_k,v)=>typeof v==='bigint'?v.toString():v,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,errors:report.errors}));process.exit(report.passed?0:1);}
