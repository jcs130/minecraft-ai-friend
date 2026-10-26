"""Backport only retained-area capacity to the pinned live .16 artifact. Never installs."""
import argparse, hashlib, json, subprocess, zipfile
from pathlib import Path

BASE = 'c24f822a4c034bb5c780790674c1bb1b622deec19bc7553d44fcbaa14427f0bb'
PACKAGE = 'org/afuhome/agentfriend/'
sha = lambda b: hashlib.sha256(b).hexdigest()

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for n in ('base-jar','jdk','output'): p.add_argument('--'+n,type=Path,required=True)
    a=p.parse_args(); root=Path(__file__).resolve().parents[1]; out=a.output.resolve()
    assert not out.exists() and sha(a.base_jar.read_bytes())==BASE
    text=(root/'src'/PACKAGE/'BlockAccessRules.java').read_text(encoding='utf8')
    baseline=text.replace('if (villages.size() > 16 || editors.size() > 16)', 'if (villages.size() > 8 || editors.size() > 16)').replace('最多16个保留保护区域、16位建设者','最多8个村庄、16位建设者')
    for label,source in [('baseline',baseline),('candidate',text)]:
        src=out/label/'src'/PACKAGE/'BlockAccessRules.java'; src.parent.mkdir(parents=True)
        src.write_text(source,encoding='utf8'); classes=out/label/'classes'; classes.mkdir()
        subprocess.run([str(a.jdk/'bin/javac.exe'),'-encoding','UTF-8','--release','21','-d',str(classes),str(src)],check=True)
        if label=='baseline':
            for f in classes.rglob('*.class'):
                name=f.relative_to(classes).as_posix()[:-6].replace('/','.')
                read=lambda where:subprocess.check_output([str(a.jdk/'bin/javap.exe'),'-p','-c','-classpath',str(where),name])
                assert read(classes)==read(a.base_jar), 'Unreviewed baseline: '+name
    entries={f.relative_to(out/'candidate/classes').as_posix():f.read_bytes() for f in (out/'candidate/classes').rglob('*.class')}
    jar=out/'AgentFriend-0.4.47.17.jar'; unchanged=[]
    with zipfile.ZipFile(a.base_jar) as old,zipfile.ZipFile(jar,'x',zipfile.ZIP_DEFLATED) as new:
        plugin=old.read('plugin.yml'); assert plugin.count(b"version: '0.4.47.16'")==1
        entries['plugin.yml']=plugin.replace(b"version: '0.4.47.16'",b"version: '0.4.47.17'")
        for row in old.infolist():
            if row.filename not in entries: new.writestr(row,old.read(row.filename)); unchanged.append(row.filename)
        for name,body in sorted(entries.items()):
            zi=zipfile.ZipInfo(name,(1980,1,1,0,0,0));zi.compress_type=zipfile.ZIP_DEFLATED;new.writestr(zi,body)
    with zipfile.ZipFile(a.base_jar) as old,zipfile.ZipFile(jar) as new: assert all(old.read(n)==new.read(n) for n in unchanged)
    result=dict(version='0.4.47.17',baselineSha256=BASE,sha256=sha(jar.read_bytes()),baselineBytecodeVerified=True,unchangedEntries=len(unchanged),replacedEntries=sorted(entries))
    (out/'build.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
if __name__=='__main__':main()
