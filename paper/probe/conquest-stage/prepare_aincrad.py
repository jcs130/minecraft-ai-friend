"""Prepare real-map QA from a marked isolated baseline, never the live server.
Requires the separately downloaded, hash-pinned free SAO Floor 1 archive.
"""
from pathlib import Path
import hashlib, json, os, secrets, shutil, subprocess, zipfile
import yaml

ROOT=Path(__file__).resolve().parents[3]
SOURCE=Path('E:/MC/staging/adventure-first-20261026')
STAGE=Path('E:/MC/staging/aincrad-conquest-20261027')
ARTIFACTS=Path('E:/MC/ops/repairs/conquest-rpg-20261026')
MAP=Path('E:/MC/downloads/SAOFloorOne.zip')
MAP_SHA='0ddf2c3f8c767d2acdfa3be793293a47fd7cb3d45a34bb997ff9d5861970518f'
JAVA=Path('E:/MC/jdk/jdk-21.0.12.1+1/bin')

def main():
    props=(SOURCE/'server.properties').read_text()
    assert 'server-ip=127.0.0.1' in props and 'motd=QD_PUBLIC_ARCHIVES_TEST_ONLY' in props
    assert not STAGE.exists() and STAGE.resolve().parent==Path('E:/MC/staging').resolve()
    assert hashlib.sha256(MAP.read_bytes()).hexdigest()==MAP_SHA
    STAGE.mkdir()
    for name in ['server.jar','eula.txt','libraries','versions','cache','config','bukkit.yml','spigot.yml']:
        src=SOURCE/name;dst=STAGE/name
        if src.is_dir():shutil.copytree(src,dst)
        elif src.is_file():shutil.copy2(src,dst)
    (STAGE/'plugins').mkdir()
    for jar in (SOURCE/'plugins').glob('*.jar'):
        if not jar.name.startswith('AgentFriend'):shutil.copy2(jar,STAGE/'plugins'/jar.name)
    for name in ['AgentFriend','AuraSkills','MagicSpells','Essentials','Minepacks','WorldGuard','WorldEdit','ProtocolLib']:
        if (SOURCE/'plugins'/name).is_dir():shutil.copytree(SOURCE/'plugins'/name,STAGE/'plugins'/name)
    shutil.copy2(ROOT/'paper/plugins/AgentFriend/AgentFriend-0.4.48.jar',STAGE/'plugins/AgentFriend-0.4.48.jar')
    tab=ARTIFACTS/'TAB-6.2.1-Paper-1.20.5-1.21.4.jar'
    shutil.copy2(tab,STAGE/'plugins/TAB.jar')
    # Only this fixed dependency binary is read from production, never its data/config.
    mythic=Path('E:/MC/server/plugins/MythicMobs-5.9.5.jar')
    if not mythic.exists():raise ValueError('Expected pinned MythicMobs 5.9.5 binary')
    shutil.copy2(mythic,STAGE/'plugins'/mythic.name)
    with zipfile.ZipFile(MAP) as z:
        for e in z.infolist():
            if e.is_dir() or not e.filename.startswith('world/'):continue
            rel=Path(e.filename).relative_to('world')
            if '..' in rel.parts:raise ValueError('unsafe map path')
            if rel.parts[0] not in ('region','data') and str(rel)!='level.dat':continue
            dst=STAGE/'aincrad'/rel;dst.parent.mkdir(parents=True,exist_ok=True);dst.write_bytes(z.read(e))
    overlay=ROOT/'paper/config-candidates/conquest-rpg'; dest=STAGE/'plugins/AgentFriend'
    for name in ['professions.yml','skills.yml','skill-points.yml','onboarding.yml']:
        shutil.copy2(ROOT/'paper/plugins/AgentFriend/resources'/name,dest/name)
    def read(p):return yaml.safe_load(p.read_text(encoding='utf8'))
    def write(p,d):p.parent.mkdir(exist_ok=True,parents=True);p.write_text(yaml.safe_dump(d,allow_unicode=True,sort_keys=False),encoding='utf8')
    config=read(dest/'config.yml');config['combat-rpg']={'enabled':True};config['conquest-world']={'enabled':True};write(dest/'config.yml',config)
    dungeons=read(dest/'dungeons.yml');dungeons['sites'].update(read(overlay/'dungeons-overlay.yml')['sites']);write(dest/'dungeons.yml',dungeons)
    story=read(ROOT/'paper/plugins/AgentFriend/resources/rpg-story.yml');addition=read(overlay/'rpg-story-overlay.yml')
    story.update({k:addition[k] for k in ('revision','title')});story['chapters']={**addition['chapters'],**story['chapters']}
    for npc,topics in addition['npc-topics'].items():story['npcs'][npc]['topics'].update(topics)
    # The QA flat world has no production village. Relocate only this QA guide
    # to safe flat terrain, keeping the same NPC identity and dialogue executor.
    # Flat layers start at -64: 69 layers put the walking surface at Y=5.
    story['npcs']['gufeng'].update({'world':'world','x':12.5,'y':5,'z':10.5})
    write(dest/'rpg-story.yml',story)
    # No baseline world/entities are copied. Keeping its NPC UUID registry would
    # correctly prevent respawning these bodies in our new isolated world.
    write(dest/'rpg-story-npcs.yml',{'npcs':{}})
    for section,file in [('Mobs','qiandengji-aincrad.yml'),('Skills','qiandengji-aincrad-skills.yml')]:
        p=STAGE/'plugins/MythicMobs'/section/file;p.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(overlay/'MythicMobs'/file,p)
    with zipfile.ZipFile(tab) as z:
        candidates=[n for n in z.namelist() if n.endswith('config.yml')]
        config_path=next(n for n in candidates if n=='config/config.yml')
        tab_config=yaml.safe_load(z.read(config_path))
    tab_config.update(read(overlay/'TAB-overlay.yml'));write(STAGE/'plugins/TAB/config.yml',tab_config)
    settings={'server-ip':'127.0.0.1','server-port':'25924','rcon.port':'25925','rcon.password':secrets.token_urlsafe(32),
      'motd':'QD_AINCRAD_CONQUEST_QA_ONLY','online-mode':'false','enforce-secure-profile':'false','enable-rcon':'true',
      'white-list':'false','spawn-protection':'0','view-distance':'3','simulation-distance':'3','allow-nether':'false',
      'enable-command-block':'false','level-name':'world','level-type':'minecraft:flat','generate-structures':'false',
      'generator-settings':json.dumps({'biome':'minecraft:plains','layers':[{'block':'minecraft:bedrock','height':1},{'block':'minecraft:stone','height':67},{'block':'minecraft:grass_block','height':1}]})}
    (STAGE/'server.properties').write_text('\n'.join(k+'='+v for k,v in settings.items())+'\n')
    for n in ['ops.json','usercache.json','whitelist.json']:(STAGE/n).write_text('[]\n')
    bstats=STAGE/'plugins/bStats/config.yml';bstats.parent.mkdir(exist_ok=True);bstats.write_text('enabled: false\n')
    classes=STAGE/'qa-classes';classes.mkdir()
    cp=os.pathsep.join(map(str,[*STAGE.glob('libraries/**/*.jar'),*STAGE.glob('plugins/*.jar')]))
    args=['-proc:none','-encoding','UTF-8','--release','21','-cp',cp,'-d',str(classes),str(Path(__file__).with_name('ConquestFixture.java'))]
    argfile=STAGE/'qa-compile.args';argfile.write_text('\n'.join('"'+s.replace('\\','/')+'"'for s in args),encoding='utf8')
    subprocess.run([str(JAVA/'javac.exe'),'@'+str(argfile)],check=True)
    (classes/'plugin.yml').write_text('name: ConquestFixture\nversion: 1.0\nmain: org.qdqa.ConquestFixture\napi-version: "1.21.1"\ndepend: [AgentFriend, AuraSkills]\ncommands:\n  qdqa: {}\n')
    subprocess.run([str(JAVA/'jar.exe'),'--create','--file',str(STAGE/'plugins/ConquestFixture.jar'),'-C',str(classes),'.'],check=True)
    print('Prepared isolated real-map fixture:',STAGE)

if __name__=='__main__':main()
