package org.afuhome.agentfriend;

import java.util.*;
import org.bukkit.entity.EntityType;

/** Authored three-beat combat, separate from admission and rewards. No artificial minimum duration,
 * invulnerability, forced victory, or killed-by-script enemies. */
final class EncounterDesign {
    static final List<String> NAMES=List.of("前庭交叉火力","毒雾与侧翼","破封守墓者");
    static final List<String> TACTICS=List.of(
        "借墙和盾挡弓手，横移躲开蓝色齐射线；先压住射手，再清近战。",
        "绿色圆圈是毒雾仪式预警，及时撤出；利用读条窗口打祭司，不要站桩追凋灵守卫。",
        "先清护卫再战守墓者。橙色扇形重劈要绕侧后；半血破封会换招，末日残血还会震荡圆圈。读条后有反击窗口。");
    private EncounterDesign(){}
    static int phase(String difficulty,double fraction){
        if("apocalypse".equals(difficulty)&&fraction<=.25)return 2;
        return fraction<=.55?1:0;
    }
    static List<DungeonWaveCatalog.Enemy> enemies(String site,int wave,List<DungeonWaveCatalog.Enemy> original){
        List<DungeonWaveCatalog.Enemy> out=new ArrayList<>();
        for(int i=0;i<original.size();i++){
            var enemy=original.get(i);
            double hp=enemy.type()==EntityType.VINDICATOR||enemy.health()>=100?220
                :enemy.type()==EntityType.WITHER_SKELETON?90:enemy.type()==EntityType.ZOMBIE||enemy.type()==EntityType.HUSK?65
                :enemy.type()==EntityType.WITCH?75:50;
            if(wave==0&&i==0){out.add(new DungeonWaveCatalog.Enemy(EntityType.SKELETON,50,"寒骨射手","QD_Ranger"));continue;}
            String name=wave==1&&i==0?"毒雾祭司":enemy.name();
            out.add(new DungeonWaveCatalog.Enemy(enemy.type(),Math.max(hp,enemy.health()),name,enemy.mythic()));
        }
        return List.copyOf(out);
    }
    static List<DungeonWaveCatalog.Enemy> pressure(String difficulty,int wave,List<DungeonWaveCatalog.Enemy> original){
        List<DungeonWaveCatalog.Enemy> out=new ArrayList<>(original);
        if(!"normal".equals(difficulty))out.add(new DungeonWaveCatalog.Enemy(EntityType.WITHER_SKELETON,80,"侧翼追猎者"));
        if("apocalypse".equals(difficulty))out.add(new DungeonWaveCatalog.Enemy(EntityType.STRAY,60,"霜骨压制手"));
        return List.copyOf(out);
    }
    static List<org.bukkit.Location> spread(List<org.bukkit.Location> candidates,int count){
        var left=new ArrayList<>(candidates);var chosen=new ArrayList<org.bukkit.Location>();
        while(chosen.size()<count&&!left.isEmpty()){
            org.bukkit.Location best=left.stream().max(Comparator.comparingDouble(at->chosen.isEmpty()?0:
                chosen.stream().mapToDouble(other->other.distanceSquared(at)).min().orElse(0))).orElseThrow();
            chosen.add(best);left.remove(best);
        }
        chosen.addAll(left);return chosen;
    }
}
