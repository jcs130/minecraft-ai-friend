"""Run pure protocol, deduplication, lease, task and durable identity regressions."""
from pathlib import Path
import argparse,subprocess,os
p=argparse.ArgumentParser();p.add_argument('--jdk',type=Path,required=True);p.add_argument('--gson',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
root=Path(__file__).resolve().parent.parent
a.output.mkdir(parents=True,exist_ok=False)
files=[root/'src/org/qiandengji/mcbot'/str(n+'.java')for n in ['Wire','Receipts','Policy','Bindings','Tasks']]+[root/'numen/ClientDriverBook.java',root/'numen/ConnectionCalls.java',root/'tests/BoundaryTest.java']
subprocess.run([str(a.jdk/'bin/javac.exe'),'-encoding','UTF-8','--release','21','-cp',str(a.gson),'-d',str(a.output),*map(str,files)],check=True)
subprocess.run([str(a.jdk/'bin/java.exe'),'-cp',str(a.output)+os.pathsep+str(a.gson),'org.qiandengji.mcbot.BoundaryTest'],check=True)
