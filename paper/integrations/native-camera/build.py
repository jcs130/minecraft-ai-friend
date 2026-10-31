"""Compile against the installed native client and reuse MC core's verified YSM reader."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import zipfile

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--game',type=Path,required=True)
    parser.add_argument('--jdk',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--install',action='store_true')
    args=parser.parse_args()
    source=Path(__file__).resolve().parent;repo=source.parents[2]
    out=args.out.resolve()
    if out.exists() or out.is_relative_to(repo):raise SystemExit('Use a new external build directory; stale classes must not enter a camera build')
    out.mkdir(parents=True)
    classes=out/'classes';classes.mkdir(exist_ok=True)
    deps=out/'deps';deps.mkdir(exist_ok=True)
    api=next((args.game/'mods').glob('fabric-api-*.jar'))
    with zipfile.ZipFile(api) as archive:
        for name in archive.namelist():
            if name.startswith('META-INF/jars/') and name.endswith('.jar'):
                (deps/Path(name).name).write_bytes(archive.read(name))
    minecraft=next((args.game/'.fabric/remappedJars').glob('**/*client-intermediary.jar'))
    # Compile against the renderer's installed bridge. A repository build directory
    # may be absent or belong to a newer, independently tested core candidate.
    bridge=args.game/'mods/agent-mc-bridge-0.1.0-fabric-1.21.1.jar'
    if not bridge.is_file():bridge=repo/'packages/agent-mc-java-bridge/build/agent-mc-bridge-0.1.0-fabric-1.21.1.jar'
    if not bridge.is_file():raise SystemExit('Build/install the matching MC bridge before compiling the camera')
    with zipfile.ZipFile(bridge) as archive:
        if 'org/agentmc/bridge/ClientBridge.class' not in archive.namelist():raise SystemExit('Installed bridge lacks the required ClientBridge API')
    ysm_candidates=[]
    for jar in (args.game/'mods').glob('*.jar'):
        with zipfile.ZipFile(jar) as archive:
            if 'fabric.mod.json' in archive.namelist():
                metadata=json.loads(archive.read('fabric.mod.json'))
                if metadata.get('id')=='yes_steve_model':ysm_candidates.append((jar,metadata['version']))
    if len(ysm_candidates)!=1:raise SystemExit('Install exactly one supported YSM client before building the camera')
    ysm,declared_version=ysm_candidates[0]
    match=re.fullmatch(r'(2\.(?:4\.1|6\.5))(?:[-+].*)?',declared_version)
    if not match:raise SystemExit('Unreviewed YSM client API: '+declared_version)
    version=match.group(1)
    reviewed={'2.4.1':'ec51cfae84d219a45fac5098a31bfe980bcb7c2d8b413e8fffbd05a411a85680',
              '2.6.5':'a66b7265a2761d639c48f61a64179206adf5d81c38f360763fc8275a0fec9fa5'}
    if hashlib.sha256(ysm.read_bytes()).hexdigest()!=reviewed[version]:raise SystemExit('Installed YSM artifact does not match its reviewed client reader')
    appearance=repo/'packages/agent-mc-world/client-appearance'
    shared_path=appearance/'YsmAccess.java' if version=='2.4.1' else appearance/'ysm-2.6.5/YsmAccess.java'
    shared=shared_path.read_text()
    if 'static String enforce' not in shared:raise SystemExit('Shared read-only YSM contract changed; review required')
    reader=shared.split('    static String enforce',1)[0]+'}\n'
    reader=reader.replace('package org.agentmc.appearance;','package org.qiandeng.camera;').replace('ClientAppearances.DisplaySelection','NativeCameraClient.ModelSelection')
    generated=out/'YsmAccess.java';generated.write_text(reader,encoding='utf-8')
    jars=[minecraft,bridge,ysm]+list((args.game/'libraries').rglob('*.jar'))+list(deps.glob('*.jar'))
    sources=list((source/'client').glob('*.java'))+[generated]
    values=['--release','21','-encoding','UTF-8','-proc:none','-classpath',';'.join(map(str,jars)),'-d',str(classes)]+list(map(str,sources))
    arguments=out/'compile.args';arguments.write_text('\n'.join('"'+x.replace('\\','/').replace('"','\\"')+'"' for x in values),encoding='utf-8')
    subprocess.run([str(args.jdk/'bin/javac.exe'),'@'+str(arguments)],check=True)
    for file in (source/'client').glob('*.json'):shutil.copyfile(file,classes/file.name)
    metadata=json.loads((classes/'fabric.mod.json').read_text())
    metadata['depends']['yes_steve_model']=declared_version
    (classes/'fabric.mod.json').write_text(json.dumps(metadata,indent=2)+'\n')
    target=out/'qiandeng-native-camera-0.1.0.jar'
    subprocess.run([str(args.jdk/'bin/jar.exe'),'--create','--file',str(target),'-C',str(classes),'.'],check=True)
    (out/'build-receipt.json').write_text(json.dumps({'ysmVersion':declared_version,'ysmSha256':hashlib.sha256(ysm.read_bytes()).hexdigest(),'sharedReader':str(shared_path.relative_to(repo)),'readerSha256':hashlib.sha256(shared_path.read_bytes()).hexdigest(),'bridgeSha256':hashlib.sha256(bridge.read_bytes()).hexdigest(),'jarSha256':hashlib.sha256(target.read_bytes()).hexdigest()},indent=2)+'\n')
    if args.install:
        for file in (target,bridge):
            destination=args.game/'mods'/file.name
            if file.resolve()!=destination.resolve():shutil.copyfile(file,destination)
    print(target)

if __name__=='__main__':main()
