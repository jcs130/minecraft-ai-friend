"""Compile native Bedrock companion forms against the pinned Geyser distribution."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import zipfile
from build_society_bridge import add_bytes
from society_lab import DEFAULT_ROOT, DEFAULT_JAVA, REPO, sha256

NAME='MawAgents.jar'
GEYSER_SHA='b3b39ada8f56a44f018d5e405874cbb2152527fab0240603309831e89e5e95c7'

def build(root=DEFAULT_ROOT,java=DEFAULT_JAVA):
    source=REPO/'world/bedrock-agents-src'
    geyser=root/'bedrock/plugins/Geyser-ViaProxy.jar'
    if sha256(geyser)!=GEYSER_SHA:raise ValueError('Unexpected Geyser distribution')
    output=root/'build/bedrock-agents';output.mkdir(parents=True,exist_ok=True)
    sources=sorted((source/'src').rglob('*.java'))
    with tempfile.TemporaryDirectory(dir=output) as temp:
        classes=Path(temp)/'classes';classes.mkdir()
        result=subprocess.run([str(java.with_name('javac.exe')),'-J-Duser.language=en','-proc:none','--release','21','-encoding','UTF-8','-classpath',str(geyser),'-d',str(classes),*map(str,sources)],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=120)
        if result.returncode:raise RuntimeError(result.stderr[-7000:])
        jar=output/NAME
        with zipfile.ZipFile(jar,'w') as z:
            add_bytes(z,'extension.yml',(source/'extension.yml').read_bytes())
            for p in sorted(classes.rglob('*.class')):add_bytes(z,p.relative_to(classes).as_posix(),p.read_bytes())
    record={'schemaVersion':1,'jar':str(jar),'sha256':sha256(jar),'geyserSha256':GEYSER_SHA,'clientRequired':False,'nativeForms':True,'sourceFiles':{p.relative_to(REPO).as_posix():sha256(p) for p in (*sources,source/'extension.yml',Path(__file__))}}
    (output/'build-record.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8');return record

def smoke(root=DEFAULT_ROOT,java=DEFAULT_JAVA):
    output=root/'build/bedrock-agents'
    cp=';'.join(map(str,(output/NAME,root/'bedrock/plugins/Geyser-ViaProxy.jar',root/'bedrock/ViaProxy-3.4.14.jar')))
    with tempfile.TemporaryDirectory(dir=output) as temp:
        tests=sorted((REPO/'world/bedrock-agents-src/test').rglob('*.java'))
        subprocess.run([str(java.with_name('javac.exe')),'-J-Duser.language=en','-proc:none','--release','21','-encoding','UTF-8','-cp',cp,'-d',temp,*map(str,tests)],check=True)
        result=subprocess.run([str(java),'-cp',cp+';'+temp,'dev.qiandeng.bedrock.agents.AgentFormsSmoke'],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=30)
        if result.returncode:raise RuntimeError(result.stderr[-5000:])
        return json.loads(result.stdout)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,default=DEFAULT_ROOT);p.add_argument('--smoke',action='store_true');a=p.parse_args();record=build(a.root)
    if a.smoke:record['smoke']=smoke(a.root)
    print(json.dumps({'ok':True,**record}))
