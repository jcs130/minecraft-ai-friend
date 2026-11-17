"""Controller ownership, durable original IDs and precise receipts; no game or credentials."""
import argparse
import os
from pathlib import Path
import subprocess
import tempfile

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--jdk',type=Path,required=True)
parser.add_argument('--gson',type=Path,required=True)
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
exe='.exe' if os.name=='nt' else ''
with tempfile.TemporaryDirectory(prefix='maid-native-body-test-') as tmp:
    subprocess.run([str(args.jdk/'bin'/('javac'+exe)),'--release','21','-encoding','UTF-8','-cp',str(args.gson),'-d',tmp,
        str(root/'hybrid-src/local/tlmcompat/hybrid/MaidBodyControl.java'),str(root/'tests/MaidBodyControlTest.java')],check=True)
    subprocess.run([str(args.jdk/'bin'/('java'+exe)),'-cp',tmp+os.pathsep+str(args.gson),'local.tlmcompat.hybrid.MaidBodyControlTest',str(Path(tmp)/'receipts')],check=True)
