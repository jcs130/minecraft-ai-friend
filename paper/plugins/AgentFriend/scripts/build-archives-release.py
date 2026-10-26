"""Isolated minimal archive/stash backport over verified production .12; never deploys."""
import argparse,hashlib,json,os,subprocess,zipfile,importlib.util,re
from pathlib import Path
BASE='d024b51f2f623c16d2b71b02e2e7aa979928bd16d10f9879b35442a7e0ab1f72'
VERSION='0.4.47.15'
PACKAGE='org/afuhome/agentfriend/'
sha=lambda b:hashlib.sha256(b).hexdigest()
def main():
 p=argparse.ArgumentParser(description=__doc__)
 for name in ('server','base-jar','jdk','output'):p.add_argument('--'+name,required=True,type=Path)
 a=p.parse_args();root=Path(__file__).resolve().parents[1];out=a.output.resolve();server=a.server.resolve()
 assert sha(a.base_jar.read_bytes())==BASE and not out.exists() and server!=out and server not in out.parents
 out.mkdir(parents=True);(out/'empty').mkdir()
 spec=importlib.util.spec_from_file_location('stash',root/'scripts/build-stash-menu-release.py');stash=importlib.util.module_from_spec(spec);spec.loader.exec_module(stash)
 def source(commit,name):return subprocess.check_output(['git','show',commit+':paper/plugins/AgentFriend/src/'+PACKAGE+name+'.java'],cwd=root.parents[2]).decode('utf8')
 baselines={'AgentFriendPlugin':stash.released_main(source(stash.SOURCE,'AgentFriendPlugin')),'LifeGuildManager':source('c90a5559^','LifeGuildManager'),'AgentCliCatalog':source('cf9dc88359d29cd0af0f2580784e87dbee2c91bb','AgentCliCatalog')}
 catalogue=baselines['AgentCliCatalog'];held=[line for line in catalogue.splitlines(True) if line.lstrip().startswith('add(specs,"archive')];assert len(held)==9
 baselines['AgentCliCatalog']=''.join(line for line in catalogue.splitlines(True) if line not in held)
 with zipfile.ZipFile(a.base_jar) as z:constants=stash.utf8_constants(z.read(PACKAGE+'AgentFriendPlugin.class'))
 for prefix in ('拍照：技能罗盘','点击选择第一人称'):
  old=[s for s in constants if s.startswith(prefix)];new=re.findall('"('+prefix+'[^"\n]+)"',baselines['AgentFriendPlugin']);assert len(old)==len(new)==1
  baselines['AgentFriendPlugin']=baselines['AgentFriendPlugin'].replace(new[0],old[0])
 candidates={name:(root/'src'/PACKAGE/(name+'.java')).read_text(encoding='utf8') for name in ('AgentFriendPlugin','LifeGuildManager','PublicArchives','ArchiveStore')}
 candidates['AgentCliCatalog']=catalogue
 cp=os.pathsep.join(map(str,[a.base_jar,server/'versions/1.21.1/paper-1.21.1.jar',*sorted((server/'libraries').rglob('*.jar')),*sorted((server/'plugins').glob('*.jar'))]))
 for label,sources in [('baseline',baselines),('candidate',candidates)]:
  src=out/label/'source'/PACKAGE;src.mkdir(parents=True);classes=out/label/'classes';classes.mkdir(parents=True);files=[]
  for name,text in sources.items():
   f=src/(name+'.java');f.write_text(text,encoding='utf8',newline='\n');files.append(f)
  args=['-proc:none','-encoding','UTF-8','--release','21','-sourcepath',str(out/'empty'),'-cp',cp,'-d',str(classes),*map(str,files)]
  argfile=out/(label+'.args');argfile.write_text('\n'.join('"'+s.replace('\\','/')+'"' for s in args),encoding='utf8')
  subprocess.run([str(a.jdk/'bin/javac.exe'),'@'+str(argfile)],check=True)
  if label=='baseline':
   for f in classes.rglob('*.class'):
    name=f.relative_to(classes).as_posix().removesuffix('.class').replace('/','.')
    read=lambda where:subprocess.check_output([str(a.jdk/'bin/javap.exe'),'-p','-c','-classpath',str(where),name])
    assert read(classes)==read(a.base_jar),'Production baseline bytecode differs: '+name
 driver=server/'libraries/org/xerial/sqlite-jdbc/3.46.0.0/sqlite-jdbc-3.46.0.0.jar'
 assert sha(driver.read_bytes())=='e697df15be3f95219d80773c5f1002030e33e932adda186c1c86fd51df6691a9'
 classes=out/'candidate/classes';entries={f.relative_to(classes).as_posix():f.read_bytes() for f in classes.rglob('*.class')}
 entries['public-archives.yml']=(root/'resources/public-archives.yml').read_bytes()
 with zipfile.ZipFile(driver) as z:
  for name in z.namelist():
   if not name.endswith('/') and (name.startswith(('org/sqlite/','META-INF/maven/org.xerial/sqlite-jdbc/','META-INF/LICENSE','META-INF/NOTICE')) or name=='META-INF/services/java.sql.Driver'):entries[name]=z.read(name)
 jar=out/('AgentFriend-'+VERSION+'.jar');unchanged=[]
 with zipfile.ZipFile(a.base_jar) as old,zipfile.ZipFile(jar,'x',zipfile.ZIP_DEFLATED) as new:
  descriptor=old.read('plugin.yml').decode();assert descriptor.count("version: '0.4.47.12'")==1
  entries['plugin.yml']=descriptor.replace("version: '0.4.47.12'","version: '"+VERSION+"'").encode()
  for row in old.infolist():
   if row.filename not in entries:new.writestr(row,old.read(row.filename));unchanged.append(row.filename)
  for name,body in sorted(entries.items()):
   zi=zipfile.ZipInfo(name,(1980,1,1,0,0,0));zi.compress_type=zipfile.ZIP_DEFLATED;new.writestr(zi,body)
 with zipfile.ZipFile(a.base_jar) as old,zipfile.ZipFile(jar) as new:
  assert all(old.read(n)==new.read(n) for n in unchanged)
 report=dict(version=VERSION,sha256=sha(jar.read_bytes()),baselineSha256=BASE,baselineBytecodeVerified=True,unchangedEntries=len(unchanged),replacedEntries=sorted(n for n in entries if not n.startswith(('org/sqlite/','META-INF/'))),driverSha256=sha(driver.read_bytes()),productionChanged=False)
 (out/'build.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps(report))
if __name__=='__main__':main()
