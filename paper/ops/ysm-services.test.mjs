import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {validateConfig,permittedConsole} from './ysm-services.mjs';
const root=resolve('ysm-test-root');
function config(){return {schemaVersion:1,enabled:true,root,java:resolve('java.exe'),controlToken:'a'.repeat(64),controlPort:25650,workerControllerPort:25649,
  proxy:{directory:join(root,'proxy'),port:25647,jar:'velocity.jar',sha256:'b'.repeat(64),heapMiB:512},worker:{directory:join(root,'worker'),port:25648,jar:'fabric.jar',sha256:'c'.repeat(64),heapMiB:768}};}
test('separate internal services and bounded JVM heaps',()=>{assert.equal(validateConfig(config()).proxy.heapMiB,512);for(const mutate of [c=>c.worker.port=c.proxy.port,c=>c.proxy.heapMiB=8192,c=>c.controlPort=0,c=>c.proxy.sha256='unverified']){const c=config();mutate(c);assert.throws(()=>validateConfig(c));}});
test('service paths cannot escape the private root',()=>{for(const mutate of [c=>c.worker.directory=resolve(root,'../unrelated'),c=>c.worker.directory=root,c=>c.proxy.jar='../unrelated.jar',c=>c.controlToken='placeholder']){const c=config();mutate(c);assert.throws(()=>validateConfig(c));}});
test('console accepts only appearance operations and bounded identifiers',()=>{assert(permittedConsole('proxy','appearance admin set ag_CorMy 猫娘 白色'));assert(permittedConsole('worker','ysm model reload'));for(const [s,q] of [['proxy','stop'],['worker','op Guest'],['proxy','appearance list\nshutdown'],['proxy','appearance admin set player ../../x blue'],['proxy','appearance admin set '+'a'.repeat(17)+' alex gsl']])assert.equal(permittedConsole(s,q),false);});
