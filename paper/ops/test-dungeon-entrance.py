"""Offline coordinate/protection policy; native checkpoint and travel tests are separate."""
from pathlib import Path
import argparse,shutil,subprocess,tempfile
p=argparse.ArgumentParser();p.add_argument('--java',default=shutil.which('java'));p.add_argument('--javac',default=shutil.which('javac'));a=p.parse_args()
root=Path(__file__).resolve().parents[1]/'plugins/AgentFriend'
with tempfile.TemporaryDirectory(prefix='dungeon-entrance-test-') as temp:
    files=[root/'src/org/afuhome/agentfriend/DungeonEntrance.java',root/'tests/org/afuhome/agentfriend/DungeonEntranceTest.java']
    subprocess.run([a.javac,'--release','21','-encoding','UTF-8','-d',temp,*map(str,files)],check=True)
    subprocess.run([a.java,'-cp',temp,'org.afuhome.agentfriend.DungeonEntranceTest'],check=True)
