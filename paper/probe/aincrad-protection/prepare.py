"""Build a loopback-only protection canary from the existing disposable map QA."""
from pathlib import Path
import secrets,shutil,json,subprocess,zipfile,uuid
import yaml
ROOT=Path(__file__).resolve().parents[3]
STAGE=Path('E:/MC/staging/aincrad-protection-20261027')
SOURCE=Path('E:/MC/staging/aincrad-conquest-20261027')
PROD=Path('E:/MC/server')
REPAIR=Path('E:/MC/ops/repairs/aincrad-protection-20261027')
JAVA=Path('E:/MC/jdk/jdk-21.0.12.1+1/bin')
def main():
    assert not STAGE.exists() and 'motd=QD_AINCRAD_CONQUEST_QA_ONLY' in (SOURCE/'server.properties').read_text()
    STAGE.mkdir()
    for name in ['server.jar','eula.txt','libraries','versions','cache','config','bukkit.yml','spigot.yml','world','aincrad']:
        src=SOURCE/name;dst=STAGE/name
        if src.is_dir():shutil.copytree(src,dst)
        elif src.is_file():shutil.copy2(src,dst)
    (STAGE/'plugins').mkdir()
    for name in ['AgentFriend','AuraSkills','MagicSpells','Essentials','Minepacks','WorldGuard','WorldEdit','ProtocolLib']:
        if (SOURCE/'plugins'/name).is_dir():shutil.copytree(SOURCE/'plugins'/name,STAGE/'plugins'/name)
    for jar in (SOURCE/'plugins').glob('*.jar'):
        if not jar.name.startswith(('AgentFriend','ConquestFixture','TAB','worldedit')):shutil.copy2(jar,STAGE/'plugins'/jar.name)
    for name in ['Denizen-1.3.1-b7074-paper1211.jar','FastAsyncWorldEdit-2.16.1.jar']:
        shutil.copy2(PROD/'plugins'/name,STAGE/'plugins'/name)
    shutil.copy2(REPAIR/'build/AgentFriend-0.4.47.17.jar',STAGE/'plugins/AgentFriend-0.4.47.17.jar')
    for name in ['professions.yml','skills.yml','skill-unlocks.yml','skill-points.yml']:
        shutil.copy2(PROD/'plugins/AgentFriend'/name,STAGE/'plugins/AgentFriend'/name)
    ledger=STAGE/'plugins/AgentFriend/profession-ledger.json'
    if ledger.exists():ledger.rename(ledger.with_suffix('.candidate-fixture.json'))
    def read(p):return yaml.safe_load(p.read_text(encoding='utf8'))
    def write(p,d):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(yaml.safe_dump(d,allow_unicode=True,sort_keys=False),encoding='utf8')
    # Production UUID editor list is configuration, never copy player inventories or auth data.
    policy=read(PROD/'plugins/AgentFriend/block-access.yml')
    policy['villages'].append(dict(world='aincrad',**{'min-x':-29999984,'min-z':-29999984,'max-x':29999984,'max-z':29999984}))
    write(STAGE/'plugins/AgentFriend/block-access.yml',policy)
    for name in ('regions.yml','config.yml'):
        target=STAGE/'plugins/WorldGuard/worlds/aincrad'/name;target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(ROOT/'paper/config-candidates/aincrad-protection'/name,target)
    ds=STAGE/'plugins/Denizen/scripts';ds.mkdir(parents=True)
    shutil.copy2(ROOT/'paper/config-candidates/aincrad-protection/qd_aincrad.dsc',ds/'qd_aincrad.dsc')
    # The isolated flat world's origin has a safe Y=5 platform; the actual map entry is unchanged.
    warp=read(PROD/'plugins/Essentials/warps/aincrad.yml');warp['world']=str(uuid.UUID(bytes=(STAGE/'aincrad/uid.dat').read_bytes()))
    write(STAGE/'plugins/Essentials/warps/aincrad.yml',warp)
    write(STAGE/'plugins/Essentials/warps/village.yml',{'world':str(uuid.UUID(bytes=(STAGE/'world/uid.dat').read_bytes())),'world-name':'world','x':10.5,'y':5.0,'z':10.5,'yaw':0,'pitch':0,'name':'village'})
    config=read(STAGE/'plugins/Essentials/config.yml');config['use-bukkit-permissions']=False;write(STAGE/'plugins/Essentials/config.yml',config)
    props=(SOURCE/'server.properties').read_text()
    for key,val in {'server-port':'25928','rcon.port':'25929','rcon.password':secrets.token_urlsafe(32),'motd':'QD_AINCRAD_PROTECTION_QA_ONLY'}.items():
        import re
        props=re.sub(r'^'+re.escape(key)+r'=.*$',key+'='+val,props,flags=re.M)
    (STAGE/'server.properties').write_text(props,encoding='utf8')
    classes=REPAIR/'fixture-classes';classes.mkdir()
    cp=';'.join(map(str,[STAGE/'versions/1.21.1/paper-1.21.1.jar',*sorted((STAGE/'libraries').rglob('*.jar')),*sorted((STAGE/'plugins').glob('*.jar'))]))
    args=['-proc:none','-encoding','UTF-8','--release','21','-cp',cp,'-d',str(classes),str(ROOT/'paper/probe/aincrad-protection/MapFixture.java')]
    argfile=REPAIR/'fixture.args';argfile.write_text('\n'.join('"'+s.replace('\\','/')+'"' for s in args),encoding='utf8')
    subprocess.run([str(JAVA/'javac.exe'),'@'+str(argfile)],check=True)
    with zipfile.ZipFile(STAGE/'plugins/MapFixture.jar','x') as z:
        for f in classes.rglob('*.class'):z.write(f,f.relative_to(classes).as_posix())
        z.writestr('plugin.yml','name: MapFixture\nversion: 1\nmain: org.qdqa.MapFixture\napi-version: 1.21\ndepend: [AgentFriend, WorldGuard, AuraSkills, Denizen]\ncommands:\n  qdmap: {}\n')
    print(json.dumps({'stage':str(STAGE),'ports':[25928,25929],'productionModified':False}))
if __name__=='__main__':main()
