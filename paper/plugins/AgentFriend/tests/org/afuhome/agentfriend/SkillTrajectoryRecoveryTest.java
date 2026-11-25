package org.afuhome.agentfriend;

import com.google.gson.*;
import java.io.File;
import java.lang.reflect.*;
import java.nio.file.Path;
import java.util.*;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.event.player.*;
import static org.afuhome.agentfriend.AssessmentCatalog.*;
import static org.afuhome.agentfriend.ExamMethodBodyFixture.*;

/** Recovery uses real trajectory and lifecycle methods; points below are observed samples, not interpolated proof. */
public final class SkillTrajectoryRecoveryTest {
    static int passed,failed,serial;
    static AssessmentCatalog catalog;
    static Path artifacts;
    static void test(String name,Runnable work){try{work.run();passed++;System.out.println("PASS "+name);}catch(Throwable t){failed++;System.out.println("FAIL "+name+": "+t);t.printStackTrace(System.out);}}
    static Definition signed(Definition definition){try{Method m=AssessmentCatalog.class.getDeclaredMethod("withVersion",Definition.class);m.setAccessible(true);return (Definition)m.invoke(null,definition);}catch(Exception e){throw new RuntimeException(e);}}
    static Definition flight(){return signed(SkillTrajectoryTest.flight());}
    static Definition leap(){return signed(SkillTrajectoryTest.definition("leap_route",List.of(new Point(3,66,0),new Point(7,68,0)),2));}
    static AssessmentCatalog with(Definition definition){try{
        Map<String,Definition> definitions=new HashMap<>(catalog.definitions);definitions.put(definition.id(),definition);
        Constructor<AssessmentCatalog> c=AssessmentCatalog.class.getDeclaredConstructor(Map.class,List.class,boolean.class);c.setAccessible(true);return c.newInstance(definitions,catalog.grades,true);
    }catch(Exception e){throw new RuntimeException(e);}}
    static Env env(Definition definition){Env e=new Env(with(definition),artifacts,"exam-recovery-"+(++serial));e.actor.at=new Location(e.world.world,0,64,0);e.world.set(0,63,0,Material.STONE);
        // Synthetic course UUID is a factual external-world mapping, not a control-flow change.
        Definition d=definition;Course c=d.course();Course mapped=new Course(c.id(),e.world.id,c.min(),c.max(),c.start(),c.landing(),c.checkpoints());
        Definition actual=signed(new Definition(d.id(),d.title(),d.description(),d.primitive(),d.enabled(),d.skills(),mapped,d.timeout(),d.horizontal(),d.ascent(),d.turn(),d.backwards(),d.radius(),d.stableSeconds(),d.jumps(),d.allies(),d.allyMovement(),d.combatSupport(),d.proofs(),d.allProofs(),d.reuseTraining(),d.prerequisite(),""));e.exam.catalog=with(actual);e.start(actual.id());check(e.run()!=null,"real start rejected synthetic legal course");return e;}
    static SkillTrajectory trajectory(Env e){return (SkillTrajectory)field(e.observed(),"trajectory");}
    static SkillTrajectoryTest.Path path(SkillTrajectory trajectory,Definition definition){SkillTrajectoryTest.Path p=new SkillTrajectoryTest.Path(definition);p.t=trajectory;p.sample(new Point(0,64,0),true,false);return p;}
    static void metricEqual(JsonObject actual,JsonObject expected){for(String key:List.of("checkpoints","landedJumps","horizontalDistance","backwardsDistance","ascent","descent","turnDegrees"))check(Math.abs(actual.get(key).getAsDouble()-expected.get(key).getAsDouble())<.011,"changed verified "+key+": "+actual+" != "+expected);}
    static void teleport(Env e){e.call("teleport",new PlayerTeleportEvent(e.p,e.actor.at,e.actor.at.clone().add(30,0,0),PlayerTeleportEvent.TeleportCause.COMMAND));}
    static void location(Env e,Point p,boolean ground){e.actor.at=new Location(e.world.world,p.x(),p.y(),p.z());e.actor.ground=ground;if(ground)e.world.set((int)p.x(),(int)p.y()-1,(int)p.z(),Material.STONE);}
    public static void main(String[] args)throws Exception{
        catalog=AssessmentCatalog.load(new File(args[0]));artifacts=Path.of(args[1]);
        for(String primitive:List.of("contract_record","native_lesson"))for(String reason:List.of("teleport","world_changed","logout","server_restart"))test("durable policy old "+primitive+" "+reason+" only explicit unexpired interrupted resume",()->{
            check(ExamLifecyclePolicy.durable(primitive),"not durable");check(ExamLifecyclePolicy.resumable(primitive,"interrupted",reason,1000,999),"old record not resumable");
            check(!ExamLifecyclePolicy.resumable(primitive,"active",reason,1000,999)&&!ExamLifecyclePolicy.resumable(primitive,"ready",reason,1000,999)&&!ExamLifecyclePolicy.resumable(primitive,"submitted",reason,1000,999)&&!ExamLifecyclePolicy.resumable(primitive,"interrupted",reason,1000,1000),"implicit/terminal/expired resume");
        });
        for(String primitive:List.of("flight_route","leap_route","support_route"))test("continuous "+primitive+" durable=false and allowlisted resumability",()->{
            check(!ExamLifecyclePolicy.durable(primitive),"continuous durable");for(String reason:List.of("teleport","world_changed","logout","server_restart","sampling_gap","impossible_displacement"))check(ExamLifecyclePolicy.resumable(primitive,"interrupted",reason,1000,999)==!primitive.equals("support_route"),"resume policy "+reason);
            for(String reason:List.of("timeout","player_cancelled","external_damage","course_disabled","flight_recast","activity_changed"))check(!ExamLifecyclePolicy.resumable(primitive,"interrupted",reason,1000,999),"nonrecoverable reason resumed "+reason);
        });
        test("suspend before first checkpoint reanchors at real height, no fake 64-block ascent",()->{
            Definition d=flight();SkillTrajectoryTest.Path p=new SkillTrajectoryTest.Path(d);p.fly(new Point(1,65,1));check(p.t.checkpoint()==0,"setup hit checkpoint");p.t.suspend();
            check(p.t.measurements().get("horizontalDistance").getAsDouble()==0&&p.t.measurements().get("ascent").getAsDouble()==0,"unverified prefix retained");
            check(p.t.resumeAt(d.course().start(),true),"legal start refused");p.sample(d.course().start(),true,false);p.sample(new Point(0,65,1),true,false);
            check(p.t.measurements().get("ascent").getAsDouble()==1&&!p.t.ready(),"originHeight reset to zero invented ascent: "+p.t.measurements());
        });
        test("checkpoint suspend discards segment and preserves exact verified metrics",()->{
            Definition d=flight();SkillTrajectoryTest.Path p=new SkillTrajectoryTest.Path(d);p.fly(new Point(0,68,8));JsonObject verified=p.t.measurements().getAsJsonObject("verifiedCheckpoint").deepCopy();
            p.fly(new Point(3,70,8));check(p.t.measurements().get("horizontalDistance").getAsDouble()>verified.get("horizontalDistance").getAsDouble(),"no unverified segment");p.t.suspend();metricEqual(p.t.measurements(),verified);
            check(!p.t.ready()&&p.t.measurements().get("landingStableMs").getAsInt()==0&&p.t.measurements().get("jumpHeight").getAsInt()==0,"suspend retained landing/jump transient");
        });
        test("trajectory copy isolated from later suspend/new samples",()->{
            Definition d=flight();SkillTrajectoryTest.Path p=new SkillTrajectoryTest.Path(d);p.fly(new Point(0,68,8));p.fly(new Point(3,70,8));SkillTrajectory snapshot=p.t.copy();JsonObject before=snapshot.measurements();p.t.suspend();p.fly(new Point(4,70,8));check(snapshot.measurements().equals(before),"copy aliased recovery/metrics");
        });
        test("restore keeps only persisted verifiedCheckpoint, never unsaved trajectory totals",()->{
            Definition d=flight();SkillTrajectoryTest.Path p=new SkillTrajectoryTest.Path(d);p.fly(new Point(0,68,8));JsonObject verified=p.t.measurements().getAsJsonObject("verifiedCheckpoint").deepCopy();p.fly(new Point(3,70,8));
            JsonObject saved=p.t.measurements();saved.addProperty("horizontalDistance",99999);saved.addProperty("ascent",99999);SkillTrajectory restored=SkillTrajectory.restore(d,saved);metricEqual(restored.measurements(),verified);
            check(restored.resumeAt(d.course().checkpoints().getFirst(),false),"flight prior checkpoint rejected");check(!restored.ready(),"restore auto-ready");
        });
        test("old metadata checkpoints retained but cannot reconstruct missing movement/jump proof",()->{
            JsonObject old=new JsonObject();old.addProperty("checkpoints",1);old.addProperty("landedJumps",99);old.addProperty("horizontalDistance",9999);old.addProperty("ascent",9999);old.addProperty("turnDegrees",180);old.addProperty("backwardsDistance",99);
            SkillTrajectory t=SkillTrajectory.restore(leap(),old);check(t.checkpoint()==1&&t.measurements().get("landedJumps").getAsInt()==1,"old checkpoint bound");
            check(t.measurements().get("horizontalDistance").getAsDouble()==0&&t.measurements().get("ascent").getAsDouble()==0&&!t.ready(),"old metadata forged missing trajectory");
        });
        test("old checkpoint metadata first resumed segment cannot invent zero-origin ascent",()->{
            Definition d=flight();JsonObject old=new JsonObject();old.addProperty("checkpoints",1);SkillTrajectory t=SkillTrajectory.restore(d,old);
            Point origin=d.course().checkpoints().getFirst();check(t.resumeAt(origin,false),"old prior checkpoint");t.accept(new SkillTrajectory.Sample(1000,origin,0,true,false),true,true);t.accept(new SkillTrajectory.Sample(1250,new Point(origin.x()+1,origin.y()+1,origin.z()),0,true,false),true,true);
            check(t.measurements().get("ascent").getAsDouble()<=1,"missing old origin created fake ascent: "+t.measurements());
        });
        test("resumeAt validates start/on-ground or previous checkpoint, not arbitrary/future points",()->{
            Definition d=flight();SkillTrajectoryTest.Path p=new SkillTrajectoryTest.Path(d);
            check(!p.t.resumeAt(d.course().start(),false)&&!p.t.resumeAt(new Point(30,64,30),true)&&!p.t.resumeAt(d.course().checkpoints().get(1),false)&&!p.t.resumeAt(new Point(100,64,0),true),"unverified entry accepted");
            p.fly(d.course().checkpoints().getFirst());p.t.suspend();check(p.t.resumeAt(d.course().checkpoints().getFirst(),false)&&p.t.resumeAt(d.course().start(),true),"valid recovery location rejected");check(!p.t.resumeAt(d.course().checkpoints().get(1),false),"future checkpoint accepted");
        });
        test("flight completion after suspend requires real verified route and stable landing",()->{
            Definition d=flight();SkillTrajectoryTest.Path p=new SkillTrajectoryTest.Path(d);p.fly(d.course().checkpoints().getFirst());p.fly(new Point(3,70,8));p.t.suspend();p.sample(d.course().checkpoints().getFirst(),true,false);
            p.fly(new Point(8,68,8));p.fly(new Point(8,71,16));p.yaw=0;p.fly(new Point(8,71,11));p.land(new Point(8,64,20));check(p.t.ready(),"real continued route refused");
        });
        test("flight tp displacement rejected without donating distance/checkpoint",()->{
            Definition d=flight();SkillTrajectoryTest.Path p=new SkillTrajectoryTest.Path(d);p.fly(d.course().checkpoints().getFirst());JsonObject verified=p.t.measurements().getAsJsonObject("verifiedCheckpoint").deepCopy();
            check(p.sample(new Point(40,90,40),true,false).equals("impossible_displacement"),"tp accepted");p.t.suspend();metricEqual(p.t.measurements(),verified);check(!p.t.ready(),"teleport made ready");
        });
        test("first leap suspend loses unfinished jump; ordinary short jump never substitutes",()->{
            Definition d=leap();SkillTrajectoryTest.Path p=new SkillTrajectoryTest.Path(d);p.t.jump(64);p.fly(new Point(2,72,0));p.t.suspend();check(p.t.checkpoint()==0&&p.t.measurements().get("landedJumps").getAsInt()==0,"unfinished leap retained");
            p.sample(d.course().start(),true,false);p.t.jump(64);p.fly(new Point(3,66,0));p.land(new Point(3,66,0));check(p.t.checkpoint()==0&&!p.t.ready(),"suspended apex donated to later short leap");
        });
        test("leap first verified landing retained; tp second leap discarded and genuinely recast",()->{
            Definition d=leap();SkillTrajectoryTest.Path p=new SkillTrajectoryTest.Path(d);p.t.jump(64);p.fly(new Point(3,72,0));p.land(new Point(3,66,0));check(p.t.checkpoint()==1,"first leap");JsonObject verified=p.t.measurements().getAsJsonObject("verifiedCheckpoint").deepCopy();
            p.t.jump(66);p.sample(new Point(3,66,0),true,false);check(p.sample(new Point(35,90,35),true,false).equals("impossible_displacement"),"leap tp accepted");p.t.suspend();metricEqual(p.t.measurements(),verified);
            check(!p.t.resumeAt(new Point(7,68,0),true)&&!p.t.resumeAt(new Point(3,66,0),false)&&p.t.resumeAt(new Point(3,66,0),true),"leap recovery platform validation");
            p.sample(new Point(3,66,0),false,true);p.t.jump(66);p.fly(new Point(7,74,0));p.land(new Point(7,68,0));check(p.t.ready()&&p.t.measurements().get("landedJumps").getAsInt()==2,"real second leap recast refused");
        });
        for(String kind:List.of("flight","leap"))for(String event:List.of("teleport","logout","shutdown"))test("actual "+kind+" "+event+" retains verifiedCheckpoint/run/expiry and suspends segment",()->{
            Definition d=kind.equals("flight")?flight():leap();Env e=env(d);SkillTrajectory t=trajectory(e);Definition actual=(Definition)field(e.observed(),"definition");SkillTrajectoryTest.Path p=path(t,actual);
            if(kind.equals("flight")){p.fly(actual.course().checkpoints().getFirst());p.fly(new Point(3,70,8));}else{p.t.jump(64);p.fly(new Point(3,72,0));p.land(new Point(3,66,0));p.t.jump(66);p.fly(new Point(4,73,0));}
            JsonObject verified=t.measurements().getAsJsonObject("verifiedCheckpoint").deepCopy();field(e.run(),"castAt",System.currentTimeMillis());field(e.run(),"castSkill",kind.equals("flight")?"flight":"warrior_sky_leap");e.call("save",e.p,e.run());JsonObject before=e.record();
            switch(event){case "teleport"->teleport(e);case "logout"->e.call("quit",new PlayerQuitEvent(e.p,(String)null));case "shutdown"->e.call("shutdown");}
            check(e.active().get("state").getAsString().equals("interrupted")&&e.active().get("runId").equals(before.get("runId"))&&e.active().get("startedAt").equals(before.get("startedAt"))&&e.active().get("expiresAt").equals(before.get("expiresAt")),"transport lost run/times");
            check(e.active().get("castAt").getAsLong()==0&&e.active().get("castSkill").getAsString().isEmpty()&&e.active().get("flightLease").getAsString().isEmpty(),"transient skill segment retained");metricEqual(e.active().getAsJsonObject("measurements"),verified);
            e.clearMemory();check(e.summary().get("nextCommand").getAsString().equals("/mycli guild exam resume"),"explicit resume not offered");
            location(e,new Point(30,64,30),true);int commits=e.ledger.commits;e.call("resume",e.p);check(e.ledger.commits==commits&&e.summary().get("state").getAsString().equals("interrupted"),"bad location resumed");
            location(e,actual.course().checkpoints().getFirst(),kind.equals("leap"));e.call("resume",e.p);check(e.active().get("state").getAsString().equals("active")&&e.active().get("expiresAt").equals(before.get("expiresAt")),"sameRun resume extended expiry");
            check(e.active().get("castAt").getAsLong()==0,"resume magically recast paid skill");
        });
        test("actual flight first cast validates legal start, cannot cast at arbitrary point",()->{
            Env e=env(flight());Definition d=(Definition)field(e.run(),"definition");location(e,new Point(30,68,30),false);e.plugin.leases.lease=new FlightLeases.Lease(UUID.randomUUID(),"flight",System.currentTimeMillis(),1);e.call("cast",e.p,"flight");
            check(e.active().get("castAt").getAsLong()==0&&!e.active().get("state").getAsString().equals("ready"),"flight illegal cast accepted");
            check(e.active().get("reason").getAsString().equals("go_to_start"),"flight illegal entry not rejected");
        });
        test("actual leap first cast must validate legal start or previous checkpoint too",()->{
            Env e=env(leap());location(e,new Point(30,64,30),true);e.call("cast",e.p,"warrior_sky_leap");
            check(e.active().get("castAt").getAsLong()==0,"leap first cast bypassed legal start/verified checkpoint");
        });
        test("actual continuous decode/restart suspends volatile segment without rewriting ledger on status",()->{
            Env e=env(flight());Definition d=(Definition)field(e.run(),"definition");SkillTrajectoryTest.Path p=path(trajectory(e),d);p.fly(d.course().checkpoints().getFirst());JsonObject verified=p.t.measurements().getAsJsonObject("verifiedCheckpoint").deepCopy();p.fly(new Point(3,70,8));e.call("save",e.p,e.run());JsonObject stored=e.active().deepCopy();int commits=e.ledger.commits;e.clearMemory();
            e.call("validateLedger");JsonObject summary=e.summary();check(summary.get("state").getAsString().equals("interrupted")&&summary.get("reason").getAsString().equals("server_restart")&&summary.get("nextCommand").getAsString().equals("/mycli guild exam resume"),"restart didn't require explicit resume");
            metricEqual(((JsonObject)e.call("measurements",e.observed())),verified);check(e.active().equals(stored)&&e.ledger.commits==commits,"status persisted/recreated old run");
        });
        test("real sampler suspends missing segment and preserves original deadline/proofs",()->{
            Env e=env(flight());Object run=e.observed();SkillTrajectory t=trajectory(e);long before=System.currentTimeMillis()-2000;
            t.accept(new SkillTrajectory.Sample(before,new Point(0,64,0),0,true,false),true,false);
            t.accept(new SkillTrajectory.Sample(before+250,new Point(1,65,0),0,true,false),true,false);
            field(run,"trajectory",t);field(run,"castAt",before);field(run,"castSkill","flight");e.call("save",e.p,run);
            JsonObject original=e.record();location(e,new Point(1,65,0),false);e.actor.flying=true;
            e.call("sampleTrajectory",e.p,e.observed());
            check(e.active().get("state").getAsString().equals("interrupted")&&e.active().get("reason").getAsString().equals("sampling_gap"),"sampling gap silently continued");
            check(e.active().get("expiresAt").equals(original.get("expiresAt"))&&e.active().get("proofs").equals(original.get("proofs")),"gap erased verified proofs or extended deadline");
            check(e.active().getAsJsonObject("measurements").get("horizontalDistance").getAsDouble()==0,"unverified gap distance retained");
        });
        System.out.println("RESULT passed="+passed+" failed="+failed);if(failed>0)System.exit(1);
    }
}
