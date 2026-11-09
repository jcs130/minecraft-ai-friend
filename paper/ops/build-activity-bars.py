"""Pinned narrow overlays; never installs into a running server."""
from pathlib import Path
import argparse,hashlib,json,subprocess,tempfile,zipfile
p=argparse.ArgumentParser()
for name in ('server','classpath-file','jdk','output'):p.add_argument('--'+name,type=Path,required=True)
a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True);root=Path(__file__).resolve().parents[1]/'plugins';shared='org/afuhome/shared/ActivityBarSemantics'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
specs=[('AgentFriend-0.4.47.59-shop-rpg.jar','01ac3e3e1cac459e6e08bd9a3013e2f7ba53daa0085904fe9e164b6ccbc68b85','0.4.47.63-inventory-tidy-rpg','0.4.47.65-activity-bars-rpg','AgentFriend','org/afuhome/agentfriend/',['ActivityBarBudget','ActivityBarLimiter','WorldLifeManager']),('CortiEyeMirror-0.1.19.jar','c74e4ba58674d948ca079b4348941ab01b6f11f18507f38f568cc418a5265e6d','0.1.19','0.1.20','CortiEyeMirror','org/afuhome/cortieye/',['EyeBossBars'])]
proof=[]
for file,digest,old,new,module,prefix,names in specs:
    baseline=a.server/'plugins'/file;assert sha(baseline)==digest,'Changed production baseline'
    output=a.output/(module+'-'+new+'.jar');assert output.resolve()!=baseline.resolve()
    owner=lambda n:any(n==prefix+c+'.class' or n.startswith(prefix+c+'$') for c in names) or n==shared+'.class' or n.startswith(shared+'$')
    with tempfile.TemporaryDirectory(prefix='activity-build-',dir=a.output) as temp:
        temp=Path(temp);sources=[root/module/'src'/prefix/(n+'.java') for n in names]+[root/'shared/src'/(shared+'.java')]
        args=['--release','21','-encoding','UTF-8','-proc:none','-implicit:none','-cp',str(baseline)+';'+a.classpath_file.read_text(encoding='utf-8-sig').strip(),'-d',str(temp/'classes'),*map(str,sources)]
        argfile=temp/'compile.args';argfile.write_text('\n'.join('"'+v.replace('\\','/')+'"' for v in args),encoding='utf8')
        subprocess.run([str(a.jdk/'bin/javac.exe'),'-J-Duser.language=en','@'+str(argfile)],check=True)
        with zipfile.ZipFile(baseline) as before,zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as after:
            for e in before.infolist():
                if owner(e.filename):continue
                data=before.read(e.filename)
                if e.filename=='plugin.yml':assert data.count(old.encode())==1;data=data.replace(old.encode(),new.encode())
                after.writestr(e,data)
            for f in sorted((temp/'classes').rglob('*.class')):
                name=f.relative_to(temp/'classes').as_posix();assert owner(name),name
                e=zipfile.ZipInfo(name,(2026,11,9,0,0,0));e.compress_type=zipfile.ZIP_DEFLATED;after.writestr(e,f.read_bytes())
        with zipfile.ZipFile(baseline) as before,zipfile.ZipFile(output) as after:
            untouched=[n for n in before.namelist() if n!='plugin.yml' and not owner(n)];assert all(before.read(n)==after.read(n) for n in untouched)
            assert all(n in after.namelist() for n in before.namelist())
        proof.append({'file':str(output),'baselineSha256':digest,'sha256':sha(output),'version':new,'unrelatedEntriesPreserved':len(untouched)})
(a.output/'build.json').write_text(json.dumps(proof,indent=2));print(json.dumps(proof))
