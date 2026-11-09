"""Pinned narrow overlays only. Does not install or touch player/world state."""
from pathlib import Path
import argparse, hashlib, json, subprocess, tempfile, zipfile, copy, re
p=argparse.ArgumentParser(description=__doc__)
for name in ('server','jdk','classpath-file','output'):p.add_argument('--'+name,type=Path,required=True)
a=p.parse_args();a.output.mkdir(parents=True,exist_ok=False)
paper=Path(__file__).resolve().parents[1];sha=lambda b:hashlib.sha256(b).hexdigest()
specs=[
 ('AgentFriend-0.4.47.59-shop-rpg.jar','2108acc630ffaf0610d7946cf3fbf2320363c0004118fc812f02e6f5d77a4f06','0.4.47.69-onboarding-viewer-rpg',
  'org/afuhome/agentfriend/',['OnboardingGuide'],paper/'plugins/AgentFriend/src'),
 ('qiandengji-maid-native-0.1.12-conversation.jar','a9925f72c58eb4df1b33942433f26cf5500dc8def2b861ac8b38e847e95aebef','0.1.16-public-dialogue',
  'local/tlmcompat/hybrid/',['HybridMaidPlugin','NativeMaidSocialSupport','NativeMaidSpeech','PublicMaidDialogue'],paper/'integrations/touhou-maids/hybrid-src'),
 ('WorldObserver-0.1.3.jar','521c83c4ef3e7ebc47a333cfe1841b6b223443b9b9c49b587359ac5c856cfb9a','0.1.4-maid-ysm',
  'org/qiandeng/observer/',['MaidObservation'],paper/'integrations/world-observer/src')]
baseline=[a.server/'plugins'/row[0] for row in specs]
cp=';'.join(map(str,[*baseline,a.server/'plugins/voicechat-bukkit-2.6.27.jar',a.server/'mods/qiandengji-maid-brain-0.1.0.jar']))+';'+a.classpath_file.read_text(encoding='utf-8-sig').strip()
proof=[]
for (name,expected,version,prefix,owners,root),base in zip(specs,baseline):
 assert sha(base.read_bytes())==expected,'Changed live baseline: '+name
 def owned(n):return any(n==prefix+c+'.class'or n.startswith(prefix+c+'$')for c in owners)
 sources=[root/prefix/(n+'.java')for n in owners]
 with tempfile.TemporaryDirectory(prefix='viewer-fidelity-',dir=a.output)as temp:
  temp=Path(temp);classes=temp/'classes';args=['--release','21','-encoding','UTF-8','-proc:none','-implicit:none','-cp',cp,'-d',str(classes),*map(str,sources)]
  argfile=temp/'args';argfile.write_text('\n'.join('"'+v.replace('\\','/')+'"'for v in args),encoding='utf-8')
  subprocess.run([str(a.jdk/'bin/javac.exe'),'-J-Duser.language=en','@'+str(argfile)],check=True)
  output=a.output/(Path(name).stem+'-candidate.jar')
  changes={f.relative_to(classes).as_posix():f.read_bytes()for f in classes.rglob('*.class')}
  assert all(owned(n)for n in changes),'Unexpected compiled class'
  with zipfile.ZipFile(base)as before,zipfile.ZipFile(output,'x',zipfile.ZIP_DEFLATED)as after:
   changes['plugin.yml']=re.sub(rb'(?m)^version:.*$',b'version: '+version.encode(),before.read('plugin.yml'))
   if name.startswith('AgentFriend'):
    prior=before.read('onboarding.yml');old='- 千灯纪：破晓攻略MMORPG。先 /mycli intro；职业、技能、任务、副本按步骤查询，旧版职业与技能已归档。'.encode()
    new='- 欢迎来到千灯纪。右键罗盘或点击“打开冒险大厅”，查看角色、技能、委托、副本、商城与个人箱；点击“我的入门路线”查看自己的下一步。'.encode()
    assert prior.count(old)==1,'Changed welcome baseline';changes['onboarding.yml']=prior.replace(old,new)
   for info in before.infolist():
    if owned(info.filename)and info.filename not in changes:continue
    after.writestr(copy.copy(info),changes.get(info.filename,before.read(info.filename)))
   for n,b in changes.items():
    if n not in before.namelist():
     info=zipfile.ZipInfo(n,(2026,11,9,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;after.writestr(info,b)
  with zipfile.ZipFile(base)as before,zipfile.ZipFile(output)as after:
   unchanged=[n for n in before.namelist()if n not in changes and not owned(n)]
   assert all(before.read(n)==after.read(n)for n in unchanged)
   assert set(before.namelist())-set(after.namelist())<=set(n for n in before.namelist()if owned(n))
  proof.append(dict(baseline=str(base),baselineSha256=expected,version=version,candidate=str(output),sha256=sha(output.read_bytes()),
    changedEntries=sorted(changes),unrelatedEntriesPreserved=len(unchanged),sources={f.relative_to(paper).as_posix():sha(f.read_bytes().replace(b'\r\n',b'\n'))for f in sources}))
(a.output/'build.json').write_text(json.dumps({'artifacts':proof,'productionChanged':False},indent=2)+'\n',encoding='utf-8')
print(json.dumps([{'version':r['version'],'sha256':r['sha256'],'unrelatedEntriesPreserved':r['unrelatedEntriesPreserved']}for r in proof]))
