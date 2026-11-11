"""Pure native-event/addressing checks; no server, model or downloaded dependencies."""
from pathlib import Path
import argparse,shutil,subprocess,tempfile
p=argparse.ArgumentParser();p.add_argument('--javac',default=shutil.which('javac'));p.add_argument('--java',default=shutil.which('java'));a=p.parse_args()
assert a.javac and a.java,'Java 21 or later is required'
root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='maid-conversation-rules-') as tmp:
 sources=[root/'hybrid-src/local/tlmcompat/hybrid'/name for name in ['MaidAddressing.java','MaidSpeechLines.java','MaidConversationRate.java']]
 subprocess.run([a.javac,'--release','21','-encoding','UTF-8','-d',tmp,*map(str,sources),str(root/'tests/MaidConversationRulesFixture.java')],check=True)
 subprocess.run([a.java,'-cp',tmp,'local.tlmcompat.hybrid.MaidConversationRulesFixture'],check=True)
 subprocess.run([a.javac,'--release','21','-encoding','UTF-8','-cp',tmp,'-d',tmp,str(root/'tests/MaidConversationRateFixture.java')],check=True)
 subprocess.run([a.java,'-cp',tmp,'local.tlmcompat.hybrid.MaidConversationRateFixture'],check=True)
