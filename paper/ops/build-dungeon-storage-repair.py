"""Replace only the deployed dungeon manager, preserving unrelated unreleased work."""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import zipfile

p=argparse.ArgumentParser();p.add_argument('--server',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
p.add_argument('--jdk',type=Path,default=Path('E:/MC/jdk/jdk-21.0.12.1+1'));a=p.parse_args()
a.output.mkdir(parents=True,exist_ok=False);paper=Path(__file__).resolve().parents[1];repo=paper.parent
base=a.server/'plugins/AgentFriend-0.4.47.10.jar';sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
assert sha(base)=='fa48a39410854eadb054eb3d8cbaaa65aad3e179c43ce22cad4d8a7f0efa013d'
cp=[a.server/'versions/1.21.1/paper-1.21.1.jar',*sorted((a.server/'libraries').rglob('*.jar')),*sorted((a.server/'plugins').glob('*.jar'))]
def compile(source,destination):
    destination.mkdir();options=['-proc:none','-implicit:none','-encoding','UTF-8','--release','21','-cp',';'.join(map(str,cp)),'-d',str(destination),str(source)]
    argfile=destination/'javac.args';argfile.write_text('\n'.join('"'+x.replace('\\','/')+'"' for x in options),encoding='utf8')
    subprocess.run([str(a.jdk/'bin/javac.exe'),'@'+str(argfile)],check=True)

relative='paper/plugins/AgentFriend/src/org/afuhome/agentfriend/SiteDungeonManager.java'
old=a.output/'baseline-source/SiteDungeonManager.java';old.parent.mkdir()
old.write_bytes(subprocess.check_output(['git','-C',str(repo),'show','5652d4e27418ddc163b06f462dbb784e380f7995:'+relative]))
compile(old,a.output/'baseline-classes')
with zipfile.ZipFile(base) as jar:
    for f in (a.output/'baseline-classes').rglob('*.class'):
        name=f.relative_to(a.output/'baseline-classes').as_posix()
        assert jar.read(name)==f.read_bytes(),'Source is not the deployed baseline: '+name

compile(repo/relative,a.output/'classes')
entries={f.relative_to(a.output/'classes').as_posix():f.read_bytes() for f in (a.output/'classes').rglob('*.class')}
assert all(n.startswith('org/afuhome/agentfriend/SiteDungeonManager') and n.endswith('.class') for n in entries)
target=a.output/'AgentFriend-0.4.47.11.jar';preserved=0
with zipfile.ZipFile(base) as source,zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED) as out:
    descriptor=source.read('plugin.yml');assert b"version: '0.4.47.10'" in descriptor
    entries['plugin.yml']=descriptor.replace(b"version: '0.4.47.10'",b"version: '0.4.47.11'")
    for name in dict.fromkeys([*source.namelist(),*entries]):
        info=zipfile.ZipInfo(name,date_time=(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
        out.writestr(info,entries[name] if name in entries else source.read(name));preserved+=name not in entries

compile(paper/'plugins/AgentFriend/tests/DungeonStorageFixture.java',a.output/'fixture-classes')
with zipfile.ZipFile(a.output/'DungeonStorageFixture.jar','x',zipfile.ZIP_DEFLATED) as jar:
    jar.writestr('plugin.yml',"name: DungeonStorageFixture\nversion: '1.0.0'\nmain: org.afuhome.agentfriend.tests.DungeonStorageFixture\napi-version: '1.21'\ndepend: [AgentFriend]\n")
    for f in (a.output/'fixture-classes').rglob('*.class'):jar.write(f,f.relative_to(a.output/'fixture-classes').as_posix())
record={'baselineSha256':sha(base),'candidateSha256':sha(target),'preservedEntries':preserved,'changedEntries':sorted(entries),'baselineSourceMatches':True}
(a.output/'build.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf8');print(json.dumps(record))
