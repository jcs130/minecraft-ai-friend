package org.afuhome.agentfriend;

import java.io.File;
import java.util.*;
import static org.afuhome.agentfriend.AssessmentCatalog.*;

/** Adversarial paths, resource validation and rank compatibility, independent of Bukkit tick execution. */
public final class SkillTrajectoryTest {
    static int assertions;
    static void check(String name,boolean ok){if(!ok)throw new AssertionError(name);assertions++;System.out.println("PASS "+name);}
    static void reject(String name,Runnable action){try{action.run();}catch(RuntimeException expected){check(name,true);return;}throw new AssertionError(name);}
    static Definition definition(String primitive,List<Point> checkpoints,int jumps) {
        Course c=new Course("test_course",UUID.fromString("8cf3c1b0-3e1d-4f07-969e-b277e5892e93"),new Point(-8,55,-8),new Point(48,96,48),
                new Point(0,64,0),checkpoints.getLast(),checkpoints);
        return new Definition("test_exam","test","test",primitive,true,primitive.equals("flight_route")?List.of("flight"):List.of("warrior_sky_leap"),c,
                120,primitive.equals("flight_route")?24:2,primitive.equals("flight_route")?3:6,primitive.equals("flight_route")?60:0,
                primitive.equals("flight_route")?4:0,1.5,2,jumps,1,4,false,List.of(),true,false,"","");
    }
    static final class Path {
        SkillTrajectory t;long clock=1000;Point point=new Point(0,64,0);double yaw;
        Path(Definition d){t=new SkillTrajectory(d);sample(point,true,false);}
        String sample(Point p,boolean air,boolean ground){clock+=250;point=p;return t.accept(new SkillTrajectory.Sample(clock,p,yaw,air,ground),true,true);}
        void fly(Point target){double dx=target.x()-point.x(),dy=target.y()-point.y(),dz=target.z()-point.z();int n=Math.max(1,(int)Math.ceil(point.distance(target)/1.4));Point from=point;
            for(int i=1;i<=n;i++)sample(new Point(from.x()+dx*i/n,from.y()+dy*i/n,from.z()+dz*i/n),true,false);}
        void land(Point target){fly(target);for(int i=0;i<12;i++)sample(target,false,true);}
    }
    static Definition flight(){return definition("flight_route",List.of(new Point(0,68,8),new Point(8,68,8),new Point(8,71,16),new Point(8,64,20)),1);}
    static void goodFlight(Path p,boolean backwards) {
        p.fly(new Point(0,68,8));p.fly(new Point(8,68,8));p.fly(new Point(8,71,16));
        p.yaw=backwards?0:180;p.fly(new Point(8,71,11));p.yaw=0;p.land(new Point(8,64,20));
    }
    public static void main(String[] args)throws Exception {
        AssessmentCatalog catalog=AssessmentCatalog.load(new File(args[0]));
        check("ten native assessments",catalog.definitions.size()==10);check("18 ordered grades",catalog.grades.size()==18);
        check("old major thresholds retained",catalog.grades.get(3).fame()==10&&catalog.grades.get(6).fame()==30&&catalog.grades.get(15).fame()==350);
        check("real exploration and housing use appropriate configurable time windows",catalog.definitions.get("survey_basic").timeout()==86400&&catalog.definitions.get("shelter_basic").timeout()==7200);
        check("unsurveyed courses disabled",catalog.definitions.get("flight_basic").course()==null&&!catalog.definitions.get("flight_basic").enabled());
        Definition frozen=catalog.definitions.get("support_basic");check("frozen snapshot round trip",AssessmentCatalog.frozen(snapshot(frozen)).equals(frozen));
        reject("snapshot change without matching version rejected",()->AssessmentCatalog.frozen(snapshot(frozen).replace("\"allies\":1","\"allies\":2")));
        var weakened=JSON.toJsonTree(frozen).getAsJsonObject();weakened.addProperty("allyMovement",2);
        reject("skill upgrade certificates cannot lower actual movement minimum",()->validate(JSON.fromJson(weakened,Definition.class)));
        var replacement=JSON.toJsonTree(frozen).getAsJsonObject();replacement.addProperty("primitive","native_lesson");replacement.add("skills",new com.google.gson.JsonArray());
        var oneProof=new com.google.gson.JsonArray();oneProof.add("cli_list");replacement.add("proofs",oneProof);
        reject("skill upgrade certificate cannot become a CLI lookup lesson",()->validate(JSON.fromJson(replacement,Definition.class)));
        check("one certificate cannot fill two portfolio groups",!distinctGroups(List.of(List.of("a","b"),List.of("a")),Set.of("a")));
        check("portfolio matching finds distinct assignment",distinctGroups(List.of(List.of("a","b"),List.of("a")),Set.of("a","b")));
        Path good=new Path(flight());goodFlight(good,true);check("complete paid air path and stable landing",good.t.ready());
        Path vertical=new Path(flight());vertical.fly(new Point(0,90,0));vertical.land(new Point(0,64,0));
        check("vertical flight has zero horizontal proof",vertical.t.measurements().get("horizontalDistance").getAsDouble()==0&&!vertical.t.ready());
        Path forward=new Path(flight());goodFlight(forward,false);check("turning around and flying forward is not backwards",forward.t.measurements().get("backwardsDistance").getAsDouble()==0&&!forward.t.ready());
        Path wrong=new Path(flight());wrong.fly(new Point(8,71,16));wrong.fly(new Point(8,68,8));wrong.fly(new Point(0,68,8));wrong.land(new Point(8,64,20));
        check("out of order checkpoints do not pass",!wrong.t.ready());
        Path noLanding=new Path(flight());noLanding.fly(new Point(0,68,8));noLanding.fly(new Point(8,68,8));noLanding.fly(new Point(8,71,16));noLanding.yaw=0;noLanding.fly(new Point(8,71,11));noLanding.fly(new Point(8,64,20));
        check("airborne at landing coordinate is insufficient",!noLanding.t.ready());
        Path gap=new Path(flight());gap.fly(new Point(0,68,8));double distance=gap.t.measurements().get("horizontalDistance").getAsDouble();gap.clock+=1500;gap.sample(new Point(8,68,8),true,false);
        check("lag gap never interpolates distance",gap.t.measurements().get("horizontalDistance").getAsDouble()==distance&&gap.t.measurements().get("samplingGaps").getAsInt()==1);
        Path teleport=new Path(flight());check("unobserved high speed displacement rejected",teleport.sample(new Point(20,80,20),true,false).equals("impossible_displacement"));
        Path boundary=new Path(flight());check("course boundary enforced",boundary.sample(new Point(100,64,100),true,false).equals("outside_course"));
        SkillTrajectory unpowered=new SkillTrajectory(flight());unpowered.accept(new SkillTrajectory.Sample(1000,new Point(0,64,0),0,true,false),false,false);
        unpowered.accept(new SkillTrajectory.Sample(1250,new Point(0,65,2),0,true,false),false,false);
        check("unpaid air movement does not count",unpowered.measurements().get("horizontalDistance").getAsDouble()==0);
        Definition leaps=definition("leap_route",List.of(new Point(3,66,0),new Point(7,68,0)),2);Path leap=new Path(leaps);
        Path fastLeap=new Path(leaps);fastLeap.t.jump(64);fastLeap.sample(new Point(0,64,0),true,false);check("legitimate native high leap velocity is accepted",!fastLeap.sample(new Point(0,71,0),true,false).equals("impossible_displacement"));
        Path leapTeleport=new Path(leaps);leapTeleport.t.jump(64);leapTeleport.sample(new Point(0,64,0),true,false);check("leap envelope still rejects a teleport jump",leapTeleport.sample(new Point(20,90,20),true,false).equals("impossible_displacement"));
        leap.t.jump(64);leap.fly(new Point(3,72,0));leap.land(new Point(3,66,0));check("first actual leap only completes first platform",!leap.t.ready()&&leap.t.checkpoint()==1);
        leap.t.jump(66);leap.fly(new Point(7,74,0));leap.land(new Point(7,68,0));check("two paid independent leaps with ordered stable landings",leap.t.ready());
        Path low=new Path(definition("leap_route",List.of(new Point(3,64,0)),1));low.t.jump(64);low.fly(new Point(3,66,0));low.land(new Point(3,64,0));check("ordinary jump cannot pass high leap",!low.t.ready());
        for(double height:new double[]{8,12,16})check("native velocity estimate "+height,Math.abs(SkillMotion.apex(SkillMotion.jumpVelocity(height))-height)<.00001);
        reject("nonfinite jump rejected",()->SkillMotion.jumpVelocity(Double.NaN));
        System.out.println("PASS total="+assertions);
    }
}
