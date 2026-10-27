"""Narrow .18 -> .19 build; no installation, player migration or full .48 JAR."""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,zipfile

BASE='95ae800b66d7baed75daff7dcc3b166f889350c1213d8bc5f7862ba51841a155'
NAMES={'SiteDungeonManager','TaskMarketManager','DungeonAdvice','AgentCommunication','AgentCliCatalog'}
PKG='org/afuhome/agentfriend/'
sha=lambda b:hashlib.sha256(b).hexdigest()

def main():
 p=argparse.ArgumentParser();p.add_argument('--server',type=Path,required=True);p.add_argument('--base-jar',type=Path,required=True);p.add_argument('--jdk',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 assert sha(a.base_jar.read_bytes())==BASE,'Unreviewed production binary'
 out=a.output.resolve();server=a.server.resolve();assert server!=out and server not in out.parents
 out.mkdir(parents=True,exist_ok=False);classes=out/'classes';classes.mkdir();source=out/'source'/PKG;source.mkdir(parents=True);empty=out/'empty';empty.mkdir()
 root=Path(__file__).resolve().parents[1]
 paths=[];sources={}
 for name in sorted(NAMES):
  origin=root/'src'/PKG/(name+'.java');text=origin.read_text(encoding='utf8');sources[name]=sha(origin.read_bytes())
  # Archives already shipped in .16 and exist in the pinned .18 baseline.
  # The older .3 -> .4 RPG builder's archive exclusion is no longer applicable.
  target=source/(name+'.java');target.write_text(text,encoding='utf8',newline='\n');paths.append(target)
 cp=os.pathsep.join(map(str,[a.base_jar,server/'versions/1.21.1/paper-1.21.1.jar',*sorted(server.glob('libraries/**/*.jar')),*sorted(server.glob('plugins/*.jar'))]))
 test=root/'tests'/PKG/'DungeonAdviceTest.java'
 options=['-proc:none','-implicit:none','--release','21','-encoding','UTF-8','-sourcepath',str(empty),'-cp',cp,'-d',str(classes),*map(str,paths),str(test)]
 argfile=out/'javac.args';argfile.write_text('\n'.join('"'+s.replace('\\','/')+'"'for s in options),encoding='utf8')
 result=subprocess.run([str(a.jdk/'bin/javac.exe'),'-J-Duser.language=en','-J-Dfile.encoding=UTF-8','@'+str(argfile)],capture_output=True)
 (out/'javac.stderr').write_bytes(result.stderr)
 if result.returncode:print(result.stderr.decode('utf8',errors='replace').encode('ascii','backslashreplace').decode());raise SystemExit(result.returncode)
 subprocess.run([str(a.jdk/'bin/java.exe'),'-cp',str(classes)+os.pathsep+cp,'org.afuhome.agentfriend.DungeonAdviceTest'],check=True)
 def owned(n):return n.startswith(PKG)and n.endswith('.class')and n.rsplit('/',1)[-1].split('$')[0].removesuffix('.class')in NAMES
 replacements={f.relative_to(classes).as_posix():f.read_bytes()for f in classes.rglob('*.class')if owned(f.relative_to(classes).as_posix())}
 output=out/'AgentFriend-0.4.47.19.jar';preserved=[]
 with zipfile.ZipFile(a.base_jar)as base,zipfile.ZipFile(output,'x',zipfile.ZIP_DEFLATED)as jar:
  descriptor=base.read('plugin.yml').decode('utf8');assert descriptor.count("version: '0.4.47.18'")==1
  replacements['plugin.yml']=descriptor.replace("version: '0.4.47.18'","version: '0.4.47.19'").encode('utf8')
  for item in base.infolist():
   if owned(item.filename)or item.filename=='plugin.yml':continue
   jar.writestr(item,base.read(item));preserved.append(item.filename)
  for name,data in sorted(replacements.items()):
   entry=zipfile.ZipInfo(name,(1980,1,1,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED;jar.writestr(entry,data)
 with zipfile.ZipFile(a.base_jar)as base,zipfile.ZipFile(output)as jar:
  assert all(base.read(n)==jar.read(n)for n in preserved)
  assert not any(n.endswith('DungeonAdviceTest.class')for n in jar.namelist())
  assert b'archive.list' in jar.read(PKG+'AgentCliCatalog.class'),'published archive discovery must remain'
 report={'version':'0.4.47.19','baseSha256':BASE,'sha256':sha(output.read_bytes()),'changedEntries':sorted(replacements),'unchangedEntries':len(preserved),'sourceSha256':sources,'productionModified':False}
 output.with_suffix('.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8');print(json.dumps(report))
if __name__=='__main__':main()
