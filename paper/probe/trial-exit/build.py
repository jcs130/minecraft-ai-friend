"""Build a narrow return-flow candidate and a separate loopback-only fixture."""
from pathlib import Path
import argparse, difflib, hashlib, json, subprocess, zipfile

p=argparse.ArgumentParser(description=__doc__)
for name in ('baseline','classpath-file','output'): p.add_argument('--'+name,type=Path,required=True)
p.add_argument('--jdk',type=Path,default=Path('E:/MC/jdk/jdk-21.0.12.1+1'))
a=p.parse_args();a.output.mkdir(parents=True,exist_ok=False)
repo=Path(__file__).resolve().parents[3];prefix='org/afuhome/agentfriend/'
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
assert sha(a.baseline)=='879b84565e4381aaac9e4a6cfd545cd5ad7e70115e48af7ef39f5e44471427de','Baseline changed'
owners=('DungeonManager','TrialGuide')
cp=str(a.baseline)+';'+a.classpath_file.read_text(encoding='utf-8-sig').strip()
def compile(sources,target):
    target.mkdir();argfile=target/'javac.args'
    args=['--release','21','-encoding','UTF-8','-proc:none','-implicit:none','-cp',cp,'-d',str(target),*map(str,sources)]
    argfile.write_text('\n'.join('"'+str(v).replace('\\','/')+'"' for v in args),encoding='utf8')
    subprocess.run([str(a.jdk/'bin/javac.exe'),'-J-Duser.language=en','@'+str(argfile)],check=True)
old=a.output/'baseline-source';old.mkdir();patched=a.output/'candidate-source';patched.mkdir()
for name in owners:
    relative='paper/plugins/AgentFriend/src/'+prefix+name+'.java'
    def source(ref):return subprocess.check_output(['git','-C',str(repo),'show',ref+':'+relative]).decode('utf8').replace('\r\n','\n')
    before=source('15b0131f');baseline=source('58b417c9088d4112a3683cdfe2b2be06ac55bacd')
    (old/(name+'.java')).write_text(baseline,encoding='utf8')
    after=(repo/relative).read_text(encoding='utf8')
    left,right=before.splitlines(keepends=True),after.splitlines(keepends=True)
    image=baseline;edits=[]
    for op,i,j,k,l in difflib.SequenceMatcher(None,left,right).get_opcodes():
        if op=='equal':continue
        pre=''.join(left[max(0,i-3):i]);post=''.join(left[j:j+3])
        needle=pre+''.join(left[i:j])+post
        assert baseline.count(needle)==1,'Patch no longer applies uniquely: '+name+' at '+str(i+1)
        start=baseline.index(needle)+len(pre)
        edits.append((start,start+len(''.join(left[i:j])),''.join(right[k:l])))
    for start,end,replacement in sorted(edits,reverse=True):image=image[:start]+replacement+image[end:]
    (patched/(name+'.java')).write_text(image,encoding='utf8')
compile(list(old.glob('*.java')),a.output/'baseline-classes')
with zipfile.ZipFile(a.baseline) as base:
    for file in (a.output/'baseline-classes').rglob('*.class'):
        assert base.read(file.relative_to(a.output/'baseline-classes').as_posix())==file.read_bytes(), 'Unreleased baseline source: '+str(file)
compile(list(patched.glob('*.java')),a.output/'classes')
entries={file.relative_to(a.output/'classes').as_posix():file.read_bytes() for file in (a.output/'classes').rglob('*.class')}
assert all(any(name==prefix+n+'.class' or name.startswith(prefix+n+'$') for n in owners) for name in entries)
target=a.output/'AgentFriend-0.4.47.76-trial-return.jar'
with zipfile.ZipFile(a.baseline) as base,zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED) as out:
    entries['plugin.yml']=base.read('plugin.yml').replace(b'0.4.47.75-trial-gear',b'0.4.47.76-trial-return')
    for name in dict.fromkeys([*base.namelist(),*entries]):
        info=zipfile.ZipInfo(name,(2026,11,14,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
        out.writestr(info,entries.get(name,base.read(name) if name in base.namelist() else b''))
compile([Path(__file__).with_name('TrialExitQa.java')],a.output/'fixture-classes')
with zipfile.ZipFile(a.output/'TrialExitQa.jar','x',zipfile.ZIP_DEFLATED) as out:
    out.writestr('plugin.yml',"name: TrialExitQa\nversion: '1.0.0'\nmain: org.afuhome.agentfriend.tests.TrialExitQa\napi-version: '1.21'\ndepend: [AgentFriend]\n")
    for file in (a.output/'fixture-classes').rglob('*.class'):out.write(file,file.relative_to(a.output/'fixture-classes').as_posix())
with zipfile.ZipFile(a.baseline) as base,zipfile.ZipFile(target) as candidate:
    unchanged=[name for name in base.namelist() if name not in entries]
    assert all(base.read(name)==candidate.read(name) for name in unchanged)
proof={'baselineSha256':sha(a.baseline),'candidateSha256':sha(target),'baselineSourceMatches':True,
       'changedOwners':list(owners),'unrelatedEntriesPreserved':len(unchanged),'productionChanged':False}
(a.output/'build.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps(proof))
