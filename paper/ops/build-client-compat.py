"""Build the guild-host stall fix over the verified CLI candidate; never install."""
from pathlib import Path
import argparse,copy,hashlib,json,os,subprocess,zipfile
p=argparse.ArgumentParser(description=__doc__)
for name in ['server','base','jdk','output']:p.add_argument('--'+name,type=Path,required=True)
a=p.parse_args();paper=Path(__file__).resolve().parents[1];root=paper/'plugins/AgentFriend'
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
assert sha(a.base)=='89259dc819a3da7e4a79ab5aec5bf5b2453753988bd9aa30343312a352d9f461'
out=a.output.resolve();assert not out.exists() and not out.is_relative_to(a.server.resolve());out.mkdir(parents=True)
classes=out/'classes';classes.mkdir();empty=out/'empty';empty.mkdir()
sources=[root/f'src/org/afuhome/agentfriend/{name}.java' for name in ['GuildHostTrades','LifeGuildBuildings']]
test=root/'tests/org/afuhome/agentfriend/GuildHostTradesTest.java'
patch=paper/'ops/patches/CompassMethodPatch.java'
fixture=paper/'ops/fixtures/ClientCompatFixture.java'
cp=os.pathsep.join(map(str,[a.base,*a.server.glob('libraries/**/*.jar'),*a.server.glob('plugins/*.jar')]))
args=['-proc:none','-implicit:none','-encoding','UTF-8','--release','21','-sourcepath',str(empty),'-cp',cp,'-d',str(classes),*map(str,[*sources,test,patch,fixture])]
argfile=out/'compile.args';argfile.write_text('\n'.join('"'+v.replace('\\','/')+'"'for v in args),encoding='utf-8')
def run(values,log):
    with(out/log).open('wb')as f:r=subprocess.run(values,stdout=f,stderr=subprocess.STDOUT,timeout=120)
    if r.returncode:raise SystemExit('Failed; inspect '+log)
run([str(a.jdk/'bin/javac.exe'),'@'+str(argfile)],'compile.log')
with zipfile.ZipFile(a.base)as z:
    name='org/afuhome/agentfriend/LifeGuildBuildings.class'
    before=out/'LifeGuildBuildings.before.class';before.write_bytes(z.read(name))
    patched=out/'LifeGuildBuildings.patched.class'
    run([str(a.jdk/'bin/java.exe'),'-cp',str(classes)+os.pathsep+cp,'CompassMethodPatch',str(before),str(classes/name),str(patched),'ensureHost'],'method-patch.log')
    updates={name:patched.read_bytes(),'org/afuhome/agentfriend/GuildHostTrades.class':(classes/'org/afuhome/agentfriend/GuildHostTrades.class').read_bytes()}
    descriptor=z.read('plugin.yml');assert descriptor.count(b'0.4.47.47-rpg')==1
    updates['plugin.yml']=descriptor.replace(b'0.4.47.47-rpg',b'0.4.47.48-rpg')
    target=out/'AgentFriend-0.4.47.48-rpg.jar'
    with zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED)as to:
        for item in z.infolist():to.writestr(copy.copy(item),updates.get(item.filename,z.read(item)))
        for n in sorted(set(updates)-set(z.namelist())):
            info=zipfile.ZipInfo(n,date_time=(1980,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;to.writestr(info,updates[n])
with zipfile.ZipFile(out/'ClientCompatFixture.jar','x',zipfile.ZIP_DEFLATED)as z:
    z.writestr('plugin.yml',"name: ClientCompatFixture\nversion: '1'\nmain: ClientCompatFixture\napi-version: '1.21.1'\ndepend: [AgentFriend]\ncommands:\n  compatqa:\n    permission: clientcompat.qa\npermissions:\n  clientcompat.qa:\n    default: op\n")
    for item in [classes/'ClientCompatFixture.class',classes/'org/afuhome/agentfriend/GuildHostTradesTest.class',classes/'org/afuhome/agentfriend/GuildHostTradesTest$Host.class']:
        z.writestr(item.relative_to(classes).as_posix(),item.read_bytes())
with zipfile.ZipFile(a.base)as before,zipfile.ZipFile(target)as after:
    changed=[n for n in before.namelist()if before.read(n)!=after.read(n)]
    added=sorted(set(after.namelist())-set(before.namelist()))
    assert not set(before.namelist())-set(after.namelist()) and set(changed+added)==set(updates)
receipt={'artifact':target.name,'sha256':sha(target),'baselineSha256':sha(a.base),'sources':{str(f.relative_to(paper)):sha(f)for f in [*sources,test,patch,fixture]},'changedEntries':changed,'addedEntries':added,'otherEntriesPreserved':len(before.namelist())-len(changed),'methodPatch':json.loads((out/'method-patch.log').read_text()),'testExecution':'compiled fixture requires a running registry-backed Bukkit server; not yet executed','productionChanged':False}
(out/'build.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8');print(json.dumps(receipt))
