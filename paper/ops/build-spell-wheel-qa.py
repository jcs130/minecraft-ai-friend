"""Build a read-only probe for the explicitly marked, loopback-only wheel fixture."""
from pathlib import Path
import argparse,os,subprocess,tempfile,zipfile

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--stage',type=Path,required=True)
p.add_argument('--jdk',type=Path,required=True)
p.add_argument('--out',type=Path,required=True)
a=p.parse_args();stage=a.stage.resolve();out=a.out.resolve()
assert (stage/'.wheel-loadout-qa').read_text().strip()=='SYNTHETIC_WHEEL_LOADOUT_ONLY'
properties=(stage/'server.properties').read_text().splitlines()
for line in ('server-ip=127.0.0.1','server-port=26875','rcon.port=26876','online-mode=false'):assert line in properties
assert not out.is_relative_to(stage),'build outside the stage, then install only while stopped'
out.mkdir(parents=True,exist_ok=True)
source=Path(__file__).resolve().parents[1]/'probe/spell-wheel-loadout/SpellWheelLoadoutQa.java'
cp=os.pathsep.join(str(p)for folder in (stage/'plugins',stage/'libraries')for p in folder.rglob('*.jar'))
with tempfile.TemporaryDirectory(dir=out,prefix='wheel-probe-')as tmp:
    java=a.jdk/'bin'/('javac.exe'if os.name=='nt'else'javac')
    subprocess.run([str(java),'--release','21','-proc:none','-encoding','UTF-8','-cp',cp,'-d',tmp,str(source)],check=True)
    with zipfile.ZipFile(out/'SpellWheelLoadoutQa.jar','w',zipfile.ZIP_DEFLATED)as z:
        for f in Path(tmp).rglob('*.class'):z.write(f,f.relative_to(tmp).as_posix())
        z.writestr('plugin.yml','name: SpellWheelLoadoutQa\nversion: 0.1.0-qa-only\nmain: local.wheelloadoutqa.SpellWheelLoadoutQa\napi-version: "1.21"\ndepend: [AgentFriend]\nsoftdepend: [floodgate]\ncommands:\n  wheelqa:\n    permission: wheelqa.admin\npermissions:\n  wheelqa.admin:\n    default: op\n')
print('Built SpellWheelLoadoutQa.jar; it refuses every unmarked or production profile')
