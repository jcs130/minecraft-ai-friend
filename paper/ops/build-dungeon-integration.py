"""Build validated dungeon integration and training rewards over a pinned .63 or .66 JAR."""
from pathlib import Path
import argparse,hashlib,json,subprocess,tempfile,zipfile
p=argparse.ArgumentParser(description=__doc__)
for name in ('server','classpath-file','jdk','output'):p.add_argument('--'+name,type=Path,required=True)
a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
root=Path(__file__).resolve().parents[1]/'plugins';prefix='org/afuhome/agentfriend/';shared='org/afuhome/shared/ActivityBarSemantics'
new='0.4.47.67-training-rewards-rpg'
names=['ActivityBarBudget','ActivityBarLimiter','WorldLifeManager','DungeonEnchantments','DungeonLoot','DungeonManager','ItemAppearances','SiteDungeonManager','DungeonEntrance','TrialRewardPolicy']
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
baseline=a.server/'plugins/AgentFriend-0.4.47.59-shop-rpg.jar'
accepted={'01ac3e3e1cac459e6e08bd9a3013e2f7ba53daa0085904fe9e164b6ccbc68b85':'0.4.47.63-inventory-tidy-rpg','2a09d9ac0720872bf9af6617ebb1f9fa42a48fd463e34eea21c5a016416b4938':'0.4.47.66-dungeon-integration-rpg'}
expected=sha(baseline)
if expected not in accepted:raise RuntimeError('Changed production baseline; review a new overlay')
old=accepted[expected]
include_shared=old=='0.4.47.63-inventory-tidy-rpg'
if not include_shared:names=['DungeonEnchantments','DungeonLoot','DungeonManager','TrialRewardPolicy']
output=a.output/('AgentFriend-'+new+'.jar')
if output.exists() or output.resolve()==baseline.resolve():raise RuntimeError('Use a fresh candidate output')
owner=lambda name:any(name==prefix+n+'.class' or name.startswith(prefix+n+'$') for n in names) or include_shared and (name==shared+'.class' or name.startswith(shared+'$'))
with tempfile.TemporaryDirectory(prefix='dungeon-integration-',dir=a.output) as temp:
    temp=Path(temp);sources=[root/'AgentFriend/src'/prefix/(n+'.java') for n in names]+([root/'shared/src'/(shared+'.java')] if include_shared else [])
    deps=str(baseline)+';'+str(a.server/'plugins/AuraSkills-2.4.0.jar')+';'+a.classpath_file.read_text(encoding='utf-8-sig').strip()
    args=['--release','21','-encoding','UTF-8','-proc:none','-implicit:none','-cp',deps,'-d',str(temp/'classes'),*map(str,sources)]
    argfile=temp/'args';argfile.write_text('\n'.join('"'+v.replace('\\','/')+'"' for v in args),encoding='utf8');subprocess.run([str(a.jdk/'bin/javac.exe'),'-J-Duser.language=en','@'+str(argfile)],check=True)
    with zipfile.ZipFile(baseline) as before,zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as after:
        for entry in before.infolist():
            if owner(entry.filename):continue
            data=before.read(entry.filename)
            if entry.filename=='plugin.yml':
                if data.count(old.encode())!=1:raise RuntimeError('Unexpected plugin metadata')
                data=data.replace(old.encode(),new.encode())
            after.writestr(entry,data)
        for file in sorted((temp/'classes').rglob('*.class')):
            name=file.relative_to(temp/'classes').as_posix()
            if not owner(name):raise RuntimeError('Unexpected compiled class: '+name)
            entry=zipfile.ZipInfo(name,(2026,11,9,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED;after.writestr(entry,file.read_bytes())
    with zipfile.ZipFile(baseline) as before,zipfile.ZipFile(output) as after:
        unchanged=[name for name in before.namelist() if name!='plugin.yml' and not owner(name)]
        if not all(before.read(name)==after.read(name) for name in unchanged):raise RuntimeError('Unrelated archive entry changed')
        if not set(before.namelist())<=set(after.namelist()):raise RuntimeError('Baseline entry lost')
proof=dict(baselineSha256=expected,version=new,sha256=sha(output),file=str(output),unrelatedEntriesPreserved=len(unchanged),compiledOwners=names,sourceSha256={str(path.relative_to(root)):sha(path) for path in sources},productionChanged=False)
(a.output/'build.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({k:v for k,v in proof.items() if k!='sourceSha256'}))
