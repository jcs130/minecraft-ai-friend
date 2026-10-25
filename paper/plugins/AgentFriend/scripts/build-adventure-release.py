"""Minimal adventure-only withdrawal over the verified archive/stash .15 candidate. Never installs."""
import argparse, hashlib, json, os, subprocess, zipfile, importlib.util, re
from pathlib import Path
BASE='df99617efdbc0cbfbd9f0bb6665dd154da6a01726b8967d97404c3bcf8971193'
SOURCE='0745171143ef4f0193794765b0abf260cca47fe1'
PACKAGE='org/afuhome/agentfriend/'
NAMES=('AgentFriendPlugin','LifeGuildManager','GuildManager','TaskRouteCatalog','WorldLifeManager','OnboardingGuide','TaskRoutes','TaskMarketManager','AgentCliCatalog')
RESOURCES=('onboarding.yml','resident-contracts.yml','route-contracts.yml','world-life.yml','rpg-story.yml')
sha=lambda b:hashlib.sha256(b).hexdigest()
def main():
 p=argparse.ArgumentParser(description=__doc__)
 for n in ('base-jar','server','jdk','output'):p.add_argument('--'+n,required=True,type=Path)
 a=p.parse_args();root=Path(__file__).resolve().parents[1];out=a.output.resolve();assert not out.exists()
 assert a.server.resolve()!=out and a.server.resolve() not in out.parents
 assert sha(a.base_jar.read_bytes())==BASE
 out.mkdir(parents=True);(out/'empty').mkdir()
 def source(commit,name):return subprocess.check_output(['git','show',commit+':paper/plugins/AgentFriend/src/'+PACKAGE+name+'.java'],cwd=root.parents[2]).decode('utf8')
 originals={n:source('838b0c8a' if n=='GuildManager' else 'cf9dc88359d29cd0af0f2580784e87dbee2c91bb' if n=='AgentCliCatalog' else SOURCE,n) for n in NAMES}
 # Existing deployed guild bytecode predates archive hooks; keep this baseline
 # boundary even though the rest of the .15 plugin now supports public books.
 originals['GuildManager']='\n'.join(line for line in originals['GuildManager'].split('\n') if 'plugin.archives().syncSources();' not in line)
 candidates={n:(root/'src'/PACKAGE/(n+'.java')).read_text(encoding='utf8') for n in NAMES}
 catalogue=originals['AgentCliCatalog']
 for before,after in [
  ('自选六条任务路线；远途纯探索委托可主动暂存和恢复','先探索、再冒险；纯探索远征和已撤下的农耕旧单可暂存'),
  ('暂存当前一次性纯探索远征，空出任务槽','暂存一次性纯探索远征或已撤下的农耕旧单，空出任务槽'),
  ('不适用于日常、工程和原图','其他日常、工程和原图不可暂存')]:
  assert catalogue.count(before)==1;catalogue=catalogue.replace(before,after)
 candidates['AgentCliCatalog']=catalogue
 spec=importlib.util.spec_from_file_location('stash_boundary',root/'scripts/build-stash-menu-release.py')
 helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
 with zipfile.ZipFile(a.base_jar) as z:constants=helper.utf8_constants(z.read(PACKAGE+'TaskMarketManager.class'))
 old=[s for s in constants if s.startswith('§7备料可用公会门口公共箱')];assert len(old)==1
 for collection in [originals,candidates]:
  wording=re.findall('"(§7备料可用公会门口公共箱[^"\\n]+)"',collection['TaskMarketManager']);assert len(wording)==1
  collection['TaskMarketManager']=collection['TaskMarketManager'].replace(wording[0],old[0])
  held=('        return task.steps().get(index(player)).goal() == GuildManager.Goal.PARRY\n'
        '                ? TaskProgressGuidance.parry(guide, plugin.professions().readGuardSkill(player, task.definition())) : guide;')
  assert collection['TaskMarketManager'].count(held)==1
  collection['TaskMarketManager']=collection['TaskMarketManager'].replace(held,'        return guide;')
 # Keep the separately held public-facility wording outside this release.
 guild=originals['GuildManager']
 replacements=[
 ('    private void accept(Player player, String id) {','    private void accept(Player player, String id) {\n        if (RetiredActivities.retired(id)) { player.sendMessage(ChatColor.YELLOW + RetiredActivities.HINT); return; }'),
 ('        for (Contract quest : CONTRACTS) (quest.dim() == focusA || quest.dim() == focusB ? focus : others).add(quest);','        for (Contract quest : CONTRACTS) if (!RetiredActivities.retired(quest.id())) (quest.dim() == focusA || quest.dim() == focusB ? focus : others).add(quest);'),
 ('    private boolean availableToday(Player player, Contract quest) {','    private boolean availableToday(Player player, Contract quest) {\n        if (RetiredActivities.retired(quest.id())) return false;'),
 ('            others.removeIf(q -> poolIds().contains(q.id()));','            others.removeIf(q -> RetiredActivities.retired(q.id()) || poolIds().contains(q.id()));'),
 ('            Contract quest = CONTRACTS.get(i);','            Contract quest = CONTRACTS.get(i);\n            if (RetiredActivities.retired(quest.id())) continue;')]
 for before,after in replacements:assert guild.count(before)==1;guild=guild.replace(before,after)
 before='            out.addProperty("status", guide.get("ready").getAsBoolean() ? "ready_to_submit" : "active");\n        }\n        return out;'
 after=before.replace('        return out;','''        if (RetiredActivities.retired(id)) {
            out.addProperty("retired", true); out.addProperty("status", "withdrawn_offer");
            out.addProperty("advice", "旧农耕委托已撤下；用 tasks pause 暂存原阶段和进度，再选探索或讨伐；也可自愿继续收尾。");
            out.addProperty("nextCommand", "/mycli tasks pause");
        }
        return out;''')
 assert guild.count(before)==1;guild=guild.replace(before,after)
 candidates['GuildManager']=guild
 candidates['RetiredActivities']=(root/'src'/PACKAGE/'RetiredActivities.java').read_text(encoding='utf8')
 cp=os.pathsep.join(map(str,[a.base_jar,a.server/'versions/1.21.1/paper-1.21.1.jar',*sorted((a.server/'libraries').rglob('*.jar')),*sorted((a.server/'plugins').glob('*.jar'))]))
 for label,sources in [('baseline',originals),('candidate',candidates)]:
  src=out/label/'src'/PACKAGE;classes=out/label/'classes';src.mkdir(parents=True);classes.mkdir(parents=True);files=[]
  for n,text in sources.items():
   file=src/(n+'.java');file.write_text(text,encoding='utf8',newline='\n');files.append(file)
  args=['-proc:none','-encoding','UTF-8','--release','21','-sourcepath',str(out/'empty'),'-cp',cp,'-d',str(classes),*map(str,files)]
  argfile=out/(label+'.args');argfile.write_text('\n'.join('"'+s.replace('\\','/')+'"' for s in args),encoding='utf8')
  subprocess.run([str(a.jdk/'bin/javac.exe'),'@'+str(argfile)],check=True)
  if label=='baseline':
   for f in classes.rglob('*.class'):
    name=f.relative_to(classes).as_posix().removesuffix('.class').replace('/','.')
    read=lambda where:subprocess.check_output([str(a.jdk/'bin/javap.exe'),'-p','-c','-classpath',str(where),name])
    assert read(classes)==read(a.base_jar),'Baseline differs: '+name
 entries={f.relative_to(out/'candidate/classes').as_posix():f.read_bytes() for f in (out/'candidate/classes').rglob('*.class')}
 for name in RESOURCES:entries[name]=(root/'resources'/name).read_bytes()
 jar=out/'AgentFriend-0.4.47.16.jar';unchanged=[]
 with zipfile.ZipFile(a.base_jar) as old,zipfile.ZipFile(jar,'x',zipfile.ZIP_DEFLATED) as new:
  entries['plugin.yml']=old.read('plugin.yml').replace(b"version: '0.4.47.15'",b"version: '0.4.47.16'")
  for row in old.infolist():
   if row.filename not in entries:new.writestr(row,old.read(row.filename));unchanged.append(row.filename)
  for name,body in sorted(entries.items()):
   zi=zipfile.ZipInfo(name,(1980,1,1,0,0,0));zi.compress_type=zipfile.ZIP_DEFLATED;new.writestr(zi,body)
 with zipfile.ZipFile(a.base_jar) as old,zipfile.ZipFile(jar) as new:assert all(old.read(n)==new.read(n) for n in unchanged)
 report=dict(version='0.4.47.16',sha256=sha(jar.read_bytes()),baselineSha256=BASE,baselineBytecodeVerified=True,unchangedEntries=len(unchanged),replacedEntries=sorted(entries),productionChanged=False)
 (out/'build.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
if __name__=='__main__':main()
