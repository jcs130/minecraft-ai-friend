from pathlib import Path
import os,subprocess,argparse,tempfile,sys
root=Path(__file__).resolve().parents[1];repair=Path('E:/MC/ops/repairs/vortex-mmo-20261027');stage=Path('E:/MC/staging/vortex-mmo-20261027');java=Path('E:/MC/jdk/jdk-21.0.12.1+1/bin')
p=argparse.ArgumentParser();p.add_argument('--vortex',type=Path,default=repair/'VortexRPG-1.2.2-alpha-qd-preview5.jar');p.add_argument('--bridge',type=Path,default=repair/'bridge-canonical/QiandengjiRpg-0.1.0.jar');a=p.parse_args()
classes=Path(tempfile.mkdtemp(prefix='rules-',dir=repair))
cp=os.pathsep.join(map(str,[a.vortex,a.bridge,*stage.glob('libraries/**/*.jar')]))
subprocess.run([str(java/'javac.exe'),'-proc:none','-encoding','UTF-8','-cp',cp,'-d',str(classes),str(root/'tests/RulesTest.java')],check=True,capture_output=True)
subprocess.run([str(java/'java.exe'),'-cp',str(classes)+os.pathsep+cp,'RulesTest'],check=True)
subprocess.run([sys.executable,str(root/'tests/test_policy.py')],check=True)
