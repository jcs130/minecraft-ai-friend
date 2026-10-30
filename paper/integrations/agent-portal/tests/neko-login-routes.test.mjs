import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
import http from 'node:http';
import {siteFixture} from './helpers.mjs';
import {NEKO_ISSUER} from '../src/neko-auth.mjs';

const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const key={...publicKey.export({format:'jwk'}),kid:'route-fixture',alg:'RS256'};

async function proxyFixture(t){
  let nonce;
  const publicOrigin='https://portal.example',clientId='qiandengji-portal-test';
  const f=await siteFixture(t,{publicOrigin,nekoAuth:{enabled:true,clientId}},{nekoFetch:async url=>{
    if(url.endsWith('/jwks.json'))return new Response(JSON.stringify({keys:[key]}));
    const seconds=Math.floor(Date.now()/1000);
    const part=[{kid:key.kid,alg:'RS256'},{iss:NEKO_ISSUER,aud:clientId,sub:'route-fixture-subject',nonce,iat:seconds,exp:seconds+300}]
      .map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
    return new Response(JSON.stringify({token_type:'Bearer',id_token:part+'.'+sign('RSA-SHA256',Buffer.from(part),privateKey).toString('base64url')}));
  }});
  const jar=new Map();let csrf;
  async function browser(path,method='GET',body,extra={}){
    const headers={Host:'portal.example','X-Forwarded-Proto':'https',Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),
      ...(method!=='GET'?{Origin:publicOrigin,'Content-Type':'application/json','X-CSRF-Token':csrf}:{}),...extra};
    const encoded=body?JSON.stringify(body):undefined;
    const received=await new Promise((resolve,reject)=>{
      const outgoing=http.request(f.origin+path,{method,headers:{...headers,...(encoded?{'Content-Length':Buffer.byteLength(encoded)}:{})}},response=>{
        let text='';response.on('data',chunk=>{text+=chunk;});response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,text}));
      });outgoing.on('error',reject);outgoing.end(encoded);
    });
    for(const cookie of received.headers['set-cookie']||[]){
      const [k,v]=cookie.split(';')[0].split('=');if(v)jar.set(k,v);else jar.delete(k);
    }
    const data=received.status===303?null:JSON.parse(received.text);if(data?.csrfToken)csrf=data.csrfToken;
    return{response:{headers:new Headers(Object.entries(received.headers).filter(([,v])=>v!==undefined))},data,status:received.status};
  }
  return{...f,browser,jar,setNonce:value=>{nonce=value;}};
}

test('real portal routes finish a cookie-bound OAuth callback and keep native account authority separate',async t=>{
  const f=await proxyFixture(t);
  const first=await f.browser('/api/v1/session');assert.equal(first.data.nekoAuth.available,true);
  const start=await f.browser('/api/v1/auth/neko/start','POST',{mode:'login'});assert.equal(start.status,200,JSON.stringify(start.data));
  const url=new URL(start.data.authorizationUrl);f.setNonce(url.searchParams.get('nonce'));
  const cookie=f.jar.get('__Host-qd_neko_flow');
  const callback=await f.browser('/api/v1/auth/neko/callback?code=fixture-code&state='+url.searchParams.get('state'),'GET',null,
    {Cookie:'__Host-qd_neko_flow='+cookie});
  assert.equal(callback.status,303);assert.equal(callback.response.headers.get('location'),'/join?neko=connected');
  assert.equal(callback.response.headers.get('cache-control'),'no-store');
  const logged=await f.browser('/api/v1/session');assert.equal(logged.data.owner.role,'owner');assert.equal(logged.data.nekoAuth.linked,true);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM account_jobs').get().n,0);
  const replay=await f.browser('/api/v1/auth/neko/callback?code=fixture-code&state='+url.searchParams.get('state'),'GET',null,{Cookie:'__Host-qd_neko_flow='+cookie});
  assert.equal(replay.response.headers.get('location'),'/join?neko=failed');
  const body={clientId:randomUUID(),clientSecret:'a'.repeat(43),username:'ag_RouteTest',requestId:randomUUID()};
  const raw=await fetch(f.origin+'/api/v1/neko-plugin/requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal(raw.status,200);const request=await raw.json();
  assert.ok(!JSON.stringify(request).includes(body.clientSecret));
  const approve=await f.browser('/api/v1/neko-plugin/requests/'+body.clientId+'/approve','POST',{});assert.equal(approve.status,200);
  const forged=await f.browser('/api/v1/neko-plugin/requests/'+body.clientId+'/activate','POST',{requestId:body.requestId,username:body.username,gamePassword:'not-sent'});
  assert.equal(forged.status,403);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM account_jobs').get().n,0);
});

test('OAuth start keeps ordinary CSRF, HTTPS origin and opt-in configuration guards',async t=>{
  const f=await proxyFixture(t);await f.browser('/api/v1/session');
  assert.equal((await f.browser('/api/v1/auth/neko/start','POST',{}, {'X-CSRF-Token':'wrong'})).status,403);
  assert.equal((await f.browser('/api/v1/auth/neko/start','POST',{}, {Origin:'https://attacker.example'})).status,403);
  const basic=await siteFixture(t);
  assert.equal((await basic.admin.request('/auth/neko')).data.available,false);
  assert.equal((await basic.admin.request('/auth/neko/start','POST',{})).status,400);
});

test('join page loads the independent SSO module and never asks for a second website password',async()=>{
  const html=await fs.readFile(new URL('../public/join.html',import.meta.url),'utf8');
  assert.ok(html.includes('src="/neko-login.js"'));
  const dom=new JSDOM(html,{url:'https://portal.example/join'}),calls=[];
  const source=await fs.readFile(new URL('../public/neko-login.js',import.meta.url),'utf8');
  const run=new (Object.getPrototypeOf(async function(){}).constructor)('document','location','fetch','AbortSignal',source);
  await run(dom.window.document,dom.window.location,async url=>{
    calls.push(url);return new Response(JSON.stringify(url.endsWith('/auth/neko')?{available:true}:
      {owner:null,csrfToken:'fixture-csrf',nekoAuth:{linked:false}}));
  },AbortSignal);
  assert.deepEqual(calls,['/api/v1/auth/neko','/api/v1/session']);
  assert.equal(dom.window.document.querySelector('#neko-signin').hidden,false);
  assert.equal(dom.window.document.querySelector('#neko-login').textContent,'使用猫娘计划账号登录千灯纪');
  assert.equal(dom.window.document.querySelector('#neko-signin input[type=password]'),null);
  dom.window.close();
});

test('linked SSO owners can reverify without knowing a separate website password',async()=>{
  const html=await fs.readFile(new URL('../public/join.html',import.meta.url),'utf8');
  const dom=new JSDOM(html,{url:'https://portal.example/join'}),calls=[];
  const source=await fs.readFile(new URL('../public/neko-login.js',import.meta.url),'utf8');
  const run=new (Object.getPrototypeOf(async function(){}).constructor)('document','location','fetch','AbortSignal',source);
  let submitted;const sent=new Promise(resolve=>{submitted=resolve;});
  const location={search:'',assign:()=>{}};
  await run(dom.window.document,location,async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/start')){submitted(JSON.parse(options.body));return new Response(JSON.stringify({authorizationUrl:NEKO_ISSUER+'oauth2/auth?fixture=true'}));}
    return new Response(JSON.stringify(url.endsWith('/auth/neko')?{available:true}:
      {owner:{username:'existing-owner'},csrfToken:'fixture-csrf',nekoAuth:{linked:true}}));
  },AbortSignal);
  const button=dom.window.document.querySelector('#neko-login');
  assert.equal(button.hidden,false);assert.equal(button.textContent,'重新验证猫娘计划账号');
  button.click();assert.deepEqual(await sent,{mode:'reauth'});
  dom.window.close();
});
