import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {scryptSync} from 'node:crypto';
import {createPanelServer} from '../admin/server.mjs';

const token='internal-secret-sentinel-'.repeat(3),salt='test-salt',password='only-in-test-fixture';
async function fixture(t){
  const calls=[];let now=Date.now();
  const server=createPanelServer({stateDir:'unused-test-state',publicOrigin:'http://127.0.0.1:19091',management:{
    token,passwordHash:{salt,hash:scryptSync(password,salt,32).toString('hex')},clock:()=>now,
    transport:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({ok:true,services:[],state:{observer:{online:false}}}),{status:200,headers:{'Content-Type':'application/json'}});}
  }});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  async function request(route,{method='GET',headers={},body}={}){
    return new Promise((resolve,reject)=>{
      const req=http.request({host:'127.0.0.1',port:server.address().port,path:route,method,headers:{Host:'127.0.0.1:19091',...headers}},res=>{
        let raw='';res.on('data',x=>raw+=x);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,raw,json:()=>JSON.parse(raw)}));
      });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
    });
  }
  async function login(){const r=await request('/api/manage/login',{method:'POST',headers:{Origin:'http://127.0.0.1:19091','Content-Type':'application/json'},body:{password}});assert.equal(r.status,200);return {Cookie:r.headers['set-cookie'][0].split(';')[0],Origin:'http://127.0.0.1:19091','Content-Type':'application/json','X-CSRF-Token':r.json().csrf};}
  return{request,login,calls,advance:ms=>{now+=ms;}};
}
test('public state never grants management; rejected mutations never reach backend',async t=>{
  const f=await fixture(t);
  for(const route of ['/api/manage/session','/api/manage/services','/api/eye/state']){const r=await f.request(route);assert.equal(r.status,200);assert.equal(r.raw.includes(token),false);}
  assert.equal(f.calls.length,2);
  for(const route of ['/api/manage/plan','/api/manage/execute','/api/eye/observer'])assert.equal((await f.request(route,{method:'POST',body:{action:'stop',services:['mc']}})).status,401);
  for(const route of ['/api/manage/logs?service=mc','/api/manage/operations'])assert.equal((await f.request(route)).status,401);
  assert.equal(f.calls.length,2);
});
test('host and origin checks precede login; authenticated writes require CSRF',async t=>{
  const f=await fixture(t);
  for(const headers of [{Host:'evil.invalid'},{Origin:'https://evil.invalid'},{'Sec-Fetch-Site':'cross-site'},{}]){
    const r=await f.request('/api/manage/login',{method:'POST',headers,body:{password}});assert.equal(r.status,403);
  }
  const headers=await f.login();
  for(const extra of [{'X-CSRF-Token':''},{Origin:''},{Origin:'http://evil.invalid'}])assert.equal((await f.request('/api/manage/plan',{method:'POST',headers:{...headers,...extra},body:{action:'stop',services:['mc']}})).status,403);
  assert.equal(f.calls.length,0);
  const r=await f.request('/api/manage/plan',{method:'POST',headers,body:{action:'restart',services:['npc']}});
  assert.equal(r.status,200);assert.equal(f.calls[0].url,'http://control:3090/plan');assert.equal(f.calls[0].options.headers.Authorization,'Bearer '+token);
  assert.equal(f.calls[0].options.headers.Cookie,undefined);assert.equal(r.raw.includes(token),false);
});
test('login cookie is protected, logout revokes it and expired sessions cannot mutate',async t=>{
  const f=await fixture(t);const headers=await f.login();
  assert.equal((await f.request('/api/manage/session',{headers})).json().authenticated,true);
  assert.equal((await f.request('/api/manage/logout',{method:'POST',headers,body:{}})).status,200);
  assert.equal((await f.request('/api/manage/execute',{method:'POST',headers,body:{planId:'x'}})).status,401);
  const second=await f.login();f.advance(3600001);
  assert.equal((await f.request('/api/manage/operations',{headers:second})).status,401);
  assert.equal(f.calls.length,0);
});
test('password failures are rate limited; route and map validation reject arbitrary upstream access',async t=>{
  const f=await fixture(t),bad={method:'POST',headers:{Origin:'http://127.0.0.1:19091','Content-Type':'application/json'},body:{password:'wrong'}};
  for(let i=0;i<5;i++)assert.equal((await f.request('/api/manage/login',bad)).status,401);
  assert.equal((await f.request('/api/manage/login',bad)).status,429);f.advance(60001);const headers=await f.login();
  for(const route of ['/api/manage/containers/json','/api/manage/run?command=stop'])assert.equal((await f.request(route,{headers})).status,404);
  for(const route of ['/api/eye/map.png','/api/eye/map.png?cx=0&cz=0&r=1000','/api/manage/logs?service=../../mc'])assert.equal((await f.request(route,{headers})).status,400);
  assert.equal(f.calls.length,0);
});
