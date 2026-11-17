"""Build the combined wheel, task-card and camp-rescue patch against the pinned current AgentFriend JAR."""
from pathlib import Path
import argparse, hashlib, json, os, re, subprocess, tempfile, zipfile

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--server',type=Path,required=True)
p.add_argument('--jdk',type=Path,required=True)
p.add_argument('--out',type=Path,required=True)
a=p.parse_args();server=a.server.resolve();out=a.out.resolve();root=Path(__file__).resolve().parents[2]
assert not out.is_relative_to(server),'candidate output must be outside the server'
baseline=server/'plugins/AgentFriend-0.4.47.59-shop-rpg.jar'
assert hashlib.sha256(baseline.read_bytes()).hexdigest()=='5f776640e200cef644febd848c0f3c21b031bd52a9cf35a6abbfd7c6957561cc','current baseline changed; re-review'
out.mkdir(parents=True,exist_ok=True)
names=['AdventureMenuModel','PlayerAdventureMenus','SpellWheelLoadout','AgentCommunication','AgentFriendPlugin','BlackBannerCamp','DailyBoardManager','GuildManager','LifeGuildManager','ProtectionAdvisor','RpgCampaign','SiteDungeonManager','TaskMarketManager','TaskRoutes','TravelMarkers']
source=root/'paper/plugins/AgentFriend/src/org/afuhome/agentfriend'
cp=[baseline,*server.glob('libraries/**/*.jar'),*server.glob('plugins/*.jar')]
with tempfile.TemporaryDirectory(dir=out,prefix='compile-')as tmp:
    classes=Path(tmp)/'classes';classes.mkdir()
    options=['--release','21','-encoding','UTF-8','-proc:none','-implicit:none','-cp',os.pathsep.join(map(str,cp)),'-d',str(classes),*[str(source/(name+'.java'))for name in names]]
    args=Path(tmp)/'javac.args';args.write_text('\n'.join('"'+s.replace('\\','/')+'"'for s in options),encoding='utf8')
    subprocess.run([str(a.jdk/'bin/javac.exe'),'@'+str(args)],check=True)
    with zipfile.ZipFile(baseline)as z:entries={n:z.read(n)for n in z.namelist()if not n.endswith('/')}
    prefix='org/afuhome/agentfriend/'
    entries={n:b for n,b in entries.items()if not any(n==prefix+k+'.class'or n.startswith(prefix+k+'$')for k in names)}
    for file in classes.rglob('*.class'):entries[file.relative_to(classes).as_posix()]=file.read_bytes()
    entries['plugin.yml']=re.sub(rb'(?m)^version:.*$',b'version: 0.4.47.89-daily-ui',entries['plugin.yml'])
    target=out/'AgentFriend-0.4.47.89-daily-ui.jar'
    with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED)as z:
        for name,data in sorted(entries.items()):
            info=zipfile.ZipInfo(name,(2026,11,18,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,data)
report={'artifact':str(target),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'version':'0.4.47.89-daily-ui','baseSha256':hashlib.sha256(baseline.read_bytes()).hexdigest(),'updatedClasses':names,'productionChanged':False}
(out/'build.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps(report))
