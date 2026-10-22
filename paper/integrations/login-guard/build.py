"""Compile the small companion against the already pinned local official jars."""
import argparse,subprocess,zipfile,json,hashlib
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--proxy',type=Path,required=True);p.add_argument('--jdk',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--libre',type=Path,help='Pinned official API jar when the runtime has audited listener patches');a=p.parse_args()
root=Path(__file__).resolve().parent
assert not a.output.exists(), 'Use a fresh build directory'
a.output.mkdir(parents=True);classes=a.output/'classes';classes.mkdir()
libre=a.libre or a.proxy/'plugins/LibreLogin-0.24.0.jar'
assert hashlib.sha256((a.proxy/'velocity.jar').read_bytes()).hexdigest()=='fe53021f3168322cb6cb68f78699866fd098df3c306e4359847a10b0d02689ef', 'Velocity internal API is pinned'
assert hashlib.sha256(libre.read_bytes()).hexdigest()=='3df848d4058e63f37cf9fe997542fd49c84374440d116a34ac4052278aa77e4f'
packet_events=list((a.proxy/'plugins').glob('packetevents-velocity-*.jar'))
assert len(packet_events)==1,'Exactly one PacketEvents JAR is required'
assert hashlib.sha256(packet_events[0].read_bytes()).hexdigest() in {
    '1889f17e58030b33ef8c3c9f0d3321c6fb93c0fbd830d96c30af88b2c5eef7b4',
    '0772f64b51aaf79132c76bb1503707ea0d35433713d5312e67401eaa599d271b',
},'PacketEvents must be a tested pinned build'
deps=[a.proxy/'velocity.jar',libre,*packet_events,*sorted((a.proxy/'plugins/librelogin/lib').rglob('*.jar'))]
cp=';'.join(map(str,deps))
subprocess.run([str(a.jdk/'bin/javac.exe'),'-proc:none','-encoding','UTF-8','--release','21','-cp',cp,'-d',str(classes),*map(str,(root/'src').rglob('*.java')),str(root/'HashAccounts.java')],check=True)
jar=a.output/'LoginGuard-0.1.6.jar'
with zipfile.ZipFile(jar,'w',zipfile.ZIP_DEFLATED) as z:
    for f in (classes/'org').rglob('*.class'):z.write(f,f.relative_to(classes).as_posix())
    z.writestr('velocity-plugin.json',json.dumps({'id':'login-guard','name':'LoginGuard','version':'0.1.6','main':'org.afuhome.auth.LoginGuard','dependencies':[{'id':'librelogin','optional':True},{'id':'packetevents','optional':False}]}))
(a.output/'classpath.txt').write_text(str(classes)+';'+cp,encoding='utf-8')
(a.output/'build.json').write_text(json.dumps({'jar':hashlib.sha256(jar.read_bytes()).hexdigest(),'dependencies':{str(f):hashlib.sha256(f.read_bytes()).hexdigest() for f in deps},'sources':{str(f.relative_to(root)):hashlib.sha256(f.read_bytes()).hexdigest() for f in root.rglob('*') if f.is_file()}},indent=2),encoding='utf-8')
print('Built LoginGuard 0.1.6')
