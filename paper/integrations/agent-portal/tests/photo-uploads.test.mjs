import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { siteFixture, testPassword } from './helpers.mjs';
import { png } from './appearance-fixtures.mjs';
import { crc32 } from '../src/appearance-files.mjs';
import { digest, newSecret, Store } from '../src/store.mjs';
import { Gallery } from '../src/gallery.mjs';
import { PhotoUploads, uploadPng } from '../src/photo-uploads.mjs';
import { offlineUuid, seal } from '../src/game-accounts.mjs';

const ROOT='/api/v1/agent-access/photos';
const uploadBody=f=>({agentId:f.agent.id,requestId:randomUUID(),title:'旅途中的一刻',story:'我们一起去探索。',pngBase64:png().toString('base64')});
async function fixture(t){
  const f=await siteFixture(t),owner=f.portal.store.ownerByName('fixture-admin');
  f.portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(owner.id,f.uuid,'isolated photo ownership',Date.now());
  return {...f,owner};
}
async function request(f,route,token,method='GET',body,headers={}){
  const res=await fetch(f.origin+route,{method,headers:{Authorization:'Bearer '+token,...headers},...(body?{body}:{})});
  return {status:res.status,headers:res.headers,data:res.headers.get('content-type')?.includes('json')?await res.json():Buffer.from(await res.arrayBuffer())};
}
const headers=()=>({'Content-Type':'image/png','X-Request-Id':randomUUID(),'X-Photo-Title':encodeURIComponent('自己的画'),'X-Photo-Story':encodeURIComponent('我想把它挂在家里。')});

test('personal uploads stay private, retain attribution, are idempotent and survive catalog refresh and reopening',async t=>{
  const f=await fixture(t),body=uploadBody(f),upload=await f.admin.request('/gallery/upload','POST',body);assert.equal(upload.status,201);const id=upload.data.id;
  assert.equal(upload.data.published,false);assert.equal(f.portal.gallery.page().total,0);
  assert.equal((await fetch(f.origin+'/api/v1/gallery/'+id+'/image')).status,404);
  const privateList=(await f.admin.request('/gallery/manage')).data.photos;
  assert.equal(privateList[0].title,body.title);assert.equal(privateList[0].story,body.story);assert.equal(privateList[0].origin,'uploaded');assert.equal(privateList[0].author,f.agent.name);
  const same=await f.admin.request('/gallery/upload','POST',body);assert.equal(same.data.id,id);assert.equal(same.data.replayed,true);
  assert.equal((await f.admin.request('/gallery/upload','POST',{...body,story:'changed'})).status,409);
  assert.equal((await f.admin.request('/gallery/'+id+'/publication','PUT',{published:true})).status,200);
  f.portal.gallery.source={read:()=>({sequence:1,value:{photos:[],photoManifest:{publishedIds:[],withdrawnIds:[id]}}})};
  assert.equal(f.portal.gallery.page().total,1);
  const publicPhoto=f.portal.gallery.page().photos[0];assert.equal(publicPhoto.origin,'uploaded');assert.ok(!('authorUuid' in publicPhoto));assert.ok(!('sha256' in publicPhoto));
  // A game snapshot cannot replace a website upload's provenance or owner.
  f.portal.gallery.source={read:()=>({sequence:2,value:{photos:[{...privateList[0],author:'Goddess',origin:'camera'}]}})};
  assert.equal(f.portal.gallery.known(id).author,f.agent.name);
  const reopened=new Store(f.config.dataDir);try{const restored=new Gallery(reopened,null);assert.equal(restored.published(id).story,body.story);assert.deepEqual(restored.image(id).bytes,png());}finally{reopened.close();}
});

test('uploads enforce actual ownership, CSRF, canonical role identity and the explicit photo PAT scope',async t=>{
  const f=await fixture(t),body=uploadBody(f),stranger=f.client();await stranger.init();await stranger.request('/accounts','POST',{username:'PhotoStranger',password:testPassword});
  assert.equal((await stranger.request('/gallery/upload','POST',body)).status,404,'another owner cannot use this role as an upload identity');
  assert.equal((await f.admin.request('/gallery/upload','POST',body,{'X-CSRF-Token':''})).status,403);
  const grant=async scopes=>(await f.admin.request('/client-credentials','POST',{agentId:f.agent.id,label:'相册测试',scopes})).data.token;
  const read=await grant(['state.read']),appearance=await grant(['state.read','appearance.write']);
  assert.equal((await request(f,ROOT,read)).status,403);assert.equal((await request(f,ROOT,appearance)).status,403);
  const photo=await grant(['state.read','photos.write']);
  const added=await request(f,ROOT,photo,'POST',png(),headers());assert.equal(added.status,201);
  const list=await request(f,ROOT,photo);assert.equal(list.status,200);assert.equal(list.data.photos[0].origin,'uploaded');assert.equal((await request(f,list.data.photos[0].imageUrl,photo)).status,200);
  assert.equal((await request(f,ROOT+'/'+added.data.id+'/publication',photo,'PUT',JSON.stringify({published:true}),{'Content-Type':'application/json'})).status,200);assert.equal(f.portal.gallery.page().total,1);
  assert.equal((await request(f,ROOT,photo,'GET',null,{Origin:f.origin})).status,403);
  assert.equal((await request(f,ROOT,photo,'GET',null,{Cookie:'browser=unexpected'})).status,403);
  assert.equal((await request(f,'/api/v1/gallery/upload',photo,'POST',JSON.stringify(body),{'Content-Type':'application/json'})).status,403);
  f.portal.store.db.prepare('DELETE FROM ownerships WHERE agent_uuid=?').run(f.uuid);
  assert.equal((await request(f,ROOT,photo)).status,403,'old PAT cannot retain photo access after ownership changes');
});

test('map links are bounded, HEAD does not spend a download, withdrawal revokes them, expired links fail',async t=>{
  const f=await fixture(t),added=await f.admin.request('/gallery/upload','POST',uploadBody(f)),id=added.data.id;
  let now=Date.now();const service=new PhotoUploads(f.portal.gallery,{now:()=>now}),context=f.portal.gallery.managementContext(f.owner);
  const link=service.issue(id,context,f.origin);assert.match(link.command,/^\/imageframe create pic_[a-f0-9]+ http:/);assert.match(link.command,/ 1 1$/);
  assert.equal((await fetch(link.url,{method:'HEAD'})).status,200);
  for(let i=0;i<3;i++){const res=await fetch(link.url);assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'private, no-store');assert.deepEqual(Buffer.from(await res.arrayBuffer()),png());}
  assert.equal((await fetch(link.url)).status,404);
  const second=service.issue(id,context,f.origin);assert.equal((await f.admin.request('/gallery/'+id+'/publication','PUT',{published:false})).status,200);assert.equal((await fetch(second.url)).status,404);
  const expiring=service.issue(id,context,f.origin),secret=new URL(expiring.url).pathname.split('/').at(-2);now+=300001;assert.throws(()=>service.imported(id,secret),{reason:'PHOTO_LINK_EXPIRED'});
  assert.equal((await f.admin.request('/gallery/'+id,'DELETE')).status,200);assert.equal(f.portal.gallery.known(id),null);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM gallery_import_links').get().n,0);
});

test('invalid image data, oversized pixels, injected metadata and role quota have clear failures',async t=>{
  const f=await fixture(t),body=uploadBody(f);
  assert.equal((await f.admin.request('/gallery/upload','POST',{...body,pngBase64:Buffer.from('<svg/>').toString('base64')})).status,400);
  assert.equal((await f.admin.request('/gallery/upload','POST',{...body,pngBase64:'a===wrong'})).status,400);
  assert.equal((await f.admin.request('/gallery/upload','POST',{...body,story:'🙂'.repeat(401)})).status,400);
  assert.throws(()=>uploadPng(png(2049,1)),{reason:'PNG_FORMAT_UNSUPPORTED'});
  assert.throws(()=>uploadPng(Buffer.alloc(4*1024*1024+1)),{reason:'PHOTO_TOO_LARGE'});
  const original=png(),data=Buffer.from('private gps\0not forwarded'),chunk=Buffer.alloc(data.length+12);chunk.writeUInt32BE(data.length);chunk.write('tEXt',4);data.copy(chunk,8);chunk.writeUInt32BE(crc32(chunk.subarray(4,-4)),chunk.length-4);
  const withMetadata=Buffer.concat([original.subarray(0,33),chunk,original.subarray(33)]);assert.deepEqual(uploadPng(withMetadata),original);
  for(let i=0;i<64;i++)f.portal.store.db.prepare('INSERT INTO gallery_uploads VALUES(?,?,?,?,?)').run(randomUUID(),f.uuid,randomUUID(),'test',Date.now());
  assert.equal((await f.admin.request('/gallery/upload','POST',body)).data.error.reason,'PHOTO_QUOTA');
});

test('native camera originals cannot be deleted through the custom upload interface',async t=>{
  const f=await fixture(t),id=randomUUID(),bytes=png();
  const photo={id,author:f.agent.name,authorUuid:f.uuid,title:'原生实拍',story:'',capturedAt:new Date().toISOString(),sha256:digest(bytes),width:64,height:64,bytes:bytes.length,published:false};
  f.portal.store.db.prepare('INSERT INTO gallery_catalog VALUES(?,?,0,?)').run(id,JSON.stringify(photo),Date.now());f.portal.gallery.accept(id,bytes);
  assert.equal((await f.admin.request('/gallery/'+id,'DELETE')).data.error.reason,'CAMERA_ORIGINAL_RETAINED');
  assert.deepEqual(f.portal.gallery.image(id,f.portal.gallery.managementContext(f.owner)).bytes,bytes);
});

test('an invited Agent uploads under its own original qda identity, including the experience pool',async t=>{
  const f=await fixture(t),key=randomBytes(32),dir=path.join(f.root,'account-bridge'),keyFile=path.join(f.root,'account.key');
  await fs.mkdir(path.join(dir,'results'),{recursive:true});await fs.writeFile(keyFile,key.toString('hex'));Object.assign(f.config.authBridge,{enabled:true,directory:dir,keyFile});
  await fs.writeFile(path.join(dir,'heartbeat.json'),seal(key,'heartbeat',{ready:true,at:Date.now()}));
  const invite=(await f.admin.request('/admin/trial-invites','POST',{requestId:randomUUID(),clientSecret:newSecret(),count:1})).data.invites[0];
  const credentials={requestId:randomUUID(),username:'ag_PhotoPool',clientSecret:newSecret()};
  assert.equal((await request(f,'/api/v1/agent-access/register',invite.token,'POST',JSON.stringify(credentials),{'Content-Type':'application/json'})).status,201);
  const session=await request(f,'/api/v1/agent-access/sessions','none','POST',JSON.stringify({clientId:credentials.requestId,clientSecret:credentials.clientSecret}),{'Content-Type':'application/json'}),token=session.data.token,id=randomUUID(),uuid=offlineUuid(credentials.username);
  assert.equal((await request(f,'/api/v1/agent-access/activate',token,'POST',JSON.stringify({requestId:id,gamePassword:'isolated-photo-password'}),{'Content-Type':'application/json'})).status,202);
  await fs.writeFile(path.join(dir,'results',id+'.json'),seal(key,'result:'+id,{requestId:id,username:credentials.username,playerUuid:uuid,state:'succeeded'}));
  assert.equal((await request(f,'/api/v1/agent-access/status',token)).data.state,'ready');
  f.game.roster=async()=>[f.agent,{...f.agent,id:digest(uuid).slice(0,24),name:credentials.username,playerUuid:uuid}];
  const result=await request(f,ROOT,token,'POST',png(),headers());assert.equal(result.status,201);
  const metadata=f.portal.gallery.known(result.data.id);assert.equal(metadata.author,credentials.username);assert.equal(metadata.authorUuid,uuid);assert.equal(metadata.published,false);
  assert.equal((await request(f,ROOT,token)).data.total,1);
  const link=await request(f,ROOT+'/'+result.data.id+'/import',token,'POST');assert.equal(link.status,201);assert.equal((await fetch(link.data.url)).status,200);
  const foreign=await f.admin.request('/gallery/upload','POST',uploadBody(f));
  for(const [suffix,method,body]of [['/image','GET'],['/import','POST'],['','DELETE'],['/publication','PUT',JSON.stringify({published:true})]])assert.equal((await request(f,ROOT+'/'+foreign.data.id+suffix,token,method,body,body?{'Content-Type':'application/json'}:{})).status,404);
});
