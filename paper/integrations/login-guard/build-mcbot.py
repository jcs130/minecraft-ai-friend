"""Patch only mcbot transport into the pinned, deployed LoginGuard 0.1.5.

The general 0.1.6 source contains a separate, unreleased account bridge candidate.
Do not publish that candidate as a side effect of game-client compatibility.
"""
from pathlib import Path
import argparse,hashlib,json,subprocess,zipfile

ROOT=Path(__file__).resolve().parent
BASE='5f7311d2b1ae22b10311302c12c31d9e1123314debaf975033d8384e61eb5852'
REV='d5c70bd5e3412f10ed36278b6cee8080d29b0ee7'
p=argparse.ArgumentParser(description=__doc__)
for name in ['base','proxy','jdk','libre','output']:p.add_argument('--'+name,type=Path,required=True)
a=p.parse_args();out=a.output.resolve();assert not out.exists(),'Use a new output directory'
assert hashlib.sha256(a.base.read_bytes()).hexdigest()==BASE,'Unreviewed deployed LoginGuard'
assert hashlib.sha256((a.proxy/'velocity.jar').read_bytes()).hexdigest()=='fe53021f3168322cb6cb68f78699866fd098df3c306e4359847a10b0d02689ef'
assert hashlib.sha256(a.libre.read_bytes()).hexdigest()=='3df848d4058e63f37cf9fe997542fd49c84374440d116a34ac4052278aa77e4f'
events=list((a.proxy/'plugins').glob('packetevents-velocity-*.jar'));assert len(events)==1
assert hashlib.sha256(events[0].read_bytes()).hexdigest()in{'1889f17e58030b33ef8c3c9f0d3321c6fb93c0fbd830d96c30af88b2c5eef7b4','0772f64b51aaf79132c76bb1503707ea0d35433713d5312e67401eaa599d271b'}
source_rel='paper/integrations/login-guard/src/org/afuhome/auth/LoginGuard.java'
revision=subprocess.check_output(['git','rev-parse',REV],cwd=ROOT,text=True).strip()
baseline=subprocess.check_output(['git','show',revision+':'+source_rel],cwd=ROOT).decode('utf8')
current=(ROOT/'src/org/afuhome/auth/LoginGuard.java').read_text(encoding='utf8')
field='    private static final MinecraftChannelIdentifier MCBOT_CHANNEL=MinecraftChannelIdentifier.create("mcbot","c2s");'
start=current.index('    @Subscribe(order=PostOrder.FIRST) public void mcbotTransport(')
end=current.index('    private void notifyAuthenticated(',start)
method=current[start:end];assert method.count('@Subscribe')==1 and field in current
assert 'mcbotTransport('not in baseline
for old,new in [
 ('    private final Set<Player> payloadPeers=',field+'\n    private final Set<Player> payloadPeers='),
 ('server.getChannelRegistrar().register(AGENT_CHANNEL);','server.getChannelRegistrar().register(AGENT_CHANNEL);\n        server.getChannelRegistrar().register(MCBOT_CHANNEL);'),
 ('    private void notifyAuthenticated(',method+'    private void notifyAuthenticated(')]:
 assert baseline.count(old)==1,'Pinned source context changed'
 baseline=baseline.replace(old,new)
out.mkdir(parents=True);classes=out/'classes';classes.mkdir();source=out/'LoginGuard.java';source.write_text(baseline,encoding='utf8')
deps=[a.base,a.proxy/'velocity.jar',a.libre,*events,*sorted((a.proxy/'plugins/librelogin/lib').rglob('*.jar'))]
cp=';'.join(map(str,deps))
subprocess.run([str(a.jdk/'bin/javac.exe'),'-proc:none','-implicit:none','-encoding','UTF-8','--release','21','-cp',cp,'-d',str(classes),str(source)],check=True)
compiled={f.relative_to(classes).as_posix():f.read_bytes()for f in classes.rglob('*.class')}
def own(name):return name=='org/afuhome/auth/LoginGuard.class'or name.startswith('org/afuhome/auth/LoginGuard$')
assert all(own(n)for n in compiled)
jar=out/'LoginGuard-0.1.7.jar';retained=0
with zipfile.ZipFile(a.base)as src,zipfile.ZipFile(jar,'w',zipfile.ZIP_DEFLATED)as dst:
 for entry in src.infolist():
  if own(entry.filename):assert entry.filename in compiled;continue
  if entry.filename=='velocity-plugin.json':
   meta=json.loads(src.read(entry));meta['version']='0.1.7';dst.writestr(entry,json.dumps(meta));continue
  dst.writestr(entry,src.read(entry));retained+=1
 for name,data in compiled.items():dst.writestr(name,data)
(out/'classpath.txt').write_text(str(classes)+';'+cp,encoding='utf8')
(out/'build.json').write_text(json.dumps({'baseSha256':BASE,'baselineRevision':revision,'jar':hashlib.sha256(jar.read_bytes()).hexdigest(),'retainedEntries':retained,'changedClasses':sorted(compiled),'generatedSourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'inputs':{f.name:hashlib.sha256(f.read_bytes()).hexdigest()for f in [Path(__file__),ROOT/'src/org/afuhome/auth/LoginGuard.java']},'productionChanged':False},indent=2)+'\n',encoding='utf8')
print('Built narrow LoginGuard 0.1.7; original account bridge retained')
