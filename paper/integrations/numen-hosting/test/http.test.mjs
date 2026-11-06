import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {request} from 'node:http';
import {HostingStore} from '../src/store.mjs';
import {hostingServer} from '../src/http.mjs';
import {PROTOCOL,signGrant,verifyGrant} from '../src/protocol.mjs';

const role={ownerId:'test-owner',serverId:'test-server',roleUuid:'00000000-0000-0000-0000-000000000001',
  numenOwnerUuid:'00000000-0000-0000-0000-000000000002',name:'HostedTest'};
async function fixture(t){
  const store=new HostingStore(':memory:'),grantKey=randomBytes(32),serviceKey=randomBytes(32),calls=[];
  const hosting={store,status:r=>({role:r}),attach:async r=>{calls.push(r);return{state:'ready'};}};
  const local=hostingServer({hosting,grantKey,serviceKey,now:()=>10000});const{port}=await local.listen();
  t.after(async()=>{await new Promise(r=>local.server.close(r));store.close();});
  const grant=(options={})=>signGrant({aud:PROTOCOL,role,iat:10000,exp:30000,jti:'grant-test-01',scope:'manage',...options},grantKey);
  const post=(body,headers={})=>new Promise((resolve,reject)=>{
    const req=request({host:'127.0.0.1',port,path:'/v1/hosting',method:'POST',headers:{
      'content-type':'application/json','authorization':`Bearer ${serviceKey.toString('base64url')}`,...headers}},res=>{
        const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,
          json:async()=>JSON.parse(Buffer.concat(chunks).toString('utf8'))}));
      });req.on('error',reject);req.end(JSON.stringify(body));
  });
  return{grant,post,calls,grantKey};
}
test('website grant selects the role; request-supplied role cannot override it',async t=>{
  const f=await fixture(t);const result=await f.post({op:'authorize',grant:f.grant()});assert.equal(result.status,200);
  const {session}=await result.json();const state=await f.post({op:'status',session,role:{name:'Victim'}});
  assert.deepEqual((await state.json()).role,role);
});
test('grant replay, expiration, wrong audience and tampering are rejected',async t=>{
  const f=await fixture(t);const g=f.grant();assert.equal((await f.post({op:'authorize',grant:g})).status,200);
  assert.equal((await f.post({op:'authorize',grant:g})).status,401);
  for(const options of[{exp:9999},{aud:'another-service'},{exp:100000}])assert.equal((await f.post({op:'authorize',grant:f.grant(options)})).status,401);
  assert.throws(()=>verifyGrant(g.replace('test','bad')+'x',f.grantKey,10000));
});
test('browser origin, cookie, forged forwarded headers and DNS rebinding Host are rejected',async t=>{
  const f=await fixture(t);
  for(const headers of[{origin:'https://play.kangqiang.site'},{cookie:'session=foreign'},
    {'x-forwarded-for':'127.0.0.1'},{forwarded:'for=127.0.0.1'},{host:'evil.invalid'}, {authorization:'Bearer wrong'}]){
    const response=await f.post({op:'authorize',grant:f.grant()},headers);assert.ok([401,403].includes(response.status));
  }
  assert.equal(f.calls.length,0);
});
test('manual-only grant cannot start the hosted native or Harness brain',async t=>{
  const f=await fixture(t);const {session}=await(await f.post({op:'authorize',grant:f.grant({scope:'manual'})})).json();
  const response=await f.post({op:'mode',mode:'numen',session});assert.equal(response.status,403);
});
test('conversation scope cannot read a key profile, configure, attach or start a controller',async t=>{
  const f=await fixture(t);const {session}=await(await f.post({op:'authorize',grant:f.grant({scope:'conversation',actor:{id:'viewer',name:'Viewer'}})})).json();
  for(const op of ['profile','configure','attach','mode','manual','input','pause'])assert.equal((await f.post({op,session})).status,403);
  assert.equal(f.calls.length,0);
});
test('public API cannot start autonomous hosting without a personal key configuration',async t=>{
  const f=await fixture(t);const {session}=await(await f.post({op:'authorize',grant:f.grant()})).json();
  const result=await f.post({op:'mode',session,mode:'numen'});assert.equal(result.status,503);assert.equal((await result.json()).error,'API_KEY_REQUIRED');
});
test('malformed and oversized request bodies fail before touching a body',async t=>{
  const f=await fixture(t);assert.equal((await f.post(null)).status,400);
  assert.equal((await f.post({op:'authorize',grant:'x'.repeat(70000)})).status,413);assert.equal(f.calls.length,0);
});
