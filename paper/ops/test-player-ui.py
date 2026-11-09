"""Offline navigation and actor-bound response regression, no game data or network."""
from pathlib import Path
import os,subprocess,tempfile
root=Path(__file__).resolve().parents[1]/'plugins/AgentFriend'
prefix=Path('org/afuhome/agentfriend');java=Path(os.environ['JAVA_HOME'])/'bin'
with tempfile.TemporaryDirectory(prefix='player-ui-') as out:
    sources=[root/'src'/prefix/'AdventureMenuModel.java',root/'tests'/prefix/'AdventureMenuModelTest.java']
    subprocess.run([str(java/'javac'),'-encoding','UTF-8','-d',out,*map(str,sources)],check=True)
    subprocess.run([str(java/'java'),'-Dfile.encoding=UTF-8','-cp',out,'org.afuhome.agentfriend.AdventureMenuModelTest'],check=True)
