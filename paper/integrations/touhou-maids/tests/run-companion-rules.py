from pathlib import Path
import argparse,shutil,subprocess,tempfile,os
p=argparse.ArgumentParser();p.add_argument('--javac',default=shutil.which('javac'));p.add_argument('--java',default=shutil.which('java'));p.add_argument('--gson',required=True);a=p.parse_args();root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as tmp:
 sources=[root/'hybrid-src/local/tlmcompat/hybrid'/s for s in ['MaidCompanionPolicy.java','MaidConversationWindow.java']]+[root/'tests/MaidCompanionPolicyFixture.java']
 subprocess.run([a.javac,'--release','21','-encoding','UTF-8','-d',tmp,*map(str,sources)],check=True)
 subprocess.run([a.java,'-cp',tmp,'local.tlmcompat.hybrid.MaidCompanionPolicyFixture'],check=True)
 subprocess.run([a.javac,'--release','21','-encoding','UTF-8','-cp',a.gson,'-d',tmp,str(root/'hybrid-src/local/tlmcompat/hybrid/MaidChatReply.java'),str(root/'tests/MaidChatReplyFixture.java')],check=True)
 subprocess.run([a.java,'-cp',tmp+os.pathsep+a.gson,'local.tlmcompat.hybrid.MaidChatReplyFixture'],check=True)
