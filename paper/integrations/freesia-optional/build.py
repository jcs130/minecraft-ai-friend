"""Build only the pinned Velocity integration; no production writes/downloads."""
from pathlib import Path
import argparse, hashlib, subprocess, zipfile, json

ROOT=Path(__file__).resolve().parent
PINNED={
 'annotations-24.1.0.jar':'27a770dc7ce50500918bb8c3c0660c98290630ec796b5e3cf6b90f403b3033c6',
 'Freesia-Worker-2.5.1+2.4.1.jar':'931ec5d348f2988b2c2e9fb83722366cb841ae7bbfd898713a36cad8d6454736',
 'Freesia-Velocity-2.5.1+2.4.1-all.jar':'1eaaeb97ba66d49ffb32acf84d3c349de1352c77c73e28a1d4ba96f96d92cae0',
 'packetevents-velocity-2.8.0.jar':'1889f17e58030b33ef8c3c9f0d3321c6fb93c0fbd830d96c30af88b2c5eef7b4',
 'velocity-3.4.0-SNAPSHOT-563.jar':'fe53021f3168322cb6cb68f78699866fd098df3c306e4359847a10b0d02689ef'}
parser=argparse.ArgumentParser();parser.add_argument('--dependencies',required=True,type=Path);parser.add_argument('--output',required=True,type=Path);parser.add_argument('--jdk',required=True,type=Path);parser.add_argument('--worker-cache',required=True,type=Path)
args=parser.parse_args();out=args.output.resolve()
assert out!=ROOT and not out.is_relative_to(ROOT),'Build artifacts belong outside the Git source directory'
assert not out.exists(),'Use a fresh output directory to prevent stale class inclusion'
out.mkdir(parents=True)
deps=[]
for name,digest in PINNED.items():
    p=args.dependencies/name
    assert hashlib.sha256(p.read_bytes()).hexdigest()==digest,('Dependency digest mismatch',name)
    deps.append(str(p))
classes=out/'classes';classes.mkdir(exist_ok=True)
sources=list((ROOT/'src').rglob('*.java'))+list((ROOT/'bridge').rglob('*.java'))
subprocess.run([str(args.jdk/'bin/javac.exe'),'-proc:none','-encoding','UTF-8','--release','21','-cp',';'.join(deps),'-d',str(classes),*[str(p) for p in sources]],check=True)
patched=out/'Freesia-Velocity-2.5.1+2.4.1-af1.jar'
with zipfile.ZipFile(args.dependencies/'Freesia-Velocity-2.5.1+2.4.1-all.jar') as src,zipfile.ZipFile(patched,'w',zipfile.ZIP_DEFLATED) as dst:
    updates={p.relative_to(classes).as_posix():p.read_bytes() for p in (classes/'meow').rglob('*.class')}
    for info in src.infolist():
        if info.filename in updates:continue
        content=src.read(info.filename)
        if info.filename=='velocity-plugin.json':
            meta=json.loads(content);meta['version']='2.5.1+2.4.1.af1';content=json.dumps(meta).encode()
        dst.writestr(info,content)
    for name,data in updates.items():dst.writestr(name,data)
    dst.writestr('META-INF/agentfriend/MPL-2.0.txt',(ROOT/'LICENSE').read_bytes())
bridge=out/'AgentAppearance-0.3.0.jar'
with zipfile.ZipFile(bridge,'w',zipfile.ZIP_DEFLATED) as dst:
    for p in (classes/'org').rglob('*.class'):dst.writestr(p.relative_to(classes).as_posix(),p.read_bytes())
    dst.writestr('velocity-plugin.json',json.dumps({'id':'agentappearance','name':'AgentAppearance','version':'0.3.0','main':'org.afuhome.appearance.AppearanceBridge','dependencies':[{'id':'freesia','optional':False},{'id':'packetevents','optional':False}]}))
worker=out/'Freesia-Worker-2.5.1+2.4.1-af1.jar'
import io
with zipfile.ZipFile(args.dependencies/'Freesia-Worker-2.5.1+2.4.1.jar') as src,zipfile.ZipFile(worker,'w',zipfile.ZIP_DEFLATED) as dst:
    for info in src.infolist():
        content=src.read(info.filename)
        if info.filename=='META-INF/jars/Freesia-Common-2.5.1+2.4.1.jar':
            b=io.BytesIO()
            with zipfile.ZipFile(io.BytesIO(content)) as common,zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as patched_common:
                replacements={p.relative_to(classes).as_posix():p.read_bytes() for p in (classes/'meow/kikir/freesia/common').rglob('*.class')}
                for ci in common.infolist():
                    if ci.filename not in replacements:patched_common.writestr(ci,common.read(ci.filename))
                for name,data in replacements.items():patched_common.writestr(name,data)
            content=b.getvalue()
        dst.writestr(info,content)
worker_sources=list((ROOT/'worker').rglob('*.java'))
cache_jars=[args.worker_cache/'.fabric/remappedJars/minecraft-1.21.1-0.16.13/server-intermediary.jar',*sorted((args.worker_cache/'.fabric/processedMods').glob('fabric-lifecycle-events-v1-*.jar')),*sorted((args.worker_cache/'.fabric/processedMods').glob('fabric-api-base-*.jar')),*sorted((args.worker_cache/'libraries/net/fabricmc/fabric-loader/0.16.13').glob('*.jar'))]
assert len(cache_jars)==4 and all(p.is_file() for p in cache_jars),'Exact initialized Fabric 1.21.1 / Loader 0.16.13 cache required'
subprocess.run([str(args.jdk/'bin/javac.exe'),'-proc:none','-encoding','UTF-8','--release','21','-cp',';'.join([str(classes),*deps,*map(str,cache_jars)]),'-d',str(classes),*map(str,worker_sources)],check=True)
cleanup=out/'AgentAppearance-WorkerCleanup-0.1.0.jar'
with zipfile.ZipFile(cleanup,'w',zipfile.ZIP_DEFLATED) as dst:
    dst.writestr('org/afuhome/appearance/WorkerCleanup.class',(classes/'org/afuhome/appearance/WorkerCleanup.class').read_bytes())
    dst.writestr('fabric.mod.json',json.dumps({'schemaVersion':1,'id':'agentappearance_cleanup','version':'0.1.0','environment':'server','entrypoints':{'main':['org.afuhome.appearance.WorkerCleanup']},'depends':{'minecraft':'1.21.1','fabricloader':'>=0.16.13','freesia_worker':'2.5.1+2.4.1','fabric-api':'*'}}))
record={'dependencies':PINNED,'workerCache':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in cache_jars},'sources':{p.relative_to(ROOT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sources+worker_sources},'outputs':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (patched,bridge,worker,cleanup)}}
(out/'build-manifest.json').write_text(json.dumps(record,indent=2),encoding='utf-8')
print(json.dumps(record['outputs'],indent=2))
