"""Publish only static registry types and our client code, never world/player data."""
from pathlib import Path
import gzip, hashlib, io, json, tarfile, os

def digest(raw): return hashlib.sha256(raw).hexdigest()
def atomic(path, raw):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_name(path.name+'.tmp')
    with tmp.open('wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
    os.replace(tmp,path)

def publish(root, source):
    root,source=Path(root),Path(source);base=root/'server/maw-sao/registry';meta=json.loads((base/'current.json').read_text(encoding='utf-8'))
    assets=root/'ops/public-assets';epoch=meta['serverEpoch'];files={};index={}
    def asset(uri,relative,raw,kind='application/octet-stream'):
        target=assets/relative;atomic(target,raw);index[uri]={'path':relative,'bytes':len(raw),'sha256':digest(raw),'contentType':kind}
    for name in ['states.jsonl','items.jsonl','entities.jsonl']:
        raw=(base/epoch/name).read_bytes();packed=gzip.compress(raw,compresslevel=6,mtime=0);uri='/native/'+epoch+'/'+name+'.gz'
        asset(uri,uri[1:],packed,'application/gzip');files[name]={'path':uri,'bytes':len(raw),'sha256':digest(raw),'compressedSha256':digest(packed)}
    metadata={k:v for k,v in meta.items()if k!='directory'}
    manifest={'schemaVersion':1,'minecraft':'1.20.1','serverEpoch':epoch,'metadata':metadata,'files':files,'containsWorldData':False}
    asset('/native-manifest.json','native-manifest.json',json.dumps(manifest,separators=(',',':')).encode(),'application/json')
    payloads={}
    package=json.loads((source/'package.json').read_text());package.update(name='myagentworld-sao-client',version='0.1.2',private=False,main='index.cjs');package.pop('scripts',None)
    lock=json.loads((source/'package-lock.json').read_text());lock.update(name=package['name'],version=package['version']);lock['packages'][''].update(name=package['name'],version=package['version'])
    payloads['package.json']=json.dumps(package,indent=2).encode();payloads['package-lock.json']=json.dumps(lock,indent=2).encode();payloads['index.cjs']=(source/'public/sdk.cjs').read_bytes()
    for name in ['sao_bot.cjs','account-receipts.cjs','forge_client.cjs','native_registry.cjs','sao-client.cjs','sao-operations.json','sao-tools.cjs','sao-engine.mjs','protection-client.cjs','craft-fence.cjs']:
        payloads['integrations/sao-compat/'+name]=(source/name).read_bytes()
    for name in ['native-client.cjs','operations.json']:payloads['integrations/tau-ceti/native-bridge/'+name]=(source.parent/'tau-ceti/native-bridge'/name).read_bytes()
    payloads['README.txt']=('Node.js 22+. npm install --ignore-scripts <this.tgz>\nconst sdk=require("myagentworld-sao-client");\nconst bot=await sdk.connect({host:"micro.kangqiang.site",port:28977,username:"ag_YourName",cacheDirectory:"./private-sao-cache",authenticate:async body=>{body.chat("/login "+process.env.SAO_GAME_PASSWORD)}});\nCreate or bind the primary game role at https://mc.kangqiang.site first; a new shared body uses /login with that game password. A different body name requires /login primaryName gamePassword. Previously independent SAO accounts must prove their old password before explicit linking. Do not automatically repeat an uncertain login/registration. Never print passwords or include them in model messages.\nbot.native and bot.sao are per-connection native APIs. prepare() does not dispatch; reuse your one controller queue.\nA stale registry refuses readiness; reconnect with a fresh manifest. Unknown action outcomes must be reconciled using the original requestId, never replayed.\nFull Forge recipe discovery and every mod-specific UI are not advertised.\n').encode()
    buffer=io.BytesIO()
    with gzip.GzipFile(fileobj=buffer,mode='wb',mtime=0)as compressed:
        with tarfile.open(fileobj=compressed,mode='w')as archive:
            for name,raw in sorted(payloads.items()):
                info=tarfile.TarInfo('package/'+name);info.size=len(raw);info.mode=0o644;info.mtime=0;archive.addfile(info,io.BytesIO(raw))
    sdk=buffer.getvalue();asset('/sao-agent-sdk.tgz','sao-agent-sdk.tgz',sdk,'application/gzip')
    sums='\n'.join(value['sha256']+'  '+uri for uri,value in sorted(index.items()))+'\n';asset('/SHA256SUMS','SHA256SUMS',sums.encode(),'text/plain; charset=utf-8')
    atomic(assets/'assets.json',json.dumps({'schemaVersion':1,'serverEpoch':epoch,'files':index},indent=2).encode())
    return {'serverEpoch':epoch,'sdkSha256':digest(sdk),'assetCount':len(index),'registryBytes':sum(x['bytes']for x in files.values())}
