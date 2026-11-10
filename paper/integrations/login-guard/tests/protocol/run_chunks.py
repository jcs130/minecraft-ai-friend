"""Fresh loopback-only real Velocity transport + Java VoiceUploads; no Paper world, TTS or accounts.

Use separately compiled baseline/candidate LoginGuard classes. Synthetic authorization is
explicit. Dependencies are the same pinned jars as run_transport_tests.py. Never deploys.
"""
import argparse, hashlib, json, os, subprocess, sys, zipfile
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[4]
sys.path.insert(0,str(HERE.parent))
from run_transport_tests import PINNED
p=argparse.ArgumentParser(description=__doc__)
for name in ['deps','classes','node-package','output']:p.add_argument('--'+name,type=Path,required=True)
p.add_argument('--baseline',action='store_true');p.add_argument('--delay-first',action='store_true')
a=p.parse_args();out=a.output.resolve();deps=[a.deps.resolve()/n for n in PINNED]
if out.exists() or out==REPO or REPO in out.parents:p.error('Use a fresh directory outside repository')
for jar in deps:
 if hashlib.sha256(jar.read_bytes()).hexdigest()!=PINNED[jar.name]:p.error('Unreviewed dependency: '+jar.name)
out.mkdir(parents=True);(out/'plugins/bStats').mkdir(parents=True);(out/'voice-transport-qa.marker').touch()
(out/'plugins/bStats/config.txt').write_text('enabled=false\n')
cp=os.pathsep.join(map(str,[a.classes.resolve(),*deps]));compiled=out/'test-classes';compiled.mkdir()
voice=REPO/'paper/integrations/proximity-voice'
subprocess.run(['java','com.sun.tools.javac.Main','-proc:none','-source','21','-target','21','-cp',cp,'-d',str(compiled),str(HERE/'VoiceChunkProxyProbe.java'),str(voice/'src/dev/god/godvoice/VoiceUploads.java'),str(voice/'tests/VoiceWireProbe.java')],check=True)
with zipfile.ZipFile(out/'plugins/VoiceChunkProbe.jar','w',zipfile.ZIP_DEFLATED) as z:
 for directory in [a.classes.resolve(),compiled]:
  for file in directory.rglob('*.class'):z.write(file,file.relative_to(directory).as_posix())
 for jar in deps[1:]:
  with zipfile.ZipFile(jar) as source:
   for name in source.namelist():
    if name.endswith('.class') and not name.startswith('META-INF/'):z.writestr(name,source.read(name))
 z.writestr('velocity-plugin.json',json.dumps(dict(id='voice-chunk-probe',name='VoiceChunkProbe',version='0.0.0-test-only',main='org.afuhome.auth.VoiceChunkProxyProbe')))
(out/'velocity.toml').write_text('''config-version = "2.7"
bind = "127.0.0.1:25881"
online-mode = false
force-key-authentication = false
player-info-forwarding-mode = "none"
[servers]
paper = "127.0.0.1:25882"
try = ["paper"]
[forced-hosts]
"lobby.example.com" = ["paper"]
"factions.example.com" = ["paper"]
"minigames.example.com" = ["paper"]
[advanced]
login-ratelimit = 0
''')
env={**os.environ,'VOICE_CHUNK_QA_ROOT':str(out),'VOICE_QA_NODE_PACKAGE':str(a.node_package.resolve()),'VOICE_QA_WIRE_CLASSPATH':os.pathsep.join(map(str,[compiled,*deps])),'VOICE_QA_VELOCITY':str(deps[0]),'VOICE_QA_BASELINE':str(int(a.baseline)),'VOICE_QA_DELAY':str(int(a.delay_first))}
result=subprocess.run(['node',str(HERE/'voice-chunks.mjs')],env=env,capture_output=True,text=True,timeout=150)
(out/'client.log').write_text(result.stdout+result.stderr);print(result.stdout+result.stderr,end='');result.check_returncode()
