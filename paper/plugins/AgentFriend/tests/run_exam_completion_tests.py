"""Execute the real completion/lifecycle method bodies with synthetic storage and players.

No server connection, player data or reward commands are used. The fixture replaces
external Bukkit/storage boundaries, not the completion control flow under test.
"""
import argparse
import os
from pathlib import Path
import subprocess


def method(source, signature):
    start = source.index(signature)
    brace = source.index("{", start)
    depth = 1
    end = brace + 1
    while depth:
        depth += (source[end] == "{") - (source[end] == "}")
        end += 1
    return source[start:end]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--jdk", type=Path, required=True)
    parser.add_argument("--source-root", type=Path, help="AgentFriend root of an older revision for the same regression")
    args = parser.parse_args()
    root = args.source_root or Path(__file__).resolve().parents[1]
    site = (root / "src/org/afuhome/agentfriend/SiteDungeonManager.java").read_text(encoding="utf-8")
    exams = (root / "src/org/afuhome/agentfriend/SkillAssessments.java").read_text(encoding="utf-8")
    plugin = (root / "src/org/afuhome/agentfriend/AgentFriendPlugin.java").read_text(encoding="utf-8")
    native = method(plugin, "void nativeSiteCompleted(Player p,String site,String run)")
    complete = method(site, "private void complete(Run r)")
    guidance = method(site, "private static void outcomeGuidance(Map<String,Object> data)") if "private static void outcomeGuidance(Map<String,Object> data)" in site else "private static void outcomeGuidance(Map<String,Object> data){}"
    durable = method(exams, "private static boolean durableSurvey(Run r)")
    durable += "\n" + (method(exams, "private static boolean durableRecord(Run r)") if "private static boolean durableRecord(Run r)" in exams else "private static boolean durableRecord(Run r){return durableSurvey(r);}")
    proof = method(exams, "void siteCompleted(Player p,String site,String run,long startedAt)") if "void siteCompleted(Player p,String site,String run,long startedAt)" in exams else "void siteCompleted(Player p,String site,String run,long startedAt){throw new AssertionError(\"missing fresh completion boundary\");}"
    lifecycle = "\n".join(method(exams, signature) for signature in (
        "public void teleport(PlayerTeleportEvent e)", "public void quit(PlayerQuitEvent e)", "void shutdown()"))
    template = r'''
import java.util.*;
public class ExamCompletionProbe {
 static int passed,failed;
 static void test(String label,Runnable action){try{action.run();passed++;System.out.println("PASS "+label);}catch(Throwable t){failed++;System.out.println("FAIL "+label+": "+t.getMessage());}}
 static void check(boolean b){if(!b)throw new AssertionError("unexpected result");}
 static class Player { final UUID id=UUID.randomUUID(); public void sendMessage(String m){} public UUID getUniqueId(){return id;} }
 static class Bukkit { static final Map<UUID,Player> players=new HashMap<>();static Player getPlayer(UUID id){return players.get(id);} }
 static record Definition(String primitive,List<String> proofs){}
 static class Exam {
  static class Run {Definition definition;String state="active",reason="";UUID id=UUID.randomUUID();long started=100,expires=Long.MAX_VALUE;Map<UUID,Object> allies=new HashMap<>();}
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
  static class Task {void cancel(){}}
  Map<UUID,Run> runs=new HashMap<>(),saved=new HashMap<>();Map<UUID,Menu> menus=new HashMap<>();Task task=new Task();
  void interrupt(Player p,Run r,String why){if(r.state.equals("active")){r.state="interrupted";r.reason=why;save(p,r);}}
  void save(Player p,Run r){saved.put(p.id,r);}
  __DURABLE__
  __LIFECYCLE__
 }
 static class Config {
  Map<String,String> values=new HashMap<>();Map<String,Map<String,Object>> receipts=new HashMap<>();int writes;
  String getString(String k){return values.get(k);}void set(String k,Object v){values.put(k,String.valueOf(v));}
  void createSection(String k,Map<String,Object> v){receipts.put(k,v);writes++;}
 }
 static class Native {boolean selected(){return true;}void siteCompleted(Player p,String site,String run){}}
 static class Plugin {Config config=new Config();Exam exams=new Exam(),skillAssessments=exams;Native nativeRpg=new Native();Config getConfig(){return config;}Exam skillAssessments(){return exams;}boolean nativeRpgSelected(){return true;} __NATIVE__ }
 static class Site {String id="synthetic_crypt",name="Synthetic";List<String> rooms=List.of("one","two","three");int conquestFloor=0,emeralds=8,bonusCount=1;Bonus bonus=new Bonus();}
 static class Bonus {String name(){return "STONE";}}
 static class Mode {int reward=1;}
 static class Run {String id=UUID.randomUUID().toString();Site site=new Site();long started=200;int stage=3;Mode mode=new Mode();Map<UUID,Integer> attendance=new LinkedHashMap<>();Map<Integer,Set<UUID>> roomAttendance=new HashMap<>();}
 static class Manager {
  static final String ROOT="site-dungeons";Plugin plugin=new Plugin();int ends,applications;
  String day(){return "2030-01-01";}Object receipt(UUID id,String site){return plugin.config.receipts.get(ROOT+".receipts."+id+"."+site);}
  void atomic(Runnable work){work.run();}void applyCompletion(Player p,String id,Object saved){applications++;plugin.nativeSiteCompleted(p,id,(String)((Map<?,?>)saved).get("run"));}
  void end(Run run,String reason){check(reason.equals("completed"));ends++;}
  List<String> missingRooms(Run r,UUID id){List<String> out=new ArrayList<>();for(int i=0;i<r.stage;i++)if(r.roomAttendance.containsKey(i)&&!r.roomAttendance.get(i).contains(id))out.add("missing");return out;}
  List<String> unverifiedRooms(Run r){List<String> out=new ArrayList<>();for(int i=0;i<r.stage;i++)if(!r.roomAttendance.containsKey(i))out.add("unknown");return out;}
  __COMPLETE__
  __GUIDANCE__
 }
 static Exam.Run exam(String primitive,String... proofs){Exam.Run r=new Exam.Run();r.definition=new Definition(primitive,List.of(proofs));return r;}
 static Run run(Player p){Run r=new Run();r.attendance.put(p.id,3);for(int i=0;i<3;i++)r.roomAttendance.put(i,Set.of(p.id));return r;}
 static Manager manager(Player p){Bukkit.players.put(p.id,p);Manager m=new Manager();m.plugin.exams.active=exam("contract_record","native_clear");return m;}
 public static void main(String[] ignored){
  test("daily reward cap does not swallow fresh full-clear evidence",()->{Player p=new Player();Manager m=manager(p);Run r=run(p);m.plugin.config.values.put(Manager.ROOT+".claimed."+p.id+"."+r.site.id,m.day());m.complete(r);check(m.plugin.exams.count==1&&m.plugin.config.writes==0&&m.applications==0&&m.ends==1);});
  test("first clear creates one reward and evidence",()->{Player p=new Player();Manager m=manager(p);Run r=run(p);m.complete(r);check(m.plugin.config.writes==1&&m.applications==1&&m.plugin.exams.count==1);m.complete(r);check(m.plugin.config.writes==1&&m.plugin.exams.count==1);});
  test("pending older reward does not swallow new examination",()->{Player p=new Player();Manager m=manager(p);Run r=run(p);m.plugin.config.receipts.put(Manager.ROOT+".receipts."+p.id+"."+r.site.id,Map.of("run","older"));m.complete(r);check(m.plugin.config.writes==0&&m.plugin.exams.count==1);});
  test("claiming an older reward cannot certify a new exam",()->{Player p=new Player();Manager m=manager(p);m.applyCompletion(p,"synthetic_crypt",Map.of("run","previous"));check(m.plugin.exams.count==0);});
  test("partial participation still gets original reward but no full-clear certificate",()->{Player p=new Player();Manager m=manager(p);Run r=run(p);r.roomAttendance.put(0,Set.of());r.attendance.put(p.id,2);m.complete(r);check(m.plugin.config.writes==1&&m.plugin.exams.count==0);});
  test("unknown room attendance cannot certify",()->{Player p=new Player();Manager m=manager(p);Run r=run(p);r.roomAttendance.remove(0);m.complete(r);check(m.plugin.exams.count==0);});
  test("bystander cannot certify or receive rewards",()->{Player p=new Player();Manager m=manager(p);Run r=run(p);r.attendance.put(p.id,0);m.complete(r);check(m.plugin.config.writes==0&&m.plugin.exams.count==0);});
  test("old dungeon start cannot satisfy a later exam",()->{Player p=new Player();Manager m=manager(p);Run r=run(p);r.started=50;m.complete(r);check(m.plugin.config.writes==1&&m.plugin.exams.count==0);});
  test("expired exam cannot gain proof",()->{Player p=new Player();Manager m=manager(p);m.plugin.exams.active.expires=1;m.complete(run(p));check(m.plugin.exams.count==0);});
  test("unknown start is rejected",()->{Player p=new Player();Manager m=manager(p);Run r=run(p);r.started=0;m.complete(r);check(m.plugin.exams.count==0);});
  for(String state:List.of("cancelled","interrupted","submitted","ready"))test("terminal exam stays "+state,()->{Player p=new Player();Manager m=manager(p);m.plugin.exams.active.state=state;m.complete(run(p));check(m.plugin.exams.count==0&&m.plugin.exams.active.state.equals(state));});
  test("survey is transport durable",()->check(Exam.durableRecord(exam("contract_record","survey"))));
  test("conquest is transport durable",()->check(Exam.durableRecord(exam("contract_record","native_clear"))));
  for(String kind:List.of("flight_route","support_route","leap_route","native_lesson"))test(kind+" remains interruptible",()->check(!Exam.durableRecord(exam(kind,"native_clear"))));
  test("unrelated contract remains unchanged",()->check(!Exam.durableRecord(exam("contract_record","project"))));
  test("old daily-limit outcome gains accurate guidance without changing facts",()->{
   Map<String,Object> data=new LinkedHashMap<>(Map.of("id","synthetic_crypt","reason","completed","rewardStatus","daily_limit","run","historic","attendance",3,"nextAction","本场仍在进行时可回到遗迹自动续接"));
   Manager.outcomeGuidance(data);check(data.get("nextAction").toString().contains("无需返回首室"));check(data.get("nextCommands").equals(List.of("/mycli guild exam status","/mycli dungeon info synthetic_crypt")));check(data.get("run").equals("historic")&&data.get("attendance").equals(3)&&data.get("rewardStatus").equals("daily_limit"));
  });
  test("incomplete outcome does not imply a successful examination",()->{
   Map<String,Object> data=new LinkedHashMap<>(Map.of("id","synthetic_crypt","reason","time_limit","rewardStatus","daily_limit"));Manager.outcomeGuidance(data);check(data.get("nextAction")!=null&&!data.get("nextAction").toString().contains("本场已通关"));
  });
  for(String reward:List.of("ready","claimed"))test("existing reward guidance preserved "+reward,()->{Map<String,Object> data=new HashMap<>(Map.of("id","synthetic_crypt","rewardStatus",reward));Manager.outcomeGuidance(data);check(data.get("nextCommands").equals(reward.equals("ready")?List.of("/mycli dungeon claim synthetic_crypt"):List.of("/mycli arena rewards","/mycli arena stash")));});
  test("malformed historical site cannot become a command",()->{Map<String,Object> data=new HashMap<>(Map.of("id","bad\ncommand","rewardStatus","ready"));Manager.outcomeGuidance(data);check(data.get("nextCommands").equals(List.of("/mycli dungeon list")));});
  for(String primitive:List.of("contract_record","flight_route"))for(String event:List.of("teleport","quit","shutdown"))test(primitive+" actual handler "+event,()->{
   Player p=new Player();Bukkit.players.put(p.id,p);Lifecycle l=new Lifecycle();Lifecycle.Run r=new Lifecycle.Run();r.definition=new Definition(primitive,List.of("native_clear"));l.runs.put(p.id,r);l.save(p,r);
   UUID id=r.id;long started=r.started,expires=r.expires;
   switch(event){case "teleport"->l.teleport(new PlayerTeleportEvent(p));case "quit"->l.quit(new PlayerQuitEvent(p));case "shutdown"->l.shutdown();}
   check(r.state.equals(primitive.equals("contract_record")?"active":"interrupted"));check(l.saved.get(p.id).id.equals(id)&&r.started==started&&r.expires==expires);
   check(event.equals("quit")?!l.runs.containsKey(p.id):l.runs.containsKey(p.id));
  });
  System.out.println("RESULT passed="+passed+" failed="+failed);if(failed>0)System.exit(1);
 }
}
'''
    generated = template.replace("__COMPLETE__", complete).replace("__DURABLE__", durable).replace("__PROOF__", proof).replace("__NATIVE__", native).replace("__LIFECYCLE__", lifecycle).replace("__GUIDANCE__", guidance)
    args.output.mkdir(parents=True, exist_ok=False)
    source = args.output / "ExamCompletionProbe.java"
    source.write_text(generated, encoding="utf-8")
    suffix = ".exe" if os.name == "nt" else ""
    subprocess.run([str(args.jdk / "bin" / ("javac" + suffix)), "--release", "21", "-encoding", "UTF-8", "-d", str(args.output), str(source)], check=True)
    result = subprocess.run([str(args.jdk / "bin" / ("java" + suffix)), "-cp", str(args.output), "ExamCompletionProbe"])
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
