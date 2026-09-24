"""Run actual AttackCompanionTask bytecode against bounded pathfinder/MC fixtures.

This observes native navigation requests and retry ownership, not Minecraft movement.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jar', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    fixture = load('defense_fixture', ROOT / 'tools/test_numen_defense.py')
    walk = load('defense_walk', ROOT / 'tools/build_numen_walk_only.py')
    libraries = load('defense_cp', ROOT / 'world/botgate-src/build.py')
    stubs = dict(fixture.STUBS)
    del stubs['com.dwinovo.numen.core.task.combat.AttackCompanionTask']
    del stubs['net.minecraft.core.BlockPos']
    stubs.update({
        'net.minecraft.core.Vec3i': 'public final int x,y,z; public Vec3i(int x,int y,int z){this.x=x;this.y=y;this.z=z;}',
        'net.minecraft.core.BlockPos extends Vec3i': 'public BlockPos(int x,int y,int z){super(x,y,z);} public BlockPos below(){return new BlockPos(x,y-1,z);} public BlockPos above(){return new BlockPos(x,y+1,z);} public boolean closerThan(Vec3i p,double d){return (x-p.x)*(x-p.x)+(y-p.y)*(y-p.y)+(z-p.z)*(z-p.z)<d*d;}',
        'net.minecraft.world.phys.Vec3': 'public final double x,y,z; public Vec3(double x,double y,double z){this.x=x;this.y=y;this.z=z;} public double distanceToSqr(Vec3 p){return (x-p.x)*(x-p.x)+(y-p.y)*(y-p.y)+(z-p.z)*(z-p.z);}',
        'com.dwinovo.numen.task.TaskRecord': '',
        'com.dwinovo.numen.core.task.combat.AttackTaskRecord extends com.dwinovo.numen.task.TaskRecord': 'public AttackTaskRecord(String s,long l,java.util.List<Integer> ids,boolean b){}',
        'com.dwinovo.numen.core.task.combat.LootSweep': 'public LootSweep(com.dwinovo.numen.entity.NumenPlayer p){}',
        'com.dwinovo.numen.core.Constants': 'public static final org.slf4j.Logger LOG=new org.slf4j.Logger(){};',
        'com.dwinovo.numen.core.pathing.calc.NavGoal': '@interface static NavGoal nearGround(net.minecraft.core.BlockPos p,double r){return new NavGoal(){};} static NavGoal approachAvoiding(NavGoal n,double k,java.util.List<com.dwinovo.numen.core.pathing.goals.GoalAvoidEntities.Threat> ts){return n;}',
        'com.dwinovo.numen.core.pathing.execute.PlayerNav': '''public enum Status{RUNNING,ARRIVED,FAILED;} public static int created,stopped,ticked;public static Status status=Status.RUNNING;
        public static PlayerNav toGoal(com.dwinovo.numen.entity.NumenPlayer p,java.util.function.Supplier<com.dwinovo.numen.core.pathing.calc.NavGoal> g,double s,java.util.function.BooleanSupplier b){g.get();created++;return new PlayerNav();} public Status tick(){ticked++;return status;} public void stop(){stopped++;} public String failReason(){return "fixture no route";}''',
        'com.dwinovo.numen.core.task.base.AbstractCompanionTask<R extends com.dwinovo.numen.task.TaskRecord> implements com.dwinovo.numen.task.Task': '''protected com.dwinovo.numen.entity.NumenPlayer player; protected R r; protected com.dwinovo.numen.core.pathing.execute.PlayerNav nav; private com.dwinovo.numen.core.FailureType failure=com.dwinovo.numen.core.FailureType.UNKNOWN;
        public AbstractCompanionTask(com.dwinovo.numen.entity.NumenPlayer p,R r){player=p;this.r=r;} protected void stopNav(){if(nav!=null)nav.stop();nav=null;} protected void fail(String s,com.dwinovo.numen.core.FailureType f){failure=f;} protected com.dwinovo.numen.core.FailureType lastFailure(){return failure;}''',
        'net.minecraft.core.NonNullList<E> extends java.util.ArrayList<E>': '',
        'net.minecraft.world.entity.player.Inventory': 'public net.minecraft.core.NonNullList<net.minecraft.world.item.ItemStack> items=new net.minecraft.core.NonNullList<>();',
    })
    del stubs['com.dwinovo.numen.core.task.combat.AttackTaskRecord']
    stubs['net.minecraft.world.entity.Entity'] += ' public net.minecraft.world.phys.Vec3 position(){return new net.minecraft.world.phys.Vec3(x,y,z);} public net.minecraft.core.BlockPos blockPosition(){return new net.minecraft.core.BlockPos(getBlockX(),getBlockY(),getBlockZ());}'
    stubs['net.minecraft.world.entity.LivingEntity extends Entity'] += ' public boolean isDeadOrDying(){return !alive;}'
    stubs['com.dwinovo.numen.entity.NumenPlayer extends net.minecraft.server.level.ServerPlayer'] += ' public net.minecraft.world.entity.player.Inventory getInventory(){return new net.minecraft.world.entity.player.Inventory();}'
    stubs['org.slf4j.Logger'] += ' default void info(String s,Object... args){}'
    src = output / 'src'
    classes = output / 'classes'
    src.mkdir(exist_ok=True)
    classes.mkdir(exist_ok=True)
    files = []
    for declaration, body in stubs.items():
        name = declaration.split()[0].split('<', 1)[0]
        package, base = name.rsplit('.', 1)
        extra = declaration[len(name):]
        kind = 'class'
        if body.startswith('@interface'):
            kind, body = 'interface', body[len('@interface'):]
        elif body.startswith('@enum '):
            kind, body = 'enum', body[len('@enum '):]
        path = src / (name.replace('.', '/') + '.java')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f'package {package}; public {kind} {base}{extra} {{ {body} }}', encoding='utf8')
        files.append(path)
    test = src / 'NavigationFixture.java'
    test.write_text(TEST, encoding='utf8')
    files.append(test)
    deps = walk.embedded_dependencies(args.jar, output / 'dependencies')
    cp = os.pathsep.join([str(args.jar.resolve()), *map(str, deps), libraries.full_cp(ROOT / 'server/mc/libraries')])
    quote = lambda value: '"' + str(value).replace('\\', '/') + '"'
    argfile = output / 'javac.args'
    argfile.write_text('\n'.join(['-proc:none', '--release', '21', '-encoding', 'UTF-8', '-cp', quote(cp), '-d', quote(classes), *map(quote, files)]), encoding='utf8')
    subprocess.run([str(fixture.JDK / 'javac.exe'), '@' + str(argfile)], check=True)
    run = subprocess.run([str(fixture.JDK / 'java.exe'), '-cp', os.pathsep.join([str(classes), cp]), 'NavigationFixture'], capture_output=True, text=True)
    (output / 'output.txt').write_text(run.stdout + run.stderr, encoding='utf8')
    print(run.stdout, run.stderr)
    count = re.search(r'checks=(\d+)', run.stdout)
    check_names = re.findall(r'^([a-z][a-z0-9_]+)$', run.stdout, re.M)
    report = {'schema': 1, 'ok': run.returncode == 0, 'exitCode': run.returncode,
              'passed': int(count[1]) if run.returncode == 0 and count else 0,
              'assertions': int(count[1]) if count else 0,
              'failed': 0 if run.returncode == 0 else 1,
              'checks': {name: True for name in check_names}, 'worldActions': 0,
              'jarSha256': hashlib.sha256(args.jar.read_bytes()).hexdigest(),
              'realBytecode': ['AttackCompanionTask', 'Haven', 'Menace'],
              'stubbed': ['Minecraft API', 'PlayerNav planner/status', 'AbstractCompanionTask lifecycle'],
              'physicalVerified': False, 'productionWorldUsed': False, 'network': 'not_used_not_isolated'}
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
    return run.returncode


TEST = '''
import com.dwinovo.numen.entity.NumenPlayer;
import com.dwinovo.numen.core.task.combat.*;
import com.dwinovo.numen.core.pathing.execute.PlayerNav;
import com.dwinovo.numen.task.TaskState;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.monster.*;
import net.minecraft.world.level.Level;
import java.lang.reflect.*;
import java.util.*;
public class NavigationFixture {
 static class Shooter extends Mob implements Enemy,RangedAttackMob {}
 static int checks;
 static void check(boolean ok,String name){if(!ok)throw new AssertionError(name);checks++;System.out.println(name);}
 static Object call(AttackCompanionTask t,String name)throws Exception{Method m=AttackCompanionTask.class.getDeclaredMethod(name);m.setAccessible(true);return m.invoke(t);}
 static NumenPlayer self(){NumenPlayer p=new NumenPlayer();p.world=new Level();Shooter m=new Shooter();m.world=p.world;m.x=5.5;m.target=p;p.world.mobs.add(m);return p;}
 static AttackCompanionTask task(NumenPlayer p)throws Exception{var t=new AttackCompanionTask(p,new AttackTaskRecord("fixture",10000,List.of(),true),true);call(t,"onStart");return t;}
 public static void main(String[]a)throws Exception{
  NumenPlayer p=self();var t=task(p);check(!p.paused,"native_start_does_not_pause_reflex");
  check(call(t,"onTick")==TaskState.RUNNING,"retreat_requests_navigation");check(PlayerNav.created==1,"one_navigation_requested");
  p.world.time+=25;call(t,"onTick");check(PlayerNav.created==1 && PlayerNav.stopped==0,"pending_search_over_20_ticks_is_not_cancelled");
  p.world.time+=176;check(call(t,"onTick")==TaskState.FAILED && t.retreatBlocked(),"no_progress_has_bounded_failure");check(PlayerNav.stopped==1,"blocked_retreat_releases_navigation");
  p=self();t=task(p);PlayerNav.status=PlayerNav.Status.FAILED;call(t,"onTick");int made=PlayerNav.created;p.world.time+=1;call(t,"onTick");check(PlayerNav.created==made,"failed_route_waits_bounded_retry");
  p.world.time+=20;call(t,"onTick");p.world.time+=20;check(call(t,"onTick")==TaskState.FAILED && t.retreatBlocked(),"three_route_failures_end_retreat");
  p=self();t=task(p);PlayerNav.status=PlayerNav.Status.ARRIVED;check(call(t,"onTick")==TaskState.RUNNING,"near_waypoint_is_not_terminal_safe");
  p.world.mobs.clear();check(call(t,"onTick")==TaskState.FAILED && !t.retreatBlocked(),"threat_disappearance_releases_without_no_path_claim");
  System.out.println("checks="+checks);
 }
}
'''

if __name__ == '__main__':
    raise SystemExit(main())
