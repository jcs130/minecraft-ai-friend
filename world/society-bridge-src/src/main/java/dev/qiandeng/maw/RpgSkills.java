package dev.qiandeng.maw;

import com.google.gson.*;
import com.hollingsworth.arsnouveau.setup.registry.CapabilityRegistry;
import net.minecraft.core.BlockPos;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.game.ClientboundSetTitleTextPacket;
import net.minecraft.network.protocol.game.ClientboundSetSubtitleTextPacket;
import net.minecraft.network.protocol.game.ClientboundSetTitlesAnimationPacket;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.effect.*;
import net.minecraft.world.entity.*;
import net.minecraft.world.entity.monster.Enemy;
import net.minecraft.world.entity.animal.IronGolem;
import net.minecraft.world.item.*;
import net.minecraft.world.item.component.*;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.phys.*;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.living.*;
import net.neoforged.neoforge.event.entity.player.PlayerInteractEvent;
import java.util.*;

/** Ported stable skill IDs with native Ars mana and actual event-based progression. */
final class RpgSkills {
    static final JsonObject CATALOG=RpgMigrationBridge.load("/maw-rpg-catalog.json");
    private static final Map<UUID,Flight> FLIGHTS=new HashMap<>();
    private static final Map<UUID,Ward> WARDS=new HashMap<>();
    private static final Map<UUID,Scan> SCANS=new HashMap<>();
    private record Flight(ServerPlayer body,boolean mayfly,boolean flying,long expires){}
    private record Ward(UUID caster,long expires,float maximum){}
    private static final class Scan {final ServerPlayer player;final BlockPos origin;final int radius;final String skill;int index;final PriorityQueue<BlockPos> ores;Scan(ServerPlayer p,int radius,String skill){this.player=p;this.origin=p.blockPosition();this.radius=radius;this.skill=skill;ores=new PriorityQueue<>(Comparator.comparingDouble((BlockPos b)->b.distSqr(origin)).reversed());}}
    static void register(){
        NeoForge.EVENT_BUS.addListener((LivingDeathEvent e)->{if(e.getSource().getEntity() instanceof ServerPlayer p&&hostile(p,e.getEntity())){RpgStore.evidence(p,"kills",1);if(p.getMainHandItem().getItem() instanceof SwordItem&&p.distanceTo(e.getEntity())<=4)RpgStore.evidence(p,"swordKills",1);if(e.getEntity().getPersistentData().getString("maw_mark_owner").equals(p.getUUID().toString())&&e.getEntity().getPersistentData().getLong("maw_mark_until")>p.level().getGameTime())RpgStore.evidence(p,"markedKills",1);}});
        NeoForge.EVENT_BUS.addListener((LivingIncomingDamageEvent e)->{
            if(!(e.getEntity() instanceof ServerPlayer p)||!(e.getSource().getEntity() instanceof Mob enemy)||!hostile(p,enemy))return;
            Ward ward=WARDS.get(p.getUUID());if(ward==null||ward.expires<System.currentTimeMillis())return;
            Vec3 towards=enemy.position().subtract(p.position()).normalize();if(p.getLookAngle().dot(towards)<0)return;
            float reduction=Math.min(ward.maximum,e.getAmount()*.5f);e.setAmount(e.getAmount()-reduction);WARDS.remove(p.getUUID());
            ServerPlayer caster=p.getServer().getPlayerList().getPlayer(ward.caster);if(caster!=null)RpgStore.evidence(caster,"parries",1);
        });
        NeoForge.EVENT_BUS.addListener((PlayerInteractEvent.RightClickItem e)->{if(e.getEntity() instanceof ServerPlayer p&&useFocus(p,e.getItemStack())){e.setCanceled(true);e.setCancellationResult(net.minecraft.world.InteractionResult.SUCCESS);}});
        NeoForge.EVENT_BUS.addListener((PlayerInteractEvent.RightClickBlock e)->{if(e.getEntity() instanceof ServerPlayer p&&useFocus(p,e.getItemStack())){e.setCanceled(true);e.setCancellationResult(net.minecraft.world.InteractionResult.SUCCESS);}});
    }
    static boolean hostile(ServerPlayer p,Entity e){return e instanceof Mob&&e instanceof Enemy&&e.isAlive()&&!e.getTags().contains("maw_friend")&&!(e instanceof OwnableEntity o&&o.getOwnerUUID()!=null);}
    static void clearFlight(ServerPlayer p){Flight f=FLIGHTS.remove(p.getUUID());if(f!=null){p.getAbilities().mayfly=f.mayfly;p.getAbilities().flying=f.flying&&f.mayfly;p.onUpdateAbilities();p.addEffect(new MobEffectInstance(MobEffects.SLOW_FALLING,200));}SCANS.remove(p.getUUID());WARDS.remove(p.getUUID());}
    static void tick(net.minecraft.server.MinecraftServer server){
        long now=System.currentTimeMillis();for(Flight f:List.copyOf(FLIGHTS.values()))if(f.expires<=now||!f.body.isAlive()||server.getPlayerList().getPlayer(f.body.getUUID())!=f.body)clearFlight(f.body);
        // At most 4096 block reads total per tick, and never generate/load a chunk.
        int budget=4096;for(Scan scan:List.copyOf(SCANS.values())){
            ServerPlayer p=scan.player;if(server.getPlayerList().getPlayer(p.getUUID())!=p||!p.isAlive()||!p.blockPosition().closerThan(scan.origin,8)){SCANS.remove(p.getUUID());continue;}
            int width=scan.radius*2+1,total=width*width*width;
            while(budget>0&&scan.index<total){int index=scan.index++;budget--;int x=index%width-scan.radius,y=index/width%width-scan.radius,z=index/(width*width)-scan.radius;BlockPos pos=scan.origin.offset(x,y,z);if(pos.distSqr(scan.origin)>scan.radius*scan.radius||!p.level().isLoaded(pos))continue;String id=BuiltInRegistries.BLOCK.getKey(p.level().getBlockState(pos).getBlock()).getPath();if(!(id.endsWith("_ore")||id.equals("ancient_debris")))continue;scan.ores.add(pos);if(scan.ores.size()>12)scan.ores.poll();}
            if(scan.index>=total){SCANS.remove(p.getUUID());if(!scan.ores.isEmpty())try{JsonObject result=finish(p,scan.skill,p.position(),()->{});JsonArray ores=new JsonArray();scan.ores.stream().sorted(Comparator.comparingDouble(b->b.distSqr(scan.origin))).forEach(pos->{JsonObject row=ModRequest.position(pos);row.addProperty("dimension",p.level().dimension().location().toString());row.addProperty("blockId",BuiltInRegistries.BLOCK.getKey(p.level().getBlockState(pos).getBlock()).toString());ores.add(row);p.serverLevel().sendParticles(p,ParticleTypes.END_ROD,true,pos.getX()+.5,pos.getY()+1,pos.getZ()+.5,8,.25,.25,.25,.01);});result.add("ores",ores);RpgMigrationBridge.remember(p,"prospect",result);RpgMessages.event(p,result);}catch(IllegalArgumentException failure){RpgMigrationBridge.rememberError(p,"prospect",failure.getMessage());}else RpgMigrationBridge.rememberError(p,"prospect","no_loaded_ore_found");}
            if(budget==0)break;
        }
    }
    static JsonObject definition(String id){JsonObject all=CATALOG.getAsJsonObject("skills");if(!all.has(id))throw new IllegalArgumentException("skill_not_found");return all.getAsJsonObject(id);}
    static int level(ServerPlayer p,String id){return RpgStore.integer(RpgStore.object(RpgStore.player(p),"skills"),id);}
    static int points(ServerPlayer p){JsonObject data=RpgStore.player(p),e=RpgStore.object(data,"evidence");return Math.min(30,6+RpgStore.integer(e,"kills")/5+RpgStore.integer(e,"minedOres")/16+RpgStore.integer(e,"trialFloors")/2+RpgStore.integer(e,"questCompletions"))-RpgStore.integer(data,"spentPoints");}
    static int uses(ServerPlayer p,String id){return RpgStore.integer(RpgStore.object(RpgStore.player(p),"uses"),id);}
    static long remaining(ServerPlayer p,String id){return Math.max(0,RpgStore.number(RpgStore.object(RpgStore.player(p),"cooldowns"),id)-System.currentTimeMillis());}
    static JsonObject state(ServerPlayer p){JsonObject result=new JsonObject();result.addProperty("profession",RpgStore.player(p).get("profession").getAsString());result.addProperty("availablePoints",points(p));result.addProperty("spentPoints",RpgStore.integer(RpgStore.player(p),"spentPoints"));JsonArray all=new JsonArray();
        for(var e:CATALOG.getAsJsonObject("skills").entrySet()){String id=e.getKey();JsonObject def=e.getValue().getAsJsonObject(),row=def.deepCopy();int rank=level(p,id);row.addProperty("id",id);row.addProperty("name",def.get("title").getAsString());row.addProperty("level",rank);row.addProperty("uses",uses(p,id));row.addProperty("cooldownMs",def.get("cooldown-seconds").getAsInt()*1000);row.addProperty("cooldownRemainingMs",remaining(p,id));row.addProperty("icon","minecraft:"+def.get("icon").getAsString().toLowerCase(Locale.ROOT));row.addProperty("canLearn",eligible(p,id)&&rank==0);if(rank>0){row.add("actualLimits",limits(p,id).deepCopy());row.addProperty("manaCost",cost(p,id));}row.addProperty("nextRankRequiresUses",rank<2?8:24);row.addProperty("newWorldRequirements","基础技能1点；职业技能须选对应职业；高级技能按真实战斗/试炼记录开放；升级需熟练8/24次和技能点。");all.add(row);}
        result.add("abilities",all);result.add("evidence",RpgStore.object(RpgStore.player(p),"evidence").deepCopy());return result;
    }
    private static boolean eligible(ServerPlayer p,String id){JsonObject def=definition(id);String profession=def.get("profession").getAsString();if(profession.equals("common"))return true;if(!profession.equals(RpgStore.player(p).get("profession").getAsString()))return false;
        JsonArray starter=CATALOG.getAsJsonObject("professions").getAsJsonObject(profession).getAsJsonArray("starter-skills");if(starter.contains(new JsonPrimitive(id)))return true;JsonObject e=RpgStore.object(RpgStore.player(p),"evidence");int clears=RpgStore.integer(e,"trialFloors");
        return switch(id){case "sword_arc"->RpgStore.integer(e,"swordKills")>=3&&RpgStore.integer(e,"parries")>=2;case "sword_step","sword_beam"->level(p,"sword_arc")>0&&clears>=3;case "twin_legacy"->level(p,"sword_beam")>0&&clears>=10;case "healer_beacon"->RpgStore.integer(e,"healedOthers")>=24&&clears>=3;case "mage_flame","scout_watch"->RpgStore.integer(e,"markedKills")>=3&&clears>=3;case "guardian_ward","guardian_oath"->RpgStore.integer(e,"villageDefenses")>=1||clears>=5;default->false;};}
    static JsonObject act(ServerPlayer p,String kind,JsonObject input){
        JsonObject data=RpgStore.player(p);
        if(kind.equals("profession_choose")){String id=ModRequest.text(input,"profession",32);if(!CATALOG.getAsJsonObject("professions").has(id))throw new IllegalArgumentException("profession_not_found");clearFlight(p);data.addProperty("profession",id);RpgStore.dirty(p);return state(p);}
        String id=ModRequest.text(input,"skillId",64);JsonObject def=definition(id);int rank=level(p,id);
        if(kind.equals("skill_learn")||kind.equals("skill_upgrade")){
            if(!eligible(p,id))throw new IllegalArgumentException("skill_requirements_not_met");boolean learn=kind.equals("skill_learn");if(learn&&rank!=0||!learn&&(rank<1||rank>=3))throw new IllegalArgumentException("invalid_skill_rank");
            if(!learn&&uses(p,id)<(rank==1?8:24))throw new IllegalArgumentException("skill_practice_required");
            int cost=def.get("profession").getAsString().equals("common")?1:rank==0?2:rank==1?3:5;if(points(p)<cost)throw new IllegalArgumentException("not_enough_skill_points");
            RpgStore.object(data,"skills").addProperty(id,rank+1);data.addProperty("spentPoints",RpgStore.integer(data,"spentPoints")+cost);RpgStore.dirty(p);return state(p);
        }
        if(kind.equals("skill_bind")){if(rank<1)throw new IllegalArgumentException("skill_not_learned");data.addProperty("focusSkill",id);RpgStore.dirty(p);return state(p);}
        if(kind.equals("skill_imprint")){
            if(rank<1)throw new IllegalArgumentException("skill_not_learned");ItemStack held=p.getMainHandItem();if(held.isEmpty()||held.getCount()!=1||!held.isDamageableItem())throw new IllegalArgumentException("hold_one_tool_or_weapon");
            if(!ModRequest.snbt(p,held).equals(ModRequest.text(input,"expectedSnbt",60000)))throw new IllegalArgumentException("held_components_changed");
            boolean table=false;for(BlockPos at:BlockPos.betweenClosed(p.blockPosition().offset(-4,-2,-4),p.blockPosition().offset(4,2,4)))if(p.level().isLoaded(at)&&p.level().getBlockState(at).is(net.minecraft.world.level.block.Blocks.ENCHANTING_TABLE)&&RpgProtection.allowed(p,"use",at)){table=true;break;}
            if(!table||p.experienceLevel<4)throw new IllegalArgumentException("enchanting_table_and_four_xp_levels_required");
            CompoundTag tag=held.getOrDefault(DataComponents.CUSTOM_DATA,CustomData.EMPTY).copyTag();tag.putString("maw_imprint",id);held.set(DataComponents.CUSTOM_DATA,CustomData.of(tag));List<Component> lore=new ArrayList<>(held.getOrDefault(DataComponents.LORE,ItemLore.EMPTY).lines());lore.add(Component.literal("潜行交互："+def.get("title").getAsString()+"（消耗魔力，须已学习）"));held.set(DataComponents.LORE,new ItemLore(lore));p.giveExperienceLevels(-4);p.inventoryMenu.broadcastChanges();JsonObject out=new JsonObject();out.addProperty("itemSnbt",ModRequest.snbt(p,held));return out;
        }
        if(kind.equals("skill_cast"))return cast(p,id);throw new IllegalArgumentException("unsupported_skill_operation");
    }
    private static void ready(ServerPlayer p,String id){PlayerAuthBridge.requireAuthenticated(p);if(!p.isAlive()||p.isSpectator()||p.getAbilities().instabuild)throw new IllegalArgumentException("survival_body_required");if(level(p,id)<1||!eligible(p,id))throw new IllegalArgumentException("skill_not_learned_or_wrong_profession");if(remaining(p,id)>0)throw new IllegalArgumentException("skill_on_cooldown");var mana=CapabilityRegistry.getMana(p);if(mana==null||mana.getCurrentMana()<cost(p,id))throw new IllegalArgumentException("not_enough_mana");}
    private static double cost(ServerPlayer p,String id){JsonObject def=definition(id),lim=limits(p,id);return lim.has("mana")?lim.get("mana").getAsDouble():def.get("mana").getAsDouble();}
    private static JsonObject limits(ServerPlayer p,String id){JsonObject def=definition(id),ranks=CATALOG.getAsJsonObject("points").getAsJsonObject("ranks");if(ranks.has(id)){JsonArray rows=ranks.getAsJsonArray(id);return rows.get(Math.min(level(p,id)-1,rows.size()-1)).getAsJsonObject();}return def.getAsJsonObject("limits");}
    private static List<Mob> enemies(ServerPlayer p,double range,int limit,boolean cone){Vec3 look=p.getLookAngle();return p.level().getEntitiesOfClass(Mob.class,p.getBoundingBox().inflate(range),e->hostile(p,e)&&p.distanceTo(e)<=range&&p.hasLineOfSight(e)&&(!cone||look.dot(e.getEyePosition().subtract(p.getEyePosition()).normalize())>.35)).stream().sorted(Comparator.comparingDouble(p::distanceToSqr)).limit(limit).toList();}
    static JsonObject cast(ServerPlayer p,String id){ready(p,id);JsonObject def=definition(id),lim=limits(p,id);int rank=level(p,id),targets=lim.get("targets").getAsInt();double range=lim.get("range").getAsDouble(),power=lim.get("power").getAsDouble();int duration=lim.get("duration-seconds").getAsInt();String effect=def.get("effect").getAsString(),equip=def.get("equipment").getAsString();
        if(equip.contains("sword")&&!(p.getMainHandItem().getItem() instanceof SwordItem)||equip.equals("two_swords")&&!(p.getOffhandItem().getItem() instanceof SwordItem)||equip.equals("shield")&&!p.getMainHandItem().is(Items.SHIELD)&&!p.getOffhandItem().is(Items.SHIELD))throw new IllegalArgumentException("required_equipment_not_held");
        if(effect.equals("prospect")){if(SCANS.containsKey(p.getUUID()))throw new IllegalArgumentException("prospect_already_running");int r=Math.min(40,24+RpgStore.integer(RpgStore.object(RpgStore.player(p),"evidence"),"minedOres")/16*2);SCANS.put(p.getUUID(),new Scan(p,r,id));JsonObject out=new JsonObject();out.addProperty("ok",true);out.addProperty("status","scanning_loaded_blocks");out.addProperty("radius",r);out.addProperty("resultQuery","rpg.state lastResults.prospect");return out;}
        if(Set.of("arcane_bolt","sword_thrust","sword_cone","sword_beam","sword_combo","frost_cone","frost_ring","flame_cone","mark","sense").contains(effect)){
            List<Mob> found=enemies(p,range,targets,!effect.equals("frost_ring")&&!effect.equals("sense"));if(found.isEmpty()&&effect.equals("arcane_bolt"))found=enemies(p,Math.min(12,range),targets,false);if(found.isEmpty())throw new IllegalArgumentException("no_visible_hostile_target");
            List<Mob> enemies=found;Vec3 hit=enemies.getFirst().position();JsonArray records=new JsonArray();JsonObject result=finish(p,id,hit,()->{
                for(Mob mob:enemies){JsonObject row=new JsonObject();row.addProperty("uuid",mob.getUUID().toString());row.addProperty("type",BuiltInRegistries.ENTITY_TYPE.getKey(mob.getType()).toString());row.addProperty("name",mob.getName().getString());row.add("position",ModRequest.position(mob.blockPosition()));records.add(row);
                    if(effect.equals("mark")||effect.equals("sense")){mob.getPersistentData().putString("maw_mark_owner",p.getUUID().toString());mob.getPersistentData().putLong("maw_mark_until",p.level().getGameTime()+Math.max(10,duration)*20);p.serverLevel().sendParticles(p,ParticleTypes.END_ROD,true,mob.getX(),mob.getY()+1,mob.getZ(),12,.4,.4,.4,.01);}
                    else{float damage=(float)(power+(def.get("profession").getAsString().equals("common")?rank-1:0));mob.hurt(p.damageSources().playerAttack(p),damage);if(effect.startsWith("frost"))mob.addEffect(new MobEffectInstance(MobEffects.MOVEMENT_SLOWDOWN,Math.max(1,duration)*20));if(effect.equals("flame_cone")&&id.equals("flamewave"))mob.igniteForSeconds(3+rank-1);}
                }
            });result.add("targets",records);return result;
        }
        if(effect.equals("selfheal")||effect.equals("mend")){
            List<ServerPlayer> friends=p.serverLevel().players().stream().filter(f->f.isAlive()&&!f.isSpectator()&&!f.getAbilities().instabuild&&f.distanceTo(p)<=range&&f.getHealth()<f.getMaxHealth()&&(f==p||p.hasLineOfSight(f))&&(p.getTeam()==null||f.getTeam()==null||p.isAlliedTo(f))).sorted(Comparator.comparingDouble(f->f.getHealth()/f.getMaxHealth())).limit(targets).toList();
            if(effect.equals("selfheal"))friends=p.getHealth()<p.getMaxHealth()?List.of(p):List.of();if(friends.isEmpty())throw new IllegalArgumentException("no_injured_teammates");List<ServerPlayer> healing=friends;return finish(p,id,p.position(),()->{for(ServerPlayer f:healing){float before=f.getHealth();f.heal((float)power);if(f!=p)RpgStore.evidence(p,"healedOthers",(int)Math.max(0,f.getHealth()-before));}});
        }
        if(effect.equals("cleanse")){if(!p.hasEffect(MobEffects.POISON)&&!p.hasEffect(MobEffects.WITHER))throw new IllegalArgumentException("no_poison_or_wither");return finish(p,id,p.position(),()->{p.removeEffect(MobEffects.POISON);p.removeEffect(MobEffects.WITHER);});}
        if(effect.equals("food")){if(p.getFoodData().getFoodLevel()>=20)throw new IllegalArgumentException("hunger_full");return finish(p,id,p.position(),()->p.getFoodData().eat(4,.625f));}
        if(effect.equals("sword_step")){
            List<Mob> found=enemies(p,range,1,true);if(found.isEmpty())throw new IllegalArgumentException("no_visible_hostile_target");Mob target=found.getFirst();Vec3 direction=target.position().subtract(p.position()).normalize();BlockPos base=BlockPos.containing(target.position().subtract(direction.scale(1.8)));BlockPos safe=safeLanding(p,base);if(safe==null)throw new IllegalArgumentException("no_safe_loaded_landing");Vec3 destination=Vec3.atBottomCenterOf(safe);if(!p.level().clip(new ClipContext(p.getEyePosition(),destination.add(0,p.getEyeHeight(),0),ClipContext.Block.COLLIDER,ClipContext.Fluid.ANY,p)).getType().equals(HitResult.Type.MISS))throw new IllegalArgumentException("dash_path_blocked");return finish(p,id,destination,()->{p.teleportTo(destination.x,destination.y,destination.z);p.connection.resetPosition();target.hurt(p.damageSources().playerAttack(p),(float)power);});
        }
        if(effect.equals("home")||effect.equals("blink")){
            if(RpgTrials.participant(p))throw new IllegalArgumentException("leave_trial_before_travel");Vec3 target;
            if(effect.equals("home")){if(p.level()!=p.getServer().overworld())throw new IllegalArgumentException("home_requires_overworld_use_waypoint");target=Vec3.atBottomCenterOf(p.serverLevel().getSharedSpawnPos());}
            else{Vec3 end=p.getEyePosition().add(p.getLookAngle().scale(range));BlockHitResult hit=p.level().clip(new ClipContext(p.getEyePosition(),end,ClipContext.Block.COLLIDER,ClipContext.Fluid.ANY,p));target=hit.getType()==HitResult.Type.MISS?p.position().add(p.getLookAngle().scale(range)):hit.getLocation().subtract(p.getLookAngle().scale(1.2));}
            BlockPos base=BlockPos.containing(target);BlockPos safe=safeLanding(p,base);if(safe==null)throw new IllegalArgumentException("no_safe_loaded_landing");Vec3 destination=Vec3.atBottomCenterOf(safe);return finish(p,id,destination,()->{clearFlight(p);p.teleportTo(destination.x,destination.y,destination.z);p.connection.resetPosition();});
        }
        if(effect.equals("sky_leap")){if(!p.onGround())throw new IllegalArgumentException("leap_requires_ground");return finish(p,id,p.position(),()->{p.setDeltaMovement(p.getDeltaMovement().x,Math.sqrt(2*.08*(8+4*(rank-1))),p.getDeltaMovement().z);p.hurtMarked=true;p.addEffect(new MobEffectInstance(MobEffects.SLOW_FALLING,400));});}
        if(effect.equals("soar")){if(FLIGHTS.containsKey(p.getUUID())||p.getAbilities().mayfly)throw new IllegalArgumentException("flight_already_active");return finish(p,id,p.position(),()->{FLIGHTS.put(p.getUUID(),new Flight(p,p.getAbilities().mayfly,p.getAbilities().flying,System.currentTimeMillis()+(20+10*(rank-1))*1000L));p.getAbilities().mayfly=true;p.onUpdateAbilities();});}
        if(effect.equals("sword_parry")||effect.equals("ward")){return finish(p,id,p.position(),()->{for(ServerPlayer f:p.serverLevel().players().stream().filter(f->f.isAlive()&&!f.isSpectator()&&f.distanceTo(p)<=range).limit(targets).toList())WARDS.put(f.getUUID(),new Ward(p.getUUID(),System.currentTimeMillis()+duration*1000L,(float)power));});}
        if(effect.equals("blessing")){return finish(p,id,p.position(),()->{for(ServerPlayer f:p.serverLevel().players().stream().filter(f->f.isAlive()&&!f.isSpectator()&&f.distanceTo(p)<=range).limit(targets).toList()){f.addEffect(new MobEffectInstance(MobEffects.MOVEMENT_SPEED,duration*20));f.addEffect(new MobEffectInstance(MobEffects.DAMAGE_RESISTANCE,duration*20));}});}
        if(effect.equals("golem")){if(p.serverLevel().getEntitiesOfClass(IronGolem.class,p.getBoundingBox().inflate(64),g->g.getPersistentData().getString("maw_summoner").equals(p.getUUID().toString())).size()>0)throw new IllegalArgumentException("one_summon_per_player");BlockPos pos=p.blockPosition().relative(p.getDirection(),2);if(!p.level().isLoaded(pos)||!p.level().noCollision(new AABB(pos).inflate(.6,1, .6))||!RpgProtection.allowed(p,"place",pos))throw new IllegalArgumentException("no_clear_summon_position");return finish(p,id,Vec3.atBottomCenterOf(pos),()->{IronGolem g=EntityType.IRON_GOLEM.create(p.serverLevel());if(g==null)throw new IllegalStateException("golem_creation_failed");g.moveTo(pos.getX()+.5,pos.getY(),pos.getZ()+.5,0,0);g.addTag("maw_friend");g.getPersistentData().putString("maw_summoner",p.getUUID().toString());g.getPersistentData().putLong("maw_summon_expires",p.level().getGameTime()+900);p.serverLevel().addFreshEntity(g);});}
        if(effect.equals("night")||effect.equals("feather"))return finish(p,id,p.position(),()->p.addEffect(new MobEffectInstance(effect.equals("night")?MobEffects.NIGHT_VISION:MobEffects.SLOW_FALLING,duration*20)));
        if(effect.equals("fireworks")||effect.equals("starlight"))return finish(p,id,p.position(),()->p.serverLevel().sendParticles(ParticleTypes.FIREWORK,p.getX(),p.getY()+1,p.getZ(),40,1,1,1,.06));
        throw new IllegalArgumentException("skill_effect_unavailable");
    }
    private static BlockPos safeLanding(ServerPlayer p,BlockPos base){for(int y=-2;y<=3;y++){BlockPos b=base.above(y);if(p.level().isLoaded(b)&&p.level().getBlockState(b).isAir()&&p.level().getBlockState(b.above()).isAir()&&p.level().getBlockState(b.below()).isSolidRender(p.level(),b.below())&&p.level().getFluidState(b).isEmpty()&&RpgProtection.allowed(p,"place",b))return b;}return null;}
    private static JsonObject finish(ServerPlayer p,String id,Vec3 center,Runnable effect){ready(p,id);JsonObject def=definition(id);double cost=cost(p,id);effect.run();CapabilityRegistry.getMana(p).removeMana(cost);RpgStore.object(RpgStore.player(p),"cooldowns").addProperty(id,System.currentTimeMillis()+def.get("cooldown-seconds").getAsLong()*1000);RpgStore.object(RpgStore.player(p),"uses").addProperty(id,uses(p,id)+1);RpgStore.dirty(p);
        p.connection.send(new ClientboundSetTitlesAnimationPacket(5,25,10));p.connection.send(new ClientboundSetTitleTextPacket(Component.literal(def.get("title").getAsString())));p.connection.send(new ClientboundSetSubtitleTextPacket(Component.literal("以灯火为引，回应此刻的祈愿")));p.serverLevel().playSound(null,p.blockPosition(),SoundEvents.ENCHANTMENT_TABLE_USE,SoundSource.PLAYERS,.6f,1.25f);p.serverLevel().sendParticles(ParticleTypes.ENCHANT,center.x,center.y+1,center.z,24,.6,.5,.6,.3);
        JsonObject r=new JsonObject();r.addProperty("schemaVersion",1);r.addProperty("kind","skill");r.addProperty("ok",true);r.addProperty("id",id);r.addProperty("title",def.get("title").getAsString());r.addProperty("body","施法生效");r.addProperty("tone","arcane");r.add("position",ModRequest.position(BlockPos.containing(center)));r.addProperty("dimension",p.level().dimension().location().toString());r.addProperty("manaSpent",cost);RpgMessages.event(p,r);return r;
    }
    private static boolean useFocus(ServerPlayer p,ItemStack stack){CustomData data=stack.get(DataComponents.CUSTOM_DATA);if(data==null||!PlayerAuthBridge.authenticated(p))return false;CompoundTag tag=data.copyTag();if(tag.getString("maw_bound_kind").equals("tome")){if(tag.getString("ownerUuid").equals(p.getUUID().toString()))RpgMigrationBridge.open(p,"guide",1);return true;}String id="";if(tag.getBoolean("maw_focus")){if(!tag.getString("ownerUuid").equals(p.getUUID().toString()))return true;id=RpgStore.player(p).has("focusSkill")?RpgStore.player(p).get("focusSkill").getAsString():"";}else if(p.isShiftKeyDown())id=tag.getString("maw_imprint");if(id.isBlank()){if(tag.getBoolean("maw_focus")){RpgMigrationBridge.open(p,"skills",1);return true;}return false;}try{cast(p,id);}catch(IllegalArgumentException e){RpgMigrationBridge.hint(p,e.getMessage());}return true;}
}
