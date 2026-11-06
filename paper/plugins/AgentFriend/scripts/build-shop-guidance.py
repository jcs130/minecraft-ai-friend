"""Candidate only. Compile the shop/help classes over the pinned production JAR; preserve unrelated fixes."""
from pathlib import Path
import argparse, hashlib, json, os, subprocess, zipfile

PIN = '3dc4845b8ddcd26a3237e32ee391293021fd6c072078968ef6640bd8cadbf4d9'
PREFIX = 'org/afuhome/agentfriend/'
NAMES = ['ArenaEconomy', 'EconomyPresentation', 'NativeRpg', 'PlayerMarket', 'GameplayGuide', 'InventoryFeedback', 'AgentCliCatalog', 'AgentCliRecovery', 'ActionFeedback']

def main():
    p = argparse.ArgumentParser(description=__doc__)
    for k in ['base','server','jdk','output']: p.add_argument('--'+k,type=Path,required=True)
    a=p.parse_args();assert hashlib.sha256(a.base.read_bytes()).hexdigest()==PIN,'Unreviewed baseline'
    assert not a.output.exists() and a.server.resolve() not in a.output.resolve().parents
    root=Path(__file__).resolve().parents[1];build=a.output.with_suffix('.build');build.mkdir(parents=True,exist_ok=False)
    classes=build/'classes';classes.mkdir();empty=build/'empty';empty.mkdir()
    jars=[a.base,*sorted((a.server/'libraries').rglob('*.jar')),*sorted((a.server/'versions').rglob('*.jar')),*sorted((a.server/'plugins').glob('*.jar'))]
    cp=os.pathsep.join(map(str,jars));(build/'classpath.txt').write_text(cp,encoding='utf-8')
    sources=[root/'src'/PREFIX/(n+'.java') for n in NAMES]
    argfile=build/'javac.args';args=['-proc:none','-implicit:none','--release','21','-encoding','UTF-8','-sourcepath',str(empty),'-cp',cp,'-d',str(classes),*map(str,sources)]
    argfile.write_text('\n'.join('"'+v.replace('\\','/')+'"'for v in args),encoding='utf-8')
    subprocess.run([str(a.jdk/'bin/javac.exe'),'-J-Xmx768m','-J-Dfile.encoding=UTF-8','-J-Duser.language=en','@'+str(argfile)],check=True)
    source=Path(__file__).with_name('PatchShopCompass.java')
    subprocess.run([str(a.jdk/'bin/javac.exe'),'-encoding','UTF-8','-proc:none','-cp',cp,'-d',str(classes),str(source)],check=True)
    with zipfile.ZipFile(a.base) as old:(build/'before.class').write_bytes(old.read(PREFIX+'AgentFriendPlugin.class'))
    subprocess.run([str(a.jdk/'bin/java.exe'),'-cp',str(classes)+os.pathsep+cp,'PatchShopCompass',str(build/'before.class'),str(build/'after.class')],check=True)
    compiled={f.relative_to(classes).as_posix():f.read_bytes() for f in (classes/'org').rglob('*.class')}
    def owns(n):return any(n==PREFIX+x+'.class' or n.startswith(PREFIX+x+'$') for x in NAMES)
    assert all(owns(n)for n in compiled)
    retained=0
    with zipfile.ZipFile(a.base)as old,zipfile.ZipFile(a.output,'x',zipfile.ZIP_DEFLATED)as out:
        assert len(old.namelist())==len(set(old.namelist()))
        for info in old.infolist():
            if owns(info.filename):continue
            data=old.read(info)
            if info.filename==PREFIX+'AgentFriendPlugin.class':data=(build/'after.class').read_bytes()
            elif info.filename=='plugin.yml':
                assert data.count(b'0.4.47.58-photo-recovery1-rpg')==1
                data=data.replace(b'0.4.47.58-photo-recovery1-rpg',b'0.4.47.59-shop-rpg')
            else:retained+=1
            out.writestr(info,data)
        for name,data in compiled.items():out.writestr(name,data)
    with zipfile.ZipFile(a.base)as old,zipfile.ZipFile(a.output)as new:
        for name in old.namelist():
            if not owns(name)and name not in [PREFIX+'AgentFriendPlugin.class','plugin.yml']:assert old.read(name)==new.read(name),name
    proof={'baseSha256':PIN,'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest(),'retainedEntries':retained,'changedClasses':sorted(compiled),'mainClassHooks':['fillCompass','compassClick','onMenuClick separator guard','onTabComplete'],'productionChanged':False}
    a.output.with_suffix('.json').write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8');print(json.dumps(proof))
if __name__=='__main__':main()
