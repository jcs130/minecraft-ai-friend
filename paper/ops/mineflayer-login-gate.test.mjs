import test from 'node:test';import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';import {setTimeout as sleep} from 'node:timers/promises';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {installLoginGate} from './mineflayer-login-gate.mjs';import {authState,proxyHeader} from './auth-proxy.mjs';
function bot(){const b=new EventEmitter();b.commands=[];b.chat=s=>b.commands.push(s);b.quit=()=>{b.quits=(b.quits??0)+1;};return b;}
test('limbo spawn and public chat cannot authorize a bot',async()=>{
 const b=bot(),g=installLoginGate(b,{password:'private-test-value',timeoutMs:3000});
 b.emit('spawn');b.emit('messagestr','<Impostor> [MC_AUTH_SUCCESS] 登录成功，可以开始游戏。');assert.equal(g.authenticated,false);
 b.emit('messagestr','[MC_AUTH_LOGIN] 请先登录');b.emit('messagestr','[MC_AUTH_LOGIN] 请先登录');await sleep(600);
 assert.deepEqual(b.commands,['/login private-test-value']);assert.equal(g.authenticated,false);
 b.emit('messagestr','[MC_AUTH_PASSWORD_OK] 密码验证通过');assert.equal(g.authenticated,false);
 b.emit('messagestr','[MC_AUTH_SUCCESS] 登录成功，可以开始游戏。');await g.ready;assert.equal(g.authenticated,true);assert.equal(b.listenerCount('messagestr'),0);
});
test('wrong password stops once and does not log credentials',async()=>{
 const b=bot(),logs=[],g=installLoginGate(b,{password:'must-not-appear-in-logs',log:s=>logs.push(s)});const rejected=assert.rejects(g.ready,/AUTH_REJECTED/);
 b.emit('messagestr','[MC_AUTH_WRONG] 密码错误');b.emit('messagestr','[MC_AUTH_LOGIN] 请先登录');await rejected;await sleep(600);
 assert.equal(b.quits,1);assert.equal(b.commands.length,0);assert.deepEqual(logs,['AUTH_REJECTED']);
});
test('missing credentials and timeout fail without retries',async()=>{
 const b=bot(),g=installLoginGate(b,{timeoutMs:3000,automaticLoginGraceMs:10});const p=assert.rejects(g.ready,/AUTH_PASSWORD_MISSING/);b.emit('messagestr','[MC_AUTH_LOGIN] 请先登录');await p;assert.equal(b.commands.length,0);
 const c=bot(),h=installLoginGate(c,{password:'unused',timeoutMs:10});await Promise.all([assert.rejects(h.ready,/AUTH_TIMEOUT/),sleep(25)]);assert.equal(c.quits,1);
});
test('passwordless Eye waits for server success after an initial login prompt',async()=>{
 const b=bot(),g=installLoginGate(b,{timeoutMs:3000,automaticLoginGraceMs:100});
 b.emit('messagestr','[MC_AUTH_LOGIN] 请先登录');b.emit('messagestr','[MC_AUTH_LOGIN] 请先登录');
 b.emit('messagestr','[MC_AUTH_EYE] 观战账号已自动登录');assert.equal(g.authenticated,false);
 b.emit('messagestr','<Fake> [MC_AUTH_SUCCESS] 登录成功，可以开始游戏。');assert.equal(g.authenticated,false);
 b.emit('messagestr','[MC_AUTH_SUCCESS] 登录成功，可以开始游戏。');await g.ready;await sleep(125);
 assert.equal(g.authenticated,true);assert.deepEqual(b.commands,[]);assert.equal(b.quits,undefined);
});
test('first-visit accounts and Eyes wait for exact success without registering a shared secret',async()=>{
 const b=bot();b.username='ag_NEW_eye';const g=installLoginGate(b,{timeoutMs:3000,automaticLoginGraceMs:100});
 b.emit('messagestr','[MC_AUTH_REGISTER] 请注册');assert.equal(g.authenticated,false);
 b.emit('messagestr','[MC_AUTH_SUCCESS] 登录成功，可以开始游戏。');await g.ready;await sleep(125);assert.deepEqual(b.commands,[]);assert.equal(b.quits,undefined);
 const c=bot();c.username='new_guest';const h=installLoginGate(c,{timeoutMs:3000});
 c.emit('messagestr','[MC_AUTH_REGISTER] 请注册');c.emit('messagestr','[MC_AUTH_PASSWORD_SETUP] 首次进入请设置密码');assert.equal(h.authenticated,false);
 c.emit('messagestr','[MC_AUTH_SUCCESS] 登录成功，可以开始游戏。');await h.ready;assert.deepEqual(c.commands,[]);
});
test('trusted proxy framing validates addresses and cannot contain injected lines',()=>{
 assert.equal(proxyHeader('::ffff:192.168.3.133',12345,'127.0.0.1',25581).toString(),'PROXY TCP4 192.168.3.133 127.0.0.1 12345 25581\r\n');
 assert.throws(()=>proxyHeader('192.168.3.1\r\nPROXY UNKNOWN',12345,'127.0.0.1',25581));
});
test('absent, stale, corrupt and future authentication health all fail closed',()=>{
 const dir=mkdtempSync(join(tmpdir(),'mc-auth-')),f=join(dir,'health.json');
 try {
   assert.equal(authState(f,10000),null);writeFileSync(f,'{');assert.equal(authState(f,10000),null);
   for(const s of [{ready:false,at:9999,authorizedNames:[]},{ready:true,at:4999,authorizedNames:[]},{ready:true,at:10001,authorizedNames:[]}]) {writeFileSync(f,JSON.stringify(s));assert.equal(authState(f,10000),null);}
   writeFileSync(f,JSON.stringify({ready:true,at:9999,authorizedNames:['ag_NEKO']}));assert.deepEqual(authState(f,10000).authorizedNames,['ag_NEKO']);
 } finally {rmSync(dir,{recursive:true});}
});
