package org.afuhome.agentfriend;

import com.google.gson.*;
import java.io.File;
import java.nio.file.*;
import java.util.*;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.event.player.*;
import static org.afuhome.agentfriend.ExamMethodBodyFixture.*;

/** Tests actual start/submit/save/record/decode/summary/guide/promotion/transport handlers. */
public final class ExamLifecyclePolicyTest {
    static int passed,failed,serial;
    static AssessmentCatalog catalog;
    static Path artifacts;
    static void test(String name,Runnable work){try{work.run();passed++;System.out.println("PASS "+name);}catch(Throwable t){failed++;System.out.println("FAIL "+name+": "+t);t.printStackTrace(System.out);}}
    static Env env(){return new Env(catalog,artifacts,"exam-lifecycle-"+(++serial));}
    static String state(Env e){return e.active().get("state").getAsString();}
    static String disk(Env e){try{return Files.exists(e.ledger.file)?Files.readString(e.ledger.file):"absent";}catch(Exception ex){throw new RuntimeException(ex);}}
    static JsonObject proof(Env e){return e.active().getAsJsonObject("proofs").getAsJsonObject("shelter");}
    static void legal(JsonObject out){if(out.has("nextCommand"))legal(out.get("nextCommand").getAsString());}
    static void legal(String command){check(command.matches("/mycli [a-z0-9_ ]+"),"pure executable nextCommand: "+command);check(!command.contains(";")&&!command.contains("；"),"command contains explanatory semicolon");}
    static void unchanged(Env e,String before,int commits){check(disk(e).equals(before)&&e.ledger.commits==commits,"read wrote ledger");}
    static void readyShelter(Env e){e.start("shelter_basic");e.houseForRun();e.call("observeHouse",e.p,e.observed());check(state(e).equals("ready"),"real observeHouse did not become ready");}
    static void transport(Env e,String event){switch(event){case "teleport"->e.call("teleport",new PlayerTeleportEvent(e.p,e.actor.at,e.actor.at.clone().add(100,0,0),PlayerTeleportEvent.TeleportCause.COMMAND));case "logout"->e.call("quit",new PlayerQuitEvent(e.p,(String)null));case "shutdown"->e.call("shutdown");default->throw new AssertionError(event);}}
    public static void main(String[] args)throws Exception{
        catalog=AssessmentCatalog.load(new File(args[0]));artifacts=Path.of(args[1]);
        test("shelter start records window only, no life contract/second order",()->{
            Env e=env();e.start("shelter_basic");check(state(e).equals("active"),"start blocked without life contract");
            check(e.active().get("reason").getAsString().equals("awaiting_structure"),"start reason");
            check(!e.plugin.config.contains("life-guild")&&!e.plugin.guild.contract&&e.plugin.market.settlements==0,"created contract/settlement");
            check(e.active().getAsJsonObject("proofs").size()==0&&e.ledger.commits==1,"start attested unobserved house");
            check(e.active().get("expiresAt").getAsLong()-e.active().get("startedAt").getAsLong()==7200000L,"wrong window");
        });
        test("shelter start does not consume or block on an unrelated existing life contract",()->{
            Env e=env();e.plugin.guild.lifeContract=true;e.plugin.config.set("life-guild."+e.actor.id+".active.id","synthetic_existing_life_order");String config=e.plugin.config.saveToString();e.start("shelter_basic");
            check(e.run()!=null&&state(e).equals("active")&&e.plugin.config.saveToString().equals(config),"life order blocked or was consumed/rewritten by shelter exam start");
        });
        test("failed start save leaves no half-run/no automatic enrollment",()->{
            Env e=env();e.ledger.fail=true;e.start("inventory_basic");
            check(e.run()==null&&!e.academy().has("active")&&e.plugin.training.enrollments==0&&e.plugin.training.starts==0,"failed start leaked run or side effect");
            check(e.ledger.commits==0&&!Files.exists(e.ledger.file),"failed start disk leak");
        });
        test("all seven live checks submitted+certificate in ONE write, not consume then ready",()->{
            Env e=env();e.start("shelter_basic");e.houseForRun();int commits=e.ledger.commits,attempts=e.ledger.attempts;
            check(e.submit(),"complete house refused");check(e.ledger.commits==commits+1&&e.ledger.attempts==attempts+1,"submit used multiple writes");
            check(state(e).equals("submitted")&&e.academy().getAsJsonObject("certificates").has("shelter_basic"),"not submitted/certified");
            JsonObject candidate=e.ledger.candidates.getLast(),a=ProfessionLedger.profile(candidate,e.actor.id).getAsJsonObject("academy");
            check(a.getAsJsonObject("active").get("state").getAsString().equals("submitted")&&a.getAsJsonObject("active").getAsJsonObject("proofs").has("shelter"),"half-ready durable candidate");
            check(e.plugin.market.settlements==0&&!e.plugin.config.contains("life-guild"),"guild claim/second contract involved");
            check(e.academy().getAsJsonArray("history").size()==1,"history missing");
            ProfessionLedger reopened=new ProfessionLedger(e.ledger.file);check(reopened.ready()&&reopened.profile(e.actor.id).getAsJsonObject("academy").equals(e.academy()),"actual disk reopen differs");
        });
        for(String missing:List.of("floor","walls","roof","window","door","bed","construction"))test("real inspection missing "+missing+" never ready or consumes order",()->{
            Env e=env();e.start("shelter_basic");e.houseForRun();
            switch(missing){
                case "floor"->e.world.set(3,0,3,Material.AIR);
                case "walls"->e.world.set(4,2,2,Material.AIR);
                case "roof"->e.world.set(2,3,2,Material.AIR);
                case "window"->e.world.set(0,2,2,Material.OAK_PLANKS);
                case "door"->{e.world.set(2,1,0,Material.OAK_PLANKS);e.world.set(2,2,0,Material.OAK_PLANKS);}
                case "bed"->{e.world.set(1,1,1,Material.AIR);e.world.set(1,1,2,Material.AIR);}
                case "construction"->e.plugin.config.set("house-evidence."+e.actor.id+".placements",List.of());
            }
            JsonObject snapshot=(JsonObject)e.call("resultSnapshot",e.p);
            check(!snapshot.getAsJsonObject("result").get("ready").getAsBoolean(),"missing "+missing+" passed");
            check(!snapshot.getAsJsonObject("houseChecks").get(missing).getAsBoolean(),"missing check not surfaced: "+missing);
            String before=disk(e);int commits=e.ledger.commits;check(!e.submit(),"missing "+missing+" submitted");unchanged(e,before,commits);
            check(!e.academy().has("certificates")&&e.active().getAsJsonObject("proofs").size()==0,"missing house consumed or certified");legal(snapshot);
        });
        for(String invalid:List.of("UNKNOWN","foreignowner","timeold","untimedlegacy"))test(invalid+" real house evidence cannot attest this actor/window",()->{
            Env e=env();e.start("shelter_basic");long started=e.active().get("startedAt").getAsLong();
            e.house(invalid.equals("timeold")?started-1:started,invalid.equals("foreignowner")?UUID.randomUUID():e.actor.id);
            if(invalid.equals("UNKNOWN"))e.world.loaded=false;
            if(invalid.equals("untimedlegacy")){List<String> raw=e.plugin.config.getStringList("house-evidence."+e.actor.id+".placements");e.plugin.config.set("house-evidence."+e.actor.id+".placements",raw.stream().map(s->s.substring(0,s.indexOf('|',s.indexOf('|')+1))).toList());}
            JsonObject result=(JsonObject)e.call("resultSnapshot",e.p);check(!result.getAsJsonObject("result").get("ready").getAsBoolean(),"invalid evidence ready");
            check(!e.submit()&&!e.academy().has("certificates"),"invalid evidence submitted");
            if(invalid.equals("UNKNOWN"))check(result.getAsJsonArray("missingProofs").asList().stream().anyMatch(x->x.getAsString().equals("structure_unknown")),"unknown missing proof absent");
        });
        test("empty status/guide/info do not create active market run or write",()->{
            Env e=env();e.plugin.market.active=catalog.definitions.get("shelter_basic");e.plugin.market.token="synthetic_step";
            e.call("jsonQuery",e.p,new String[]{"guild","exam","status"});e.call("jsonQuery",e.p,new String[]{"guild","exam","guide"});
            e.call("jsonQuery",e.p,new String[]{"guild","exam","info","shelter_basic"});e.call("summary",e.p);e.call("resultSnapshot",e.p);
            check(e.run()==null&&!e.academy().has("active")&&e.ledger.attempts==0,"read created/wrote run");e.actor.outputs.forEach(ExamLifecyclePolicyTest::legal);
        });
        test("ready live reads never write proof/migrate grade; missing order and commands exact",()->{
            Env e=env();e.start("shelter_basic");e.houseForRun();String before=disk(e);int commits=e.ledger.commits;
            for(int i=0;i<2;i++){e.call("jsonQuery",e.p,new String[]{"guild","exam","status"});e.call("jsonQuery",e.p,new String[]{"guild","exam","guide"});e.call("jsonQuery",e.p,new String[]{"guild","exam","info","shelter_basic"});legal(e.summary());}
            unchanged(e,before,commits);check(state(e).equals("active")&&e.active().getAsJsonObject("proofs").size()==0&&!e.academy().has("grade"),"read mutated proof/grade");
            JsonObject guide=(JsonObject)e.call("guide",e.p,e.observed());for(JsonElement step:guide.getAsJsonArray("steps"))legal(step.getAsJsonObject().get("command").getAsString());
            e.world.cells.clear();JsonObject out=e.summary();JsonArray missing=out.getAsJsonArray("missingProofs");
            check(missing.toString().equals("[\"floor\",\"walls\",\"roof\",\"window\",\"door\",\"bed\",\"construction\"]"),"wrong missing order: "+missing);legal(out);unchanged(e,before,commits);
        });
        test("real native lesson proof pipeline all-required then submitted, no shelter chat proof",()->{
            Env e=env();e.start("inventory_basic");AssessmentCatalog.Definition d=catalog.definitions.get("inventory_basic");
            for(int i=0;i<d.proofs().size();i++){e.call("proof",e.p,d.proofs().get(i),"server_training:"+i);check(state(e).equals(i==d.proofs().size()-1?"ready":"active"),"all-proofs lesson ready early/late");}
            check(e.submit()&&e.academy().getAsJsonObject("certificates").has("inventory_basic"),"lesson actual submit failed");
            Env shelter=env();shelter.start("shelter_basic");String before=disk(shelter);int commits=shelter.ledger.commits;shelter.call("proof",shelter.p,"shelter","client_claim");unchanged(shelter,before,commits);check(!shelter.active().getAsJsonObject("proofs").has("shelter"),"client shelter claim trusted");
        });
        test("actual siteCompleted old/unknown/expired rejected; fresh proof uses real ready+submit",()->{
            Env e=env();JsonObject raw=AssessmentCatalog.JSON.toJsonTree(catalog.definitions.get("shelter_basic")).getAsJsonObject();raw.addProperty("id","synthetic_conquest");JsonArray proofs=new JsonArray();proofs.add("native_clear");raw.add("proofs",proofs);
            AssessmentCatalog.Definition d=SkillTrajectoryRecoveryTest.signed(AssessmentCatalog.JSON.fromJson(raw,AssessmentCatalog.Definition.class));
            Object r=e.call("newRun",d,"");check((boolean)e.call("save",e.p,r),"seed fresh conquest run");long began=e.active().get("startedAt").getAsLong();String before=disk(e);int commits=e.ledger.commits;
            e.call("siteCompleted",e.p,"synthetic_crypt",UUID.randomUUID().toString(),began-1);e.call("siteCompleted",e.p,"synthetic_crypt",UUID.randomUUID().toString(),0L);unchanged(e,before,commits);
            check(e.active().getAsJsonObject("proofs").size()==0,"old/unknown site proof donated");
            e.call("siteCompleted",e.p,"synthetic_crypt",UUID.randomUUID().toString(),began);check(state(e).equals("ready")&&e.active().getAsJsonObject("proofs").has("native_clear"),"fresh fully witnessed proof not ready");check(e.submit(),"actual conquest submit failed");
            Object expired=e.call("newRun",d,"");field(expired,"expires",1L);e.call("save",e.p,expired);before=disk(e);commits=e.ledger.commits;e.call("siteCompleted",e.p,"synthetic_crypt",UUID.randomUUID().toString(),System.currentTimeMillis());unchanged(e,before,commits);check(e.active().getAsJsonObject("proofs").size()==0,"expired conquest gained proof");
        });
        test("submitted leave house retains original certificate and nonpending terminal reason",()->{
            Env e=env();e.start("shelter_basic");e.houseForRun();check(e.submit(),"submit");JsonObject cert=e.academy().getAsJsonObject("certificates").deepCopy();
            e.clearMemory();e.call("validateLedger");e.actor.at=new Location(e.world.world,100,64,100);e.world.cells.clear();String before=disk(e);int commits=e.ledger.commits;
            e.call("certificates",e.p);JsonObject out=e.summary();check(out.get("state").getAsString().equals("submitted")&&out.get("reason").getAsString().equals("submitted")&&Set.of("submitted","complete").contains(out.get("phase").getAsString()),"terminal certificate became pending: "+out);
            check(out.getAsJsonArray("missingProofs").isEmpty()&&out.getAsJsonObject("result").get("ready").getAsBoolean(),"submitted proof replaced by offsite live inspection");
            check((boolean)e.call("hasCertificate",e.p,"shelter_basic")&&e.academy().getAsJsonObject("certificates").equals(cert),"old cert revoked on leaving house");legal(out);unchanged(e,before,commits);
        });
        test("failed ready persistence keeps original active result/certs/grade/history",()->{
            Env e=env();e.seedGrade(5,List.of("inventory_basic"));e.start("shelter_basic");e.houseForRun();String before=disk(e);int commits=e.ledger.commits;e.ledger.fail=true;
            e.call("observeHouse",e.p,e.call("copy",e.observed()));unchanged(e,before,commits);
            check(state(e).equals("active")&&e.record().get("state").getAsString().equals("active")&&e.academy().get("grade").getAsInt()==5&&e.academy().getAsJsonObject("certificates").size()==1,"failed ready leaked");
        });
        test("failed submit post-edit storage does not leak houseproof/cert/grade/history",()->{
            Env e=env();e.seedGrade(2,List.of("inventory_basic","shelter_basic"));e.call("start",e.p,"shelter_basic",true);e.houseForRun();
            String before=disk(e);JsonObject memory=e.record();int commits=e.ledger.commits;e.ledger.fail=true;
            check(!e.submit(),"failure reported success");unchanged(e,before,commits);
            check(e.record().equals(memory)&&e.academy().get("grade").getAsInt()==2&&!e.academy().has("history")&&e.plugin.guild.mirrors==0,"failed submit leaked grade/run/history");
            e.ledger.fail=false;check(e.submit()&&e.academy().get("grade").getAsInt()==3,"retry failed after storage recovery");
        });
        test("failed submit preserves an already-ready run and its original attestation",()->{
            Env e=env();e.seedGrade(8,List.of("inventory_basic"));readyShelter(e);String before=disk(e);JsonObject memory=e.record();int commits=e.ledger.commits;e.ledger.fail=true;
            check(!e.submit(),"failed ready submit accepted");unchanged(e,before,commits);check(e.record().equals(memory)&&state(e).equals("ready"),"ready rollback changed existing run");
        });
        test("actual filesystem failure on ledger temp path preserves ready/cert/grade",()->{
            Env e=env();e.seedGrade(8,List.of("inventory_basic"));readyShelter(e);JsonObject memory=e.record();String before=disk(e);int commits=e.ledger.commits;
            try{Files.createDirectory(e.ledger.file.resolveSibling(e.ledger.file.getFileName()+".tmp"));}catch(Exception ex){throw new RuntimeException(ex);}
            check(!e.submit(),"real blocked file write reported success");unchanged(e,before,commits);check(e.record().equals(memory)&&e.academy().get("grade").getAsInt()==8&&e.academy().getAsJsonObject("certificates").size()==1&&!e.ledger.real.error().isEmpty(),"real IO failure leaked state");
        });
        test("frozen rankRulesVersion=1 submit still gates fame and preserves original certs",()->{
            Env e=env();e.seedGrade(2,List.of("inventory_basic","shelter_basic"));e.call("start",e.p,"shelter_basic",true);field(e.run(),"rankRulesVersion",1);e.call("save",e.p,e.run());e.houseForRun();e.plugin.guild.fame=9;
            String before=disk(e);int commits=e.ledger.commits;check(!e.submit(),"archival point-rules bypassed fame");unchanged(e,before,commits);check(e.actor.last().get("reason").getAsString().equals("fame_required:10"),"wrong frozen gate");
            e.plugin.guild.fame=10;check(e.submit()&&e.academy().get("grade").getAsInt()==3&&e.active().get("rankRulesVersion").getAsInt()==1,"frozen fame submission failed/rewrote archival rule");
        });
        test("duplicate submitted is idempotent, stale pre-submit input cannot double cert/grade",()->{
            Env e=env();e.seedGrade(2,List.of("inventory_basic","shelter_basic"));e.call("start",e.p,"shelter_basic",true);e.houseForRun();Object stale=e.call("copy",e.observed());
            check(e.submit(),"submit");int commits=e.ledger.commits;String before=disk(e);check(e.submit(),"duplicate submitted not acknowledged");unchanged(e,before,commits);
            check(!(boolean)e.call("submit",e.p,stale),"stale active input accepted");unchanged(e,before,commits);
            check(e.academy().get("grade").getAsInt()==3&&e.academy().getAsJsonArray("history").size()==1&&e.plugin.guild.mirrors==1,"duplicate grade/history/mirror");
        });
        for(String stale:List.of("crossrun","changed_startedAt","changed_state"))test("submit rejects "+stale+" atomic ledger race",()->{
            Env e=env();e.start("shelter_basic");e.houseForRun();Object request=e.call("copy",e.observed());
            JsonObject changed=e.active().deepCopy();if(stale.equals("crossrun"))changed.addProperty("runId",UUID.randomUUID().toString());
            else if(stale.equals("changed_startedAt"))changed.addProperty("startedAt",changed.get("startedAt").getAsLong()-1);else changed.addProperty("state","cancelled");
            e.ledger.write(root->ProfessionLedger.profile(root,e.actor.id).getAsJsonObject("academy").add("active",changed));String before=disk(e);int commits=e.ledger.commits;
            check(!(boolean)e.call("submit",e.p,request),"stale ledger input committed");unchanged(e,before,commits);check(!e.academy().has("certificates"),"stale input certified");
        });
        test("fresh submit attestation binds actual actor/run/window, cannot reuse foreign stale proof",()->{
            Env e=env();readyShelter(e);JsonObject altered=e.record();JsonObject stale=altered.getAsJsonObject("proofs").getAsJsonObject("shelter");
            stale.addProperty("runId",UUID.randomUUID().toString());stale.addProperty("actorUuid",UUID.randomUUID().toString());stale.addProperty("startedAt",1L);stale.addProperty("observedAt",1L);e.replaceRun(altered);
            e.world.cells.clear();check(!e.submit(),"old ready/foreign proof bypassed live house");e.houseForRun();check(e.submit(),"fresh correct house refused");JsonObject proof=proof(e);
            check(proof.get("runId").equals(e.active().get("runId"))&&proof.get("actorUuid").getAsString().equals(e.actor.id.toString())&&proof.get("startedAt").equals(e.active().get("startedAt"))&&proof.get("observedAt").getAsLong()>=proof.get("startedAt").getAsLong(),"attestation wrong actor/run/time");
        });
        for(String primitive:List.of("shelter_basic","survey_basic","inventory_basic"))for(String event:List.of("teleport","logout","shutdown"))test(primitive+" actual "+event+" preserves durable proof and original times",()->{
            Env e=env();e.start(primitive);Object r=e.observed();((JsonObject)field(r,"proofs")).addProperty("retained_partial","server_fact");check((boolean)e.call("save",e.p,r),"seed partial proof");
            JsonObject before=e.record();int commits=e.ledger.commits;transport(e,event);check(e.active().equals(before)&&e.ledger.commits==commits,"transport changed durable record");
            e.clearMemory();Object restored=e.call("decode",e.active());check(((JsonObject)e.call("record",restored)).equals(before),"decode changed durable proof/times");
            e.call("validateLedger");check(e.summary().get("state").getAsString().equals("active"),"restart silently interrupted durable record");
        });
        for(String primitive:List.of("shelter_basic","inventory_basic"))for(String why:List.of("teleport","world_changed","logout","server_restart"))test(primitive+" old interrupted "+why+" explicit sameRun resume original expiry",()->{
            Env e=env();e.start(primitive);JsonObject old=e.record();old.addProperty("state","interrupted");old.addProperty("reason",why);old.getAsJsonObject("proofs").addProperty("retained_partial","server_fact");e.replaceRun(old);e.clearMemory();
            String before=disk(e);int commits=e.ledger.commits;JsonObject status=e.summary();check(status.get("state").getAsString().equals("interrupted")&&status.get("nextCommand").getAsString().equals("/mycli guild exam resume"),"read auto-resumed or wrong command");unchanged(e,before,commits);
            e.call("resume",e.p);check(state(e).equals("active")&&e.active().get("runId").equals(old.get("runId"))&&e.active().get("startedAt").equals(old.get("startedAt"))&&e.active().get("expiresAt").equals(old.get("expiresAt"))&&e.active().get("proofs").equals(old.get("proofs")),"resume extended/reset proof");
        });
        for(String terminal:List.of("cancelled","timeout","course_disabled"))test(terminal+" cannot resume or become ready via submit",()->{
            Env e=env();e.start("shelter_basic");JsonObject old=e.record();old.addProperty("state",terminal.equals("cancelled")?"cancelled":"interrupted");old.addProperty("reason",terminal.equals("cancelled")?"player_cancelled":terminal);
            if(terminal.equals("timeout"))old.addProperty("expiresAt",1L);e.replaceRun(old);e.houseForRun();String before=disk(e);int commits=e.ledger.commits;
            check(!(boolean)e.call("canResume",e.observed()),"terminal resumable");e.call("resume",e.p);check(!e.submit(),"terminal submitted");unchanged(e,before,commits);legal(e.summary());
        });
        test("expired ACTIVE shelter cannot gain ready/proof or resume",()->{
            Env e=env();e.start("shelter_basic");JsonObject old=e.record();old.addProperty("expiresAt",1L);e.replaceRun(old);e.houseForRun();check(!e.submit(),"expired active submitted");
            check(e.active().get("reason").getAsString().equals("timeout")&&!e.active().getAsJsonObject("proofs").has("shelter")&&!(boolean)e.call("canResume",e.observed()),"expired run has proof/resume");legal(e.summary());
        });
        test("sample batch failed forced write keeps preboundary runs without ready notice",()->{
            Env e=env();e.start("shelter_basic");e.houseForRun();JsonObject before=e.record();int messages=e.actor.messages.size();
            field(e.exam,"sampleWrites",new LinkedHashMap<UUID,JsonObject>());field(e.exam,"sampleCandidates",new LinkedHashMap<UUID,Object>());field(e.exam,"sampleNotices",new ArrayList<Runnable>());
            e.call("observeHouse",e.p,e.call("copy",e.observed()));e.ledger.fail=true;e.call("flushSamples");
            check(e.record().equals(before)&&state(e).equals("active")&&!(boolean)e.call("available"),"failed batch exposed half-ready");
            check(e.actor.messages.subList(messages,e.actor.messages.size()).stream().noneMatch(s->s.contains("实操达成")),"ready notice before durability");
        });
        int[] thresholds={0,4,7,10,17,24,30,44,57,70,97,124,150,217,284,350,450,550};
        for(int index=0;index<18;index++){final int i=index;test("grade "+i+" exact fame catalog/display "+thresholds[i],()->{
            AssessmentCatalog.Grade g=catalog.grades.get(i);check(g.fame()==thresholds[i],"catalog fame mismatch");check(Exam.invokeStaticDisplay(g).equals(g),"display dropped fame/prerequisites");
        });}
        for(int index=1;index<18;index++){final int i=index;test("grade "+i+" real fame gate and promotionInfo use fame not rankPoints",()->{
            Env e=env();e.seedGrade(i-1,catalog.definitions.keySet());e.academy().addProperty("rankPoints",999999);e.academy().addProperty("rankPointsStarted",true);
            AssessmentCatalog.Grade g=catalog.grades.get(i);e.plugin.guild.fame=g.fame()-1;
            check(e.call("promotionGate",e.p,g,true).equals("fame_required:"+g.fame())&&e.call("promotionGate",e.p,g,false).equals("fame_required:"+g.fame()),"rankPoints bypassed fame");
            JsonObject low=(JsonObject)e.call("promotionInfo",e.p);check(low.get("fameTarget").getAsInt()==g.fame()&&low.getAsJsonObject("nextGrade").get("fame").getAsInt()==g.fame()&&low.get("fameRemaining").getAsInt()==1,"promotion view fame mismatch");legal(low);
            e.plugin.guild.fame=g.fame();check(e.call("promotionGate",e.p,g,true).equals("ready"),"exact fame threshold denied");legal((JsonObject)e.call("promotionInfo",e.p));
            check(e.academy().get("grade").getAsInt()==i-1,"read/gate auto-promoted");
        });}
        for(int index:List.of(2,4,5,7,8,10,11,13,14,16,17)){final int i=index;test("small division "+i+" certificates remain mandatory, confirmation cannot skip",()->{
            Env e=env();e.seedGrade(i-1,List.of());e.plugin.guild.fame=100000;
            String gate=(String)e.call("promotionGate",e.p,catalog.grades.get(i),true);check(gate.startsWith("certificate_required:"),"small grade lost prerequisite: "+gate);
            String before=disk(e);int commits=e.ledger.commits;e.call("confirmDivision",e.p,i);unchanged(e,before,commits);check(e.academy().get("grade").getAsInt()==i-1,"missing cert promoted");
        });}
        test("major promotecondition history remains gate, small not major history",()->{
            Env e=env();e.seedGrade(2,catalog.definitions.keySet());e.plugin.guild.history=false;
            check(e.call("promotionGate",e.p,catalog.grades.get(3),true).equals("history_required"),"major history dropped");
            e.seedGrade(3,catalog.definitions.keySet());check(e.call("promotionGate",e.p,catalog.grades.get(4),true).equals("ready"),"small imposed major history");
        });
        test("distinct prerequisite groups cannot share one certificate",()->{
            Env e=env();e.seedGrade(4,List.of("inventory_basic","shelter_basic"));check(e.call("promotionGate",e.p,catalog.grades.get(5),true).equals("distinct_certificates_required"),"one cert reused across groups");
        });
        test("already-confirm idempotent keeps grade/certs/history and no second mirror",()->{
            Env e=env();e.seedGrade(0,List.of("inventory_basic"));int commits=e.ledger.commits;e.call("confirmDivision",e.p,1);check(e.academy().get("grade").getAsInt()==1&&e.ledger.commits==commits+1&&e.plugin.guild.mirrors==1,"confirm didn't apply once");
            String before=disk(e);commits=e.ledger.commits;e.plugin.guild.fame=0;e.call("confirmDivision",e.p,1);unchanged(e,before,commits);
            check(e.actor.last().get("reason").getAsString().equals("already_promoted")&&!e.actor.last().get("applied").getAsBoolean()&&e.plugin.guild.mirrors==1,"already confirmation not idempotent");
        });
        test("failed confirmation keeps old grade/certificate/history and rejects stale/skipped grades",()->{
            Env e=env();e.seedGrade(13,catalog.definitions.keySet());e.academy().add("history",new JsonArray());String before=disk(e);int commits=e.ledger.commits;e.ledger.fail=true;e.call("confirmDivision",e.p,14);unchanged(e,before,commits);
            check(e.academy().get("grade").getAsInt()==13,"failed confirm changed grade");e.ledger.fail=false;e.call("confirmDivision",e.p,16);unchanged(e,before,commits);e.call("confirmDivision",e.p,12);unchanged(e,before,commits);
        });
        test("old grade/certs/history survive new failed/cancelled run and low fame",()->{
            Env e=env();e.seedGrade(17,catalog.definitions.keySet());JsonArray h=new JsonArray();JsonObject row=new JsonObject();row.addProperty("runId",UUID.randomUUID().toString());h.add(row);e.academy().add("history",h);
            e.plugin.guild.fame=0;e.start("shelter_basic");JsonObject oldCerts=e.academy().getAsJsonObject("certificates").deepCopy();Object r=e.observed();field(r,"state","cancelled");field(r,"reason","player_cancelled");e.call("save",e.p,r);
            e.call("validateLedger");check((int)e.call("readGrade",e.p)==17&&e.academy().getAsJsonObject("certificates").equals(oldCerts)&&e.academy().getAsJsonArray("history").equals(h),"old standing rolled back");
        });
        System.out.println("RESULT passed="+passed+" failed="+failed);if(failed>0)System.exit(1);
    }
    // Calls the injected static method via an instance without copying its implementation.
    static final class Exam {static AssessmentCatalog.Grade invokeStaticDisplay(AssessmentCatalog.Grade g){return (AssessmentCatalog.Grade)invoke(env().exam,"displayedGrade",g);}}
}
