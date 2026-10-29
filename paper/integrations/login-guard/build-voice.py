"""Add only the voice transport gate to deployed 0.1.8; preserve its account bridge."""
import argparse,hashlib,json,os,subprocess,sys,zipfile
from pathlib import Path

root=Path(__file__).resolve().parent
parser=argparse.ArgumentParser(description=__doc__)
for key in ['base','original','preheartbeat','proxy','jdk','libre','output']:parser.add_argument('--'+key,type=Path,required=True)
a=parser.parse_args()
os.environ['PYTHONUTF8']='1'
assert not a.output.exists(),'Use a fresh output directory'
assert hashlib.sha256(a.base.read_bytes()).hexdigest()=='a9ccb8fb93eb905851cb375679ea96f15c94416af04e7677e3ffd602380aea72','Unreviewed deployed LoginGuard'
a.output.mkdir(parents=True);baseline=a.output/'baseline'
subprocess.run([sys.executable,str(root/'build-heartbeat.py'),'--base',str(a.preheartbeat),'--original',str(a.original),'--proxy',str(a.proxy),'--jdk',str(a.jdk),'--libre',str(a.libre),'--output',str(baseline)],check=True)
with zipfile.ZipFile(a.base) as actual,zipfile.ZipFile(baseline/'LoginGuard-0.1.8.jar') as rebuilt:
    assert actual.namelist()==rebuilt.namelist() and all(actual.read(n)==rebuilt.read(n) for n in actual.namelist()),'Frozen source does not reproduce production'
source=(baseline/'LoginGuard.java').read_text(encoding='utf-8')
current=(root/'src/org/afuhome/auth/LoginGuard.java').read_text(encoding='utf-8')
field='    private static final MinecraftChannelIdentifier VOICE_CHANNEL=MinecraftChannelIdentifier.create("mcagent","voice");'
start=current.index('    @Subscribe(order=PostOrder.FIRST) public void voiceTransport(')
end=current.index('    @Subscribe(order=PostOrder.FIRST) public void mcbotTransport(',start)
method=current[start:end];assert method.count('@Subscribe')==1
for before,after in [
    ('    private final Set<Player> payloadPeers=',field+'\n    private final Set<Player> payloadPeers='),
    ('server.getChannelRegistrar().register(MCBOT_CHANNEL);','server.getChannelRegistrar().register(MCBOT_CHANNEL);\n        server.getChannelRegistrar().register(VOICE_CHANNEL);'),
    ('    @Subscribe(order=PostOrder.FIRST) public void mcbotTransport(',method+'    @Subscribe(order=PostOrder.FIRST) public void mcbotTransport('),
]:
    assert source.count(before)==1,'Frozen source context changed'
    source=source.replace(before,after)
generated=a.output/'LoginGuard.java';generated.write_text(source,encoding='utf-8')
classes=a.output/'classes';classes.mkdir();cp=(baseline/'classpath.txt').read_text(encoding='utf-8')
subprocess.run([str(a.jdk/'bin/javac.exe'),'-proc:none','-implicit:none','--release','21','-encoding','UTF-8','-cp',cp,'-d',str(classes),str(generated)],check=True)
compiled={p.relative_to(classes).as_posix():p.read_bytes() for p in classes.rglob('*.class')}
jar=a.output/'LoginGuard-0.1.9.jar';kept=0
with zipfile.ZipFile(a.base) as previous,zipfile.ZipFile(jar,'w',zipfile.ZIP_DEFLATED) as target:
    for entry in previous.infolist():
        if entry.filename in compiled:continue
        blob=previous.read(entry)
        if entry.filename=='velocity-plugin.json':
            data=json.loads(blob);data['version']='0.1.9';blob=json.dumps(data).encode()
        else:kept+=1
        target.writestr(entry,blob)
    for name,blob in compiled.items():target.writestr(name,blob)
(a.output/'classpath.txt').write_text(str(classes)+';'+cp,encoding='utf-8')
(a.output/'build.json').write_text(json.dumps({'baseSha256':hashlib.sha256(a.base.read_bytes()).hexdigest(),'sha256':hashlib.sha256(jar.read_bytes()).hexdigest(),'retainedEntries':kept,'changedClasses':list(compiled),'accountBridgeRetained':True,'productionChanged':False},indent=2))
print('Built LoginGuard 0.1.9 voice gate only; exact production baseline reproduced')
