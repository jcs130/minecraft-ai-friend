"""Compile against the installed native client and reuse MC core's verified YSM reader."""
import argparse
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
    out=args.out.resolve();out.mkdir(parents=True,exist_ok=True)
    classes=out/'classes';classes.mkdir(exist_ok=True)
    deps=out/'deps';deps.mkdir(exist_ok=True)
    api=next((args.game/'mods').glob('fabric-api-*.jar'))
    with zipfile.ZipFile(api) as archive:
        for name in archive.namelist():
            if name.startswith('META-INF/jars/') and name.endswith('.jar'):
                (deps/Path(name).name).write_bytes(archive.read(name))
    minecraft=next((args.game/'.fabric/remappedJars').glob('**/*client-intermediary.jar'))
    bridge=repo/'packages/agent-mc-java-bridge/build/agent-mc-bridge-0.1.0-fabric-1.21.1.jar'
    shared=(repo/'packages/agent-mc-world/client-appearance/YsmAccess.java').read_text()
    if 'static String enforce' not in shared:raise SystemExit('Shared read-only YSM contract changed; review required')
    reader=shared.split('    static String enforce',1)[0]+'}\n'
    reader=reader.replace('package org.agentmc.appearance;','package org.qiandeng.camera;').replace('ClientAppearances.DisplaySelection','NativeCameraClient.ModelSelection')
    generated=out/'YsmAccess.java';generated.write_text(reader,encoding='utf-8')
    jars=[minecraft,bridge]+list((args.game/'libraries').rglob('*.jar'))+list(deps.glob('*.jar'))+list((args.game/'mods').glob('yesstevemodel-*.jar'))
    sources=list((source/'client').glob('*.java'))+[generated]
    values=['--release','21','-encoding','UTF-8','-proc:none','-classpath',';'.join(map(str,jars)),'-d',str(classes)]+list(map(str,sources))
    arguments=out/'compile.args';arguments.write_text('\n'.join('"'+x.replace('\\','/').replace('"','\\"')+'"' for x in values),encoding='utf-8')
    subprocess.run([str(args.jdk/'bin/javac.exe'),'@'+str(arguments)],check=True)
    for file in (source/'client').glob('*.json'):shutil.copyfile(file,classes/file.name)
    target=out/'qiandeng-native-camera-0.1.0.jar'
    subprocess.run([str(args.jdk/'bin/jar.exe'),'--create','--file',str(target),'-C',str(classes),'.'],check=True)
    if args.install:
        for file in (target,bridge):shutil.copyfile(file,args.game/'mods'/file.name)
    print(target)

if __name__=='__main__':main()
