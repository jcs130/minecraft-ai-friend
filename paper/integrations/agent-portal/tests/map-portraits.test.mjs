import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { createWorldMapService } from '../src/world-map-service.mjs';
import { validateMapAvatar, MAP_AVATAR_LIMIT } from '../src/world-map.mjs';

test('public portrait upload requires operator authorization; exact UUID serves all dimensions and survives restart', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qd-portrait-'));
  const token = 'srv_' + 'x'.repeat(43), uuid='11111111-1111-3111-8111-111111111111';
  const config = {dataDir:root,publicDir:root,tokenHash:createHash('sha256').update(token).digest('hex')};
  let service=createWorldMapService(config);
  await new Promise(r=>service.server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>service.server.close(r));await fs.rm(root,{recursive:true,force:true});});
  let origin='http://127.0.0.1:'+service.server.address().port;
  const image=PNG.sync.write(new PNG({width:16,height:16}));
  const headers={'content-type':'image/png','x-content-sha256':createHash('sha256').update(image).digest('hex')};
  const put=(h,body=image)=>fetch(origin+'/api/v1/internal/world-map/avatars/'+uuid,{method:'PUT',headers:h,body});
  assert.equal((await put(headers)).status,401);
  headers.authorization='Bearer '+token;
  assert.equal((await put({...headers,'x-content-sha256':'0'.repeat(64)})).status,400);
  assert.equal((await put(headers,Buffer.from('<svg/>'))).status,400);
  assert.equal((await put(headers,Buffer.alloc(MAP_AVATAR_LIMIT+1))).status,413);
  assert.equal((await (await put(headers)).json()).visibility,'public');
  for(const dimension of ['overworld','nether','end']){
    const r=await fetch(origin+`/world-map/maps/${dimension}/assets/playerheads/${uuid}.png`);
    assert.equal(r.headers.get('x-map-player-head'),'custom'); assert.equal(r.headers.get('cache-control'),'no-cache');
    assert.deepEqual(Buffer.from(await r.arrayBuffer()),image);
  }
  await new Promise(r=>service.server.close(r));service=createWorldMapService(config);
  await new Promise(r=>service.server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+service.server.address().port;
  assert.equal((await fetch(origin+`/world-map/maps/overworld/assets/playerheads/${uuid}.png`)).headers.get('x-map-player-head'),'custom');
  assert.equal((await fetch(origin+'/world-map/maps/overworld/assets/playerheads/22222222-2222-3222-8222-222222222222.png')).status,404);
});

test('portrait dimensions, static chunks and trailing bytes are bounded',()=>{
 const valid=PNG.sync.write(new PNG({width:16,height:16}));assert.equal(validateMapAvatar(valid),valid);
 const wide=Buffer.from(valid);wide.writeUInt32BE(513,16);assert.throws(()=>validateMapAvatar(wide));
 assert.throws(()=>validateMapAvatar(Buffer.concat([valid,Buffer.from('x')])));
 const animated=Buffer.from(valid);animated.write('acTL',37,'ascii');assert.throws(()=>validateMapAvatar(animated));
});

test('map live links select only the requested authorized catalogue entry, never another resident',async()=>{
 const source=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('function selectLiveChannel('),source.indexOf('function livePage()'));
 const select=vm.runInNewContext(fn+'; selectLiveChannel');
 const channels=[{id:'a',playerName:'Other',isOwn:true},{id:'b',playerName:'ag_CorMy'}];
 assert.equal(select(channels,'AG_CORMY','a').id,'b');
 assert.equal(select(channels,'PrivateOrMissing','a'),undefined);
 assert.equal(select([],'ag_CorMy','b'),undefined);
 assert.equal(select(channels,'','b').id,'b');assert.equal(select(channels,'','missing').id,'a');
});
