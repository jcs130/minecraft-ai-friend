"""Build only the read-only original YSM exporter; no server JAR installation."""
import argparse,subprocess,os
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--jdk',type=Path,required=True);p.add_argument('--gson',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
root=Path(__file__).resolve().parent;converter=root.parents[1]/'freesia-optional/bridge/org/afuhome/appearance/ModelCatalog.java'
a.output.mkdir(parents=True,exist_ok=False)
subprocess.run([str(a.jdk/'bin'/('javac.exe' if os.name=='nt' else 'javac')),'-proc:none','-encoding','UTF-8','--release','21','-cp',str(a.gson),'-d',str(a.output),str(converter),str(root/'ExportAppearance.java')],check=True)
print('Read-only appearance exporter built.')
