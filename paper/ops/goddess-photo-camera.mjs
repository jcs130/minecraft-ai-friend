// Private still-camera adapter for the existing local Goddess connection.
// Only Minecraft plugin messages trigger work. The renderer binds an ephemeral loopback socket.
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile, access} from 'node:fs/promises';
import {randomBytes, createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

const CHANNEL = 'mcagent:photo';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function nativePhotoSkin(data) {
  if (!data?.url) return null;
  const url = new URL(data.url);
  const hash = /^\/texture\/([0-9a-f]{40,64})$/i.exec(url.pathname)?.[1]?.toLowerCase();
  if (!hash || url.hostname !== 'textures.minecraft.net' || !['http:','https:'].includes(url.protocol) || url.port || url.username || url.password || url.search || url.hash) throw Error('PHOTO_SKIN_SOURCE_UNSUPPORTED');
  return {hash, url:'https://textures.minecraft.net/texture/'+hash, model:data.model === 'slim' ? 'slim' : 'classic'};
}
export function validatePhotoJob(job) {
  if (!job || job.type !== 'capture' || !UUID.test(job.job) || !UUID.test(job.nonce)
    || !UUID.test(job.owner) || !UUID.test(job.world) || !UUID.test(job.uploadId)
    || !['first','third','top'].includes(job.mode) || !Number.isSafeInteger(job.entityId)
    || !['x','y','z','yaw','pitch','anchorX','anchorY','anchorZ'].every(k => Number.isFinite(job[k]))) throw Error('PHOTO_JOB_INVALID');
  const url = new URL(job.uploadBase);
  // Exact numeric private address only: no DNS, credentials, redirects or arbitrary URL imports.
  const octets = url.hostname.split('.').map(Number);
  const privateHost = url.hostname === '127.0.0.1' || octets.length === 4 && octets.every(n => Number.isInteger(n) && n >= 0 && n < 256)
    && (octets[0] === 10 || octets[0] === 192 && octets[1] === 168 || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
  if (url.protocol !== 'http:' || !privateHost || url.username || url.password || !['','/'].includes(url.pathname) || url.search || url.hash) throw Error('PHOTO_UPLOAD_LOCAL_ONLY');
  return {...job, uploadBase: url.origin};
}

export function startGoddessPhotoCamera(bot, options = {}) {
  const log = options.log ?? (() => {});
  const skinCache = new Map(); let skinCacheBytes = 0;
  let settings, browser, active, cameraId, heartbeat, stopped = false, available = false;
  const reply = (type, job) => {
    if (bot._client.state !== 'play') return;
    bot._client.write('custom_payload', {channel:CHANNEL, data:Buffer.from(JSON.stringify({type, ...(type === 'ready' ? {idle:active == null} : {}), ...(job ? {job:job.job,nonce:job.nonce,...(job.reason ? {reason:job.reason} : {})} : {})}))});
  };
  const stopJob = () => { active?.abort.abort(); };
  const onCamera = p => { cameraId = p.cameraId; if (active && cameraId !== active.job.entityId) stopJob(); };
  const onPayload = packet => {
    if (packet.channel !== CHANNEL || packet.data.length > 8192) return;
    let data; try { data = JSON.parse(packet.data.toString('utf8')); } catch { return; }
    if (data.type === 'cancel') {
      if (active && data.job === active.job.job && data.nonce === active.job.nonce) stopJob();
      return;
    }
    if (!available || active) return;
    let job; try { job = validatePhotoJob(data); } catch { return; }
    const state = {job,abort:new AbortController(),physics:bot.physicsEnabled}; active = state; bot.physicsEnabled = false;
    reply('ready');
    void capture(state).catch(error => {
      const reason = /^PHOTO_[A-Z_]+$/.test(error?.message ?? '') ? error.message : error?.code ?? error?.name ?? 'Error';
      log(`photo job=${job.job} failed=${reason}`);
      reply('failed', {...job,reason:reason === 'TimeoutError' ? 'PHOTO_RENDER_TIMEOUT' : /^PHOTO_[A-Z_]+$/.test(reason) ? reason : 'PHOTO_RENDER_FAILED'});
    }).finally(() => { if (active === state) {active = null;bot.physicsEnabled=state.physics;if(available)reply('ready');} });
  };
  bot._client.on('camera', onCamera);
  bot._client.on('custom_payload', onPayload);

  async function initialize() {
    settings = options.settings ?? JSON.parse(await readFile('E:/MC/ops/goddess-photo-camera.json','utf8'));
    if (!path.isAbsolute(settings.assetsRoot) || !path.isAbsolute(settings.viewerRoot) || !path.isAbsolute(settings.browserPath)) throw Error('PHOTO_CONFIGURATION_INVALID');
    await Promise.all([access(settings.assetsRoot + '/dist/modern-viewer.js'), access(settings.browserPath)]);
    // Warm one bounded headless browser; every request gets a fresh, disposable context.
    const dependencies = createRequire(pathToFileURL(settings.dependencyRoot + '/package.json'));
    const {default:puppeteer} = await import(pathToFileURL(dependencies.resolve('puppeteer-core')).href);
    browser = await puppeteer.launch({executablePath:settings.browserPath,headless:true,pipe:true,timeout:30_000});
    if (stopped) { await browser.close(); return; }
    browser.once('disconnected',() => {available=false;stopJob();});
    available = true;
    bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from(CHANNEL)});
    reply('ready'); heartbeat = setInterval(() => { if (available) reply('ready'); },5000); heartbeat.unref();
    log('private photo camera ready; no public listener');
  }
  const init = () => void initialize().catch(error => log(`photo camera unavailable=${error?.code ?? error?.name ?? 'Error'}`));
  if (bot._client.state === 'play' && bot.entity) init(); else bot.once('spawn', init);

  async function capture(state) {
    const {job,abort} = state;
    const signal = AbortSignal.any([abort.signal,AbortSignal.timeout(options.captureTimeoutMs ?? 45_000)]);
    const guard = () => {
      signal.throwIfAborted();
      const target = bot.entities[job.entityId];
      if (cameraId !== job.entityId || !target || target.uuid?.toLowerCase() !== job.owner.toLowerCase()
        || Math.hypot(target.position.x-job.anchorX, target.position.y-job.anchorY, target.position.z-job.anchorZ) > .75) throw Error('PHOTO_CAMERA_LEASE_LOST');
      return target;
    };
    guard();
    const playerSkins = new Map(), skinImages = new Map();
    for (const entity of Object.values(bot.entities)) {
      if (entity.id === bot.entity?.id || entity.id === job.entityId && job.mode === 'first'
        || !entity.username || Math.hypot(entity.position.x-job.anchorX,entity.position.z-job.anchorZ) > 48) continue;
      const skin = nativePhotoSkin(bot.players[entity.username]?.skinData);
      if (!skin) continue;
      if (playerSkins.size >= 40) throw Error('PHOTO_SKIN_BUDGET_EXCEEDED');
      playerSkins.set(entity.uuid,skin);
      if (skinImages.has(skin.hash)) continue;
      if (skinCache.has(skin.hash)) {skinImages.set(skin.hash,skinCache.get(skin.hash));continue;}
      const response = await fetch(skin.url,{redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(5000)])});
      if (!response.ok) throw Error('PHOTO_SKIN_UNAVAILABLE');
      const parts=[];let size=0;
      for await (const part of response.body) {size+=part.length;if(size>1024*1024)throw Error('PHOTO_SKIN_SIZE_INVALID');parts.push(part);}
      const png=Buffer.concat(parts);
      if (png.length<24 || png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a') throw Error('PHOTO_SKIN_FORMAT_INVALID');
      skinImages.set(skin.hash,png);
      while (skinCache.size >= 64 || skinCacheBytes + png.length > 4*1024*1024) {
        const oldest=skinCache.keys().next().value;skinCacheBytes-=skinCache.get(oldest).length;skinCache.delete(oldest);
      }
      skinCache.set(skin.hash,png);skinCacheBytes+=png.length;
    }
    guard();
    const root = settings.viewerRoot;
    const moduleAt = relative => import(pathToFileURL(path.join(root, relative)).href);
    const [{viewerPhotoPage},{createViewerChunkStream,createViewerEntityStream},{createViewerContentBridge}] = await Promise.all([
      moduleAt('packages/modern-viewer/renderer-src/host/viewer-photo-page.mjs'),
      moduleAt('packages/modern-viewer/src/viewer-stream.mts'),
      moduleAt('packages/modern-viewer/renderer-src/host/viewer-content.mjs')
    ]);
    const require = createRequire(pathToFileURL(root + '/package.json'));
    const express = require('express'), {Server} = require('socket.io');
    const token = randomBytes(24).toString('hex'), app = express(), server = createServer(app);
    const sessions = new Set(); let origin, context;
    const bridge = createViewerContentBridge(bot);
    const authenticated = req => req.headers.cookie?.split(';').some(s => s.trim() === `photo=${token}`);
    app.use((req,res,next) => {
      if (req.hostname !== '127.0.0.1') return res.sendStatus(403);
      res.set('Cache-Control','no-store');
      if (req.path === '/' && req.query.token === token) { res.cookie('photo',token,{httpOnly:true,sameSite:'strict'}); return next(); }
      if (!authenticated(req)) return res.sendStatus(403);
      next();
    });
    app.get('/',async (_req,res) => {try {res.type('html').send(await viewerPhotoPage(settings.assetsRoot));} catch {res.sendStatus(503);} });
    app.get('/index.js',(_req,res) => res.sendFile(settings.assetsRoot + '/dist/modern-viewer.js'));
    app.get('/head-texture/:file',(req,res) => {
      const hash=/^([0-9a-f]{40,64})\.png$/.exec(req.params.file)?.[1], png=skinImages.get(hash);
      if (!png) return res.sendStatus(404);
      res.type('png').send(png);
    });
    app.use('/textures',express.static(settings.assetsRoot + '/public/textures/1.20.6'));
    app.use(express.static(settings.assetsRoot + '/public'));
    const io = new Server(server,{serveClient:false,maxHttpBufferSize:2048,allowRequest:(req,done) => done(null,authenticated(req) && (!req.headers.origin || req.headers.origin === origin))});
    io.on('connection',socket => {
      // Stream radius is exclusive; the renderer's distance=2 guard requires a full 5x5 footprint.
      const chunks = createViewerChunkStream({bot,socket,viewDistance:3,emit:(name,value) => socket.emit(name,value)});
      // Camera owner is hidden, and no observer inventory, chat, HUD, or gameplay controls are forwarded.
      const serialize = e => {
        if (e.id === bot.entity?.id || e.id === job.entityId && job.mode === 'first') return null;
        const skin=playerSkins.get(e.uuid);
        return JSON.parse(JSON.stringify({id:e.id,name:e.name,type:e.type,username:e.username,pos:e.position,yaw:e.yaw,pitch:e.pitch,headYaw:e.headYaw,uuid:e.uuid,width:e.width,height:e.height,metadata:e.metadata,equipment:e.equipment,
          ...(skin ? {skinUrl:'/head-texture/'+skin.hash+'.png',skinModel:skin.model} : {})},(_k,v)=>typeof v==='bigint'?String(v):v));
      };
      const entities = createViewerEntityStream({bot,socket,serialize}); bot.on('entityGone',entities.remove);
      socket.emit('version','1.20.6'); const off = bridge.subscribeSocket(socket);
      const sync = () => {
        try { guard(); } catch { abort.abort(); return; }
        socket.emit('position',{pos:{x:job.x,y:job.y,z:job.z},yaw:job.yaw,pitch:job.pitch});
        socket.emit('time',bot.time.timeOfDay);
        socket.emit('weather',{raining:bot.isRaining,thunder:bot.thunderState ?? 0});
        chunks.updatePosition({x:job.x,y:job.y,z:job.z});
        for (const e of Object.values(bot.entities)) if (e.id !== bot.entity?.id && (e.id !== job.entityId || job.mode !== 'first')) entities.queue(e,true);
      };
      sync(); const timer = setInterval(sync,200);
      const close = () => {clearInterval(timer);chunks.close();entities.close();bot.off('entityGone',entities.remove);off();sessions.delete(close);};
      sessions.add(close); socket.once('disconnect',close);
    });
    const abortCapture = () => { void context?.close().catch(()=>{}); };
    signal.addEventListener('abort',abortCapture,{once:true});
    try {
      await new Promise((resolve,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
      origin = 'http://127.0.0.1:' + server.address().port;
      context = await browser.createBrowserContext(); const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror',e => pageErrors.push(String(e.message).replace(/https?:\/\/\S+/g,'[local asset]').slice(0,300)));
      await page.setViewport({width:768,height:768,deviceScaleFactor:1});
      await page.setRequestInterception(true);
      page.on('request',req => {const url=req.url(); if (url.startsWith(origin+'/') || url.startsWith('data:') || url.startsWith('blob:')) void req.continue(); else void req.abort();});
      await page.goto(origin + '/?photo=1&distance=2&fov=70&token=' + token,{waitUntil:'domcontentloaded',timeout:20_000});
      if (options.onPreview) await options.onPreview({url:origin + '/?photo=1&distance=2&fov=70&token=' + token,job:job.job});
      try { await page.waitForFunction(() => globalThis.__photoReady?.() === true,{timeout:25_000}); }
      catch (error) {
        const diagnostics = await page.evaluate(() => ({chunks:globalThis.__lanternRenderer?.chunkLoading ?? null,boot:document.querySelector('.boot')?.textContent ?? null})).catch(()=>null);
        log(`photo job=${job.job} renderer=${JSON.stringify(diagnostics?.chunks ?? null)} errors=${pageErrors.length}`);
        if (options.onRenderFailure) await options.onRenderFailure({diagnostics,pageErrors,png:await page.screenshot({type:'png'})});
        throw error;
      }
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      guard();
      if (options.beforeScreenshot) await options.beforeScreenshot({url:origin + '/?distance=2&token=' + token,job:job.job});
      guard();
      const canvas = await page.$('#viewer-canvas');
      const png = Buffer.from(await canvas.screenshot({type:'png'}));
      if (png.length < 1024 || png.length > 4 * 1024 * 1024) throw Error('PHOTO_IMAGE_SIZE_INVALID');
      guard();
      const body = new FormData(); body.append('image',new Blob([png],{type:'image/png'}),'photo.png');
      reply('uploading',job);
      const response = await fetch(job.uploadBase + '/upload?id=' + job.uploadId,{method:'POST',body,redirect:'error',signal});
      if (!response.ok) throw Error('PHOTO_IMPORT_REJECTED');
      await response.arrayBuffer();
      reply('uploaded',job);
      log(`photo job=${job.job} uploaded bytes=${png.length} sha256=${createHash('sha256').update(png).digest('hex')}; game confirmation pending`);
      if (options.onCapture) await options.onCapture({job:job.job,png});
    } finally {
      signal.removeEventListener('abort',abortCapture);
      await context?.close().catch(()=>{}); for (const close of sessions) close();
      bridge.dispose(); io.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
  }

  const close = () => { if (stopped) return; stopped=true; available=false; clearInterval(heartbeat);stopJob();bot.off('spawn',init);bot._client.off('camera',onCamera);bot._client.off('custom_payload',onPayload);void browser?.close().catch(()=>{}); };
  bot.once('end',close);
  return {close};
}
