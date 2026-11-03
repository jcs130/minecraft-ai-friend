"""Compile original review methods with explicit game/API doubles; never load Minecraft."""
from pathlib import Path
import hashlib
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source-root',type=Path,default=Path(__file__).resolve().parents[1])
parser.add_argument('--output',type=Path)
parser.add_argument('--jdk',type=Path,help='JDK directory; defaults to javac on PATH')
parser.add_argument('--gson',type=Path,default=os.environ.get('GSON_JAR'),help='Installed Gson JAR; no downloads')
options=parser.parse_args()
BASE=Path(__file__).resolve().parents[1]
REPO=options.source_root.resolve()
OUT=options.output.resolve() if options.output else Path(tempfile.mkdtemp(prefix='issue43-java-'))
SRC=OUT/'java-src'
CLASSES=OUT/'java-classes'
RUNTIME=OUT/'java-runtime'
if not options.gson or not options.gson.is_file():parser.error('--gson must identify an installed Gson JAR')
if not options.jdk and not shutil.which('javac'):parser.error('JDK 21+ is required')
JDK=options.jdk/'bin' if options.jdk else Path(shutil.which('javac')).parent
GSON=options.gson.resolve()
EXE='.exe' if os.name=='nt' else ''
sys.stdout.reconfigure(encoding='utf-8')
for p in (SRC,CLASSES,RUNTIME,OUT/'deps'): p.mkdir(parents=True,exist_ok=True)
gson_copy=OUT/'deps'/GSON.name
shutil.copyfile(GSON,gson_copy)
provenance={'sourceRoot':str(REPO),'sourceFiles':{},'extractedMethods':[],
 'scope':'ClientBridge do admission block + exact validate/tick/dispatch/key/cancel methods; actual ControlLedger/MinescriptRunner and TaskPersistence; game/Fabric/Minescript jobs/registry/tools are local doubles. No live client, server, network, model, or game world.',
 'gson':{'path':str(GSON),'sha256':hashlib.sha256(GSON.read_bytes()).hexdigest()}}
def put(name,text):
    p=SRC/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text,encoding='utf-8')
def read(name):
    p=REPO/name;raw=p.read_bytes()
    provenance['sourceFiles'][name]=hashlib.sha256(raw).hexdigest()
    return raw.decode('utf-8')
def copy(name,destination): put(destination,read(name))

bridge_path='packages/agent-mc-java-bridge/src/main/java/org/agentmc/bridge/ClientBridge.java'
bridge=read(bridge_path)
def method(text,header):
    start=text.index(header); opening=text.index('{',start);depth=0;i=opening;state='code'
    while i<len(text):
        c=text[i];n=text[i+1:i+2]
        if state=='string':
            if c=='\\':i+=2;continue
            if c=='"':state='code'
        elif state=='char':
            if c=='\\':i+=2;continue
            if c=="'":state='code'
        elif state=='line':
            if c=='\n':state='code'
        elif state=='comment':
            if c=='*' and n=='/':state='code';i+=2;continue
        else:
            if c=='"':state='string'
            elif c=="'":state='char'
            elif c=='/' and n=='/':state='line';i+=2;continue
            elif c=='/' and n=='*':state='comment';i+=2;continue
            elif c=='{':depth+=1
            elif c=='}':
                depth-=1
                if depth==0:
                    fragment=text[start:i+1]
                    provenance['extractedMethods'].append({'header':header,'firstLine':text[:start].count('\n')+1,
                        'lastLine':text[:i+1].count('\n')+1,'sha256':hashlib.sha256(fragment.encode()).hexdigest()})
                    return fragment
        i+=1
    raise ValueError(header)

do_start=bridge.index('        if (!method.equals("do"))')
do_end=bridge.index('\n    }',do_start)
do_block=bridge[do_start:do_end]
provenance['extractedMethods'].append({'header':'do admission block, enclosed by local submit wrapper',
 'firstLine':bridge[:do_start].count('\n')+1,'lastLine':bridge[:do_end].count('\n')+1,
 'sha256':hashlib.sha256(do_block.encode()).hexdigest()})
headers=['private boolean minescriptAvailable()', 'private MinescriptRunner scripts()', 'private void cancelScript()',
 'private void validate(', 'private void tick(', 'private void dispatch(', 'private void pressKeys(',
 'private void releaseKeys()', 'private boolean inventoryPendingFor(', 'private boolean cancelAll(',
 'private static JsonObject object(', 'private static String text(', 'private static int integer(',
 'private static boolean flag(', 'private static boolean finite(']
methods='\n'.join(method(bridge,h) for h in headers)
methods += '\n' + (method(bridge,'private boolean scriptCancellationUnknown()')
    if 'private boolean scriptCancellationUnknown()' in bridge else
    'private boolean scriptCancellationUnknown(){return scriptStopUnconfirmed;}')
gate=next((line.strip() for line in bridge.splitlines() if 'if(scriptStopUnconfirmed&&Set.of(' in line),'')
methods+='\nprivate void bodyMethodGate(String method){'+gate+'}\n'
copy('packages/agent-mc-java-bridge/src/main/java/org/agentmc/bridge/ControlLedger.java','org/agentmc/bridge/ControlLedger.java')
copy('packages/agent-mc-java-bridge/src/main/java/org/agentmc/bridge/MinescriptRunner.java','org/agentmc/bridge/MinescriptRunner.java')
copy('packages/agent-mc-java-bridge/src/test/java/ControlLedgerCheck.java','ControlLedgerCheck.java')
copy('world/numen-src/api/common/src/main/java/com/dwinovo/numen/task/TaskPersistence.java','com/dwinovo/numen/task/TaskPersistence.java')

put('net/fabricmc/loader/api/FabricLoader.java',r'''
package net.fabricmc.loader.api;
import java.nio.file.Path;import java.util.Optional;
public final class FabricLoader {
 public static FabricLoader getInstance(){return new FabricLoader();}
 public Path getGameDir(){return Path.of("").toAbsolutePath();}
 public Optional<Mod> getModContainer(String id){return Optional.of(new Mod());}
 public static class Mod {public Metadata getMetadata(){return new Metadata();}}
 public static class Metadata {public Version getVersion(){return new Version();}}
 public static class Version {public String getFriendlyString(){return "4.0";}}
}
''')
put('net/minescript/common/Minescript.java',r'''
package net.minescript.common;
import java.util.*;
public class Minescript {
 public static final Manager jobs=new Manager();
 public static class Manager {public boolean failRead;public final Map<Integer,Object> map=new HashMap<>();public Map<Integer,Object> getMap(){if(failRead)throw new IllegalStateException("injected observation failure");return map;}}
 public enum State {RUNNING,KILLED}
 public static class Job {
  public boolean failKill,killed;public Job(boolean fail){failKill=fail;}
  public void kill(){if(failKill)throw new IllegalStateException("injected kill failure");killed=true;jobs.map.remove(jobId());}
  public State state(){return killed?State.KILLED:State.RUNNING;}
  public int jobId(){return 1;}
 }
 public static void onClientChat(String s){throw new AssertionError("No real script launch allowed");}
}
''')
put('org/agentmc/bridge/LocalGameDoubles.java',r'''
package org.agentmc.bridge;
import com.google.gson.*;import java.util.*;
class class_304 {boolean pressed;void method_23481(boolean value){pressed=value;}}
class class_315 {boolean field_1837;class_304 field_1894=new class_304(),field_1881=new class_304(),field_1913=new class_304(),field_1849=new class_304(),field_1903=new class_304(),field_1832=new class_304(),field_1867=new class_304(),field_1904=new class_304(),field_1886=new class_304();}
class LocalInventory {int field_7545;Object method_5438(int s){return new Object();}}
class LocalHandler {int field_7763;List<Object> field_7761=new ArrayList<>();}
class LocalPlayer {LocalHandler field_7512=new LocalHandler();LocalInventory inventory=new LocalInventory();LocalInventory method_31548(){return inventory;}void method_36456(float x){}void method_36457(float x){}void method_7346(){}}
class LocalNetwork {void method_45730(String s){throw new AssertionError("No command allowed");}void method_45729(String s){throw new AssertionError("No chat allowed");}}
class LocalManager {void method_2906(int h,int s,int b,class_1713 t,LocalPlayer p){throw new AssertionError("No inventory action allowed");}}
class class_310 {LocalPlayer field_1724=new LocalPlayer();Object field_1687=new Object();class_315 field_1690=new class_315();LocalManager field_1761=new LocalManager();LocalNetwork method_1562(){return new LocalNetwork();}void method_1507(Object o){}}
class class_490 {class_490(LocalPlayer p){}}
class class_1713 {static final class_1713 field_7790=new class_1713(),field_7794=new class_1713(),field_7791=new class_1713();}
class class_4185 {boolean field_22763=true,field_22764=true;void method_25306(){}}
class InventoryPick {boolean unresolved(){return false;}void requireResolved(){}void unknown(String s){}JsonObject inspect(){return new JsonObject();}void update(Object o,int s,long t){}}
class NativeNavigation {boolean unresolved(){return false;}String owner(){return null;}boolean cancel(){return true;}boolean available(){return true;}void paused(boolean p){}String tick(){return "running";}JsonObject report(){return new JsonObject();}String reason(){return "";}void start(JsonObject o,int ms,String id){}static void validate(JsonObject o){}}
class ReflexFrames {int scope(class_310 c){return 1;}}
class ReflexInputs {void stop(){}boolean active(int scope){return false;}}
class ServerAuthorization {static boolean ready(JsonObject o){return o.get("ready").getAsBoolean();}}
class MethodSession {MethodSession(class_310 c,int ms,InventoryPick i,String id,NativeNavigation n){}void paused(boolean p){}void tick(){}JsonObject result(int c){return new JsonObject();}void call(int c,String name,JsonArray a){throw new AssertionError("Unexpected method dispatch");}static Object inventoryIdentities(class_310 c){return List.of();}static String identity(Object s){return "";}static JsonElement item(class_310 c,Object stack,int slot){return new JsonObject();}}
''')

native_header=r'''
package org.agentmc.bridge;
import com.google.gson.*;import java.nio.file.*;import java.util.*;import net.fabricmc.loader.api.FabricLoader;
import net.minescript.common.Minescript;
public final class NativeCancelCheck {
 private final Gson gson=new Gson();private final ArrayDeque<ControlLedger.Action> queue=new ArrayDeque<>();
 private final ControlLedger ledger;private ControlLedger.Action current,reflexItem;
 private final class_310 client=new class_310();private final NativeNavigation navigation=new NativeNavigation();
 private final InventoryPick inventoryPick=new InventoryPick();private final ReflexInputs reflexInputs=new ReflexInputs();
 private final ReflexFrames reflexFrames=new ReflexFrames();private MethodSession methodSession,reflexItemSession;
 private boolean minescriptEnabled=true,scriptStopUnconfirmed,authReady=true;private MinescriptRunner scriptRunner;
 private String screenToken="local",proof;private final Path directory;private final Minescript.Job job;
 NativeCancelCheck(Path root,boolean failKill)throws Exception {
  directory=Files.createTempDirectory(root,"case-");ledger=new ControlLedger(directory);
  proof=ledger.claim("local-controller",30000,System.currentTimeMillis()).get("nonce").getAsString();
  JsonObject input=new JsonObject();input.addProperty("code","result=None");input.addProperty("timeoutMs",30000);
  current=ledger.admit("old-script","minescript.run",input,System.currentTimeMillis());current.phase="running";current.bodyScope=1;current.before=position();ledger.save(current);
  Minescript.jobs.map.clear();job=new Minescript.Job(failKill);Minescript.jobs.map.put(1,job);
  scriptRunner=new MinescriptRunner(Path.of("").toAbsolutePath());
  var active=MinescriptRunner.class.getDeclaredField("active");active.setAccessible(true);active.set(scriptRunner,job);
  var deadline=MinescriptRunner.class.getDeclaredField("deadline");deadline.setAccessible(true);deadline.setLong(scriptRunner,Long.MAX_VALUE);
 }
 private JsonObject submit(JsonObject args)throws Exception {
  long now=System.currentTimeMillis();String method="do";
  ledger.require(text(args,"controllerId",""),text(args,"nonce",""),now);
'''
native_extra=r'''
 private void connected(){if(client.field_1724==null||client.field_1687==null)throw new IllegalStateException("disconnected");}
 private void updateScreen(){}private double[] position(){return new double[]{0,0,0};}
 private JsonObject state(){JsonObject o=new JsonObject();o.addProperty("fixture",true);o.addProperty("scriptCancellationUnknown",scriptCancellationUnknown());return o;}
 private JsonObject authorization(){JsonObject o=new JsonObject();o.addProperty("ready",authReady);return o;}
 private List<class_4185> buttons(){return List.of();}
 private JsonObject args(String id,String queueMode){JsonObject a=new JsonObject(),input=new JsonObject();input.addProperty("forward",true);input.addProperty("ticks",20);a.add("input",input);a.addProperty("operation","move");a.addProperty("action_id",id);a.addProperty("queue",queueMode);a.addProperty("controllerId","local-controller");a.addProperty("nonce",proof);return a;}
 private static void check(boolean value,String why){if(!value)throw new AssertionError(why);}
 private JsonObject report(String name,String replacement,boolean rejected)throws Exception {
  JsonObject o=new JsonObject();o.addProperty("case",name);o.addProperty("cancellationUnknown",scriptStopUnconfirmed);
  o.addProperty("oldJobAlive",!job.killed);o.addProperty("oldPhase",ledger.get("old-script").phase);
  o.addProperty("oldPersistedPhase",JsonParser.parseString(Files.readString(directory.resolve(ControlLedger.hash("old-script")+".json"))).getAsJsonObject().get("phase").getAsString());
  o.addProperty("replacementPhase",ledger.get(replacement)==null?"not_admitted":ledger.get(replacement).phase);
  o.addProperty("forward",client.field_1690.field_1894.pressed);o.addProperty("rejected",rejected);return o;
 }
 public static void main(String[] argv)throws Exception {
  Path root=Path.of("native-cases");Files.createDirectories(root);JsonArray results=new JsonArray();
  var fail=new NativeCancelCheck(root,true);fail.submit(fail.args("replacement","now"));fail.tick(fail.client);
  check(fail.scriptStopUnconfirmed,"unknown flag missing");check(fail.ledger.get("old-script").phase.equals("unknown"),"original must be unknown");
  check(!fail.job.killed,"old script unexpectedly killed");check(fail.ledger.get("replacement").phase.equals("blocked"),"replacement must be blocked while cancellation is unknown");check(!fail.client.field_1690.field_1894.pressed,"replacement pressed forward over unknown cancellation");
  boolean subsequentRejected=false;try{fail.submit(fail.args("later","append"));}catch(IllegalStateException expected){subsequentRejected=true;}check(subsequentRejected,"existing unknown must block later request");
  var r=fail.report("queue=now cancellation throws","replacement",false);r.addProperty("subsequentRequestRejected",subsequentRejected);results.add(r);
  var ok=new NativeCancelCheck(root,false);ok.submit(ok.args("replacement","now"));ok.tick(ok.client);
  check(ok.job.killed&&!ok.scriptStopUnconfirmed,"normal cancel failed");check(ok.ledger.get("old-script").phase.equals("cancelled"),"old normal phase");check(ok.client.field_1690.field_1894.pressed,"normal replacement failed");results.add(ok.report("confirmed cancellation control","replacement",false));
  var prior=new NativeCancelCheck(root,true);check(!prior.cancelAll("local stop"),"unconfirmed stop reported true");boolean rejected=false;try{prior.submit(prior.args("replacement","now"));}catch(IllegalStateException expected){rejected=true;}
  check(rejected&&prior.ledger.get("replacement")==null&&!prior.client.field_1690.field_1894.pressed,"prior unknown guard failed");results.add(prior.report("unknown before admission rejection","replacement",rejected));
  var append=new NativeCancelCheck(root,true);append.submit(append.args("replacement","append"));append.tick(append.client);
  check(!append.scriptStopUnconfirmed&&append.current.id.equals("old-script")&&!append.client.field_1690.field_1894.pressed,"append should not replace old script");results.add(append.report("append waits for existing script control","replacement",false));
  var expired=new NativeCancelCheck(root,true);expired.submit(expired.args("replacement","now"));expired.ledger.release();expired.tick(expired.client);
  check(!expired.client.field_1690.field_1894.pressed&&expired.ledger.get("replacement").phase.equals("blocked"),"expired lease must not run a blocked replacement");results.add(expired.report("expired lease does not revive blocked replacement","replacement",false));
  var recovery=new NativeCancelCheck(root,true);recovery.submit(recovery.args("replacement","now"));
  Minescript.jobs.map.clear();Minescript.jobs.map.put(2,new Minescript.Job(false));check(recovery.state().get("scriptCancellationUnknown").getAsBoolean(),"foreign script incorrectly freed body");
  Minescript.jobs.failRead=true;check(recovery.state().get("scriptCancellationUnknown").getAsBoolean(),"failed observation cleared unknown");Minescript.jobs.failRead=false;
  Minescript.jobs.map.clear();check(!recovery.state().get("scriptCancellationUnknown").getAsBoolean(),"empty real manager did not reconcile stop");
  recovery.submit(recovery.args("replacement","now"));recovery.tick(recovery.client);check(!recovery.client.field_1690.field_1894.pressed,"blocked request was replayed after reconciliation");
  check(recovery.ledger.get("old-script").phase.equals("unknown"),"stop observation invented old world outcome");
  recovery.submit(recovery.args("fresh-intent","append"));recovery.tick(recovery.client);check(recovery.client.field_1690.field_1894.pressed,"fresh request after reconciliation blocked");results.add(recovery.report("read-only stop reconciliation permits only new intent","replacement",false));
  var tickGuard=new NativeCancelCheck(root,true);tickGuard.scriptStopUnconfirmed=true;tickGuard.current=null;
  JsonObject queuedInput=new JsonObject();queuedInput.addProperty("forward",true);queuedInput.addProperty("ticks",20);
  var queued=tickGuard.ledger.admit("queued-before-stop","move",queuedInput,System.currentTimeMillis());queued.bodyScope=1;tickGuard.queue.add(queued);tickGuard.tick(tickGuard.client);
  check(queued.phase.equals("accepted")&&!tickGuard.client.field_1690.field_1894.pressed,"tick bypassed unknown gate");results.add(tickGuard.report("tick independently blocks already queued work","queued-before-stop",false));
  var retry=new NativeCancelCheck(root,true);retry.submit(retry.args("replacement","now"));retry.job.failKill=false;
  check(retry.cancelAll("explicit operator stop")&&!retry.scriptStopUnconfirmed,"confirmed explicit stop did not recover cancellation gate");
  check(retry.ledger.get("old-script").phase.equals("unknown")&&retry.ledger.get("replacement").phase.equals("blocked"),"explicit stop rewrote old outcome");results.add(retry.report("explicit confirmed stop recovery","replacement",false));
  var inputs=new NativeCancelCheck(root,true);inputs.submit(inputs.args("replacement","now"));
  for(String m:List.of("do","method_claim","method_call","reflex_control","reflex_item")){boolean blocked=false;try{inputs.bodyMethodGate(m);}catch(IllegalStateException expected){blocked=true;}check(blocked,"body method bypassed unknown script: "+m);}
  for(String m:List.of("state","result","stop","cancel"))inputs.bodyMethodGate(m);
  results.add(inputs.report("all body entrypoints blocked; reads and stop remain available","replacement",true));
  System.out.println(new GsonBuilder().setPrettyPrinting().create().toJson(results));
  Files.writeString(Path.of("..","native-results.json"),new GsonBuilder().setPrettyPrinting().create().toJson(results));
  System.out.println("PASS 9 scenarios; unknown cancellation blocks replacement, tick and body entrypoints, with authoritative stop reconciliation");
 }
}
'''
put('org/agentmc/bridge/NativeCancelCheck.java',native_header+do_block+'\n }\n'+methods+'\n'+native_extra)

put('net/minecraft/server/MinecraftServer.java','package net.minecraft.server; public class MinecraftServer {}')
put('com/dwinovo/numen/Constants.java',r'''package com.dwinovo.numen; public class Constants {public static final Log LOG=new Log();public static class Log {public void info(String s,Object...o){}public void warn(String s,Object...o){}}}''')
put('com/dwinovo/numen/entity/NumenPlayer.java',r'''
package com.dwinovo.numen.entity;import java.util.UUID;import net.minecraft.server.MinecraftServer;
public class NumenPlayer {private final UUID id=UUID.randomUUID();public Level level(){return new Level();}public UUID getUUID(){return id;}public static class Level {public MinecraftServer getServer(){return new MinecraftServer();}}}
''')
put('com/dwinovo/numen/entity/CompanionRegistry.java',r'''
package com.dwinovo.numen.entity;import java.util.*;import net.minecraft.server.MinecraftServer;
public class CompanionRegistry {public static final CompanionRegistry INSTANCE=new CompanionRegistry();private final Map<UUID,Entry> entries=new HashMap<>();public static CompanionRegistry get(MinecraftServer s){return INSTANCE;}public Entry find(UUID id){return entries.get(id);}public void put(UUID id,Entry e){entries.put(id,e);}public record Entry(String taskTool,String taskArgs){public Entry doing(String t,String a){return new Entry(t,a);}}}
''')
put('com/dwinovo/numen/agent/tool/NumenTool.java',r'''package com.dwinovo.numen.agent.tool;import com.google.gson.JsonObject;import com.dwinovo.numen.entity.NumenPlayer;import java.util.function.Consumer;public interface NumenTool {void onServerCall(String call,JsonObject args,NumenPlayer body,Consumer<String> reply);}''')
put('com/dwinovo/numen/agent/tool/ToolRegistry.java',r'''package com.dwinovo.numen.agent.tool;import java.util.*;public class ToolRegistry {public static final Map<String,NumenTool> tools=new HashMap<>();public static NumenTool get(String name){return tools.get(name);}}''')
put('com/dwinovo/numen/event/NumenEvents.java',r'''package com.dwinovo.numen.event;import com.dwinovo.numen.entity.NumenPlayer;import java.util.*;public class NumenEvents {public static final List<String> events=new ArrayList<>();public static void taskFinished(NumenPlayer body,String call,String tool,String status,String why){events.add(status+":"+tool);}}''')
put('WorldReplayCheck.java',r'''
import com.google.gson.*;import com.dwinovo.numen.task.TaskPersistence;import com.dwinovo.numen.entity.*;import com.dwinovo.numen.agent.tool.*;import com.dwinovo.numen.event.NumenEvents;import java.util.*;import java.nio.file.*;
public class WorldReplayCheck {
 static void check(boolean v,String why){if(!v)throw new AssertionError(why);}
 public static void main(String[] argv)throws Exception {
  JsonArray results=new JsonArray();
  for(String name:List.of("saved mine replay","idle control","missing tool rejection","invalid arguments rejection","tool refuses replay")){
   ToolRegistry.tools.clear();NumenEvents.events.clear();var body=new NumenPlayer();var calls=new ArrayList<JsonObject>();
   String tool=name.equals("idle control")?"":"mine";String args=name.equals("invalid arguments rejection")?"invalid-json":"{\"count\":64}";
   CompanionRegistry.INSTANCE.put(body.getUUID(),new CompanionRegistry.Entry(tool,args));
   if(!name.equals("missing tool rejection"))ToolRegistry.tools.put("mine",(id,input,companion,reply)->{JsonObject c=input.deepCopy();c.addProperty("callId",id);calls.add(c);reply.accept(name.equals("tool refuses replay")?"{\"success\":false,\"message\":\"local rejection\"}":"{\"success\":true}");});
   TaskPersistence.restore(body);
   check(calls.isEmpty(),"saved task must never be replayed on body restore");
   check(CompanionRegistry.INSTANCE.find(body.getUUID()).taskTool().equals(tool)&&CompanionRegistry.INSTANCE.find(body.getUUID()).taskArgs().equals(args),"pending review evidence changed");
   check(NumenEvents.events.size()==(tool.isEmpty()?0:1),"missing pending-review notice");
   if(!tool.isEmpty())check(NumenEvents.events.getFirst().equals("stopped:mine"),"old action result fabricated");
   JsonObject r=new JsonObject();r.addProperty("case",name);r.add("toolCalls",new Gson().toJsonTree(calls));r.add("events",new Gson().toJsonTree(NumenEvents.events));r.addProperty("remainingSavedTool",CompanionRegistry.INSTANCE.find(body.getUUID()).taskTool());results.add(r);
  }
  System.out.println(new GsonBuilder().setPrettyPrinting().create().toJson(results));Files.writeString(Path.of("..","world-java-results.json"),new GsonBuilder().setPrettyPrinting().create().toJson(results));
  var body=new NumenPlayer();JsonObject next=new JsonObject();next.addProperty("count",2);
  TaskPersistence.remember(body,"mine",next);check(CompanionRegistry.INSTANCE.find(body.getUUID())==null,"remember created an unregistered body");
  CompanionRegistry.INSTANCE.put(body.getUUID(),new CompanionRegistry.Entry("mine","{\"count\":64}"));TaskPersistence.remember(body,"mine",next);
  check(CompanionRegistry.INSTANCE.find(body.getUUID()).taskArgs().equals(next.toString()),"explicit fresh task could not replace saved intent");TaskPersistence.forget(body);
  check(CompanionRegistry.INSTANCE.find(body.getUUID()).taskTool().isEmpty(),"explicit forget failed");
  System.out.println("PASS 6 scenarios; old intent is preserved for review without tool dispatch, fresh intent and forget still work");
 }
}
''')

failures=[]
def run(argv,cwd,log_name,*,fatal=False):
    print('COMMAND '+json.dumps([str(x) for x in argv],ensure_ascii=False),flush=True)
    p=subprocess.run([str(x) for x in argv],cwd=cwd,capture_output=True,encoding='utf-8',errors='replace')
    (OUT/log_name).write_text('COMMAND '+json.dumps([str(x) for x in argv],ensure_ascii=False)+'\n'+p.stdout+p.stderr+f'\nEXIT {p.returncode}\n',encoding='utf-8')
    print(p.stdout+p.stderr,flush=True)
    if p.returncode:
        failures.append(log_name)
        if fatal:raise SystemExit(p.returncode)
sources=sorted(SRC.rglob('*.java'))
run([JDK/('javac'+EXE),'--release','21','-encoding','UTF-8','-proc:none','-classpath',gson_copy,'-d',CLASSES,*sources],BASE,'java-compile.log',fatal=True)
cp=os.pathsep.join((str(CLASSES),str(gson_copy)))
for cls,log in [('org.agentmc.bridge.NativeCancelCheck','native.log'),('WorldReplayCheck','world-java.log'),('ControlLedgerCheck','ledger-existing.log')]:
    run([JDK/('java'+EXE),'-ea','-Djava.io.tmpdir='+str(RUNTIME),'-cp',cp,cls],RUNTIME,log)
provenance['generatedSourcesSha256']={str(p.relative_to(SRC)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
provenance['failedChecks']=failures
(OUT/'java-provenance.json').write_text(json.dumps(provenance,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
if failures:
    print('FAILED '+', '.join(failures))
    raise SystemExit(1)
print('PASS original Java methods compiled targeting Java 21; all local checks passed; evidence '+str(OUT))
