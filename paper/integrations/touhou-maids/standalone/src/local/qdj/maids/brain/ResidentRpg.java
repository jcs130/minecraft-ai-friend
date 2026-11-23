package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import java.util.List;
import java.util.Map;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.monster.Enemy;

/** Per-body progression. Native jobs handle attacks; these modest class skills consume finite resources. */
final class ResidentRpg {
    static final String KEY="tlm_resident_rpg";
    private static final java.util.Set<java.util.UUID> reportedBackendErrors=new java.util.HashSet<>();
    static String title(String job) { return switch(job){case "knight"->"骑士";case "cleric"->"牧师";case "engineer"->"工程师";case "beastmaster"->"驯兽师";case "guardian"->"守护剑士";case "ranger"->"游侠";case "mage"->"法师";case "healer"->"行医者";case "artisan"->"工匠";default->"草药师";}; }
    static List<String> skills(String job) { return switch(job){case "guardian"->List.of("guard");case "ranger"->List.of("sprint");case "mage"->List.of("frost");case "healer","farmer"->List.of("mend");default->List.of("haste");}; }
    static CompoundTag data(EntityMaid maid) {
        var persistent=maid.getPersistentData();
        if(!persistent.contains(KEY)) {var value=new CompoundTag();value.putDouble("mana",20);value.putInt("clockVersion",2);persistent.put(KEY,value);}
        var data=persistent.getCompound(KEY);
        if(data.getInt("clockVersion")<2) {
            long oldNow=maid.level().getGameTime(),now=now(maid);
            for(String skill:List.of("guard","sprint","frost","mend","haste")) {
                String key="cooldown_"+skill;
                if(data.contains(key))data.putLong(key,now+Math.max(0,data.getLong(key)-oldNow));
            }
            data.putLong("regenerated",now);data.putInt("clockVersion",2);
        }
        return data;
    }
    static long now(EntityMaid maid){return maid.getServer().overworld().getGameTime();}
    static long experience(EntityMaid maid){return data(maid).getInt("xp")+data(maid).getLong("combatXp");}
    static int level(EntityMaid maid) { return (int)Math.min(20,1+experience(maid)/100); }
    static void xp(EntityMaid maid,int amount) { if(ResidentVortex.selected()){ResidentVortex.xp(maid.getUUID(),amount);return;}var d=data(maid);d.putInt("xp",Math.min(1_000_000,d.getInt("xp")+amount)); }
    static void tick(EntityMaid maid) {
        if(ResidentVortex.selected()){
            try{ResidentVortex.tick(maid,MaidAgentsMod.residents().role(maid.getUUID()).profession());}
            catch(RuntimeException unavailable){
                if(reportedBackendErrors.add(maid.getUUID()))java.util.logging.Logger.getLogger("VortexRPG")
                    .log(java.util.logging.Level.WARNING,"Resident RPG backend unavailable for "+maid.getUUID(),unavailable);
            }
            return;
        }
        var d=data(maid); long time=now(maid);
        if(time-d.getLong("regenerated")>=20) {d.putDouble("mana",Math.min(max(maid),d.getDouble("mana")+.25));d.putLong("regenerated",time);}
    }
    static double max(EntityMaid maid) { return 20+2*(level(maid)-1); }
    static List<Map<String,Object>> abilities(EntityMaid maid,String profession) {
        var d=data(maid);long time=now(maid);
        return skills(profession).stream().map(id->Map.<String,Object>of("id",id,
            "name",switch(id){case "guard"->"守护";case "sprint"->"疾步";case "frost"->"寒霜";case "mend"->"休养治愈";default->"勤工";},
            "manaCost",id.equals("frost")?4:5,"cooldownMs",id.equals("frost")?4000:15000,
            "cooldownRemainingMs",Math.max(0,d.getLong("cooldown_"+id)-time)*50,
            "resourceReady",d.getLong("cooldown_"+id)<=time&&d.getDouble("mana")>=(id.equals("frost")?4:5),
            "effect",switch(id){case "guard"->"本人抗性提升 I，5秒";case "sprint"->"本人速度 I，5秒";
                case "frost"->"自动选择10格内可见敌对生物，造成3至6点伤害并减速2秒，无合法目标不消耗";
                case "mend"->"治疗6格内可见的受伤同伴和自己2至4点；受伤10秒内不治疗，无有效对象不消耗";
                default->"本人急迫 I，5秒";})).toList();
    }
    static Map<String,Object> observe(EntityMaid maid,String profession) {
        if(ResidentVortex.selected())return ResidentVortex.observe(maid.getUUID());
        return Map.of("progressionSystem","resident_classes_v1","profession",profession,"title",title(profession),"level",level(maid),"xp",experience(maid),"workXp",data(maid).getInt("xp"),"combatXp",data(maid).getLong("combatXp"),
            "mana",Map.of("current",data(maid).getDouble("mana"),"max",max(maid)),"skills",skills(profession),"abilities",abilities(maid,profession));
    }
    static Map<String,Object> cast(EntityMaid maid,String profession,String id,List<LivingEntity> allies) {
        if(ResidentVortex.selected())throw new IllegalArgumentException("native_cast_requires_request_id");
        if(!skills(profession).contains(id)) throw new IllegalArgumentException("skill_not_learned_for_profession");
        var d=data(maid); long now=now(maid); int cost=id.equals("frost")?4:5;
        if(d.getLong("cooldown_"+id)>now) throw new IllegalArgumentException("skill_cooldown");
        if(d.getDouble("mana")<cost) throw new IllegalArgumentException("mana_low");
        var world=(ServerLevel)maid.level(); LivingEntity target=null; int affected=0;
        if(id.equals("frost")) {
            target=world.getEntitiesOfClass(LivingEntity.class,maid.getBoundingBox().inflate(10),e->ResidentCombat.visibleHostile(maid,e,10))
                .stream().min(java.util.Comparator.comparingDouble(maid::distanceToSqr)).orElse(null);
            if(target==null) throw new IllegalArgumentException("no_visible_hostile");
            if(!target.hurt(world.damageSources().mobAttack(maid),3+Math.min(3,level(maid)/3))) throw new IllegalArgumentException("damage_refused");
            target.addEffect(new MobEffectInstance(MobEffects.MOVEMENT_SLOWDOWN,40,0),maid); affected=1;
        } else if(id.equals("mend")) {
            // Restorative aura is deliberately out-of-combat, not unlimited combat regeneration.
            for(var ally:allies) if(ally.isAlive()&&ally.level()==world&&ally.distanceToSqr(maid)<=36&&ally.getHealth()<ally.getMaxHealth()&&
                (ally.getLastHurtByMob()==null||ally.tickCount-ally.getLastHurtByMobTimestamp()>200)&&maid.hasLineOfSight(ally)) {
                float before=ally.getHealth();ally.heal(2+Math.min(2,level(maid)/5));if(ally.getHealth()>before) affected++;
            }
            if(affected==0) throw new IllegalArgumentException("no_injured_out_of_combat_ally");
        } else {
            var effect=switch(id){case "guard"->MobEffects.DAMAGE_RESISTANCE;case "sprint"->MobEffects.MOVEMENT_SPEED;default->MobEffects.DIG_SPEED;};
            if(!maid.addEffect(new MobEffectInstance(effect,100,0))) throw new IllegalArgumentException("effect_unchanged");
            affected=1;
        }
        d.putDouble("mana",d.getDouble("mana")-cost); d.putLong("cooldown_"+id,now+(id.equals("frost")?80:300));xp(maid,1);
        var at=target==null?maid.position():target.position();
        world.sendParticles(id.equals("frost")?ParticleTypes.SNOWFLAKE:ParticleTypes.HAPPY_VILLAGER,at.x,at.y+1,at.z,14,.4,.5,.4,.02);
        return Map.of("status","completed","completed",true,"reason","skill_applied","skill",id,"affected",affected,"manaSpent",cost);
    }
    static Map<String,Object> cast(EntityMaid maid,String profession,String id,List<LivingEntity> allies,java.util.UUID request){
        return ResidentVortex.selected()?ResidentVortex.cast(maid,request,id):cast(maid,profession,id,allies);
    }
    static boolean mana(EntityMaid maid,double amount,boolean spend){
        if(ResidentVortex.selected())return ResidentVortex.mana(maid.getUUID(),amount,spend);
        var d=data(maid);if(d.getDouble("mana")<amount)return false;if(spend)d.putDouble("mana",d.getDouble("mana")-amount);return true;
    }
}
