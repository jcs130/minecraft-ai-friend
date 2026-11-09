"""Prepare an isolated code candidate; never edits the supplied live source.
No runtime assets, cookies, saves or credentials are copied. Deployment is separate.
"""
from pathlib import Path
import argparse,shutil,json,hashlib
p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--destination',required=True);a=p.parse_args()
src=Path(a.source).resolve();dst=Path(a.destination).resolve();here=Path(__file__).resolve().parent
assert src.is_dir() and not dst.exists() and not dst.is_relative_to(src) and not src.is_relative_to(dst)
dst.mkdir(parents=True)
for name in ['public','src','vendor']:
 shutil.copytree(src/name,dst/name,ignore=shutil.ignore_patterns('node_modules','.git','asset-packs','dist','build'))
for name in ['server.mjs','gateway-server.mjs','package.json']:shutil.copyfile(src/name,dst/name)
changed={}
def edit(name,old,new):
 path=dst/name;text=path.read_text(encoding='utf-8');assert text.count(old)==1,(name,old[:80],text.count(old))
 changed.setdefault(name,hashlib.sha256((src/name).read_bytes()).hexdigest())
 path.write_text(text.replace(old,new),encoding='utf-8')
for folder in ['src','public']:
 for file in (here/folder).iterdir():shutil.copyfile(file,dst/folder/file.name)
edit('server.mjs',"import http from 'node:http';","import http from 'node:http';\nimport {createPlayRtcGateway} from './src/play-rtc-gateway.mjs';")
edit('server.mjs',"originKey = null, existingRolesOnly = false, voiceLoopbackPort, webLogin = null,","originKey = null, existingRolesOnly = false, voiceLoopbackPort, webLogin = null, playRtcRuntime = null,")
edit('server.mjs','async function body(req) {','async function body(req, limit = 8192) {')
edit('server.mjs','if (size > 8192)','if (size > limit)')
edit('src/gateway.mjs',"import http from 'node:http';","import http from 'node:http';\nimport {isPlayRtcPath,playRtcBodyLimit} from './play-rtc-http-policy.mjs';")
edit('src/gateway.mjs','function allowedPath(pathname) {','function allowedPath(pathname) {\n  if(isPlayRtcPath(pathname))return true;')
edit('src/gateway.mjs','const bodyLimit = voiceUpload ? 4 * 1024 * 1024 : 8192;','const bodyLimit = voiceUpload ? 4 * 1024 * 1024 : playRtcBodyLimit(url.pathname);')
edit('server.mjs',"  const sessions = new Map();","  const sessions = new Map();\n  const playRtc=createPlayRtcGateway({runtime:playRtcRuntime,rate});")
edit('server.mjs',"'/client-shell.js': ['client-shell.js', 'text/javascript; charset=utf-8'],", "'/play-rtc-client.mjs':['play-rtc-client.mjs','text/javascript; charset=utf-8'], '/native-rtc-protocol.js':['native-rtc-protocol.js','text/javascript; charset=utf-8'],\n  '/client-shell.js': ['client-shell.js', 'text/javascript; charset=utf-8'],")
anchor="      if (req.method === 'POST' && pathname === '/api/play/control') {"
routes="""      if(req.method==='POST'&&pathname==='/api/play/rtc/offer'){
        rate(row,'rtc-offer',3,60000);
        try{return json(res,await playRtc.offer(row,req.headers['x-client-id'],await body(req,65536)))}
        catch(e){throw new ApiError(e.status??503,e.reason??'RTC_UNAVAILABLE','实时通道暂不可用，保留原连接方式')}
      }
      if(req.method==='POST'&&pathname==='/api/play/rtc/receipt'){
        rate(row,'rtc-query',20);const data=await body(req);
        try{return json(res,playRtc.query(row,req.headers['x-client-id'],data.requestId))}
        catch(e){throw new ApiError(e.status??403,e.reason??'OWN_PLAY_REQUIRED','无法查询此角色的操作')}
      }
"""
routes="      if(req.method==='GET'&&pathname==='/api/play/rtc/status'){rate(row,'rtc-capabilities',6,60000);try{return json(res,playRtc.capabilities(row))}catch(e){throw new ApiError(e.status??403,e.reason??'OWN_PLAY_REQUIRED','本人角色尚未就绪')}}\n"+routes
edit('server.mjs',anchor,routes+anchor+"\n        try{playRtc.assertHttp(row)}catch(e){throw new ApiError(409,e.reason,'实时控制连接仍在使用，请先停止控制')}")
edit('src/gateway.mjs',"'touch-controller.mjs', 'client-transport.mjs'", "'play-rtc-client.mjs', 'native-rtc-protocol.js', 'touch-controller.mjs', 'client-transport.mjs'")
edit('server.mjs',"async close() { clearInterval(cleanup);", "async close() { playRtc.close(); clearInterval(cleanup);")
edit('src/game.mjs','async control(packet, clientId) {','async control(packet, clientId, onReceipt) {')
edit('src/game.mjs',"socket.emit('viewerControl', data, value => {", """socket.emit('viewerControl', data, value => {
        if(['primary','secondary','hotbar','navigate','inventory'].includes(data.type)) onReceipt?.({...value,
          active:socket.state?.active===true,epoch:socket.state?.active?socket.state.epoch:null});""")
edit('gateway-server.mjs',"const app = createToyServer({", """let playRtcRuntime=null;
if(config.playRtcConfig){
  const {loadPlayRtcRuntime}=await import('./src/play-rtc-runtime.mjs');
  playRtcRuntime=await loadPlayRtcRuntime(config.playRtcConfig);
}
const app = createToyServer({ playRtcRuntime,""")
edit('public/app.js',"function control(type, extra = {}, lease = epoch, keepalive = false) {","""let playRtc=null;
async function preparePlayRtc(){
  if(playRtc?.status().ready)return;
  const capabilities=await api('/api/play/rtc/status','GET',undefined,true);
  if(!capabilities.enabled)return;
  playRtc?.close();
  const {createPlayRtcClient}=await import('./play-rtc-client.mjs');
  playRtc=createPlayRtcClient({
    iceServers:capabilities.iceServers,
    iceTransportPolicy:capabilities.iceTransportPolicy,
    offer:sdp=>api('/api/play/rtc/offer','POST',sdp,true),
    queryReceipt:requestId=>api('/api/play/rtc/receipt','POST',{requestId},true),
    onLost:()=>{void stopControls('实时连接中断，已停止控制；请重新接管，不会重复执行操作。',true)}
  });
  window.QdPlayRtc=playRtc;
  if(await playRtc.connect()){
    try{ui.viewer.contentWindow.dispatchEvent(new Event('qd-play-rtc-ready'))}catch{}
  }
}
function control(type, extra = {}, lease = epoch, keepalive = false) {
  if(playRtc?.status().ready){
    const payload={type,epoch:lease,...extra,...(type==='motion'?{input:motionInput()}:{})};
    const started=performance.now();
    const result=type==='motion'?Promise.resolve(playRtc.motion(payload)):playRtc.action(payload);
    return result.then(r=>{inputSamples.push({type,transport:'webrtc',roundTripMs:Math.round(performance.now()-started),status:r.status,requestId:r.requestId});
      if(inputSamples.length>120)inputSamples.shift();return r});
  }""")
edit('public/app.js',"    const result = await control('acquire', {}, null);", "    await preparePlayRtc();\n    if(ticket!==intent||!canAcquire()){playRtc?.close();return;}\n    const result = await control('acquire', {}, null);")
# Reuse existing decoder verbatim, and preserve all consumer-only rendering fixes.
renderer='vendor/mc-visual-console/packages/modern-viewer/renderer-src/'
name=renderer+'src/native-viewer/native-event-stream.js'
edit(name,'export function createNativeEventStream({',"import {createPlayWorldStream} from './play-world-stream.js';\nexport function createNativeEventStream(options){return createPlayWorldStream(options,createNativeSseStream)}\nfunction createNativeSseStream({")
shutil.copyfile(here/'public/play-world-stream.js',dst/renderer/'src/native-viewer/play-world-stream.js')
shutil.copyfile(here.parent/'agent-portal/src/webrtc-runtime.mjs',dst/'src/webrtc-runtime.mjs')
manifest={'schemaVersion':1,'productionChanged':False,'before':changed,'after':{n:hashlib.sha256((dst/n).read_bytes()).hexdigest() for n in changed}}
(dst/'rtc-candidate.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print(json.dumps({'candidatePrepared':True,'modifiedExistingFiles':len(changed),'productionChanged':False}))
