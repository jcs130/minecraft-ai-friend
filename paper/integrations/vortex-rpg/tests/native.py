"""Offline release rules. Explicit artifacts only; no connection or game mutation."""
from pathlib import Path
import argparse,os,shutil,subprocess,tempfile

p=argparse.ArgumentParser(description=__doc__)
for name in ['vortex','bridge','agentfriend','server']:p.add_argument('--'+name,type=Path,required=True)
p.add_argument('--java',type=Path,help='JDK 21+ bin directory; defaults to the installed java')
a=p.parse_args();java=a.java or Path(shutil.which('java')or 'java').resolve().parent
suffix='.exe'if os.name=='nt'else'';root=Path(__file__).resolve().parents[1];paper=root.parents[1]
artifacts=[a.vortex,a.bridge,a.agentfriend];assert all(x.is_file()for x in artifacts)
classes=Path(tempfile.mkdtemp(prefix='qiandengji-native-tests-'));cp=os.pathsep.join(map(str,[*artifacts,*a.server.glob('libraries/**/*.jar'),*a.server.glob('versions/**/*.jar')]))
sources=[paper/'probe'/n for n in ['AppearanceHintPolicyTest.java','AdventureCertificateMigrationTest.java','DungeonLoadoutRulesTest.java']]
sources += [paper/'plugins/AgentFriend/src/org/afuhome/agentfriend'/n for n in ['AppearanceHintPolicy.java','ProfessionLedger.java','DungeonLoadoutRules.java']]
sources += [root/n for n in ['RewardJournal.java','QuestWrites.java','tests/RewardJournalTest.java','tests/QuestWritesTest.java','tests/PlayerDataRepositoryTest.java','tests/QuestTextTest.java','tests/RpgJourneyTest.java','tests/RpgCatalogTest.java','tests/AuctionSafetyTest.java','tests/RulesTest.java','src/org/qiandengji/vortex/EconomyReceipts.java','tests/EconomyReceiptsTest.java']]
args=['-proc:none','-encoding','UTF-8','--release','21','-cp',cp,'-d',str(classes),*map(str,sources)]
argfile=classes/'javac.args';argfile.write_text('\n'.join('"'+x.replace('\\','/')+'"'for x in args),encoding='utf8')
subprocess.run([str(java/('javac'+suffix)),'@'+str(argfile)],check=True)
for name in ['org.afuhome.agentfriend.AppearanceHintPolicyTest','org.afuhome.agentfriend.AdventureCertificateMigrationTest','org.afuhome.agentfriend.DungeonLoadoutRulesTest','io.vortexcore.quest.RewardJournalTest','io.vortexcore.quest.QuestWritesTest','PlayerDataRepositoryTest','QuestTextTest','RpgJourneyTest','org.afuhome.agentfriend.RpgCatalogTest','AuctionSafetyTest','RulesTest','org.qiandengji.vortex.EconomyReceiptsTest']:
    subprocess.run([str(java/('java'+suffix)),'-ea','-Dfile.encoding=UTF-8','-cp',str(classes)+os.pathsep+cp,name],check=True)
print('Offline release checks passed; no server or player data changed.')
