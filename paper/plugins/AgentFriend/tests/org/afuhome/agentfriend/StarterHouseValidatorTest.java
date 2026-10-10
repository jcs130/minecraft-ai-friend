package org.afuhome.agentfriend;
import java.util.*;
import static org.afuhome.agentfriend.StarterHouseValidator.*;
public final class StarterHouseValidatorTest {
    static final Pos BED=new Pos(1,1,1);
    static final class World implements Grid {
        Map<Pos,Kind> map=new HashMap<>();Set<Pos> placed=new HashSet<>();
        public Kind kind(Pos p){return map.getOrDefault(p,Kind.AIR);}public boolean placed(Pos p){return placed.contains(p);}
        void set(int x,int y,int z,Kind k){Pos p=new Pos(x,y,z);map.put(p,k);placed.add(p);}
    }
    static World home(){World w=new World();
        for(int x=0;x<5;x++)for(int z=0;z<5;z++){w.set(x,0,z,Kind.SOLID);w.set(x,3,z,Kind.SOLID);
            if(x==0||x==4||z==0||z==4){w.set(x,1,z,Kind.SOLID);w.set(x,2,z,Kind.SOLID);}}
        w.set(1,1,1,Kind.BED);w.set(1,1,2,Kind.BED_HEAD);w.set(2,1,0,Kind.DOOR);w.set(2,2,0,Kind.DOOR_TOP);
        w.set(0,2,2,Kind.PANE);w.set(2,0,-1,Kind.SOLID);return w;
    }
    static int tests;static void check(String name,boolean value){if(!value)throw new AssertionError(name);tests++;System.out.println("PASS "+name);}
    public static void main(String[] args){
        check("complete furnished connected house",inspect(home(),BED).ready());
        World w=new World();for(int x=0;x<12;x++)w.set(x,0,0,Kind.SOLID);check("twelve flat planks cannot pass",!inspect(w,null).ready());
        w=home();w.set(2,3,2,Kind.AIR);check("one missing roof column rejected",!inspect(w,BED).roof());
        w=home();w.set(0,1,1,Kind.AIR);w.set(0,2,1,Kind.AIR);check("open ground-level wall rejected",!inspect(w,BED).walls());
        w=home();w.set(4,2,2,Kind.AIR);check("upper wall hole rejected",!inspect(w,BED).walls());
        w=home();w.set(0,2,2,Kind.SOLID);check("window required",!inspect(w,BED).window());
        w=home();w.set(0,2,2,Kind.SOLID);w.set(3,1,3,Kind.GLASS);w.set(3,2,3,Kind.SOLID);check("interior glass pillar is not an exterior window",!inspect(w,BED).window());
        w=home();w.set(2,1,-1,Kind.SOLID);check("blocked outside door rejected",!inspect(w,BED).door());
        w=home();w.set(2,1,1,Kind.FURNITURE);check("blocked inside door rejected",!inspect(w,BED).door());
        w=home();w.set(3,1,3,Kind.FURNITURE);check("indoor crafting/storage furniture allowed",inspect(w,BED).ready());
        w=home();w.set(2,2,0,Kind.AIR);check("incomplete door rejected",!inspect(w,BED).door());
        w=home();w.set(1,1,2,Kind.AIR);check("complete bed required",!inspect(w,BED).bed());
        w=home();w.placed.clear();w.placed.add(BED);w.placed.add(new Pos(2,1,0));w.placed.add(new Pos(0,2,2));
        for(int x=10;x<30;x++)w.set(x,1,10,Kind.SOLID);check("unrelated planks cannot claim existing house",!inspect(w,BED).construction());
        w=home();for(int x=1;x<4;x++)for(int z=1;z<4;z++)w.set(x,3,z,Kind.ROOF);check("stairs or slab roof accepted",inspect(w,BED).ready());
        w=home();w.set(3,0,3,Kind.AIR);check("floor hole rejected",!inspect(w,BED).floor());
        w=home();w.set(0,1,1,Kind.UNKNOWN);check("unknown/unloaded wall rejected",!inspect(w,BED).ready());
        w=home();w.set(2,3,2,Kind.PANE);check("glass pane is not a roof",!inspect(w,BED).roof());
        System.out.println("RESULT "+tests+" passed");
    }
}
