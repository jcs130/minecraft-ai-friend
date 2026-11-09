"""Build player UI plus accepted training rewards over the pinned live .66 JAR."""
from pathlib import Path
import argparse,hashlib,json,subprocess,tempfile,zipfile
p=argparse.ArgumentParser(description=__doc__)
for name in ('server','classpath-file','jdk','output'):p.add_argument('--'+name,type=Path,required=True)
a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
root=Path(__file__).resolve().parents[1]/'plugins/AgentFriend'
prefix='org/afuhome/agentfriend/'
version='0.4.47.68-player-ui-rpg'
names=['AgentFriendPlugin','NativeRpg','AdventureMenuModel','PlayerAdventureMenus','BedrockMenuForms',
       'DungeonEnchantments','DungeonLoot','DungeonManager','TrialRewardPolicy']
sha=lambda file:hashlib.sha256(file.read_bytes()).hexdigest()
baseline=a.server/'plugins/AgentFriend-0.4.47.59-shop-rpg.jar'
expected='2a09d9ac0720872bf9af6617ebb1f9fa42a48fd463e34eea21c5a016416b4938'
if sha(baseline)!=expected:raise RuntimeError('Changed live baseline; review a new overlay')
output=a.output/('AgentFriend-'+version+'.jar')
if output.exists():raise RuntimeError('Use a fresh build output')
def owned(name):return any(name==prefix+n+'.class' or name.startswith(prefix+n+'$') for n in names)
sources=[root/'src'/prefix/(name+'.java') for name in names]
with tempfile.TemporaryDirectory(prefix='player-ui-',dir=a.output) as temp:
    temp=Path(temp)
    deps=str(baseline)+';'+str(a.server/'plugins/AuraSkills-2.4.0.jar')+';'+a.classpath_file.read_text(encoding='utf-8-sig').strip()
    args=['--release','21','-encoding','UTF-8','-proc:none','-implicit:none','-cp',deps,'-d',str(temp/'classes'),*map(str,sources)]
    argfile=temp/'args';argfile.write_text('\n'.join('"'+v.replace('\\','/')+'"' for v in args),encoding='utf8')
    subprocess.run([str(a.jdk/'bin/javac.exe'),'-J-Duser.language=en','@'+str(argfile)],check=True)
    with zipfile.ZipFile(baseline) as before,zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as after:
        for entry in before.infolist():
            if owned(entry.filename):continue
            data=before.read(entry.filename)
            if entry.filename=='plugin.yml':
                if data.count(b'0.4.47.66-dungeon-integration-rpg')!=1:raise RuntimeError('Unexpected metadata')
                data=data.replace(b'0.4.47.66-dungeon-integration-rpg',version.encode())
                lines=[line for line in data.splitlines() if line.startswith(b'softdepend: [') and line.endswith(b']')]
                if len(lines)!=1 or b'floodgate' in lines[0]:raise RuntimeError('Review optional dependency list')
                data=data.replace(lines[0],lines[0][:-1]+b', floodgate]')
            after.writestr(entry,data)
        for file in sorted((temp/'classes').rglob('*.class')):
            name=file.relative_to(temp/'classes').as_posix()
            if not owned(name):raise RuntimeError('Unexpected compiled owner: '+name)
            entry=zipfile.ZipInfo(name,(2026,11,9,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED
            after.writestr(entry,file.read_bytes())
    with zipfile.ZipFile(baseline) as before,zipfile.ZipFile(output) as after:
        unchanged=[name for name in before.namelist() if name!='plugin.yml' and not owned(name)]
        if not all(before.read(name)==after.read(name) for name in unchanged):raise RuntimeError('Unrelated archive entry changed')
        if not set(before.namelist())<=set(after.namelist()):raise RuntimeError('Baseline entry lost')
proof=dict(version=version,sha256=sha(output),file=str(output),baselineSha256=expected,
           compiledOwners=names,unrelatedEntriesPreserved=len(unchanged),
           sourceHashEncoding='git-text-lf',
           sourceSha256={file.relative_to(root).as_posix():hashlib.sha256(file.read_bytes().replace(b'\r\n',b'\n')).hexdigest() for file in sources},productionChanged=False)
(a.output/'build.json').write_text(json.dumps(proof,indent=2)+'\n',encoding='utf8')
print(json.dumps({k:v for k,v in proof.items() if k!='sourceSha256'}))
