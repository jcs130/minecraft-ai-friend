"""Java 21 pure helpers and real method-body fixtures; no server/player/prod writes."""
import argparse
import os
from pathlib import Path
import re
import subprocess
import sys


def method(source, signature):
    start = source.index(signature)
    brace = source.index("{", start)
    depth, end = 1, brace + 1
    # These selected bodies contain no braces in string literals.
    while depth:
        depth += (source[end] == "{") - (source[end] == "}")
        end += 1
    return source[start:end]


def body_class(source):
    return source[source.index("final class "):].replace("final class ", "static final class ", 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--jdk", type=Path, required=True)
    parser.add_argument("--classpath", type=Path, default=Path("E:/MC/staging/shelter-exam-20261125-baseline/classpath.txt"))
    parser.add_argument("--baseline-classes", type=Path, default=Path("E:/MC/staging/shelter-exam-20261125-baseline/classes"))
    args = parser.parse_args()
    if sys.version_info[:2] != (3, 12):
        raise SystemExit("Requires real Python 3.12")
    root = Path(__file__).resolve().parents[1]
    src = root / "src/org/afuhome/agentfriend"
    owned = ["GuildManager", "GuildRankPoints", "LifeGuildManager", "FoundationGrowth", "HouseEvidence", "LifeContractSettlement"]
    sources = {name: (src / f"{name}.java").read_text(encoding="utf-8") for name in owned}
    cp = args.classpath.read_text(encoding="utf-8").strip()
    args.output.mkdir(parents=True, exist_ok=True)
    compiled = args.output / "owned-classes"
    compiled.mkdir(exist_ok=True)
    suffix = ".exe" if os.name == "nt" else ""
    java = args.jdk / ("bin/java" + suffix)
    javac = args.jdk / ("bin/javac" + suffix)
    version = subprocess.run([str(java), "-version"], capture_output=True, text=True, check=True)
    if not re.search(r'version "21\.', version.stderr):
        raise SystemExit("Requires real Java 21")
    print("Python", sys.version.split()[0], "/", version.stderr.splitlines()[0], flush=True)
    # Compile newly introduced notification ABI too; never substitute the old baseline class.
    support = [str(src / f"{n}.java") for n in ("AgentCommunication", "TaskTransition", "TaskJournalModel")]
    compile_args = ["--release", "21", "-proc:none", "-encoding", "UTF-8", "-cp", cp + os.pathsep + str(args.baseline_classes), "-d", str(compiled)] + [str(src / f"{n}.java") for n in owned] + support
    argfile = args.output / "owned-javac.args"
    argfile.write_text("\n".join(chr(34) + s.replace(chr(92), "/") + chr(34) for s in compile_args), encoding="utf-8")
    subprocess.run([str(javac), "-J-Duser.language=en", "@" + str(argfile)], check=True)
    life, guild = sources["LifeGuildManager"], sources["GuildManager"]
    # Real declaration/catalogue, plus unchanged method bodies (only external boundaries are synthetic).
    declarations = life[life.index("    private record Contract"):life.index("    private final AgentFriendPlugin")]
    life_methods = "\n".join(method(life, s) for s in (
        "private String today()", "private String base(Player player)", "private Contract byId(String id)",
        "private Contract active(Player player)", "private int progress(Player player)",
        "private boolean completedToday(Player player, Contract contract)", "String activeId(Player player)",
        "boolean hasActiveContract(Player player)", "boolean contractId(String id)", "List<GuildManager.Contract> catalog()",
        "String acceptanceReason(Player player, String id)", "private List<String> houseRecords(Player p)",
        "JsonObject onboardingState(Player player)", "JsonObject taskState(Player player)", "JsonObject skillState(Player player)",
        "private String skillText(Player p, Contract c)", "boolean verify(Player player)", "private String rank(int reputation)",
        "private void accept(Player player, String id)", "private void abandon(Player player)", "private void claim(Player player)",
        "private void advance(Player player, String id, String uniquePosition)", "private boolean sameRun(Player player,String id,String runId,String lampKey)", "private boolean recordingShelter(Player p)"))
    command = method(life, "void command(Player player, String[] args)")
    events = "\n".join(method(life, s) for s in (
        "public void onCraft(CraftItemEvent event)", "public void onCraftExtract(", "public void onBuild(BlockPlaceEvent event)", "public void onHouseBreak(BlockBreakEvent event)"))
    # Substitute only external event/block interface types, not production control flow.
    for real, fake_type in {
        "org.bukkit.event.player.PlayerStatisticIncrementEvent": "PlayerStatisticIncrementEvent",
        "org.bukkit.inventory.CraftingInventory": "CraftingInventory",
        "org.bukkit.event.block.BlockMultiPlaceEvent": "BlockMultiPlaceEvent",
        "org.bukkit.block.BlockState": "BlockState", "org.bukkit.block.Block": "Block",
    }.items():
        events = events.replace(real, fake_type)
    life_methods += "\n" + events
    guild_record = guild[guild.index("    record Contract("):guild.index("    private static final List<Contract>")]
    goal = guild[guild.index("    enum Goal"):guild.index("    /** 智能考核维度")]
    guild_methods = "\n".join(method(guild, s) for s in (
        "private String base(UUID id)", "private String adventureId(Player p)", "String activeId(Player p)",
        "boolean hasAdventureContract(Player p)", "private boolean lifeActive(Player p)", "void stageLifeCompletion(Player player, String id, int gain)",
        "private static String canonicalAction(String action)", "void command(Player player, String[] args)",
        "private String acceptanceReason(Player player,String id)", "private com.google.gson.JsonObject residentBoard(Player player,int page)",
        "private void recordRankPoints(Player player, Contract quest, GuildRankPoints.Award award)", "String rankPointHint(Player player, Contract quest)",
        "GuildRankPoints.Award rankPointPreview(Player player, Contract quest)"))
    # The actual life dispatch prefix of accept is tested; non-life acceptance is deliberately outside this fixture.
    prefix = method(guild, "private void accept(Player player, String id)").split("        releaseExpiredDaily(player);")[0]
    guild_methods += prefix + ' throw new AssertionError("non-life acceptance outside route fixture"); }'
    guild_methods += method(guild, "private void claim(Player player,Runnable finished)")
    guild_methods += method(guild, "private void abandon(Player player)")
    guild_methods += method(guild, "void residentCommand(Player player,String[] args,java.util.function.Consumer<com.google.gson.JsonObject> finish)")
    fixture = r'''
package org.afuhome.agentfriend;
import com.google.gson.*;
import java.io.*;
import java.util.*;
import java.util.function.*;
import java.time.*;
import org.bukkit.Material;
import org.bukkit.ChatColor;
import org.bukkit.GameMode;
import org.bukkit.configuration.file.*;
public class LifeTwoTrackProbe {
 static int passed,failed;
 static void check(boolean v){if(!v)throw new AssertionError("unexpected state");}
 static void test(String name,Runnable run){try{run.run();passed++;System.out.println("PASS "+name);}catch(Throwable e){failed++;System.out.println("FAIL "+name);e.printStackTrace(System.out);}}
 static class Player {
  final UUID id;final List<String> messages=new ArrayList<>();GameMode mode=GameMode.SURVIVAL;
  Player(){this(UUID.randomUUID());}Player(UUID id){this.id=id;}UUID getUniqueId(){return id;}
  OpenInventory inventory=new OpenInventory();GameMode getGameMode(){return mode;}void sendMessage(String message){messages.add(message);}OpenInventory getOpenInventory(){return inventory;}
 }
 static class CraftingInventory {}
 static class OpenInventory {Object top=new CraftingInventory();Object getTopInventory(){return top;}}
 static class Bukkit {static final List<Runnable> tasks=new ArrayList<>();static Bukkit getScheduler(){return new Bukkit();}void runTask(AgentFriendPlugin p,Runnable r){tasks.add(r);}static void endTick(){var next=List.copyOf(tasks);tasks.clear();next.forEach(Runnable::run);}}
 static class CraftItemEvent {Player p;boolean shift;CraftItemEvent(Player p,boolean shift){this.p=p;this.shift=shift;}Object getWhoClicked(){return p;}boolean isShiftClick(){return shift;}Block getCurrentItem(){return new Block("item",Material.BREAD);}}
 static class PlayerStatisticIncrementEvent {Player p;int oldValue,newValue;PlayerStatisticIncrementEvent(Player p,int oldValue,int newValue){this.p=p;this.oldValue=oldValue;this.newValue=newValue;}Player getPlayer(){return p;}org.bukkit.Statistic getStatistic(){return org.bukkit.Statistic.CRAFT_ITEM;}Material getMaterial(){return Material.BREAD;}int getPreviousValue(){return oldValue;}int getNewValue(){return newValue;}}
 static class Block {String key;Material type;Block(String key,Material type){this.key=key;this.type=type;}Material getType(){return type;}String getLocation(){return key;}}
 static class BlockState {Block b;BlockState(Block b){this.b=b;}Block getBlock(){return b;}}
 static class BlockPlaceEvent {Player p;Block b;BlockPlaceEvent(Player p,Block b){this.p=p;this.b=b;}Player getPlayer(){return p;}Block getBlockPlaced(){return b;}}
 static class BlockMultiPlaceEvent extends BlockPlaceEvent {List<BlockState> cells;BlockMultiPlaceEvent(Player p,Block... blocks){super(p,blocks[0]);cells=Arrays.stream(blocks).map(BlockState::new).toList();}List<BlockState> getReplacedBlockStates(){return cells;}}
 static class BlockBreakEvent {Player p;Block b;BlockBreakEvent(Player p,Block b){this.p=p;this.b=b;}Player getPlayer(){return p;}Block getBlock(){return b;}}
 static class StarterHouseValidator {record Result(int progress,boolean ready){String reason(){return ready?"ready":"incomplete";}}}
 static class StarterHouseInspection {
  static String key(Block b){return b.key;}
  static StarterHouseValidator.Result inspect(Player p,List<String> records){return new StarterHouseValidator.Result(records.size()>=7?7:0,records.size()>=7);}
  static String hint(StarterHouseValidator.Result r){return r.ready()?"ready":"build";}
  static JsonObject json(StarterHouseValidator.Result r){JsonObject out=new JsonObject();out.addProperty("ready",r.ready());return out;}
 }
 static class RetiredActivities {static String HINT="retired";static boolean retired(String id){return id.equals("farmer_harvest");}}
 static class DurableConfigStore {
  static final String REVISION="__agentfriend_storage.revision";
  static void persist(AgentFriendPlugin p)throws IOException{
   if(p.fail){p.fail=false;throw new IOException("injected durable failure");}
   p.writes++;p.durable=p.config.saveToString();
  }
  static Map<String,Object> audit(AgentFriendPlugin p){return Map.of("commitUnknown",p.unknown);}
 }
 __HOUSE__
 static class AuraSkillsApi {
  static final AuraSkillsApi API=new AuraSkillsApi();static UUID actor;static boolean loaded=true,disabled=false,fault=false;static int xpWrites;
  static AuraSkillsApi get(){return API;}User getUser(UUID id){actor=id;return new User();}
  Requirements getXpRequirements(){if(fault)throw new IllegalStateException("injected authority unavailable");return new Requirements();}
  static class User {boolean isLoaded(){return loaded;}int getSkillLevel(Skills s){return s==Skills.FISHING?12:9;}double getSkillXp(Skills s){return s==Skills.FISHING?34.5:20.25;}}
  static class Requirements {double getXpRequired(Skills s,int level){return 100;}}
 }
 enum Skills {
  FISHING,FARMING;boolean isEnabled(){return !AuraSkillsApi.disabled;}String getId(){return "auraskills/"+name().toLowerCase(Locale.ROOT);}
  String getDisplayName(Locale l,boolean colour){return name();}int getMaxLevel(){return 100;}
 }
 static class FoundationGrowth { __FOUNDATION__ }
 static class DungeonManager {
  AgentFriendPlugin p;boolean reject;int calls;DungeonManager(AgentFriendPlugin p){this.p=p;}
  boolean queueGuildRewards(UUID id,int emeralds,Material gift,int count){calls++;String path="rewards."+id;
   p.config.set(path+".emeralds",p.config.getInt(path+".emeralds")+emeralds);p.config.set(path+".gift",gift.name());
   p.config.set(path+".giftCount",p.config.getInt(path+".giftCount")+count);return !reject;}
  void command(Player p,String[] a){}void openStash(Player p){}boolean isBuilt(){return true;}
 }
 static class Assessments {boolean occupied,expired;String state="active",exam="shelter_basic";boolean busy(Player p){return occupied;}
  boolean recordingShelter(Player p){return !expired&&state.equals("active")&&exam.startsWith("shelter_")&&p.getGameMode()==GameMode.SURVIVAL;}
  boolean canAttachContract(Player p,String id){return false;}JsonObject summary(Player p){var o=new JsonObject();o.addProperty("examId",exam);o.addProperty("state",state);return o;}
  void command(Player p,String[] a){}void certificates(Player p){}
 }
 static class TaskMarket {
  boolean isMarket(String id){return id.startsWith("tm_");}void command(Player p,String[] a){}void mapInfo(Player p){}void assessment(Player p){}
  void verify(Player p,GuildManager.Contract q,Consumer<Boolean> c){c.accept(false);}void abandoned(Player p){}GuildManager.Contract active(Player p){return null;}
  List<Offer> offers(){return List.of(new Offer("tm_fixture"));}GuildManager.Contract offered(String id){return fake(id);}
  Offer find(Player p,String id){return new Offer(id);}String offerState(Offer o,Player p){return "available";}
 }
 record Offer(String id){}
 static class DailyBoard {record Card(String id){GuildManager.Contract contract(){return fake(id);}}
  List<Card> cards(){return List.of(new Card("db_fixture"));}Card card(String id){return id.startsWith("db_")?new Card(id):null;}
  String boardDate(){return "2030-01-01";}String revision(){return "fixture";}
 }
 static GuildManager.Contract fake(String id){return new GuildManager.Contract(id,"fixture","do",Material.STONE,GuildManager.Goal.CRAFT,1,0,0,5,2,Material.BREAD,2);}
 static class EngineeringSites {static Set<GuildManager.Goal> GOALS=Set.of();}
 static class TaskGuidance {static String step(GuildManager.Goal g,String d){return d;}}
 static class VillageGuildCommissions {
  static void command(Player p,String[] a){}static boolean id(String id){return false;}static void accept(Player p,String id){}
 }
 static class DungeonExpeditions {record Site(String id){}static List<Site> SITES=List.of();void travel(Player p,String id){} }
 static class Service {void locations(Player p){}void visit(Player p,String id){}void command(Player p,String[] a){}void traderInfo(Player p){}
  boolean nearTrader(Player p){return false;}void openReceptionMenu(Player p){}void storageInfo(Player p){}void describe(Player p){}void syncSources(){} }
 static class Communication {
  final AgentFriendPlugin plugin;Communication(AgentFriendPlugin p){plugin=p;}
  void taskTransition(Player p,String source,String id,String state,String command){check(plugin.writes>0&&!plugin.unknown);}
 }
 static class AgentFriendPlugin {
  final YamlConfiguration config=new YamlConfiguration();String durable="";boolean fail,unknown;int writes,lessons,successes;
  final java.util.logging.Logger log=java.util.logging.Logger.getLogger("synthetic-life");
  final DungeonManager dungeon=new DungeonManager(this);final Assessments exams=new Assessments();final TaskMarket market=new TaskMarket();final DailyBoard daily=new DailyBoard();
  final GuildManager guild=new GuildManager(this);final LifeGuildManager life=new LifeGuildManager(this);
  YamlConfiguration getConfig(){return config;}GuildManager guild(){return guild;}LifeGuildManager lifeGuild(){return life;}
  Assessments skillAssessments(){return exams;}TaskMarket taskMarket(){return market;}DailyBoard dailyBoard(){return daily;}
  java.util.logging.Logger getLogger(){return log;}void saveConfig(){throw new AssertionError("unexpected separate save");}
  void recordWorldLesson(Player p,String kind){lessons++;}void openLifeGuildMenu(Player p){}void openGuildMenu(Player p){}void guildHallTeleport(Player p){}
  Service lifeBuildings(){return new Service();}Service playerContracts(){return new Service();}Service guildHall(){return new Service();}
  Service trialSharedSupplies(){return new Service();}Service archives(){return new Service();}
  Communication communication(){return new Communication(this);}
 }
 static class LifeGuildManager {
  private static final ZoneId ZONE=ZoneId.of("Asia/Shanghai");
  __DECLARATIONS__
  final AgentFriendPlugin plugin;final DungeonManager dungeon;final Map<UUID,StarterHouseValidator.Result> lastHomes=new HashMap<>();
  private final Map<UUID,Boolean> breadShiftClicks=new HashMap<>();String position(String location){return location;}
  LifeGuildManager(AgentFriendPlugin p){plugin=p;dungeon=p.dungeon;}
  void starter(Player p,Material m,String label){}void board(Player p){}void status(Player p){taskState(p);}void write(Player p,String[] a){}
  void receipt(Player p,String action,Contract c,boolean ok,String reason){if(action.equals("claim")&&ok){check(plugin.durable.contains("completion-receipts"));plugin.successes++;}}
  StarterHouseValidator.Result refreshHouse(Player p){var r=StarterHouseInspection.inspect(p,houseRecords(p));lastHomes.put(p.id,r);return r;}
  __LIFE_METHODS__
  __LIFE_COMMAND__
 }
 static class GuildManager {
  __GOAL__
  __GUILD_RECORD__
  static List<Contract> CONTRACTS=List.of(fake("static_fixture"));final AgentFriendPlugin plugin;final DungeonManager dungeon;
  final DungeonExpeditions expeditions=new DungeonExpeditions();int staticClaims;
  GuildManager(AgentFriendPlugin p){plugin=p;dungeon=p.dungeon;}
  String today(){return LocalDate.now(ZoneId.of("Asia/Shanghai")).toString();}boolean member(Player p){return plugin.config.contains(base(p.id)+".joined");}
  int fame(Player p){return plugin.config.getInt(base(p.id)+".fame");}int reputation(Player p){return fame(p);}int readLegacyRank(Player p){return plugin.config.getInt(base(p.id)+".rituals.certified",fame(p)>=30?2:fame(p)>=10?1:0);}
  boolean expiredDaily(String id){return false;}boolean examBlocks(Player p,String id){return plugin.exams.busy(p);}int effectiveRank(Player p){return 0;}
  Contract contract(String id){return fake(id);}Contract active(Player p){return adventureId(p).isEmpty()?null:fake(adventureId(p));}
  boolean availableToday(Player p,Contract q){return true;}boolean doneToday(Player p,Contract q){return false;}List<Contract> everDoneList(Player p){return List.of();}
  boolean releaseExpiredDaily(Player p){return false;}void claim(Player p){claim(p,()->{});}void claimVerified(Player p){staticClaims++;}
  void join(Player p){plugin.config.set(base(p.id)+".joined",today());}void board(Player p){residentBoard(p,1);}void status(Player p){progressState(p);}
  JsonObject progressState(Player p){var o=lifeActive(p)?plugin.life.taskState(p):new JsonObject();o.addProperty("activeId",activeId(p));o.addProperty("joined",member(p));o.addProperty("completed",plugin.config.getInt(base(p.id)+".completed"));o.addProperty("fame",fame(p));return o;}
  __GUILD_METHODS__
 }
 static String lp(Player p){return "life-guild."+p.id;}static String gp(Player p){return "guild-players."+p.id;}
 static void seed(AgentFriendPlugin a,Player p,String id,int progress){a.config.set(lp(p)+".active.id",id);a.config.set(lp(p)+".active.progress",progress);a.config.set(lp(p)+".active.runId",UUID.randomUUID().toString());}
 static Block block(int i){return new Block("11111111-1111-1111-1111-111111111111:"+i+":64:0",Material.STONE);}
 public static void main(String[] args){
  test("real native craft extraction method counts actions, not preview or duplicate shift batches",()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();seed(a,p,"gourmet_bread",0);a.life.onCraft(new CraftItemEvent(p,false));check(a.life.progress(p)==0);a.life.onCraftExtract(new PlayerStatisticIncrementEvent(p,0,1));check(a.life.progress(p)==1);a.life.onCraft(new CraftItemEvent(p,true));a.life.onCraftExtract(new PlayerStatisticIncrementEvent(p,1,2));a.life.onCraftExtract(new PlayerStatisticIncrementEvent(p,2,3));check(a.life.progress(p)==2);Bukkit.endTick();a.life.onCraftExtract(new PlayerStatisticIncrementEvent(p,3,4));check(a.life.progress(p)==3&&AuraSkillsApi.xpWrites==0);});
  test("craft stats without real extraction/open crafting do not progress",()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();seed(a,p,"gourmet_bread",0);a.life.onCraftExtract(new PlayerStatisticIncrementEvent(p,2,2));p.inventory.top=new Object();a.life.onCraftExtract(new PlayerStatisticIncrementEvent(p,2,3));check(a.life.progress(p)==0&&a.writes==0);});
  test("real MultiPlace/Break methods record shelter without life contract and invalidate strangers",()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player(),q=new Player();a.life.onBuild(new BlockMultiPlaceEvent(p,block(1),block(2)));check(HouseEvidence.allRecords(a,p).size()==2&&a.life.activeId(p).isEmpty());a.life.onBuild(new BlockPlaceEvent(q,block(1)));check(HouseEvidence.allRecords(a,p).size()==1&&HouseEvidence.allRecords(a,q).size()==1);a.life.onHouseBreak(new BlockBreakEvent(p,block(1)));check(HouseEvidence.allRecords(a,q).isEmpty());});
  test("shelter API expiration/survival eligibility controls recording; failed event adds no proof",()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();a.exams.expired=true;a.life.onBuild(new BlockPlaceEvent(p,block(3)));check(HouseEvidence.allRecords(a,p).isEmpty());a.exams.expired=false;p.mode=GameMode.CREATIVE;a.life.onBuild(new BlockPlaceEvent(p,block(4)));check(HouseEvidence.allRecords(a,p).isEmpty());p.mode=GameMode.SURVIVAL;a.fail=true;a.life.onBuild(new BlockPlaceEvent(p,block(5)));check(HouseEvidence.allRecords(a,p).isEmpty()&&a.config.getStringList("house-evidence."+p.id+".placements").isEmpty());});
  test("same UUID/timestamp single source and no legacy exam freshness",()->{
   AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player(),other=new Player();
   check(HouseEvidence.placed(a,p,List.of(block(1)),true));long at=HouseEvidence.decode(a.config.getStringList("house-evidence."+p.id+".placements").get(0)).timestamp();
   check(HouseEvidence.placementsSince(a,p,at).size()==1&&HouseEvidence.placementsSince(a,p,at+1).isEmpty()&&HouseEvidence.placementsSince(a,other,at).isEmpty());
   a.config.set("house-evidence."+other.id+".placements",a.config.getStringList("house-evidence."+p.id+".placements"));check(HouseEvidence.allRecords(a,other).isEmpty());
   a.config.set(lp(p)+".active.house-placed",List.of(block(1).key+"|STONE"));check(HouseEvidence.placementsSince(a,p,0).isEmpty());
  });
  test("repeated placement/multiplace replacement and all-owner break invalidation",()->{
   AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player(),q=new Player();Block b=block(2);
   HouseEvidence.placed(a,p,List.of(b,block(3)),true);HouseEvidence.placed(a,p,List.of(b),true);check(HouseEvidence.allRecords(a,p).size()==2);
   a.config.set(lp(q)+".active.house-placed",List.of(b.key+"|STONE"));HouseEvidence.placed(a,q,List.of(b),true);
   check(HouseEvidence.allRecords(a,p).size()==1&&HouseEvidence.allRecords(a,q).size()==1&&a.config.getStringList(lp(q)+".active.house-placed").isEmpty());
   HouseEvidence.broken(a,b);check(HouseEvidence.allRecords(a,q).isEmpty());HouseEvidence.placed(a,q,List.of(block(3)),false);check(HouseEvidence.allRecords(a,p).isEmpty());
  });
  test("2048 owner bound with latest records",()->{var records=new ArrayList<String>();UUID id=UUID.randomUUID();for(int i=0;i<2050;i++)records.add(new HouseEvidence.Placement(block(i).key,"STONE",id,100+i).encode());
   var out=HouseEvidence.append(records,List.of(new HouseEvidence.Placement(block(2050).key,"STONE",id,9999)));check(out.size()==2048&&HouseEvidence.decode(out.get(0)).position().equals(block(3).key));});
  test("failed placement cannot certify or be accidentally persisted; recovery excludes unsaved proof",()->{
   AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();HouseEvidence.placed(a,p,List.of(block(4)),true);a.fail=true;
   check(!HouseEvidence.placed(a,p,List.of(block(5)),true)&&HouseEvidence.allRecords(a,p).isEmpty());
   check(a.config.getStringList("house-evidence."+p.id+".placements").size()==1);
   HouseEvidence.placed(a,p,List.of(block(6)),false);check(HouseEvidence.allRecords(a,p).size()==1);
   a.unknown=true;check(HouseEvidence.allRecords(a,p).isEmpty());
  });
  test("failed all-owner invalidation fails closed until durable recovery",()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();HouseEvidence.placed(a,p,List.of(block(9)),true);a.fail=true;check(!HouseEvidence.broken(a,block(9))&&!HouseEvidence.available(a));HouseEvidence.placed(a,p,List.of(block(10)),false);check(HouseEvidence.available(a)&&HouseEvidence.allRecords(a,p).isEmpty());});
  test("Aura authority level/xp uses actor UUID and never grants XP",()->{Player p=new Player();var f=FoundationGrowth.skill(p,"fishing");check(AuraSkillsApi.actor.equals(p.id)&&f.get("level").getAsInt()==12&&f.get("xp").getAsDouble()==34.5&&AuraSkillsApi.xpWrites==0);});
  test("partial Aura API failure does not leave a falsely available level",()->{Player p=new Player();AuraSkillsApi.fault=true;try{var row=FoundationGrowth.skill(p,"fishing");check(!row.get("available").getAsBoolean()&&!row.has("level")&&!row.has("xp"));}finally{AuraSkillsApi.fault=false;}});
  test("unloaded disabled and unknown Aura skills are unavailable, never completed zero",()->{Player p=new Player();AuraSkillsApi.loaded=false;check(!FoundationGrowth.skill(p,"fishing").has("level"));AuraSkillsApi.loaded=true;AuraSkillsApi.disabled=true;check(!FoundationGrowth.skill(p,"fishing").get("available").getAsBoolean());AuraSkillsApi.disabled=false;check(!FoundationGrowth.skill(p,"unknown").has("xp"));});
  for(String id:List.of("gourmet_bread","angler_catch","builder_home","author_story","tinkerer_light","trader_supply"))test("guild and life accept single original slot "+id,()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();a.guild.command(p,new String[]{"guild","接单",id});check(a.life.activeId(p).equals(id)&&a.guild.activeId(p).equals(id)&&a.guild.adventureId(p).isEmpty());int writes=a.writes;a.life.command(p,new String[]{"life","accept","author_story"});check(a.writes==writes&&a.life.activeId(p).equals(id));check(a.guild.acceptanceReason(p,"static_fixture").equals("another_contract_active"));});
  test("retired farmer new offer rejected; old farmer completion retained",()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();a.life.command(p,new String[]{"life","accept","farmer_harvest"});check(a.life.activeId(p).isEmpty());seed(a,p,"farmer_harvest",12);a.config.set(lp(p)+".reputation.farmer",50);a.life.claim(p);check(a.guild.fame(p)==3&&a.config.getInt(lp(p)+".reputation.farmer")==50);});
  test("another adventure/exam occupies shared acceptance gate",()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();a.config.set(gp(p)+".active.id","static_fixture");check(a.life.acceptanceReason(p,"author_story").equals("another_contract_active"));a.config.set(gp(p)+".active",null);a.exams.occupied=true;check(a.life.acceptanceReason(p,"builder_home").equals("exam_contract_incompatible"));a.life.accept(p,"builder_home");check(a.life.activeId(p).isEmpty());});
  test("shelter recording does not require a second contract and terminal exams stop",()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();check(a.life.recordingShelter(p)&&a.life.activeId(p).isEmpty());a.exams.state="submitted";check(!a.life.recordingShelter(p));a.exams.state="active";a.exams.exam="survey_basic";check(!a.life.recordingShelter(p));});
  test("unified resident catalogue retains static daily market and all nonretired Life IDs",()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();var board=a.guild.residentBoard(p,1);Set<String> ids=new HashSet<>();for(var row:board.getAsJsonArray("items")){var o=row.getAsJsonObject();ids.add(o.get("id").getAsString());check(o.get("acceptCommand").getAsString().equals("guild accept "+o.get("id").getAsString())&&!o.has("rankPointPreview"));}check(ids.size()==9&&ids.containsAll(List.of("static_fixture","db_fixture","tm_fixture","builder_home","angler_catch","author_story","trader_supply","tinkerer_light","gourmet_bread")));});
  for(String action:List.of("claim","交付","领取"))test("guild claim alias durable original Life settlement "+action,()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();seed(a,p,"author_story",1);a.guild.command(p,new String[]{"guild",action});check(a.guild.fame(p)==4&&a.successes==1&&a.guild.staticClaims==0);});
  for(String action:List.of("abandon","放弃"))test("guild abandon alias clears only Life slot "+action,()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();seed(a,p,"author_story",0);a.guild.command(p,new String[]{"guild",action});check(a.life.activeId(p).isEmpty()&&a.writes==1);});
  for(String action:List.of("verify","验收","status","rank","状态","等级","board","list","看板"))test("guild read/verify alias retains Life slot "+action,()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();seed(a,p,"author_story",0);a.guild.command(p,new String[]{"guild",action});check(a.life.activeId(p).equals("author_story")&&a.writes==0);});
  test("all native/resident canonical aliases",()->{for(String action:List.of("交付","领取","claim"))check(GuildManager.canonicalAction(action).equals("claim"));check(GuildManager.canonicalAction("接单").equals("accept")&&GuildManager.canonicalAction("验收").equals("verify")&&GuildManager.canonicalAction("放弃").equals("abandon")&&GuildManager.canonicalAction("看板").equals("board"));});
  for(String action:List.of("accept","接单","status","状态","verify","验收","claim","交付","领取","abandon","放弃","board","看板"))test("real resident body routes Life alias "+action,()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();String normalized=GuildManager.canonicalAction(action);if(!normalized.equals("accept"))seed(a,p,"author_story",1);JsonObject[] result={null};String[] cmd=normalized.equals("accept")?new String[]{"guild",action,"author_story"}:new String[]{"guild",action};a.guild.residentCommand(p,cmd,o->result[0]=o);check(result[0]!=null&&result[0].get("success").getAsBoolean());if(normalized.equals("claim"))check(a.guild.fame(p)==4&&a.successes==1);});
  test("resident failed durable claim never reports success",()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();seed(a,p,"author_story",1);a.fail=true;JsonObject[] result={null};a.guild.residentCommand(p,new String[]{"guild","claim"},o->result[0]=o);check(!result[0].get("success").getAsBoolean()&&a.successes==0&&a.guild.fame(p)==0&&a.life.activeId(p).equals("author_story"));});
  test("fame rewards skill receipt done clearactive are one commit and retry is idempotent",()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();seed(a,p,"author_story",1);String run=a.config.getString(lp(p)+".active.runId");a.life.claim(p);check(a.writes==1&&a.successes==1&&a.guild.fame(p)==4&&a.config.getInt(gp(p)+".completed")==1&&a.config.getInt(lp(p)+".reputation.author")==4&&a.config.getInt("rewards."+p.id+".emeralds")==2&&a.config.getInt("rewards."+p.id+".giftCount")==1&&a.config.contains(lp(p)+".completion-receipts."+run)&&a.life.activeId(p).isEmpty());a.life.claim(p);check(a.writes==1&&a.successes==1&&a.dungeon.calls==1);});
  for(String id:List.of("farmer_harvest","gourmet_bread","angler_catch","builder_home","author_story","tinkerer_light","trader_supply"))test("each original Life reward amount/completion is unchanged "+id,()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();var c=a.life.byId(id);seed(a,p,id,c.target());if(id.equals("builder_home")){a.config.set(lp(p)+".active.acceptedAt",System.currentTimeMillis());for(int i=0;i<7;i++)a.life.onBuild(new BlockPlaceEvent(p,block(i)));}int before=a.writes;a.life.claim(p);int expectedEmeralds=id.equals("builder_home")||id.equals("tinkerer_light")?3:2;int expectedGifts=switch(id){case "farmer_harvest","tinkerer_light","trader_supply"->4;case "builder_home"->2;default->1;};check(a.successes==1&&a.writes==before+1&&a.config.getInt("rewards."+p.id+".emeralds")==expectedEmeralds&&a.config.getInt("rewards."+p.id+".giftCount")==expectedGifts&&a.guild.fame(p)==c.reputation());});
  test("new acceptance failure rolls back registration and task together",()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();String before=a.config.saveToString();a.fail=true;a.life.accept(p,"author_story");check(a.config.saveToString().equals(before)&&a.life.activeId(p).isEmpty()&&!a.guild.member(p)&&a.writes==0);});
  test("next legal claim preserves old receipts and adds no historical compensation",()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();seed(a,p,"author_story",1);a.config.set(lp(p)+".done.author_story","2000-01-01");a.config.set(lp(p)+".completion-receipts.old.id","author_story");a.config.set(lp(p)+".reputation.author",20);a.config.set(gp(p)+".fame",10);a.life.claim(p);check(a.guild.fame(p)==14&&a.config.getInt(lp(p)+".reputation.author")==24&&a.config.getString(lp(p)+".completion-receipts.old.id").equals("author_story")&&a.config.getInt("rewards."+p.id+".emeralds")==2);});
  test("integer overflow refuses settlement without partial reward or fame",()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();seed(a,p,"author_story",1);a.config.set(lp(p)+".reputation.author",Integer.MAX_VALUE);String before=a.config.saveToString();a.life.claim(p);check(a.config.saveToString().equals(before)&&a.successes==0&&a.writes==0);});
  test("durable failure rolls back ALL staged fields; retry pays once",()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();seed(a,p,"author_story",1);String before=a.config.saveToString();a.fail=true;a.life.claim(p);check(a.config.saveToString().equals(before)&&a.successes==0&&a.lessons==0&&a.writes==0);a.life.claim(p);check(a.successes==1&&a.guild.fame(p)==4&&a.config.getInt("rewards."+p.id+".emeralds")==2&&a.writes==1);});
  test("reward rejection with partial staging restores exact original image",()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();seed(a,p,"author_story",1);String before=a.config.saveToString();a.dungeon.reject=true;a.life.claim(p);check(a.config.saveToString().equals(before)&&a.writes==0&&a.successes==0);});
  test("old today done/receipt cannot pay or backfill fame",()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();seed(a,p,"author_story",1);a.config.set(lp(p)+".done.author_story",a.life.today());a.config.set(lp(p)+".completion-receipts.old.id","author_story");String before=a.config.saveToString();a.life.claim(p);check(a.config.saveToString().equals(before)&&a.guild.fame(p)==0&&a.dungeon.calls==0);});
  test("existing unique run receipt denies cross-day replay",()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();seed(a,p,"author_story",1);String run=a.config.getString(lp(p)+".active.runId");a.config.set(lp(p)+".completion-receipts."+run+".id","author_story");a.life.claim(p);check(a.guild.fame(p)==0&&a.dungeon.calls==0);});
  test("old native grade score/templates retained; no archival currency writes",()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();a.config.set(gp(p)+".fame",29);a.config.set(gp(p)+".rankPoints.points",12);a.config.set(gp(p)+".rankPoints.templates.old",2);seed(a,p,"author_story",1);a.life.claim(p);check(a.guild.readLegacyRank(p)==1&&a.guild.fame(p)==33&&a.config.getInt(gp(p)+".rankPoints.points")==12&&a.config.getInt(gp(p)+".rankPoints.templates.old")==2);a.guild.recordRankPoints(p,fake("test"),GuildRankPoints.preview(0,0,0,8));check(a.config.getInt(gp(p)+".rankPoints.points")==12&&a.guild.rankPointHint(p,fake("test")).isEmpty()&&a.guild.rankPointPreview(p,fake("test"))==null);});
  test("angler retains old reputation without independent XP or levels",()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();seed(a,p,"angler_catch",3);a.config.set(lp(p)+".reputation.angler",55);a.life.claim(p);check(a.guild.fame(p)==3&&a.config.getInt(lp(p)+".reputation.angler")==55&&AuraSkillsApi.xpWrites==0);});
  test("five retained skills original 6/20/50 thresholds",()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();for(int n:List.of(0,6,20,50)){a.config.set(lp(p)+".reputation.author",n);var state=a.life.skillState(p);var row=state.getAsJsonArray("skills").asList().stream().map(JsonElement::getAsJsonObject).filter(o->o.get("id").getAsString().equals("author")).findFirst().orElseThrow();check(row.get("level").getAsInt()==(n==50?3:n==20?2:n==6?1:0));}});
  test("read projections neither cachewrite refresh nor durable save",()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();seed(a,p,"builder_home",0);a.config.set(lp(p)+".active.house-placed",java.util.stream.IntStream.range(0,7).mapToObj(i->block(i).key+"|STONE").toList());String before=a.config.saveToString();for(int i=0;i<3;i++){check(a.life.taskState(p).get("ready").getAsBoolean());a.life.skillState(p);a.life.onboardingState(p);}check(a.config.saveToString().equals(before)&&a.writes==0&&a.life.lastHomes.isEmpty());});
  test("old builder list finishes ordinary contract but new accepted window excludes it",()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();seed(a,p,"builder_home",0);a.config.set(lp(p)+".active.house-placed",java.util.stream.IntStream.range(0,7).mapToObj(i->block(i).key+"|STONE").toList());check(a.life.houseRecords(p).size()==7&&HouseEvidence.placementsSince(a,p,1).isEmpty());a.config.set(lp(p)+".active.acceptedAt",System.currentTimeMillis());check(a.life.houseRecords(p).isEmpty());a.config.set(lp(p)+".active.acceptedAt",null);a.life.claim(p);check(a.guild.fame(p)==4&&a.successes==1);});
  test("advancement dedup and failed action do not notify success",()->{AgentFriendPlugin a=new AgentFriendPlugin();Player p=new Player();seed(a,p,"trader_supply",0);a.fail=true;a.life.advance(p,"trader_supply","profession:farmer");check(a.life.progress(p)==0&&a.writes==0);a.life.advance(p,"trader_supply","profession:farmer");a.life.advance(p,"trader_supply","profession:farmer");check(a.life.progress(p)==1&&a.writes==1);});
  test("delayed lamp event cannot advance a replacement contract run",()->{
   Player p=new Player();AgentFriendPlugin plugin=new AgentFriendPlugin();String active="life-guild."+p.id+".active";
   plugin.config.set(active+".id","tinkerer_light");plugin.config.set(active+".runId","first-run");plugin.config.set(active+".lamp","original-lamp");
   check(plugin.life.sameRun(p,"tinkerer_light","first-run","original-lamp"));
   plugin.config.set(active+".runId","second-run");check(!plugin.life.sameRun(p,"tinkerer_light","first-run","original-lamp"));
   plugin.config.set(active+".runId","first-run");plugin.config.set(active+".lamp","replacement-lamp");check(!plugin.life.sameRun(p,"tinkerer_light","first-run","original-lamp"));
  });
  test("unknown placement commit retains pending image but cannot attest",()->{
   Player p=new Player();AgentFriendPlugin plugin=new AgentFriendPlugin();plugin.unknown=true;plugin.fail=true;
   String key=UUID.randomUUID()+":1:4:1";check(!HouseEvidence.placed(plugin,p,List.of(new Block(key,Material.STONE)),true));
   check(plugin.config.getStringList("house-evidence."+p.id+".placements").size()==1);check(HouseEvidence.allRecords(plugin,p).isEmpty());
  });
  System.out.println("RESULT "+passed+" passed, "+failed+" failed");if(failed>0)System.exit(1);
 }
}
'''
    replacements = {
        "__HOUSE__": body_class(sources["HouseEvidence"]),
        "__FOUNDATION__": method(sources["FoundationGrowth"], "public static JsonObject skill(Player player, String id)"),
        "__DECLARATIONS__": declarations, "__LIFE_METHODS__": life_methods, "__LIFE_COMMAND__": command,
        "__GOAL__": goal, "__GUILD_RECORD__": guild_record, "__GUILD_METHODS__": guild_methods,
    }
    for key, value in replacements.items():
        fixture = fixture.replace(key, value)
    probe = args.output / "LifeTwoTrackProbe.java"
    probe.write_text(fixture, encoding="utf-8")
    archival_test = root / "tests/org/afuhome/agentfriend/GuildRankPointsTest.java"
    subprocess.run([str(javac), "--release", "21", "-proc:none", "-encoding", "UTF-8", "-cp", cp, "-d", str(args.output), str(probe), str(src / "LifeContractSettlement.java"), str(src / "GuildRankPoints.java"), str(archival_test)], check=True)
    subprocess.run([str(java), "-cp", str(args.output) + os.pathsep + cp, "org.afuhome.agentfriend.LifeTwoTrackProbe"], check=True)
    # Execute the untouched historical assertions, not a replacement test invented for retirement.
    subprocess.run([str(java), "-cp", str(args.output) + os.pathsep + cp, "org.afuhome.agentfriend.GuildRankPointsTest"], check=True)
    guards = {
        "native crafting counts real extraction and no recipe-preview completion": "PlayerStatisticIncrementEvent" in method(life, "public void onCraftExtract(") and "advance(" not in method(life, "public void onCraft(CraftItemEvent event)"),
        "native placement/MultiPlace MONITOR ignoreCancelled": "BlockMultiPlaceEvent" in method(life, "public void onBuild(BlockPlaceEvent event)") and bool(re.search(r'@EventHandler\(priority = EventPriority.MONITOR, ignoreCancelled = true\)\s+public void onBuild', life)),
        "Life completion never supplies shelter certificate proof": ".proof(" not in method(life, "private void claim(Player player)"),
        "Aura reads never award/transfer historical XP": not re.search(r'\b(?:add|set|give|apply)(?:Skill)?(?:Xp|XP|Experience)\s*\(', sources["FoundationGrowth"] + life),
        "guild progress and resident UI no extra scoring": "rankPointPreview(" not in method(guild, "com.google.gson.JsonObject progressState(Player p)") and "rankPointPreview(" not in method(guild, "private com.google.gson.JsonObject residentBoard(Player player,int page)"),
        "legacy scoring pure/static assertions are unchanged": "Math.min(cap, 2 * (int) delivered.stream()" in sources["GuildRankPoints"],
        "journal life projection no save/cache refresh": all(not re.search(r'\b(?:set|saveConfig|refreshHouse|put)\s*\(', method(life, s)) for s in ("JsonObject taskState(Player player)", "JsonObject skillState(Player player)")),
    }
    for name, ok in guards.items():
        print(("PASS " if ok else "FAIL ") + name)
    if not all(guards.values()):
        raise SystemExit(1)
    print(f"SOURCE GUARDS {len(guards)} passed; owned production sources compile against baseline")


if __name__ == "__main__":
    main()
