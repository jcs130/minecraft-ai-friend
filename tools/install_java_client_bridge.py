"""Create a new optional client bridge + JS SDK bundle, without starting any service."""
from pathlib import Path
import argparse,hashlib,json,shutil
from install_maw_native_sdk import dependencies,REPO,SOURCE,RUNTIME

def install(destination:Path,build_record:Path,baritone_jar:Path|None=None,minescript_jar:Path|None=None,*,activate=True):
    destination=destination.resolve();parent=(RUNTIME/'integrations/java-client-bridge').resolve()
    if parent not in destination.parents or destination.exists():raise ValueError('Use a fresh named client bridge bundle')
    record=json.loads(build_record.read_bytes());jar=Path(record['jar'])
    digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    if not record['clientOnly'] or record['serverRequired'] or record['customPayloadChannels'] or digest(jar)!=record['sha256']:raise ValueError('Unverified bridge artifact')
    source=REPO/'world/java-client-bridge-src'
    if not all(digest(source/name)==value for name,value in record['sources'].items()):raise ValueError('Build differs from current bridge source')
    entries=['world-adapter/index.cjs','world-adapter/stdio.cjs','java-client/mineflayer-facade.cjs']
    files={p.relative_to(SOURCE).as_posix():p.read_bytes() for p in sorted(set(p for entry in entries for p in dependencies(SOURCE/entry)))}
    package=json.loads((SOURCE/'society-agent/package.json').read_bytes());package.update(name='@my-agent-world/java-client-bridge',version=record['version'],main='world-adapter/index.cjs',license='MIT')
    lock=json.loads((SOURCE/'society-agent/package-lock.json').read_bytes())
    if lock['packages']['']['dependencies']!=package['dependencies']:raise ValueError('Pinned runtime dependency mismatch')
    lock.update(name=package['name'],version=package['version']);lock['packages'][''].update(name=package['name'],version=package['version'])
    files['package.json']=(json.dumps(package,indent=2)+'\n').encode();files['package-lock.json']=(json.dumps(lock,indent=2)+'\n').encode()
    files[jar.name]=jar.read_bytes();files['LICENSE']=(REPO/'LICENSE').read_bytes()
    files['tools/audit_java_client.py']=(REPO/'tools/audit_java_client.py').read_bytes()
    for name in ('MY-AGENT-WORLD-JAVA-CLIENT.md','MY-AGENT-WORLD-JAVA-CLIENT.txt','MY-AGENT-WORLD-UNIFIED-ACCESS.md','MY-AGENT-WORLD-UNIFIED-ACCESS.txt'):files[name]=(REPO/'docs'/name).read_bytes()
    evidence=REPO/'docs/evidence/unified-access-20261014.json'
    if evidence.is_file():files['evidence/'+evidence.name]=evidence.read_bytes()
    files['operations.json']=(source/'resources/client-operations.json').read_bytes()
    baritone_sha='7f9f40952c49e78388e4e9ceaa6fd91a5b662238e06c997b3de5438177f99d8d'
    if baritone_jar:
        if digest(baritone_jar)!=baritone_sha or baritone_jar.name!='baritone-api-neoforge-1.11.3.jar':raise ValueError('Expected exact original Baritone 1.11.3 NeoForge artifact')
        files[baritone_jar.name]=baritone_jar.read_bytes()
        files['BARITONE-SOURCE.txt']=('Original, unmodified Baritone 1.11.3 NeoForge API distribution.\nSource: https://github.com/cabaletta/baritone/tree/v1.11.3\nLicense: LGPL-3.0-or-later, https://github.com/cabaletta/baritone/blob/v1.11.3/LICENSE\nInstall only in the Java client mods directory.\nSHA256: '+baritone_sha+'\n').encode()
    minescript_sha='4e421ed49e38f7453178ce7d8cc8415367cb513e2d837d648ae844c1d8e4b351'
    if minescript_jar:
        if digest(minescript_jar)!=minescript_sha or minescript_jar.name!='minescript-neoforge-1.21.1-4.0.jar':raise ValueError('Expected exact original Minescript 4.0 NeoForge artifact')
        files[minescript_jar.name]=minescript_jar.read_bytes()
        files['MINESCRIPT-SOURCE.txt']=(REPO/'world/third-party/minescript/SOURCE.txt').read_bytes()
        files['MINESCRIPT-LICENSE.txt']=(REPO/'world/third-party/minescript/COPYING').read_bytes()
    for name in ('MY-AGENT-WORLD-MINESCRIPT.md','MY-AGENT-WORLD-MINESCRIPT.txt'):
        path=REPO/'docs'/name
        if path.is_file():files[name]=path.read_bytes()
    evidence=REPO/'docs/evidence/minescript-20261014.json'
    if evidence.is_file():files['evidence/'+evidence.name]=evidence.read_bytes()
    destination.mkdir(parents=True)
    for name,data in files.items():
        p=destination/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
    catalog=json.loads((source/'resources/client-operations.json').read_bytes())
    manifest={'schemaVersion':1,'directory':str(destination),'version':record['version'],'jar':jar.name,'jarSha256':record['sha256'],
        'clientOnly':True,'serverRequired':False,'customPayloadChannels':[],'providers':['mineflayer','numen','java-client'],
        'operationCount':catalog['operationCount'],'modFiles':[jar.name]+([baritone_jar.name] if baritone_jar else [])+([minescript_jar.name] if minescript_jar else []),
        'optionalBaritone':{'version':'1.11.3','sha256':baritone_sha,'bundled':bool(baritone_jar)},'newServices':0,'modelRequests':0,'files':{name:hashlib.sha256(data).hexdigest() for name,data in sorted(files.items())}}
    manifest['optionalMinescript']={'version':'4.0','sha256':minescript_sha,'bundled':bool(minescript_jar),'managedBy':'owning_minecraft_client_and_finite_script_deadline'}
    for target in [destination/'installation.json']+([parent/'installation.json'] if activate else []):target.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    return {k:manifest[k] for k in ['directory','jarSha256','operationCount','serverRequired']}
if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--destination',type=Path,required=True);ap.add_argument('--build-record',type=Path,required=True)
    ap.add_argument('--baritone-jar',type=Path,help='Optional exact original 1.11.3 NeoForge API JAR; never installed into a server')
    ap.add_argument('--minescript-jar',type=Path,help='Optional exact original 4.0 NeoForge JAR; Python interpreter is configured explicitly in Minescript')
    ap.add_argument('--no-activate',action='store_true',help='Keep the current shared installation manifest unchanged')
    a=ap.parse_args();print(json.dumps(install(a.destination,a.build_record,a.baritone_jar,a.minescript_jar,activate=not a.no_activate),indent=2))
