"""Load the real candidate design/move classes. JVM/math checks only, not game balance acceptance."""
import argparse
import os
from pathlib import Path
import subprocess


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--jdk',type=Path,required=True)
    p.add_argument('--candidate',type=Path,required=True)
    p.add_argument('--server',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();a.output.mkdir(parents=True,exist_ok=False)
    java=a.output/'EncounterDesignProbe.java'
    java.write_text(r'''
import java.lang.reflect.*;
import java.util.*;
public class EncounterDesignProbe {
 static int checks;
 static void check(boolean yes,String label){if(!yes)throw new AssertionError(label);checks++;}
 static Method method(Class<?> c,String name,Class<?>...types)throws Exception{Method m=c.getDeclaredMethod(name,types);m.setAccessible(true);return m;}
 static Object enemy(Class<?> c,Object type,double hp,String name,String mythic)throws Exception{
  Constructor<?> ctor=c.getDeclaredConstructors()[0];
  for(Constructor<?> k:c.getDeclaredConstructors())if(k.getParameterCount()==4)ctor=k;
  ctor.setAccessible(true);return ctor.newInstance(type,hp,name,mythic);
 }
 static Object val(Class<?> c,String s){return Enum.valueOf((Class)c,s);}
 public static void main(String[] args)throws Exception{
  Class<?> design=Class.forName("org.afuhome.agentfriend.EncounterDesign");
  Class<?> enemy=Class.forName("org.afuhome.agentfriend.DungeonWaveCatalog$Enemy");
  Class<?> type=Class.forName("org.bukkit.entity.EntityType");
  Method shape=method(design,"enemies",String.class,int.class,List.class),pressure=method(design,"pressure",String.class,int.class,List.class),phase=method(design,"phase",String.class,double.class);
  Method hp=method(enemy,"health"),name=method(enemy,"name"),kind=method(enemy,"type");
  List<Object> original=List.of(enemy(enemy,val(type,"WITCH"),38,"","QD_Hexer"),enemy(enemy,val(type,"SKELETON"),31,"","QD_Ranger"),enemy(enemy,val(type,"ZOMBIE"),36,"",""));
  String before=original.toString();List<?> first=(List<?>)shape.invoke(null,"undead_crypt",0,original);
  check(first.size()==3&&name.invoke(first.getFirst()).equals("寒骨射手")&&kind.invoke(first.getFirst()).equals(val(type,"SKELETON")),"first wave authored ranged threat");
  check(original.toString().equals(before),"source definition unchanged");
  List<?> second=(List<?>)shape.invoke(null,"undead_crypt",1,original);
  check(name.invoke(second.getFirst()).equals("毒雾祭司"),"second wave authored caster");
  List<?> finalWave=(List<?>)shape.invoke(null,"undead_crypt",2,List.of(enemy(enemy,val(type,"VINDICATOR"),100,"亡骸守墓者","")));
  check((Double)hp.invoke(finalWave.getFirst())==220,"authored boss base health");
  for(String mode:List.of("normal","adventure","apocalypse")){
   List<?> enemies=(List<?>)pressure.invoke(null,mode,1,first);int extra=mode.equals("normal")?0:mode.equals("adventure")?1:2;
   check(enemies.size()==first.size()+extra,"difficulty pressure count "+mode);
   check((Integer)phase.invoke(null,mode,.8)==0,"opening phase "+mode);
   check((Integer)phase.invoke(null,mode,.5)==1,"half health phase "+mode);
   check((Integer)phase.invoke(null,mode,.2)==(mode.equals("apocalypse")?2:1),"apocalypse final phase "+mode);
  }
  Class<?> moves=Class.forName("org.afuhome.agentfriend.DungeonEnemyMoves$Move");
  Method topology=method(moves,"shape"),covers=method(moves,"covers",double.class,double.class,double.class);
  Object barrage=val(moves,"CRYPT_BARRAGE"),miasma=val(moves,"CRYPT_MIASMA");
  check(topology.invoke(barrage).equals("line")&&topology.invoke(miasma).equals("circle"),"telegraph topology differs by stage");
  Method projectile=method(moves,"blocksNativeProjectile",boolean.class);
  for(Object move:moves.getEnumConstants()){
   boolean authored=move==barrage||move==miasma;
   check((Boolean)projectile.invoke(move,true)==authored,"only authored ranged enemies pause ordinary shots during windup and recovery "+move);
   check(!(Boolean)projectile.invoke(move,false),"ordinary ranged attacks remain available outside the visible skill window "+move);
  }
  check((Boolean)covers.invoke(barrage,7,.8,0),"blue line contains danger");check(!(Boolean)covers.invoke(barrage,7,1.2,0),"sidestep clears blue line");
  check((Boolean)covers.invoke(miasma,-1,2,0),"green ring covers radial interior");check(!(Boolean)covers.invoke(miasma,0,4,0),"retreat clears green ring");
  for(Object move:List.of(barrage,miasma,val(moves,"GRAVE_CLEAVE"),val(moves,"FORGE_SWEEP"),val(moves,"ECHO_NOVA"))){
   Field windup=moves.getDeclaredField("windup"),recovery=moves.getDeclaredField("recovery");windup.setAccessible(true);recovery.setAccessible(true);
   check(windup.getInt(move)>=28&&recovery.getInt(move)>=22,"visible windup and retaliation window "+move);
  }
  Class<?> location=Class.forName("org.bukkit.Location"),world=Class.forName("org.bukkit.World");Constructor<?> lc=location.getConstructor(world,double.class,double.class,double.class);
  Object testWorld=Proxy.newProxyInstance(world.getClassLoader(),new Class<?>[]{world},(proxy,m,a)->switch(m.getName()){
    case "getName"->"synthetic-design-world";case "getUID"->new UUID(0,1);case "equals"->proxy==a[0];case "hashCode"->System.identityHashCode(proxy);default->null;});
  List<Object> points=new ArrayList<>();for(double[] pos:new double[][]{{0,0},{1,0},{8,8},{8,0},{0,8},{4,4}})points.add(lc.newInstance(testWorld,pos[0],4.,pos[1]));
  List<?> spread=(List<?>)method(design,"spread",List.class,int.class).invoke(null,points,4);
  check(spread.size()==points.size()&&new HashSet<>(spread).size()==points.size(),"spawn spread keeps each real location once");
  Method distance=location.getMethod("distanceSquared",location);
  for(int i=0;i<4;i++)for(int j=i+1;j<4;j++)check((Double)distance.invoke(spread.get(i),spread.get(j))>=9,"spread discourages instant clustered wipe");
  System.out.println("PASS "+checks+" actual candidate design/move checks; no game process or player data");
 }
}
''',encoding='utf8')
    subprocess.run([str(a.jdk/'bin'/('javac.exe' if os.name=='nt' else 'javac')),'--release','21','-encoding','UTF-8','-d',str(a.output),str(java)],check=True)
    dependencies=[a.candidate,a.server/'versions/1.21.1/paper-1.21.1.jar',*sorted(a.server.glob('libraries/**/*.jar')),*[q for q in sorted(a.server.glob('plugins/*.jar')) if not q.name.startswith('AgentFriend-')]]
    cp=os.pathsep.join(str(q)for q in [a.output,*dependencies]);argfile=a.output/'java.args'
    argfile.write_text('-cp\n"'+cp.replace(chr(92),'/')+'"\nEncounterDesignProbe\n',encoding='utf8')
    subprocess.run([str(a.jdk/'bin'/('java.exe' if os.name=='nt' else 'java')),'@'+str(argfile)],check=True)


if __name__=='__main__':main()
