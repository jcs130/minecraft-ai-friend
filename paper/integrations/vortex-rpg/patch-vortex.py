"""Build narrow fixes from pinned upstream sources; never ships third-party code.

Input is the separately verified local 1.21.1 Attribute compatibility JAR.
Only our generated QuestService, QuestEventListener, SpellbookService and
ManaGate classes change. Original upstream resources/other classes stay exact.
"""
from pathlib import Path
import argparse,hashlib,json,os,re,subprocess,zipfile
from quest_rewards_patch import patch_currency_rewards
PIN='4cafc171905350e5a56e94239f4f247ad34141d965f93b71c6daf7f8b3af84f75d668fea7eff31eb783b57cd964aecb11a06a036a6c6d9ed64b9ed0a79741d7f'
def replace_once(text,before,after):
 assert text.count(before)==1,'Upstream code differs from reviewed patch point'
 return text.replace(before,after,1)
def main():
 p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--base',type=Path,required=True);p.add_argument('--server',type=Path,required=True);p.add_argument('--vault',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 assert not a.output.exists() and hashlib.sha512(a.base.read_bytes()).hexdigest()==PIN
 commit=subprocess.check_output(['git','-C',str(a.source),'rev-parse','HEAD'],text=True).strip();assert commit.startswith('3e5baba')
 build=a.output.parent/(a.output.stem+'.build');generated=build/'source';compiled=build/'classes'
 build.mkdir();generated.mkdir();compiled.mkdir()
 # Link direct accessors before javac. Reflection over VortexCorePlugin fields
 # forces resolution of optional PlaceholderAPI types on a plain Paper server.
 asm=next(a.server.glob('libraries/org/ow2/asm/asm/9.7.1/asm-9.7.1.jar'))
 helper=Path(__file__).with_name('VortexApiAccess.java');access=a.output.with_suffix('.access.jar')
 subprocess.run(['E:/MC/jdk/jdk-21.0.12.1+1/bin/javac.exe','-proc:none','-cp',str(asm),'-d',str(compiled),str(helper)],check=True,capture_output=True)
 subprocess.run(['E:/MC/jdk/jdk-21.0.12.1+1/bin/java.exe','-cp',str(compiled)+os.pathsep+str(asm),'VortexApiAccess',str(a.base),str(access)],check=True)
 sources={};base=a.source/'src/main/java/io/vortexcore'
 def read(name):
  f=base/name;text=f.read_text(encoding='utf8');sources[name]=hashlib.sha256(f.read_bytes()).hexdigest();return text
 q=read('quest/QuestService.java')
 q,vault=patch_currency_rewards(q,read('integration/vault/VaultEconomyBridge.java'))
 q=replace_once(q,'QuestProgress completed = progress.complete();','if (definition.objectives().isEmpty() || !definition.objectives().stream().allMatch(o -> progress.objectives().stream().anyMatch(v -> v.objectiveId().equals(o.id()) && v.current()>=o.amount() && v.completed()))) { return CompletableFuture.completedFuture(false); }\n            QuestProgress completed = progress.complete();')
 q=replace_once(q,'completeQuest(player, questId.toLowerCase(Locale.ROOT));','scheduler.runEntity(player, "quest-ready-" + player.getUniqueId(), () -> messageService.send(player, "<green>目标已完成，请主动交付：</green> /mycli tasks claim " + questId));')
 # Capture the actual location before asynchronous repository work. Legacy
 # world-only targets remain supported; coordinate targets require all axes.
 method='''
    public void progressLocation(org.bukkit.entity.Player player, org.bukkit.Location at) {
        String world = at.getWorld().getName(); double x=at.getX(), y=at.getY(), z=at.getZ();
        questRepository.load(player.getUniqueId()).thenAccept(data -> {
            for (QuestProgress progress : data.quests().values()) {
                if (progress.state()!=QuestState.ACTIVE) continue;
                var definition=questRegistry.find(progress.questId()); if(definition.isEmpty())continue;
                for (var objective:definition.get().objectives()) {
                    if(objective.type()!=QuestObjectiveType.VISIT_LOCATION)continue;
                    if(locationMatches(objective.target(),world,x,y,z))progressObjective(player,progress.questId(),objective.id(),1);
                }
            }
        });
    }
    public static boolean locationMatches(String target,String world,double x,double y,double z) {
        if(target==null||world==null)return false;String[] p=target.split(":",-1);
        if(p.length==1)return target.equalsIgnoreCase(world);
        if(p.length!=5||!p[0].equalsIgnoreCase(world))return false;
        try {double a=Double.parseDouble(p[1]),b=Double.parseDouble(p[2]),c=Double.parseDouble(p[3]),r=Double.parseDouble(p[4]);
            if(!Double.isFinite(a)||!Double.isFinite(b)||!Double.isFinite(c)||!Double.isFinite(r)||r<=0||r>128)return false;
            return Math.pow(x-a,2)+Math.pow(y-b,2)+Math.pow(z-c,2)<=r*r;
        }catch(NumberFormatException e){return false;}
    }
'''
 q=replace_once(q,'    public CompletableFuture<Boolean> completeQuest(Player player, String questId) {',method+'\n    public CompletableFuture<Boolean> completeQuest(Player player, String questId) {')
 listener=read('quest/listener/QuestEventListener.java')
 listener=replace_once(listener,'String worldName = to.getWorld().getName().toLowerCase();\n        questService.progressObjectiveByType(player, QuestObjectiveType.VISIT_LOCATION, worldName, 1);','questService.progressLocation(player, to.clone());')
 listener=replace_once(listener,'previous.getBlockZ() == to.getBlockZ()','previous.getBlockZ() == to.getBlockZ() && previous.getBlockY() == to.getBlockY()')
 spell=read('rpg/SpellbookService.java')
 # Observation is read-only and shares the exact map used by every native cast.
 spell=replace_once(spell,'    public CompletableFuture<Void> cast(Player player, UnifiedPlayer profile, String requestedSpellId) {','''    public long qiandengjiCooldown(java.util.UUID id, String spellId) {
        return Math.max(0L, cooldowns.getOrDefault(id, java.util.Map.of()).getOrDefault(spellId, 0L)-System.currentTimeMillis());
    }
    public CompletableFuture<Void> cast(Player player, UnifiedPlayer profile, String requestedSpellId) {
        if(!io.vortexcore.combat.PlayerStateGate.allowed(player))return failedCast(player,"当前状态不能施放；先等待救援或使用生存角色，再查 /mycli status。");''')
 # Eligibility is initially checked before scheduling; a second queued native
 # cast must recheck on the owning entity thread before it spends any mana.
 spell=replace_once(spell,'            SpellContext context = new SpellContext(UUID.randomUUID(), profile, player.getLocation(), nexusBus, player);','''            if (qiandengjiCooldown(player.getUniqueId(), spellId)>0L) {
                future.completeExceptionally(new IllegalStateException("技能正在冷却；等待后查询，不要重复施放。"));return;
            }
            SpellContext context = new SpellContext(UUID.randomUUID(), profile, player.getLocation(), nexusBus, player);''')
 # The advertised ManaManager is not consulted by the upstream spell path.
 # Reserve only after permission/target eligibility and cooldown checks; return
 # it on failed execution. Every native GUI/command/API cast shares this gate.
 spell=replace_once(spell,'SpellContext context = new SpellContext(UUID.randomUUID(), profile, player.getLocation(), nexusBus, player);','''double reservedMana;
            try { reservedMana=io.vortexcore.combat.ManaGate.cost(plugin, spellId);
                if (!io.vortexcore.combat.ManaGate.take(plugin, player, reservedMana)) {
                    future.completeExceptionally(new IllegalStateException("魔力不足，请先恢复；本次未施放、未进入冷却。")); return;
                }
            } catch(RuntimeException error){future.completeExceptionally(error);return;}
            SpellContext context = new SpellContext(UUID.randomUUID(), profile, player.getLocation(), nexusBus, player);''')
 spell=replace_once(spell,'spell.compiledSpell().execute(context).whenComplete','io.vortexcore.combat.ManaGate.execute(() -> spell.compiledSpell().execute(context)).whenComplete')
 spell=replace_once(spell,'cooldowns.get(player.getUniqueId()).remove(spellId);','cooldowns.get(player.getUniqueId()).remove(spellId);\n                    io.vortexcore.combat.ManaGate.refund(plugin, player, reservedMana);')
 # Compile the same source against the *actual* enum API of 1.21.1.
 spell=spell.replace('Attribute.MAX_HEALTH','Attribute.GENERIC_MAX_HEALTH')
 classes=read('rpg/ClassSkillService.java')
 for signature in [
  'public CompletableFuture<Void> chooseClass(Player player, UnifiedPlayer profile, String classId)',
  'public CompletableFuture<Void> playerRequestClassSwap(Player player, UnifiedPlayer profile, String classId)',
  'public CompletableFuture<Void> forceSetClass(Player player, UnifiedPlayer profile, String classId)',
  'public CompletableFuture<AscensionResult> ascend(Player player, UnifiedPlayer profile, String ascensionId)',
  'public CompletableFuture<SkillUnlockResult> unlockSkill(Player player, UnifiedPlayer profile, String skillId)']:
  classes=replace_once(classes,signature+' {',signature+' {\n        if(!io.vortexcore.combat.PlayerStateGate.allowed(player))return CompletableFuture.failedFuture(new IllegalStateException("当前状态不能更改职业或技能；先等待救援，再查 /mycli status。"));')
 for field in ['MAX_HEALTH','ATTACK_DAMAGE','MOVEMENT_SPEED','ARMOR']:classes=classes.replace('Attribute.'+field,'Attribute.GENERIC_'+field)
 gate='''package io.vortexcore.combat;
import org.bukkit.entity.Player;import org.bukkit.plugin.Plugin;
public final class ManaGate {
 private static ManaManager manager(Plugin p) {return ((io.vortexcore.VortexCorePlugin)p).qiandengjiMana();}
 public static double cost(Plugin p,String id){double value=p.getConfig().getDouble("qiandengji.spell-mana-costs."+id,6.0);if(!Double.isFinite(value)||value<0||value>10000)throw new IllegalStateException("技能魔力配置无效");return value;}
 public static boolean take(Plugin p,Player player,double value){return manager(p).consumeMana(player.getUniqueId(),value);}
 public static void refund(Plugin p,Player player,double value){var m=manager(p);m.setMana(player.getUniqueId(),m.getMana(player.getUniqueId())+value);}
 public static <T> java.util.concurrent.CompletionStage<T> execute(java.util.function.Supplier<java.util.concurrent.CompletionStage<T>> task){try{return task.get();}catch(RuntimeException e){return java.util.concurrent.CompletableFuture.failedFuture(e);}}
}
'''
 state_gate='''package io.vortexcore.combat;
public final class PlayerStateGate {
 public static boolean allowed(org.bukkit.entity.Player p){
  if(!p.isOnline()||p.isDead()||!java.util.Set.of(org.bukkit.GameMode.SURVIVAL,org.bukkit.GameMode.ADVENTURE).contains(p.getGameMode()))return false;
  var af=org.bukkit.Bukkit.getPluginManager().getPlugin("AgentFriend");if(af==null||!af.isEnabled())return true;
  try{return Boolean.TRUE.equals(af.getClass().getMethod("nativeRpgMayAct",org.bukkit.entity.Player.class).invoke(af,p));}
  catch(Exception mismatch){return false;}
 }
}
'''
 texts={'quest/QuestService.java':q,'quest/listener/QuestEventListener.java':listener,'rpg/SpellbookService.java':spell,'rpg/ClassSkillService.java':classes,'combat/ManaGate.java':gate,'combat/PlayerStateGate.java':state_gate,'integration/vault/VaultEconomyBridge.java':vault}
 for name,text in texts.items():f=generated/'io/vortexcore'/name;f.parent.mkdir(exist_ok=True,parents=True);f.write_text(text,encoding='utf8')
 cp=os.pathsep.join(map(str,[access,a.vault,*a.server.rglob('libraries/**/*.jar')]))
 result=subprocess.run(['E:/MC/jdk/jdk-21.0.12.1+1/bin/javac.exe','-J-Duser.language=en','-J-Dfile.encoding=UTF-8','-proc:none','-encoding','UTF-8','--release','21','-cp',cp,'-d',str(compiled),*map(str,generated.rglob('*.java'))],capture_output=True)
 if result.returncode:print(result.stderr.decode('utf8',errors='replace'));raise SystemExit(result.returncode)
 new={f.relative_to(compiled).as_posix():f.read_bytes()for f in (compiled/'io').rglob('*.class')}
 allowed=('io/vortexcore/quest/QuestService','io/vortexcore/quest/listener/QuestEventListener','io/vortexcore/rpg/SpellbookService','io/vortexcore/rpg/ClassSkillService','io/vortexcore/combat/ManaGate','io/vortexcore/combat/PlayerStateGate','io/vortexcore/integration/vault/VaultEconomyBridge')
 assert all(any(n==s+'.class'or n.startswith(s+'$') for s in allowed)for n in new)
 retained=0
 with zipfile.ZipFile(access)as z,zipfile.ZipFile(a.output,'w',zipfile.ZIP_DEFLATED)as out:
  for info in z.infolist():
   if info.filename in new:continue
   out.writestr(info,z.read(info));retained+=1
  for name,data in new.items():out.writestr(name,data)
 report={'upstream':commit,'sourceHashes':sources,'baseSha512':PIN,'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest(),'changedClasses':list(new)+['io/vortexcore/VortexCorePlugin.class','io/vortexcore/rpg/PlayerProfileService.class'],'otherEntriesRetained':retained-2,'productionChanged':False}
 a.output.with_suffix('.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps({'changedClasses':len(new),'otherEntriesRetained':retained,'productionChanged':False}))
if __name__=='__main__':main()
