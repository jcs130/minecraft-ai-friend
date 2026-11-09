"""Exercise actual reward and enchantment rules, without a server or player data."""
from pathlib import Path
import os,subprocess,tempfile
root=Path(__file__).resolve().parents[1]/'plugins/AgentFriend'
prefix=Path('org/afuhome/agentfriend')
java=Path(os.environ['JAVA_HOME'])/'bin'
with tempfile.TemporaryDirectory(prefix='trial-rewards-') as temporary:
    sources=[root/'src'/prefix/(name+'.java') for name in ['TrialRewardPolicy','DungeonEnchantments']]
    tests=['TrialRewardPolicyTest','TrialEnchantmentBudgetTest','DungeonEnchantmentsTest']
    sources += [root/'tests'/prefix/(name+'.java') for name in tests]
    subprocess.run([str(java/'javac'),'-encoding','UTF-8','-d',temporary,*map(str,sources)],check=True)
    for name in tests:subprocess.run([str(java/'java'),'-Dfile.encoding=UTF-8','-cp',temporary,'org.afuhome.agentfriend.'+name],check=True)
