import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {scryptSync} from 'node:crypto';
import {createPanelServer} from '../admin/server.mjs';
import {createManagementApi} from '../admin/management-api.mjs';

const token='internal-secret-sentinel-'.repeat(3),salt='test-salt',password='only-in-test-fixture';
async function fixture(t,management={}){
  const calls=[];let now=Date.now();
  const server=createPanelServer({stateDir:'unused-test-state',publicOrigin:'http://127.0.0.1:19091',management:{
    token,passwordHash:{salt,hash:scryptSync(password,salt,32).toString('hex')},clock:()=>now,
    transport:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({ok:true,services:[],state:{observer:{online:false}}}),{status:200,headers:{'Content-Type':'application/json'}});},...management
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

const localMode={authMode:'local',passwordHash:null};
function localHeaders(response){return {Cookie:response.headers['set-cookie'][0].split(';')[0],Origin:'http://127.0.0.1:19091',
  'Content-Type':'application/json','X-CSRF-Token':response.json().csrf};}

test('explicit local management signs a protected automatic session without a password',async t=>{
  const f=await fixture(t,localMode),r=await f.request('/api/manage/session');
  assert.equal(r.status,200);assert.equal(r.json().authMode,'local');assert.equal(r.json().configured,true);
  assert.equal(r.json().authenticated,true);assert.match(r.json().csrf,/^[a-f0-9]{48}$/);
  assert.match(r.headers['set-cookie'][0],/^qd_admin=[a-f0-9]{64}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=3600$/);
  assert.equal(r.raw.includes(token),false);assert.equal(r.raw.includes(password),false);
  const headers=localHeaders(r),same=await f.request('/api/manage/session',{headers});
  assert.equal(same.json().csrf,r.json().csrf);assert.equal(same.headers['set-cookie'],undefined);
  assert.equal((await f.request('/healthz')).json().mode,'local-management');
  assert.equal((await f.request('/api/manage/login',{method:'POST',headers,body:{}})).status,404);
  assert.equal((await f.request('/api/manage/logs?service=qwenpaw-ops',{headers})).status,200);
  assert.equal(f.calls[0].url,'http://control:3090/logs?service=qwenpaw-ops');
});

test('automatic local sessions retain cookie, Origin and CSRF requirements for every mutation',async t=>{
  const f=await fixture(t,localMode),r=await f.request('/api/manage/session'),headers=localHeaders(r);
  for(const route of ['/api/manage/plan','/api/manage/execute','/api/eye/observer']){
    assert.equal((await f.request(route,{method:'POST',headers:{Origin:headers.Origin},body:{}})).status,401);
    for(const extra of [{'X-CSRF-Token':''},{Origin:''},{Origin:'http://evil.invalid'},{Host:'evil.invalid'},{'Sec-Fetch-Site':'cross-site'}]){
      assert.equal((await f.request(route,{method:'POST',headers:{...headers,...extra},body:{}})).status,403);
    }
  }
  assert.equal(f.calls.length,0);
  assert.equal((await f.request('/api/manage/plan',{method:'POST',headers,body:{action:'restart',services:['qwenpaw-ops']}})).status,200);
  assert.equal(f.calls[0].options.headers.Authorization,'Bearer '+token);
  assert.equal(f.calls[0].options.headers.Cookie,undefined);
  f.advance(3600001);
  assert.equal((await f.request('/api/manage/execute',{method:'POST',headers,body:{planId:'old'}})).status,401);
  const renewed=await f.request('/api/manage/session',{headers});
  assert.equal(renewed.json().authenticated,true);assert.notEqual(renewed.json().csrf,r.json().csrf);
  assert.equal(f.calls.length,1,'An expired execute must never be replayed upstream');
});

test('local automatic sessions stay bounded and available across repeated anonymous health reads',async t=>{
  const f=await fixture(t,localMode),active=await f.request('/api/manage/session'),headers=localHeaders(active);
  let oldest;
  for(let i=0;i<35;i++){
    const read=await f.request('/api/manage/session');assert.equal(read.status,200);assert.equal(read.json().authenticated,true);
    if(!oldest)oldest=localHeaders(read);
    assert.equal((await f.request('/api/manage/session',{headers})).json().csrf,active.json().csrf,'A regularly used browser survives anonymous reads');
  }
  assert.equal((await f.request('/api/manage/operations',{headers:oldest})).status,401,'Old unused sessions are evicted');
  f.advance(3540001);
  const renewal=await f.request('/api/manage/session',{headers});
  assert.equal(renewal.json().csrf,active.json().csrf);assert.ok(renewal.json().expiresAt>active.json().expiresAt);
  assert.equal(renewal.headers['set-cookie'][0].split(';')[0],headers.Cookie);
  assert.equal((await f.request('/api/manage/session',{headers})).headers['set-cookie'],undefined);
});

test('local management refuses unverified peers and forwarded-header impersonation',async()=>{
  const origins=['http://127.0.0.1:19091','http://localhost:19091'];
  const api=createManagementApi({...localMode,token,localOrigins:origins,localTrustedPeers:['172.20.0.1']});
  async function request(remoteAddress,headers={},method='GET'){
    const response={headers:{},setHeader(key,value){this.headers[key]=value;}};
    await api({method,headers:{host:'127.0.0.1:19091',...headers},socket:{remoteAddress}},response,
      new URL('http://127.0.0.1:19091/api/manage/session'),(res,status,data)=>{res.status=status;res.data=data;});
    return response;
  }
  const spoofed={forwarded:'for=127.0.0.1;host=127.0.0.1:19091','x-forwarded-for':'127.0.0.1','x-real-ip':'127.0.0.1'};
  for(const peer of ['192.168.1.20','172.20.0.2','2001:db8::1',undefined]){
    const r=await request(peer,spoofed);assert.equal(r.status,403);assert.equal(r.data.error,'local_access_required');assert.equal(r.headers['Set-Cookie'],undefined);
  }
  for(const peer of ['127.0.0.1','127.0.0.2','::1','::ffff:127.0.0.1','172.20.0.1','::ffff:172.20.0.1'])assert.equal((await request(peer)).data.authenticated,true);
  for(const headers of [{host:'evil.invalid'},{origin:'http://evil.invalid'},{'sec-fetch-site':'cross-site'}])assert.equal((await request('172.20.0.1',headers)).status,403);
  assert.equal((await request('127.0.0.1',{host:'localhost:19091',origin:'http://localhost:19091'})).status,200);
  for(const localTrustedPeers of [['172.20.0.0/16'],['*'],['localhost'],['0.0.0.0']])assert.throws(()=>createManagementApi({...localMode,token,localOrigins:origins,localTrustedPeers}));
  assert.throws(()=>createPanelServer({stateDir:'unused',publicOrigin:'http://world.example:19091',management:{...localMode,token}}),/loopback/);
  assert.throws(()=>createManagementApi({authMode:'none'}),/Unsupported/);
});

test('local access cannot substitute for the private control token',async t=>{
  const f=await fixture(t,{...localMode,token:null}),r=await f.request('/api/manage/session');
  assert.equal(r.status,200);assert.equal(r.json().authMode,'local');assert.equal(r.json().configured,false);
  assert.equal(r.json().authenticated,false);assert.equal(r.json().csrf,null);assert.equal(r.headers['set-cookie'],undefined);
  assert.equal((await f.request('/api/manage/services')).status,503);assert.equal(f.calls.length,0);
});
