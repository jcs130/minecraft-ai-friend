// Native Java LAN discovery, same wire format as BetterLANBroadcaster:
// https://github.com/myxxr/BetterLANBroadcaster . No game or proxy plugin load.
import dgram from 'node:dgram';
import os from 'node:os';
import path from 'node:path';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {isIPv4} from 'node:net';
const run=promisify(execFile);
export const destination={address:'224.0.2.60',port:4445,ttl:1};

export function validateConfig(raw){
 const c={...raw};
 if(c.schemaVersion!==1||typeof c.motd!=='string'||!c.motd.trim()||Buffer.byteLength(c.motd)>180||/[\[\]\x00-\x1f\x7f]/.test(c.motd))throw Error('Invalid LAN title');
 const ip=typeof c.interfaceAddress==='string'?c.interfaceAddress.split('.').map(Number):[];
 if(!isIPv4(c.interfaceAddress??'')||!(ip[0]===10||ip[0]===192&&ip[1]===168||ip[0]===172&&ip[1]>=16&&ip[1]<=31))throw Error('Choose the explicit private LAN IPv4 address');
 if(!Number.isInteger(c.port)||c.port<1||c.port>65535)throw Error('Invalid advertised game port');
 if(!Number.isInteger(c.backendPort)||c.backendPort<1||c.backendPort>65535)throw Error('Invalid loopback game port');
 if(typeof c.statusScript!=='string'||!path.isAbsolute(c.statusScript)||typeof c.stateFile!=='string'||!path.isAbsolute(c.stateFile))throw Error('Explicit runtime paths required');
 if(c.maintenanceFile!==undefined&&(typeof c.maintenanceFile!=='string'||!path.isAbsolute(c.maintenanceFile)))throw Error('Invalid maintenance path');
 return Object.freeze(c);
}
export function payload(c){return Buffer.from(`[MOTD]${c.motd}[/MOTD][AD]${c.port}[/AD]`,'utf8');}

export function createAnnouncer(c,{probe,send,now=Date.now}){
 let healthy=false,checkedAt=null,sent=0,busy=null,lastError='not checked';
 const fresh=()=>healthy&&checkedAt!==null&&now()-checkedAt<=30000;
 const state=()=>({schemaVersion:1,phase:fresh()?'announcing':'suppressed',observedAt:new Date(now()).toISOString(),
  interfaceAddress:c.interfaceAddress,port:c.port,lastCheckedAt:checkedAt===null?null:new Date(checkedAt).toISOString(),packetsSent:sent,reason:fresh()?'ready':healthy?'Health check expired':lastError});
 const refresh=()=>{
  if(busy)return busy;
  busy=(async()=>{try{await probe(c);healthy=true;lastError='';}catch(e){healthy=false;lastError=e.message;}
   checkedAt=now();return state();})().finally(()=>{busy=null;});return busy;
 };
 const broadcast=()=>{
  if(!fresh())return false;
  send(payload(c),destination);sent++;return true;
 };
 return{refresh,broadcast,state};
}
async function probe(c){
 if(!Object.values(os.networkInterfaces()).flat().some(n=>n?.family==='IPv4'&&!n.internal&&n.address===c.interfaceAddress))throw Error('Configured LAN interface unavailable');
 if(c.maintenanceFile&&existsSync(c.maintenanceFile))throw Error('Game maintenance');
 // Reuse the existing Minecraft status CLI. Check both the authenticated LAN
 // entry and the loopback game so a surviving login proxy is not a ghost world.
 await Promise.all([[c.interfaceAddress,c.port],['127.0.0.1',c.backendPort]].map(async([host,port])=>{
  const {stdout}=await run(process.execPath,[c.statusScript,host,String(port),'767'],{timeout:4000,maxBuffer:65536,windowsHide:true});
  if(!stdout.startsWith(`OK ${host}:${port} | `))throw Error('Minecraft status unavailable');
 }));
}
async function saveState(c,data){await mkdir(path.dirname(c.stateFile),{recursive:true});const temp=c.stateFile+'.tmp';await writeFile(temp,JSON.stringify(data,null,2)+'\n');await rename(temp,c.stateFile);}

export async function main(args=process.argv.slice(2)){
 const index=args.indexOf('--config');if(index<0||!args[index+1])throw Error('Use --config <absolute config file>');
 const c=validateConfig(JSON.parse((await readFile(args[index+1],'utf8')).replace(/^\uFEFF/,'')));
 if(args.includes('--check')){await probe(c);return{passed:true,gameAndAuthenticatedEntryReady:true,broadcastStarted:false};}
 await probe(c);
 const socket=dgram.createSocket('udp4');
 await new Promise((resolve,reject)=>{socket.once('error',reject);socket.bind(0,c.interfaceAddress,resolve);});
 socket.setMulticastInterface(c.interfaceAddress);socket.setMulticastTTL(destination.ttl);socket.setMulticastLoopback(true);
 let closing=false;
 const broadcaster=createAnnouncer(c,{probe,send:(bytes,d)=>socket.send(bytes,d.port,d.address)});
 socket.on('error',async e=>{console.error('LAN discovery socket:',e.message);await close(1);});
 const announce=setInterval(()=>broadcaster.broadcast(),1500);
 const health=setInterval(()=>broadcaster.refresh().then(s=>saveState(c,s)).catch(e=>console.error(e.message)),15000);
 async function close(code=0){if(closing)return;closing=true;clearInterval(announce);clearInterval(health);await saveState(c,{...broadcaster.state(),phase:'stopped'}).catch(()=>{});socket.close();process.exitCode=code;}
 process.once('SIGTERM',()=>close());process.once('SIGINT',()=>close());
 await broadcaster.refresh();broadcaster.broadcast();await saveState(c,broadcaster.state());
 return{running:true,pid:process.pid,interfaceAddress:c.interfaceAddress,port:c.port};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
