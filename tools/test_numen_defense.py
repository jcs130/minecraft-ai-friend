"""Offline fixture: actual Numen class bytes, narrow Minecraft API stubs; no server."""
from pathlib import Path
import os, subprocess, json, sys, zipfile, argparse, uuid, hashlib, re

ROOT = Path(__file__).resolve().parents[1]
HERE = None
JDK = Path(r'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin')
STUBS = {
'net.minecraft.world.phys.AABB': 'public AABB inflate(double n){return this;}',
'net.minecraft.core.Holder': '',
'net.minecraft.core.BlockPos': 'public final int x,y,z; public BlockPos(int x,int y,int z){this.x=x;this.y=y;this.z=z;} public BlockPos below(){return new BlockPos(x,y-1,z);} public BlockPos above(){return new BlockPos(x,y+1,z);}',
'net.minecraft.util.RandomSource': '@interface default double nextDouble(){return .5;}',
'net.minecraft.world.level.material.FluidState': 'public boolean isEmpty(){return true;}',
'net.minecraft.world.level.block.state.BlockState': 'private boolean air; public BlockState(boolean air){this.air=air;} public boolean isAir(){return air;} public net.minecraft.world.level.material.FluidState getFluidState(){return new net.minecraft.world.level.material.FluidState();}',
'net.minecraft.world.entity.ai.attributes.Attributes': 'public static net.minecraft.core.Holder ARMOR_TOUGHNESS=new net.minecraft.core.Holder();',
'net.minecraft.world.damagesource.DamageSource': 'public net.minecraft.world.entity.Entity owner,direct; public net.minecraft.world.entity.Entity getEntity(){return owner;} public net.minecraft.world.entity.Entity getDirectEntity(){return direct;}',
'net.minecraft.world.damagesource.DamageSources': 'public DamageSource generic(){return new DamageSource();}',
'net.minecraft.world.damagesource.CombatRules': 'public static float getDamageAfterAbsorb(net.minecraft.world.entity.LivingEntity e,float x,DamageSource d,float a,float t){return x;}',
'net.minecraft.world.level.Level': 'public long time=100; public java.util.List<net.minecraft.world.entity.Mob> mobs=new java.util.ArrayList<>(); public long getGameTime(){return time;} public <T> java.util.List<T> getEntitiesOfClass(Class<T> c,net.minecraft.world.phys.AABB b){return mobs.stream().filter(c::isInstance).map(c::cast).toList();} public boolean isLoaded(net.minecraft.core.BlockPos p){return true;} public net.minecraft.world.level.block.state.BlockState getBlockState(net.minecraft.core.BlockPos p){return new net.minecraft.world.level.block.state.BlockState(!(p.y==63 && Math.abs(p.x)<=16 && Math.abs(p.z)<=16));}',
'net.minecraft.server.level.ServerLevel extends net.minecraft.world.level.Level': 'public net.minecraft.world.damagesource.DamageSources damageSources(){return new net.minecraft.world.damagesource.DamageSources();}',
'net.minecraft.world.entity.Entity': 'public double x=.5,y=64,z=.5; public float width=.6f; public boolean alive=true; public net.minecraft.world.level.Level world; public net.minecraft.world.level.Level level(){return world;} public net.minecraft.world.phys.AABB getBoundingBox(){return new net.minecraft.world.phys.AABB();} public double getX(){return x;} public double getY(){return y;} public double getZ(){return z;} public int getBlockX(){return (int)Math.floor(x);} public int getBlockZ(){return (int)Math.floor(z);} public float getBbWidth(){return width;} public boolean isAlive(){return alive;} public double distanceToSqr(Entity e){return (x-e.x)*(x-e.x)+(y-e.y)*(y-e.y)+(z-e.z)*(z-e.z);} public boolean isRemoved(){return !alive;}',
'net.minecraft.world.entity.LivingEntity extends Entity': 'public float hp=20; public int tickCount=100,lastHurtAt=100; public LivingEntity lastHurt; public boolean visible=true; public net.minecraft.world.damagesource.DamageSource damage; public float getHealth(){return hp;} public int getArmorValue(){return 0;} public double getAttributeValue(net.minecraft.core.Holder h){return 0;} public LivingEntity getLastHurtByMob(){return lastHurt;} public int getLastHurtByMobTimestamp(){return lastHurtAt;} public boolean hasLineOfSight(Entity e){return visible;} public net.minecraft.world.damagesource.DamageSource getLastDamageSource(){return damage;}',
'net.minecraft.world.entity.Mob extends LivingEntity': 'public LivingEntity target; public LivingEntity getTarget(){return target;}',
'net.minecraft.world.entity.monster.Enemy': '@interface',
'net.minecraft.world.entity.monster.RangedAttackMob': '@interface',
'net.minecraft.world.entity.monster.Creeper extends net.minecraft.world.entity.Mob implements Enemy': 'public int getSwellDir(){return 0;} public boolean isIgnited(){return false;} public boolean isPowered(){return false;}',
'net.minecraft.world.entity.boss.enderdragon.EndCrystal extends net.minecraft.world.entity.Entity': '',
'net.minecraft.server.level.ServerPlayer extends net.minecraft.world.entity.LivingEntity': '',
'com.dwinovo.numen.entity.NumenPlayer extends net.minecraft.server.level.ServerPlayer': 'public boolean paused; public boolean reflexPaused(String x){return paused;} public void setShiftKeyDown(boolean b){} public void pauseReflex(String s){paused=true;}',
'com.dwinovo.numen.task.TaskState': '@enum RUNNING,SUCCESS,FAILED,CANCELLED',
'com.dwinovo.numen.task.Task': '@interface enum StopReason{PREEMPTED,CANCELLED;} default boolean canRun(com.dwinovo.numen.entity.NumenPlayer p){return true;} default TaskState tick(com.dwinovo.numen.entity.NumenPlayer p){return TaskState.RUNNING;} default void start(com.dwinovo.numen.entity.NumenPlayer p){} default void stop(com.dwinovo.numen.entity.NumenPlayer p,StopReason w){} default String name(){return "fixture";}',
'com.dwinovo.numen.task.reflex.Reflex': '@interface String id();String describe();',
'com.dwinovo.numen.task.TaskResult': 'public String message(){return "fixture done";}',
'com.dwinovo.numen.core.task.combat.AttackTaskRecord': 'public AttackTaskRecord(String s,long l,java.util.List<Integer> ids,boolean b){}',
'com.dwinovo.numen.core.task.combat.AttackCompanionTask': 'public static boolean lastRetreat,blocked,keepRunning; public boolean retreatBlocked(){return blocked;} public void retreatFromDanger(){lastRetreat=true;} public AttackCompanionTask(com.dwinovo.numen.entity.NumenPlayer p,AttackTaskRecord r){lastRetreat=false;} public AttackCompanionTask(com.dwinovo.numen.entity.NumenPlayer p,AttackTaskRecord r,boolean retreat){lastRetreat=retreat;} public void start(com.dwinovo.numen.entity.NumenPlayer p){} public com.dwinovo.numen.task.TaskState tick(com.dwinovo.numen.entity.NumenPlayer p){return keepRunning? com.dwinovo.numen.task.TaskState.RUNNING:com.dwinovo.numen.task.TaskState.SUCCESS;} public void stop(com.dwinovo.numen.entity.NumenPlayer p,com.dwinovo.numen.task.Task.StopReason w){} public com.dwinovo.numen.task.TaskResult result(com.dwinovo.numen.task.TaskState s){return new com.dwinovo.numen.task.TaskResult();}',
'com.dwinovo.numen.permission.Action': 'public static Action attack(net.minecraft.world.entity.Entity e){return new Action();}',
'com.dwinovo.numen.permission.Verdict': 'public boolean allowed(){return Permission.allow;}',
'com.dwinovo.numen.permission.Permission': 'public static boolean allow=true; public static Verdict judge(com.dwinovo.numen.entity.NumenPlayer p,Action a){return new Verdict();}',
'com.dwinovo.numen.entity.InputDriver': 'public static void halt(net.minecraft.server.level.ServerPlayer p){}',
'com.dwinovo.numen.event.NumenEvents': 'public static void reflex(com.dwinovo.numen.entity.NumenPlayer p,com.dwinovo.numen.task.reflex.Reflex r,String s){}',
'org.slf4j.Logger': '@interface default void info(String s,Object a){} default void info(String s,Object a,Object b){}',
'com.dwinovo.numen.Constants': 'public static final org.slf4j.Logger LOG=new org.slf4j.Logger(){};',
}

STUBS['net.minecraft.world.entity.Entity'] += ' public int getBlockY(){return (int)Math.floor(y);}'
STUBS['net.minecraft.world.entity.LivingEntity extends Entity'] += ' public net.minecraft.util.RandomSource getRandom(){return new net.minecraft.util.RandomSource(){};}'

TEST = '''
import com.dwinovo.numen.entity.NumenPlayer;
import com.dwinovo.numen.core.task.chain.MobDefenseChain;
import com.dwinovo.numen.core.combat.Menace;
import com.dwinovo.numen.core.combat.Haven;
import com.dwinovo.numen.task.*;
import net.minecraft.world.entity.*;
import net.minecraft.world.entity.monster.*;
import net.minecraft.world.level.Level;
import java.util.*;
import com.dwinovo.numen.core.task.combat.AttackCompanionTask;
public class DefenseFixture {
 static class Hostile extends Mob implements Enemy {}
 static class Shooter extends Hostile implements RangedAttackMob {}
 static int checks,failed;
 static void check(String name,boolean got,boolean want){checks++; if(got!=want)failed++;System.out.println(name+": "+got+" expected="+want);}
 static NumenPlayer self(){NumenPlayer p=new NumenPlayer();p.world=new Level();return p;}
 static <T extends Mob>T foe(NumenPlayer p,T m,double dx){m.world=p.world;m.x=p.x+dx;m.target=p;p.world.mobs.add(m);return m;}
 public static void main(String[] args) throws Exception {
  for(double d:new double[]{5,8,12,20}){NumenPlayer p=self();Shooter m=foe(p,new Shooter(),d);p.lastHurt=m; check("shot_at_"+d,new MobDefenseChain().canRun(p),true);}
  NumenPlayer p=self();Hostile m=foe(p,new Hostile(),8);check("distant_melee",new MobDefenseChain().canRun(p),false);
  p=self();m=foe(p,new Hostile(),2);check("near_melee",new MobDefenseChain().canRun(p),true);
  p=self();Shooter s=foe(p,new Shooter(),5);s.y+=2;p.lastHurt=s;check("flying_fairy",new MobDefenseChain().canRun(p),true);
  p=self();s=foe(p,new Shooter(),5);p.lastHurt=s;com.dwinovo.numen.permission.Permission.allow=false;check("named_rick_avoid",new MobDefenseChain().canRun(p),true);com.dwinovo.numen.permission.Permission.allow=true;
  p=self();s=foe(p,new Shooter(),8);p.lastHurt=s;p.hp=5;p.paused=true;check("hurt_low_hp_paused",new MobDefenseChain().canRun(p),true);
  p=self();s=foe(p,new Shooter(),8);s.target=null;check("unengaged_shooter",new MobDefenseChain().canRun(p),false);
  p=self();Mob passive=foe(p,new Mob(),2);passive.target=null;check("neutral_bystander",new MobDefenseChain().canRun(p),false);
  p=self();s=foe(p,new Shooter(),33);p.lastHurt=s;check("outside_bounded_range",new MobDefenseChain().canRun(p),false);
  p=self();s=foe(p,new Shooter(),8);p.lastHurt=s;MobDefenseChain reflex=new MobDefenseChain();Task sync=new Task(){};check("reflex_preempts_sync",TaskSelector.select(List.of(reflex),sync,null,List.of(),p)==reflex,true);
  p=self();s=foe(p,new Shooter(),5);p.lastHurt=s;reflex=new MobDefenseChain();reflex.tick(p);p.world.mobs.clear();s.alive=false;reflex.tick(p);check("release_after_terminal_and_threat_gone",reflex.canRun(p),false);
  p=self();s=foe(p,new Shooter(),5);p.lastHurt=s;p.visible=false;check("recent_hit_without_line_of_sight",new MobDefenseChain().canRun(p),true);p.lastHurt=null;check("target_behind_wall_without_hit",new MobDefenseChain().canRun(p),false);
  p=self();s=foe(p,new Shooter(),8);s.target=null;p.lastHurt=s;p.tickCount=201;check("stale_hit_expires",new MobDefenseChain().canRun(p),false);
  p=self();s=foe(p,new Shooter(),5);reflex=new MobDefenseChain();reflex.tick(p);check("ranged_routes_to_retreat_only",AttackCompanionTask.lastRetreat,true);
  p=self();m=foe(p,new Hostile(),2);reflex=new MobDefenseChain();reflex.tick(p);check("ordinary_melee_keeps_existing_combat",AttackCompanionTask.lastRetreat,false);foe(p,new Shooter(),8);reflex.tick(p);check("new_ranged_threat_switches_existing_defense",AttackCompanionTask.lastRetreat,true);
  p=self();s=foe(p,new Shooter(),5);reflex=new MobDefenseChain();AttackCompanionTask.blocked=true;reflex.tick(p);reflex.tick(p);check("failed_retreat_yields",reflex.canRun(p),false);p.lastHurtAt++;check("fresh_hit_bypasses_failed_retry_window",reflex.canRun(p),true);p.lastHurtAt--;p.world.time+=40;check("failed_retreat_retry_is_bounded",reflex.canRun(p),true);AttackCompanionTask.blocked=false;
  p=self();s=foe(p,new Shooter(),5);check("distant_landing_absent",Haven.awayFrom(p,List.of(s))==null,true);
  boolean hasNear=false;try{var method=Haven.class.getMethod("awayFrom",LivingEntity.class,List.class,double.class);hasNear=method.invoke(null,p,List.of(s),16.0)!=null;}catch(NoSuchMethodException e){}check("nearby_waypoint_still_available",hasNear,true);
  check("waypoint_does_not_equal_safe",new MobDefenseChain().canRun(p),true);
  System.out.println("checks="+checks+" failures="+failed+" ordinaryWidthRadius="+Menace.dangerRadius(new Hostile(),self()));
  if(failed>0)System.exit(1);
 }
}
'''

def run(jar, output):
    global HERE
    HERE=Path(output).resolve();HERE.mkdir(parents=True,exist_ok=True)
    names=['combat/Menace','combat/Haven','combat/AttackPlan','combat/AttackPlan$Action','combat/AttackPlan$Move','combat/Battlefield','combat/Battlefield$Foe','task/chain/MobDefenseChain','pathing/goals/GoalAvoidEntities','pathing/goals/GoalAvoidEntities$Threat','pathing/goals/Goal','task/survival/SurvivalDecisions']
    seam=HERE/'native-seam.jar'
    with zipfile.ZipFile(jar) as archive,zipfile.ZipFile(seam,'w') as target:
        for name in names:
            entry='com/dwinovo/numen/core/'+name+'.class';target.writestr(entry,archive.read(entry))
        api=next(n for n in archive.namelist() if 'numen_api-' in n and n.endswith('.jar'))
        import io
        with zipfile.ZipFile(io.BytesIO(archive.read(api))) as embedded:
            entry='com/dwinovo/numen/task/TaskSelector.class';target.writestr(entry,embedded.read(entry))
    src=HERE/'fixture-src'; out=HERE/'fixture-classes';src.mkdir(exist_ok=True);out.mkdir(exist_ok=True)
    files=[]
    for declaration,body in STUBS.items():
        name=declaration.split()[0]; package,base=name.rsplit('.',1); extra=declaration[len(name):]
        kind='class'
        if body.startswith('@interface'):kind='interface';body=body[len('@interface'):]
        elif body.startswith('@enum '):kind='enum';body=body[len('@enum '):]
        dest=src/(name.replace('.','/')+'.java');dest.parent.mkdir(parents=True,exist_ok=True)
        dest.write_text(f'package {package}; public {kind} {base}{extra} {{ {body} }}',encoding='utf8');files.append(dest)
    test=src/'DefenseFixture.java';test.write_text(TEST,encoding='utf8');files.append(test)
    cp=str(seam)
    subprocess.run([str(JDK/'javac.exe'),'--release','21','-encoding','UTF-8','-cp',cp,'-d',str(out),*map(str,files)],check=True)
    r=subprocess.run([str(JDK/'java.exe'),'-cp',os.pathsep.join([str(out),cp]),'DefenseFixture'],capture_output=True,text=True)
    (HERE/'output.txt').write_text(r.stdout+r.stderr,encoding='utf8')
    match=re.search(r'checks=(\d+) failures=(\d+)',r.stdout)
    report={'schema':1,'ok':r.returncode==0,'exitCode':r.returncode,'jar':str(Path(jar).resolve()),'jarSha256':hashlib.sha256(Path(jar).read_bytes()).hexdigest(),'assertions':int(match[1]) if match else 0,'failed':int(match[2]) if match else None,'checks':{m[1]:m[2]==m[3] for m in re.finditer(r'^([^:\n]+): (true|false) expected=(true|false)',r.stdout,re.M)},'realBytecode':['Menace','Haven','MobDefenseChain','TaskSelector','GoalAvoidEntities'],'stubbed':['Minecraft entity/level API','AttackCompanionTask execution','Permission verdict'],'physicalVerified':False,'worldActions':0,'network':'not_used_not_isolated'}
    (HERE/'report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
    print(r.stdout,r.stderr,sep='');return report

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jar',type=Path,required=True)
    parser.add_argument('--output',type=Path,default=ROOT/'runtime/numen-defense-seam'/uuid.uuid4().hex)
    args=parser.parse_args();report=run(args.jar,args.output)
    print(json.dumps({'ok':report['ok'],'assertions':report['assertions'],'failed':report['failed'],'report':str(args.output/'report.json')}))
    return report['exitCode']
if __name__=='__main__':sys.exit(main())
