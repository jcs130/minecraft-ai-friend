import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {validateConfig,permittedConsole,appearanceBackend,nativeBackendStatus} from './ysm-services.mjs';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import os from 'node:os';
const root=resolve('ysm-test-root');
function config(){return {schemaVersion:1,enabled:true,root,java:resolve('java.exe'),controlToken:'a'.repeat(64),controlPort:25650,workerControllerPort:25649,
  proxy:{directory:join(root,'proxy'),port:25647,jar:'velocity.jar',sha256:'b'.repeat(64),heapMiB:512},worker:{directory:join(root,'worker'),port:25648,jar:'fabric.jar',sha256:'c'.repeat(64),heapMiB:768}};}
test('separate internal services and bounded JVM heaps',()=>{assert.equal(validateConfig(config()).proxy.heapMiB,512);for(const mutate of [c=>c.worker.port=c.proxy.port,c=>c.proxy.heapMiB=8192,c=>c.controlPort=0,c=>c.proxy.sha256='unverified']){const c=config();mutate(c);assert.throws(()=>validateConfig(c));}});
test('service paths cannot escape the private root',()=>{for(const mutate of [c=>c.worker.directory=resolve(root,'../unrelated'),c=>c.worker.directory=root,c=>c.proxy.jar='../unrelated.jar',c=>c.controlToken='placeholder']){const c=config();mutate(c);assert.throws(()=>validateConfig(c));}});
test('console accepts only appearance operations and bounded identifiers',()=>{assert(permittedConsole('proxy','appearance admin set ag_CorMy 猫娘 白色'));assert(permittedConsole('worker','ysm model reload'));for(const [s,q] of [['proxy','stop'],['worker','op Guest'],['proxy','appearance list\nshutdown'],['proxy','appearance admin set player ../../x blue'],['proxy','appearance admin set '+'a'.repeat(17)+' alex gsl']])assert.equal(permittedConsole(s,q),false);});

const nativeSha='b285c73d4ec010d9a9be3c53c1bee890cf269645be5f1bcf1c27a2e8e82807cb';
function nativeConfig(){return {...config(),appearanceBackend:'native265',native:{properties:resolve('server.properties'),rconPort:29575,stateFile:join(root,'native-state.json'),jarSha256:nativeSha}};}
test('native mode is explicit and cannot accept a mixed artifact or conflicting RCON route',()=>{
 assert.equal(appearanceBackend(validateConfig(config())),'worker241');assert.equal(appearanceBackend(validateConfig(nativeConfig())),'native265');
 const fresh=nativeConfig();delete fresh.worker;delete fresh.workerControllerPort;assert.equal(validateConfig(fresh).appearanceBackend,'native265');
 for(const mutate of [c=>c.appearanceBackend='native',c=>c.native.jarSha256='0'.repeat(64),c=>c.native.rconPort=c.controlPort,c=>c.native.properties=resolve('not-server.properties'),c=>c.native.stateFile='relative.json',c=>c.native.stateFile=resolve('outside-state.json')]){const c=nativeConfig();mutate(c);assert.throws(()=>validateConfig(c));}
});
test('native control preserves typed self/body operations without general console access',()=>{
 assert(permittedConsole('proxy','appearance admin set DeepFish 大肥鱼_1.1.ysm white','native265'));
 assert(permittedConsole('proxy','appearance admin set DeepFish 作者/模型.zip white','native265'));
 for(const q of ['appearance admin set DeepFish ../secret white','appearance admin set DeepFish /absolute white','execute run op Guest','appearance admin set DeepFish model white\nstop'])assert.equal(permittedConsole('proxy',q,'native265'),false);
 assert.equal(permittedConsole('proxy','appearance admin set DeepFish 作者/模型.zip white'),false);
});
test('optional compatible authentication backend is private, bounded and has unique ports',()=>{
 const c=nativeConfig();c.auth={directory:join(root,'auth'),properties:join(root,'auth','server.properties'),port:25651,rconPort:25652,jar:'server.jar',sha256:'d'.repeat(64),heapMiB:1536};
 assert.equal(validateConfig(c).auth.heapMiB,1536);assert.equal(permittedConsole('auth','op Guest','native265'),false);
 for(const mutate of [x=>x.auth.port=x.proxy.port,x=>x.auth.rconPort=x.controlPort,x=>x.auth.rconPort=x.native.rconPort,x=>x.auth.heapMiB=512,x=>x.auth.heapMiB=4096,x=>x.auth.directory=resolve(root,'../outside'),x=>x.auth.properties=join(root,'proxy','server.properties'),x=>x.appearanceBackend='worker241']){
  const value=structuredClone(c);mutate(value);assert.throws(()=>validateConfig(value));
 }
});
test('native status never reports a legacy Worker alive and expires stale model evidence',()=>{
 const root=mkdtempSync(join(os.tmpdir(),'ysm-native-status-')),c=nativeConfig();c.native.stateFile=join(root,'state.json');const now=Date.now();
 const state={schemaVersion:1,source:'ysm_native_backend',writtenAt:now,players:[{available:true,source:'ysm_native_backend',ysmVersion:'2.6.5',protocolVersion:'2.6.0',jarSha256:nativeSha}]};
 try{
  writeFileSync(c.native.stateFile,JSON.stringify(state));assert.equal(nativeBackendStatus(c,now).ready,true);assert.equal(nativeBackendStatus(c,now+15001).ready,false);
  for(const change of [{source:'freesia_worker'},{writtenAt:now+2000},{players:[]},{players:[{...state.players[0],jarSha256:'0'.repeat(64)}]}]){writeFileSync(c.native.stateFile,JSON.stringify({...state,...change}));assert.equal(nativeBackendStatus(c,now).ready,false);}
 }finally{rmSync(root,{recursive:true,force:true});}
});
