"""Create a new optional client bridge + JS SDK bundle, without starting any service."""
from pathlib import Path
import argparse,hashlib,json,shutil
from install_maw_native_sdk import dependencies,REPO,SOURCE,RUNTIME

def install(destination:Path,build_record:Path):
    destination=destination.resolve();parent=(RUNTIME/'integrations/java-client-bridge').resolve()
    if parent not in destination.parents or destination.exists():raise ValueError('Use a fresh named client bridge bundle')
    record=json.loads(build_record.read_bytes());jar=Path(record['jar'])
    digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    if not record['clientOnly'] or record['serverRequired'] or record['customPayloadChannels'] or digest(jar)!=record['sha256']:raise ValueError('Unverified bridge artifact')
    source=REPO/'world/java-client-bridge-src'
    if not all(digest(source/name)==value for name,value in record['sources'].items()):raise ValueError('Build differs from current bridge source')
    entries=['world-adapter/index.cjs','world-adapter/stdio.cjs','java-client/mineflayer-facade.cjs']
    files={p.relative_to(SOURCE).as_posix():p.read_bytes() for p in sorted(set(p for entry in entries for p in dependencies(SOURCE/entry)))}
    package=json.loads((SOURCE/'society-agent/package.json').read_bytes());package.update(name='@my-agent-world/java-client-bridge',version='0.1.0',main='world-adapter/index.cjs',license='MIT')
    lock=json.loads((SOURCE/'society-agent/package-lock.json').read_bytes())
    if lock['packages']['']['dependencies']!=package['dependencies']:raise ValueError('Pinned runtime dependency mismatch')
    lock.update(name=package['name'],version=package['version']);lock['packages'][''].update(name=package['name'],version=package['version'])
    files['package.json']=(json.dumps(package,indent=2)+'\n').encode();files['package-lock.json']=(json.dumps(lock,indent=2)+'\n').encode()
    files[jar.name]=jar.read_bytes();files['LICENSE']=(REPO/'LICENSE').read_bytes()
    for name in ('MY-AGENT-WORLD-JAVA-CLIENT.md','MY-AGENT-WORLD-JAVA-CLIENT.txt'):files[name]=(REPO/'docs'/name).read_bytes()
    files['operations.json']=(source/'resources/client-operations.json').read_bytes()
    destination.mkdir(parents=True)
    for name,data in files.items():
        p=destination/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
    manifest={'schemaVersion':1,'directory':str(destination),'version':'0.1.0','jar':jar.name,'jarSha256':record['sha256'],
        'clientOnly':True,'serverRequired':False,'customPayloadChannels':[],'providers':['mineflayer','numen','java-client'],
        'operationCount':23,'newServices':0,'modelRequests':0,'files':{name:hashlib.sha256(data).hexdigest() for name,data in sorted(files.items())}}
    for target in (destination/'installation.json',parent/'installation.json'):target.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    return {k:manifest[k] for k in ['directory','jarSha256','operationCount','serverRequired']}
if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--destination',type=Path,required=True);ap.add_argument('--build-record',type=Path,required=True)
    a=ap.parse_args();print(json.dumps(install(a.destination,a.build_record),indent=2))
