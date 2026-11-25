"""Execute the real completion/lifecycle method bodies with synthetic storage and players.

No server connection, player data or reward commands are used. The fixture replaces
external Bukkit/storage boundaries, not the completion control flow under test.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


# Keep braces in Java strings/comments out of method-body depth (as in the two-track runner).
def method(source, signature):
    start = source.index(signature)
    brace = source.index("{", start)
    i, depth, state = brace, 0, "code"
    while i < len(source):
        ch, following = source[i], source[i:i + 2]
        if state == "code":
            if following in ("//", "/*"):
                state = "line" if following == "//" else "comment"
                i += 2
                continue
            if ch in ('"', "'"):
                state = ch
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return source[start:i + 1]
        elif state == "line":
            if ch == "\n":
                state = "code"
        elif state == "comment":
            if following == "*/":
                state = "code"
                i += 2
                continue
        elif ch == "\\":
            i += 2
            continue
        elif ch == state:
            state = "code"
        i += 1
    raise ValueError("Unclosed method: " + signature)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--jdk", type=Path, required=True)
    parser.add_argument("--source-root", type=Path, help="AgentFriend root of an older revision for the same regression")
    args = parser.parse_args()
    root = (args.source_root or Path(__file__).resolve().parents[1]).resolve()
    src = root / "src/org/afuhome/agentfriend"
    inputs = [src / (name + ".java") for name in ("SiteDungeonManager", "SkillAssessments", "AgentFriendPlugin")]
    site, exams, plugin = [path.read_text(encoding="utf-8") for path in inputs]
    policy_source = src / "ExamLifecyclePolicy.java"
    two_track = policy_source.is_file()
    if two_track:
        inputs.append(policy_source)
    copy_signature = "private static Run copy(Run r)"
    copy_body = method(exams, copy_signature) if copy_signature in exams else ""
    ally_copy = method(exams, "Ally(Ally a)") if copy_body else ""
    if "copy(" in method(exams, "public void teleport(PlayerTeleportEvent e)") and not copy_body:
        raise ValueError("Teleport requires the actual Run copy body")
    native = method(plugin, "void nativeSiteCompleted(Player p,String site,String run)")
    complete = method(site, "private void complete(Run r)")
    if "siteRewardSlot(" in complete:
        inputs.append(src / "SiteRewardPolicy.java")
        policy = inputs[-1].read_text(encoding="utf-8")
        complete += "\n" + method(site, "private String siteRewardSlot(")
        rules = method(policy, "static String status(")
        if "SiteRewardPolicy.relicEligible(" in complete:
            rules += method(policy, "static boolean relicEligible(")
        complete += "\nstatic class SiteRewardPolicy {" + rules + "}"
    eligibility_signature = "private boolean rewardEligible(Run r, UUID id)"
    eligibility = method(site, eligibility_signature) if eligibility_signature in site else ""
    guidance = method(site, "private static void outcomeGuidance(Map<String,Object> data)") if "private static void outcomeGuidance(Map<String,Object> data)" in site else "private static void outcomeGuidance(Map<String,Object> data){}"
    durable = method(exams, "private static boolean durableSurvey(Run r)")
    durable += "\n" + (method(exams, "private static boolean durableRecord(Run r)") if "private static boolean durableRecord(Run r)" in exams else "private static boolean durableRecord(Run r){return durableSurvey(r);}")
    proof = method(exams, "void siteCompleted(Player p,String site,String run,long startedAt)") if "void siteCompleted(Player p,String site,String run,long startedAt)" in exams else "void siteCompleted(Player p,String site,String run,long startedAt){throw new AssertionError(\"missing fresh completion boundary\");}"
    lifecycle_signatures = ("public void teleport(PlayerTeleportEvent e)", "public void quit(PlayerQuitEvent e)", "void shutdown()")
    lifecycle = "\n".join(method(exams, signature) for signature in lifecycle_signatures)
    template = r'''
package org.afuhome.agentfriend;
import java.util.*;
public class ExamCompletionProbe {
 static int passed,failed;
 static void test(String label,Runnable action){try{action.run();passed++;System.out.println("PASS "+label);}catch(Throwable t){failed++;System.out.println("FAIL "+label+": "+t.getMessage());}}
 static void check(boolean b){if(!b)throw new AssertionError("unexpected result");}
 static class Player { final UUID id=UUID.randomUUID(); public void sendMessage(String m){} public UUID getUniqueId(){return id;} }
 static class Bukkit { static final Map<UUID,Player> players=new HashMap<>();static Player getPlayer(UUID id){return players.get(id);} }
 static class ResidentCli { static final Map<UUID,Player> residents=new HashMap<>();static Player find(UUID id){Player player=Bukkit.getPlayer(id);return player!=null?player:residents.get(id);} }
 static record Definition(String primitive,List<String> proofs){}
 // Bounded snapshot models, not trajectory decisions or a live Gson/storage implementation.
 static class JsonObject extends LinkedHashMap<String,Object> {
  JsonObject deepCopy(){JsonObject n=new JsonObject();forEach((k,v)->n.put(k,v instanceof JsonObject o?o.deepCopy():v));return n;}
 }
 static class Trajectory {
  int checkpoint,samples;JsonObject verified=new JsonObject();
  Trajectory copy(){Trajectory n=new Trajectory();n.checkpoint=checkpoint;n.samples=samples;n.verified=verified.deepCopy();return n;}
 }
 static record Point(double x,double y,double z){}
 static class Ally {
  final UUID id,world;final Point start;Point previous;long sampled,until;double movement;boolean resistance;
  Ally(UUID id){this.id=id;world=UUID.randomUUID();start=new Point(1,2,3);previous=start;sampled=200;until=900;movement=4;resistance=true;}
  __ALLY_COPY__
 }
 static class Exam {
  static class Run {
   Definition definition;Object grade;String market="",state="active",reason="",castSkill="",lease="";UUID id=UUID.randomUUID();
   long started=100,castAt,expires=Long.MAX_VALUE;int castLevel,rankRulesVersion,checkpoint;double combatSupport;
   Trajectory trajectory;JsonObject proofs=new JsonObject(),savedMeasurements=new JsonObject();final Map<UUID,Ally> allies=new LinkedHashMap<>();
  }
  Run active;int count;String evidence;
  Run current(Player p){return active;}
  void proof(Player p,String kind,String evidence){if(!active.state.equals("active")||!active.definition.proofs().contains(kind))return;count++;this.evidence=evidence;active.state="ready";}
  __DURABLE__
  __PROOF__
 }
 static class PlayerTeleportEvent {Player p;PlayerTeleportEvent(Player p){this.p=p;}Player getPlayer(){return p;}}
 static class PlayerQuitEvent {Player p;PlayerQuitEvent(Player p){this.p=p;}Player getPlayer(){return p;}}
 static class Lifecycle {
  static class Run extends Exam.Run {}
  record Menu(UUID owner){}
  static class Task {boolean cancelled;void cancel(){cancelled=true;}}
  Map<UUID,Run> runs=new HashMap<>(),saved=new HashMap<>();Map<UUID,Menu> menus=new HashMap<>();Task task=new Task();
  boolean failSave;int saveAttempts;
  void interrupt(Player p,Run r,String why){if(r.state.equals("active")){r.state="interrupted";r.reason=why;save(p,r);}}
  // Synthetic commit/failure boundary: publish the candidate only after a successful save.
  // The handler, durable decisions and Run/Ally copying below remain extracted production bodies.
  boolean save(Player p,Run r){saveAttempts++;if(failSave)return false;saved.put(p.id,r);runs.put(p.id,r);return true;}
  __COPY__
  __DURABLE__
  __LIFECYCLE__
 }
 static class Receipt extends HashMap<String,Object> {
  Receipt(Map<String,Object> values){super(values);}
  String getString(String key,String fallback){return (String)getOrDefault(key,fallback);}
  void set(String key,Object value){put(key,value);}
 }
 static class Config {
  Map<String,String> values=new HashMap<>();Map<String,Map<String,Object>> receipts=new HashMap<>();int writes;
  String getString(String k){return values.get(k);}void set(String k,Object v){values.put(k,String.valueOf(v));}
  Receipt createSection(String k,Map<String,Object> v){var receipt=new Receipt(v);receipts.put(k,receipt);writes++;return receipt;}
 }
 static class Native {boolean circleEnabled;boolean selected(){return true;}boolean healingCircleEnabled(){return circleEnabled;}void siteCompleted(Player p,String site,String run){}}
 static class Plugin {Config config=new Config();Exam exams=new Exam(),skillAssessments=exams;Native nativeRpg=new Native();Config getConfig(){return config;}Exam skillAssessments(){return exams;}Native nativeRpg(){return nativeRpg;}boolean nativeRpgSelected(){return true;} __NATIVE__ }
 static class Site {String id="synthetic_crypt",name="Synthetic";List<String> rooms=List.of("one","two","three");int conquestFloor=0,emeralds=8,bonusCount=1;Bonus bonus=new Bonus();}
 static class Bonus {String name(){return "STONE";}}
 enum Mode {NORMAL;int reward=1;}
 static class BlackBannerCamp {static final String SITE="illager_camp";}
 static class DungeonRelics {
  record Relic(String name){}
  static Relic at(String site){return site.equals("synthetic_relic")?new Relic("Synthetic relic"):null;}
  static String create(Relic relic,int tier,java.util.concurrent.ThreadLocalRandom rng){return relic.name();}
 }
 static class BeaconExpedition {
  static final int BRIEFING=0,CAMP=3,STAGES=6;
  record Progress(int additionalMaterials){int rewardCount(int base){return base+additionalMaterials;}}
 }
 static class Run {String id=UUID.randomUUID().toString();Site site=new Site();long started=200;int stage=3;boolean altarTactics;BeaconExpedition.Progress beacon;Mode mode=Mode.NORMAL;Map<UUID,Integer> attendance=new LinkedHashMap<>();Map<Integer,Set<UUID>> roomAttendance=new HashMap<>();int stages(){return beacon==null?site.rooms.size():6;}}
 static class Manager {
  static final String ROOT="site-dungeons";Plugin plugin=new Plugin();int ends,applications,announcements;
  // This fixture exercises legacy receipt/exam completion. Authored outdoor/wave dispatch is
  // executed by run_outdoor_camp_tests; never silently take that branch in these legacy cases.
  boolean wildCamp(Site site){return false;}boolean sameArena(Site site){return false;}
  void completeCamp(Run r){throw new AssertionError("legacy exam fixture entered authored combat branch");}
  String day(){return "2030-01-01";}Receipt receipt(UUID id,String site){var data=plugin.config.receipts.get(ROOT+".receipts."+id+"."+site);return data==null?null:new Receipt(data);}
  boolean relicClaimed(UUID id,String site){return plugin.config.values.containsKey("relic/"+id+"/"+site);}
  static String circleProof(UUID id){return ROOT+".healing-circle-proofs."+id;}boolean circleReward(UUID id){return plugin.config.values.containsKey(circleProof(id));}
  void announceCircleReward(Player p,Run r){check(circleReward(p.getUniqueId())&&ends>0);announcements++;}
  void atomic(Runnable work){work.run();}void applyCompletion(Player p,String id,Object saved){applications++;plugin.nativeSiteCompleted(p,id,(String)((Map<?,?>)saved).get("run"));}
  void end(Run run,String reason){check(reason.equals("completed"));ends++;}
  List<String> missingRooms(Run r,UUID id){List<String> out=new ArrayList<>();for(int i=0;i<r.stage;i++)if(r.roomAttendance.containsKey(i)&&!r.roomAttendance.get(i).contains(id))out.add("missing");return out;}
  List<String> unverifiedRooms(Run r){List<String> out=new ArrayList<>();for(int i=0;i<r.stage;i++)if(!r.roomAttendance.containsKey(i))out.add("unknown");return out;}
  __COMPLETE__
  __REWARD_ELIGIBILITY__
  __GUIDANCE__
 }
 static Exam.Run exam(String primitive,String... proofs){Exam.Run r=new Exam.Run();r.definition=new Definition(primitive,List.of(proofs));return r;}
 static Run run(Player p){Run r=new Run();r.attendance.put(p.id,3);for(int i=0;i<3;i++)r.roomAttendance.put(i,Set.of(p.id));return r;}
 static Manager manager(Player p){Bukkit.players.put(p.id,p);Manager m=new Manager();m.plugin.exams.active=exam("contract_record","native_clear");return m;}
 __COPY_HELPERS__
 public static void main(String[] ignored){
  test("native resident completion uses own identity without a Bukkit player connection",()->{Player p=new Player();Manager m=manager(p);Bukkit.players.remove(p.id);ResidentCli.residents.put(p.id,p);Run r=run(p);m.complete(r);check(m.plugin.exams.count==1&&m.plugin.config.writes==1&&m.applications==1&&Bukkit.getPlayer(p.id)==null);m.complete(r);check(m.plugin.config.writes==1);ResidentCli.residents.remove(p.id);});
  test("daily reward cap does not swallow fresh full-clear evidence",()->{Player p=new Player();Manager m=manager(p);Run r=run(p);m.plugin.config.values.put(Manager.ROOT+".claimed."+p.id+"."+r.site.id,m.day());m.complete(r);check(m.plugin.exams.count==1&&m.plugin.config.writes==0&&m.applications==0&&m.ends==1);});
  if(__HAS_CIRCLE__)test("altar learning proof survives the daily loot cap and is issued once",()->{
   Player p=new Player();Manager m=manager(p);Run r=run(p);r.altarTactics=true;m.plugin.nativeRpg.circleEnabled=true;
   m.plugin.config.values.put(Manager.ROOT+".claimed."+p.id+"."+r.site.id,m.day());
   m.complete(r);m.complete(r);
   check(r.id.equals(m.plugin.config.values.get(Manager.circleProof(p.id)))&&m.announcements==1&&m.plugin.config.writes==0&&m.applications==0);
  });
  test("first clear creates one reward and evidence",()->{Player p=new Player();Manager m=manager(p);Run r=run(p);m.complete(r);check(m.plugin.config.writes==1&&m.applications==1&&m.plugin.exams.count==1);m.complete(r);check(m.plugin.config.writes==1&&m.plugin.exams.count==1);});
  if(__HAS_RELIC__)test("first boss relic has its own durable slot even after the ordinary daily cap",()->{
   Player p=new Player();Manager m=manager(p);Run r=run(p);r.site.id="synthetic_relic";
   m.plugin.config.values.put(Manager.ROOT+".claimed."+p.id+"."+r.site.id,m.day());
   m.complete(r);m.complete(r);
   Receipt receipt=m.receipt(p.id,r.site.id);
   check(m.plugin.config.writes==1&&Boolean.TRUE.equals(receipt.get("relic-only"))&&"Synthetic relic".equals(receipt.get("relic")));
   check(Integer.valueOf(0).equals(receipt.get("emeralds")));
  });
  test("pending older reward does not swallow new examination",()->{Player p=new Player();Manager m=manager(p);Run r=run(p);m.plugin.config.receipts.put(Manager.ROOT+".receipts."+p.id+"."+r.site.id,Map.of("run","older"));m.complete(r);check(m.plugin.config.writes==0&&m.plugin.exams.count==1);});
  test("claiming an older reward cannot certify a new exam",()->{Player p=new Player();Manager m=manager(p);m.applyCompletion(p,"synthetic_crypt",Map.of("run","previous"));check(m.plugin.exams.count==0);});
  test("partial participation still gets original reward but no full-clear certificate",()->{Player p=new Player();Manager m=manager(p);Run r=run(p);r.roomAttendance.put(0,Set.of());r.attendance.put(p.id,2);m.complete(r);check(m.plugin.config.writes==1&&m.plugin.exams.count==0);});
  test("unknown room attendance cannot certify",()->{Player p=new Player();Manager m=manager(p);Run r=run(p);r.roomAttendance.remove(0);m.complete(r);check(m.plugin.exams.count==0);});
  test("bystander cannot certify or receive rewards",()->{Player p=new Player();Manager m=manager(p);Run r=run(p);r.attendance.put(p.id,0);m.complete(r);check(m.plugin.config.writes==0&&m.plugin.exams.count==0);});
  test("old dungeon start cannot satisfy a later exam",()->{Player p=new Player();Manager m=manager(p);Run r=run(p);r.started=50;m.complete(r);check(m.plugin.config.writes==1&&m.plugin.exams.count==0);});
  test("expired exam cannot gain proof",()->{Player p=new Player();Manager m=manager(p);m.plugin.exams.active.expires=1;m.complete(run(p));check(m.plugin.exams.count==0);});
  __BEACON_CASES__
  test("unknown start is rejected",()->{Player p=new Player();Manager m=manager(p);Run r=run(p);r.started=0;m.complete(r);check(m.plugin.exams.count==0);});
  for(String state:List.of("cancelled","interrupted","submitted","ready"))test("terminal exam stays "+state,()->{Player p=new Player();Manager m=manager(p);m.plugin.exams.active.state=state;m.complete(run(p));check(m.plugin.exams.count==0&&m.plugin.exams.active.state.equals(state));});
  test("survey is transport durable",()->check(Exam.durableRecord(exam("contract_record","survey"))));
  test("conquest is transport durable",()->check(Exam.durableRecord(exam("contract_record","native_clear"))));
  for(String kind:List.of("flight_route","support_route","leap_route"))test(kind+" remains interruptible",()->check(!Exam.durableRecord(exam(kind,"native_clear"))));
  test("native lesson durability follows source revision",()->check(Exam.durableRecord(exam("native_lesson","native_clear"))==__TWO_TRACK__));
  test("unrelated contract durability follows source revision",()->check(Exam.durableRecord(exam("contract_record","project"))==__TWO_TRACK__));
  test("old daily-limit outcome gains accurate guidance without changing facts",()->{
   Map<String,Object> data=new LinkedHashMap<>(Map.of("id","synthetic_crypt","reason","completed","rewardStatus","daily_limit","run","historic","attendance",3,"nextAction","本场仍在进行时可回到遗迹自动续接"));
   Manager.outcomeGuidance(data);check(data.get("nextAction").toString().contains("无需返回首室"));check(data.get("nextCommands").equals(List.of("/mycli guild exam status","/mycli dungeon info synthetic_crypt")));check(data.get("run").equals("historic")&&data.get("attendance").equals(3)&&data.get("rewardStatus").equals("daily_limit"));
  });
  test("incomplete outcome does not imply a successful examination",()->{
   Map<String,Object> data=new LinkedHashMap<>(Map.of("id","synthetic_crypt","reason","time_limit","rewardStatus","daily_limit"));Manager.outcomeGuidance(data);check(data.get("nextAction")!=null&&!data.get("nextAction").toString().contains("本场已通关"));
  });
  for(String reward:List.of("ready","claimed"))test("existing reward guidance preserved "+reward,()->{Map<String,Object> data=new HashMap<>(Map.of("id","synthetic_crypt","rewardStatus",reward));Manager.outcomeGuidance(data);check(data.get("nextCommands").equals(reward.equals("ready")?List.of("/mycli dungeon claim synthetic_crypt"):List.of("/mycli arena rewards","/mycli arena stash")));});
  test("malformed historical site cannot become a command",()->{Map<String,Object> data=new HashMap<>(Map.of("id","bad\ncommand","rewardStatus","ready"));Manager.outcomeGuidance(data);check(data.get("nextCommands").equals(List.of("/mycli dungeon list")));});
  for(Definition definition:List.of(new Definition("contract_record",List.of("native_clear")),new Definition("contract_record",List.of("survey")),new Definition("contract_record",List.of("project")),new Definition("native_lesson",List.of("native_clear")),new Definition("flight_route",List.of("native_clear")),new Definition("support_route",List.of("native_clear")),new Definition("leap_route",List.of("native_clear"))))
  for(String event:List.of("teleport","quit","shutdown"))test(definition.primitive()+"/"+definition.proofs().getFirst()+" actual handler "+event,()->{
   Player p=new Player();Bukkit.players.put(p.id,p);Lifecycle l=new Lifecycle();Lifecycle.Run r=new Lifecycle.Run();r.definition=definition;r.reason="awaiting_proof";r.proofs.put("retained","prior evidence");l.save(p,r);l.menus.put(p.id,new Lifecycle.Menu(p.id));
   UUID id=r.id;long started=r.started,expires=r.expires;
   boolean durable=definition.primitive().equals("contract_record")&&(__TWO_TRACK__||definition.proofs().contains("native_clear")||definition.proofs().contains("survey"))||__TWO_TRACK__&&definition.primitive().equals("native_lesson");
   switch(event){case "teleport"->l.teleport(new PlayerTeleportEvent(p));case "quit"->l.quit(new PlayerQuitEvent(p));case "shutdown"->l.shutdown();}
   Lifecycle.Run saved=l.saved.get(p.id);
   check(saved.state.equals(durable?"active":"interrupted")&&r.state.equals(saved.state));
   check(saved.reason.equals(durable?"awaiting_proof":event.equals("quit")?"logout":event.equals("shutdown")?"server_restart":"teleport"));
   check(saved.id.equals(id)&&saved.started==started&&saved.expires==expires&&saved.proofs.get("retained").equals("prior evidence"));
   check(r.id.equals(id)&&r.started==started&&r.expires==expires&&l.saveAttempts==(durable?1:2));
   check(event.equals("quit")?!l.runs.containsKey(p.id):l.runs.get(p.id)==saved);
   check(l.menus.containsKey(p.id)==event.equals("teleport")&&l.task.cancelled==event.equals("shutdown"));
  });
  __COPY_CASES__
  System.out.println("RESULT passed="+passed+" failed="+failed);if(failed>0)System.exit(1);
 }
}
'''
    beacon_cases = r'''
  test("chapter briefing and camp attendance alone cannot grant a reward",()->{
   Player p=new Player();Manager m=manager(p);Run r=new Run();r.beacon=new BeaconExpedition.Progress(2);r.stage=r.stages();
   r.attendance.put(p.id,2);r.roomAttendance.put(0,Set.of(p.id));r.roomAttendance.put(3,Set.of(p.id));
   m.complete(r);check(m.plugin.config.writes==0&&m.plugin.exams.count==0);
  });
  test("chapter combat attendance uses actual last stage and bound material value",()->{
   Player p=new Player();Manager m=manager(p);Run r=new Run();r.beacon=new BeaconExpedition.Progress(2);r.stage=r.stages();
   r.attendance.put(p.id,1);r.roomAttendance.put(5,Set.of(p.id));m.complete(r);
   var receipt=m.plugin.config.receipts.values().iterator().next();
   check(receipt.get("bossParticipant").equals(true)&&receipt.get("count").equals(3)&&m.plugin.exams.count==0);
  });
''' if eligibility else ""
    copy_helpers = r'''
 static JsonObject nested(Exam.Run r){return (JsonObject)r.proofs.get("nested");}
 static Lifecycle.Run snapshotRun(){
  Lifecycle.Run r=new Lifecycle.Run();r.definition=new Definition("support_route",List.of("support_move"));r.grade="frozen grade";r.market="step-token";
  r.reason="support_observing";r.castSkill="blessing";r.lease="paid-lease";r.castAt=150;r.castLevel=3;r.rankRulesVersion=1;r.combatSupport=6;r.checkpoint=2;
  JsonObject proof=new JsonObject();proof.put("value","witness");r.proofs.put("nested",proof);r.savedMeasurements.put("nested",proof.deepCopy());
  r.trajectory=new Trajectory();r.trajectory.checkpoint=2;r.trajectory.samples=8;r.trajectory.verified=proof.deepCopy();return r;
 }
 static void sameSnapshot(Exam.Run n,Exam.Run r){
  check(n.id.equals(r.id)&&n.definition==r.definition&&n.grade==r.grade&&n.market.equals(r.market)&&n.state.equals(r.state)&&n.reason.equals(r.reason));
  check(n.started==r.started&&n.expires==r.expires&&n.castAt==r.castAt&&n.castLevel==r.castLevel&&n.rankRulesVersion==r.rankRulesVersion&&n.castSkill.equals(r.castSkill)&&n.lease.equals(r.lease)&&n.combatSupport==r.combatSupport&&n.checkpoint==r.checkpoint);
  check(n.proofs.equals(r.proofs)&&n.savedMeasurements.equals(r.savedMeasurements));
  check(n.trajectory!=r.trajectory&&n.trajectory.checkpoint==r.trajectory.checkpoint&&n.trajectory.samples==r.trajectory.samples&&n.trajectory.verified.equals(r.trajectory.verified));
 }
 static void sameAlly(Ally n,Ally a){check(n!=a&&n.id.equals(a.id)&&n.world.equals(a.world)&&n.start.equals(a.start)&&n.previous.equals(a.previous)&&n.sampled==a.sampled&&n.until==a.until&&n.movement==a.movement&&n.resistance==a.resistance);}
''' if copy_body else ""
    copy_cases = r'''
  test("actual Run copy preserves scalars and isolates nested snapshots and allies",()->{
   check(Lifecycle.copy(null)==null);Lifecycle.Run r=snapshotRun();UUID ally=UUID.randomUUID();r.allies.put(ally,new Ally(ally));Lifecycle.Run n=Lifecycle.copy(r);
   check(n!=r&&n.allies!=r.allies&&n.allies.keySet().equals(r.allies.keySet()));sameSnapshot(n,r);sameAlly(n.allies.get(ally),r.allies.get(ally));
   check(n.proofs!=r.proofs&&nested(n)!=nested(r)&&n.savedMeasurements!=r.savedMeasurements&&n.savedMeasurements.get("nested")!=r.savedMeasurements.get("nested"));
   check(n.trajectory.verified!=r.trajectory.verified);
   n.allies.get(ally).movement=99;nested(n).put("value","changed");((JsonObject)n.savedMeasurements.get("nested")).put("value","changed");n.trajectory.verified.put("value","changed");n.trajectory.checkpoint=9;
   check(r.allies.get(ally).movement==4&&nested(r).get("value").equals("witness")&&((JsonObject)r.savedMeasurements.get("nested")).get("value").equals("witness")&&r.trajectory.verified.get("value").equals("witness")&&r.trajectory.checkpoint==2);
  });
  for(String mode:List.of("success","failed_save","offline_caster"))test("actual ally teleport copy-on-write "+mode,()->{
   Player caster=new Player(),traveler=new Player(),remaining=new Player();Bukkit.players.put(caster.id,caster);Lifecycle l=new Lifecycle();Lifecycle.Run r=snapshotRun();
   r.allies.put(traveler.id,new Ally(traveler.id));r.allies.put(remaining.id,new Ally(remaining.id));l.save(caster,r);int attempts=l.saveAttempts;
   l.failSave=mode.equals("failed_save");if(mode.equals("offline_caster"))Bukkit.players.remove(caster.id);
   l.teleport(new PlayerTeleportEvent(traveler));Lifecycle.Run saved=l.saved.get(caster.id);
   check(r.allies.containsKey(traveler.id)&&r.allies.size()==2&&r.state.equals("active"));
   check(l.saveAttempts==attempts+(mode.equals("offline_caster")?0:1)&&l.runs.get(caster.id)==saved);
   if(mode.equals("success")){
    check(saved!=r&&!saved.allies.containsKey(traveler.id)&&saved.allies.size()==1);sameSnapshot(saved,r);sameAlly(saved.allies.get(remaining.id),r.allies.get(remaining.id));
    nested(saved).put("value","changed");saved.allies.get(remaining.id).movement=99;saved.trajectory.verified.put("value","changed");
    check(nested(r).get("value").equals("witness")&&r.allies.get(remaining.id).movement==4&&r.trajectory.verified.get("value").equals("witness"));
   }else check(saved==r&&saved.allies.containsKey(traveler.id)&&nested(saved).get("value").equals("witness"));
  });
''' if copy_body else ""
    generated = template.replace("__COMPLETE__", complete).replace("__DURABLE__", durable).replace("__PROOF__", proof).replace("__NATIVE__", native).replace("__LIFECYCLE__", lifecycle).replace("__GUIDANCE__", guidance)
    generated = generated.replace("__TWO_TRACK__", str(two_track).lower()).replace("__COPY__", copy_body).replace("__ALLY_COPY__", ally_copy)
    generated = generated.replace("__COPY_HELPERS__", copy_helpers).replace("__COPY_CASES__", copy_cases)
    generated = generated.replace("__HAS_CIRCLE__", str("grantCircle" in complete).lower())
    generated = generated.replace("__HAS_RELIC__", str("SiteRewardPolicy.relicEligible(" in complete).lower())
    generated=generated.replace("__REWARD_ELIGIBILITY__",eligibility).replace("__BEACON_CASES__",beacon_cases)
    output = args.output.resolve()
    if not output.parent.is_dir():
        raise ValueError("Output parent must already exist")
    output.mkdir(exist_ok=False)
    source = output / "ExamCompletionProbe.java"
    source.write_text(generated, encoding="utf-8")
    signatures = ["private static boolean durableSurvey(Run r)", *lifecycle_signatures]
    if "private static boolean durableRecord(Run r)" in exams:
        signatures.append("private static boolean durableRecord(Run r)")
    if copy_body:
        signatures += [copy_signature, "Ally(Ally a)"]
    manifest = {"sourceRoot": str(root), "twoTrackPolicy": two_track,
                "productionHashes": {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in inputs},
                "methods": [{"signature": signature, "line": exams.count("\n", 0, exams.index(signature)) + 1,
                             "sha256": hashlib.sha256(method(exams, signature).encode()).hexdigest()} for signature in signatures],
                "externalBoundaries": ["synthetic Bukkit players and storage commit/failure",
                                       "synthetic interrupt/proof and reward services (not production persistence)",
                                       "bounded trajectory/JSON snapshot models with deep object copies"],
                "uncovered": ["live server events", "production ledger/filesystem atomicity", "trajectory movement decisions"]}
    (output / "method-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    suffix = ".exe" if os.name == "nt" else ""
    sources = [source, *([policy_source] if two_track else [])]
    compile_command = [str(args.jdk / "bin" / ("javac" + suffix)), "-proc:none", "--release", "21", "-encoding", "UTF-8", "-d", str(output), *map(str, sources)]
    compiled = subprocess.run(compile_command, capture_output=True, text=True, encoding="utf-8", errors="replace")
    compile_log = compiled.stdout + compiled.stderr
    (output / "compile.log").write_text(compile_log, encoding="utf-8")
    summary = {"sourceRoot": str(root), "twoTrackPolicy": two_track,
               "compile": {"command": compile_command, "exit": compiled.returncode}, "run": None}
    if compiled.returncode:
        print(compile_log, end="")
        (output / "results.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
        raise SystemExit(compiled.returncode)
    command = [str(args.jdk / "bin" / ("java" + suffix)), "-Dfile.encoding=UTF-8", "-cp", str(output), "org.afuhome.agentfriend.ExamCompletionProbe"]
    result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
    text = result.stdout + result.stderr
    (output / "run.log").write_text(text, encoding="utf-8")
    print(text, end="")
    count = re.search(r"RESULT passed=(\d+) failed=(\d+)", text)
    summary["run"] = {"command": command, "exit": result.returncode, "resultPresent": bool(count),
                      "passed": int(count[1]) if count else None, "failed": int(count[2]) if count else None,
                      "checks": [line for line in text.splitlines() if line.startswith(("PASS ", "FAIL "))]}
    (output / "results.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    raise SystemExit(result.returncode or int(not count or int(count[2]) > 0))


if __name__ == "__main__":
    main()
