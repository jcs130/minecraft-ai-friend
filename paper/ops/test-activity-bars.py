from pathlib import Path
import argparse,os,shutil,subprocess,tempfile
p=argparse.ArgumentParser();p.add_argument('--java',default=shutil.which('java'));p.add_argument('--javac',default=shutil.which('javac'));p.add_argument('--gson');a=p.parse_args();root=Path(__file__).resolve().parents[1]/'plugins'
with tempfile.TemporaryDirectory(prefix='activity-semantics-') as tmp:
    sources=[root/'shared/src/org/afuhome/shared/ActivityBarSemantics.java',root/'AgentFriend/src/org/afuhome/agentfriend/ActivityBarBudget.java',root/'AgentFriend/tests/org/afuhome/agentfriend/ActivitySemanticsTest.java']
    if a.gson:sources += [root/'AgentFriend/src/org/afuhome/agentfriend/AgentMessagePolicy.java',root/'AgentFriend/tests/org/afuhome/agentfriend/AgentMessagePolicyTest.java']
    cp=tmp+(os.pathsep+a.gson if a.gson else '')
    subprocess.run([a.javac,'--release','21','-encoding','UTF-8','-cp',cp,'-d',tmp,*map(str,sources)],check=True)
    subprocess.run([a.java,'-cp',cp,'org.afuhome.agentfriend.ActivitySemanticsTest'],check=True)
    if a.gson:subprocess.run([a.java,'-cp',cp,'org.afuhome.agentfriend.AgentMessagePolicyTest'],check=True)
