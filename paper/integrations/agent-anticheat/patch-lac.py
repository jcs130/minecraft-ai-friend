"""Patch one field reference in the pinned AGPL LightAntiCheat binary.

FlightA's slow-falling variable accidentally reads the JUMP effect. This uses
the real SLOW_FALLING field on the verified Paper 1.21.1, retaining flight checks
instead of exempting all Agents or everyone drinking a potion. Obtain source
and binary from upstream; do not commit private server folders or binary JARs.
"""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,zipfile

p=argparse.ArgumentParser()
p.add_argument('--base',type=Path,required=True)
p.add_argument('--server',type=Path,required=True)
p.add_argument('--output',type=Path,required=True)
p.add_argument('--javac',type=Path,required=True)
a=p.parse_args()
assert hashlib.sha512(a.base.read_bytes()).hexdigest()=='42bc52ebda95807346d158bef4a4df888ff9b71ee3087acf6297b68132699c30be3d59ffc3dcae15547e8f83aede1d343c75475c85a5a2be72e2d53816ecc5e1'
with zipfile.ZipFile(a.base)as base:
 descriptor=base.read('plugin.yml').decode('utf8')
 assert descriptor.count("version: '1.2.6'")==1
work=a.output.with_suffix('.build');work.mkdir(parents=True,exist_ok=False)
classes=work/'classes';classes.mkdir()
asm=next(a.server.glob('libraries/org/ow2/asm/asm/9.7.1/asm-9.7.1.jar'))
subprocess.run([str(a.javac),'-proc:none','--release','21','-encoding','UTF-8','-cp',str(asm),'-d',str(classes),str(Path(__file__).with_name('PatchSlowFalling.java'))],check=True)
entry='me/vekster/lightanticheat/check/checks/movement/flight/FlightA.class'
with zipfile.ZipFile(a.base)as z:(work/'FlightA-before.class').write_bytes(z.read(entry))
subprocess.run([str(a.javac.with_name('java.exe')),'-cp',str(classes)+os.pathsep+str(asm),'PatchSlowFalling',str(work/'FlightA-before.class'),str(work/'FlightA-after.class')],check=True)
changed={entry:(work/'FlightA-after.class').read_bytes()}
with zipfile.ZipFile(a.base) as base,zipfile.ZipFile(a.output,'x',zipfile.ZIP_DEFLATED) as out:
 for name in base.namelist():
  data=changed.get(name,base.read(name))
  if name=='plugin.yml':
   data=descriptor.replace("version: '1.2.6'","version: '1.2.6-qd1'").encode('utf8')
  entry=zipfile.ZipInfo(name,date_time=(2026,1,1,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED;out.writestr(entry,data)
report={'baseSha512':hashlib.sha512(a.base.read_bytes()).hexdigest(),'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest(),'changed':['plugin.yml',*changed],'reason':'read actual slow-falling effect; retain physics enforcement','license':'AGPL-3.0','source':'https://github.com/tiredvekster/LightAntiCheat/blob/ec801a0eca80aa8d53587411e643bead7c8bdb1a/src/main/java/me/vekster/lightanticheat/check/checks/movement/flight/FlightA.java'}
a.output.with_suffix('.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
print(json.dumps(report))
