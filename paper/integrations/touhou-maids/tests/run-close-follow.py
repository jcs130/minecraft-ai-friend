from pathlib import Path
import argparse,shutil,subprocess,tempfile
p=argparse.ArgumentParser();p.add_argument('--javac',default=shutil.which('javac'));p.add_argument('--java',default=shutil.which('java'));a=p.parse_args()
assert a.javac and a.java,'Use Java 21 or later'
root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='maid-close-follow-') as tmp:
 subprocess.run([a.javac,'--release','21','-encoding','UTF-8','-d',tmp,str(root/'hybrid-src/local/tlmcompat/hybrid/MaidFollowPolicy.java'),str(root/'tests/MaidFollowPolicyFixture.java')],check=True)
 subprocess.run([a.java,'-cp',tmp,'MaidFollowPolicyFixture'],check=True)
