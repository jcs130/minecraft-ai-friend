"""Narrow candidate build against the deployed AF.48; never install or alter player data."""
from pathlib import Path
import argparse,copy,hashlib,json,os,subprocess,zipfile
p=argparse.ArgumentParser(description=__doc__)
for name in ('server','jdk','output'):p.add_argument('--'+name,type=Path,required=True)
a=p.parse_args();paper=Path(__file__).resolve().parents[1];root=paper/'plugins/AgentFriend'
base=a.server/'plugins/AgentFriend-0.4.47.48-rpg.jar';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(base)=='5831959e6b75b23a1c77363886868feadabe82b21dbbd5c1519d2d090c888bcd'
out=a.output.resolve();assert not out.exists() and not out.is_relative_to(a.server.resolve());out.mkdir(parents=True)
classes=out/'classes';classes.mkdir();empty=out/'empty';empty.mkdir()
names=['AgentCliRecovery','AgentCliRecoveryService','AgentFriendPlugin','NativeRpg','DungeonManager','GuildHallManager','LifeGuildBuildings','RpgStoryNpcs','NpcEntityReadiness']
sources=[root/f'src/org/afuhome/agentfriend/{name}.java' for name in names]
# main also contains an unrelated, not-yet-deployed public-facility change.
# Keep the deployed storage guidance in this candidate; do not widen its scope.
hall=next(f for f in sources if f.name=='GuildHallManager.java')
original_hall=hall.read_text(encoding='utf-8')
start=original_hall.index('        if (plugin.lands().publicFacility(LandManager.GUILD))')
end=original_hall.index('        player.sendMessage("§6公会东南侧',start)
block=original_hall[start:end]
assert block.count('else player.sendMessage(')==1
compatible_hall=original_hall[:start]+'        '+block.split('else ',1)[1]+original_hall[end:]
compiled_hall=out/'GuildHallManager.java';compiled_hall.write_text(compatible_hall,encoding='utf-8')
sources=[compiled_hall if f==hall else f for f in sources]
tests=['AgentCliRecoveryTest','AgentCliContractTest','AgentCliTextTest','NativeCliCatalogTest','ProtectionGuidanceTest']
test_sources=[root/f'tests/org/afuhome/agentfriend/{name}.java' for name in tests]
dependencies=[base,*a.server.glob('libraries/**/*.jar'),*a.server.glob('plugins/*.jar')];cp=os.pathsep.join(map(str,dependencies))
values=['-proc:none','-implicit:none','-encoding','UTF-8','--release','21','-sourcepath',str(empty),'-cp',cp,'-d',str(classes),*map(str,sources+test_sources)]
argfile=out/'compile.args';argfile.write_text('\n'.join('"'+x.replace('\\','/')+'"' for x in values),encoding='utf-8')
with(out/'compile.log').open('wb') as log:r=subprocess.run([str(a.jdk/'bin/javac.exe'),'@'+str(argfile)],stdout=log,stderr=subprocess.STDOUT)
if r.returncode:raise SystemExit('Compilation failed; inspect compile.log')
for name in tests:
    with(out/(name+'.log')).open('wb') as log:r=subprocess.run([str(a.jdk/'bin/java.exe'),'-ea','-cp',str(classes)+os.pathsep+cp,'org.afuhome.agentfriend.'+name,str(root/'resources')],stdout=log,stderr=subprocess.STDOUT,timeout=120)
    if r.returncode:raise SystemExit('Test failed; inspect '+name+'.log')
def owned(name):return name.startswith('org/afuhome/agentfriend/') and name.endswith('.class') and name.rsplit('/',1)[-1].split('$')[0].removesuffix('.class') in names
updates={f.relative_to(classes).as_posix():f.read_bytes() for f in classes.rglob('*.class') if owned(f.relative_to(classes).as_posix())}
target=out/'AgentFriend-0.4.47.49-rpg.jar'
with zipfile.ZipFile(base) as before:
    descriptor=before.read('plugin.yml');assert descriptor.count(b'0.4.47.48-rpg')==1
    updates['plugin.yml']=descriptor.replace(b'0.4.47.48-rpg',b'0.4.47.49-rpg')
    assert {n for n in before.namelist() if owned(n)}<=set(updates)
    with zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED) as after:
        for item in before.infolist():after.writestr(copy.copy(item),updates.get(item.filename,before.read(item.filename)))
        for name in sorted(set(updates)-set(before.namelist())):after.writestr(name,updates[name])
with zipfile.ZipFile(base) as before,zipfile.ZipFile(target) as after:
    changed=[n for n in before.namelist() if before.read(n)!=after.read(n)];added=sorted(set(after.namelist())-set(before.namelist()))
    assert not set(before.namelist())-set(after.namelist()) and set(changed+added)<=set(updates)
receipt={'artifact':target.name,'sha256':sha(target),'baselineSha256':sha(base),'sources':{str(f.relative_to(paper)) if f.is_relative_to(paper) else f.name:sha(f) for f in sources},'guildStoragePolicy':'deployed private-storage guidance retained; public-facility candidate excluded','changedEntries':changed,'addedEntries':added,'otherEntriesPreserved':len(zipfile.ZipFile(base).namelist())-len(changed),'productionChanged':False,'tests':tests}
(out/'build.json').write_text(json.dumps(receipt,indent=2));print(json.dumps({'artifact':target.name,'sha256':sha(target),'tests':tests}))
