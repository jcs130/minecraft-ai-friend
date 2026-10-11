package dev.qiandeng.maw;

import com.google.gson.*;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.*;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.*;
import net.minecraft.world.entity.*;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.monster.*;
import net.minecraft.world.entity.projectile.Projectile;
import net.minecraft.world.item.*;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.phys.*;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.living.*;
import net.neoforged.neoforge.event.entity.ProjectileImpactEvent;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import java.util.*;

/** Fifteen native waves, reconnectable same-UUID party, bounded rooms and persistent personal loot. */
final class RpgTrials {
    static final ResourceKey<Level> DIMENSION=ResourceKey.create(net.minecraft.core.registries.Registries.DIMENSION,ResourceLocation.parse("maw:trials"));
    private static int buildIndex;private static MinecraftServer buildingServer;private static int restoredTicks;
    private static final String TAG="maw_trial_enemy";
    static void register(){
        NeoForge.EVENT_BUS.addListener((net.neoforged.neoforge.event.entity.player.PlayerInteractEvent.RightClickBlock e)->{if(!(e.getEntity() instanceof ServerPlayer p)||p.level().dimension()!=DIMENSION||!PlayerAuthBridge.authenticated(p))return;BlockPos at=e.getPos();if(at.equals(lobby().offset(-8,1,0))){RpgStorage.open(p,0);}else if(at.getY()==81&&at.getZ()==-10&&at.getX()>=-67&&at.getX()<=-61&&((at.getX()+67)%3)==0){JsonObject args=new JsonObject();args.addProperty("difficulty",List.of("normal","adventure","apocalypse").get((at.getX()+67)/3));try{act(p,"arena_start",args);}catch(IllegalArgumentException error){RpgMigrationBridge.hint(p,error.getMessage());}}else return;e.setCanceled(true);e.setCancellationResult(net.minecraft.world.InteractionResult.SUCCESS);});
        NeoForge.EVENT_BUS.addListener((LivingChangeTargetEvent e)->{if(e.getEntity().getTags().contains(TAG)&&e.getNewAboutToBeSetTarget()!=null&&e.getNewAboutToBeSetTarget().getTags().contains(TAG))e.setCanceled(true);});
        NeoForge.EVENT_BUS.addListener((LivingIncomingDamageEvent e)->{Entity source=e.getSource().getEntity();if(e.getEntity().getTags().contains(TAG)&&source!=null&&source.getTags().contains(TAG))e.setCanceled(true);});
        NeoForge.EVENT_BUS.addListener((ProjectileImpactEvent e)->{if(e.getProjectile().getOwner()!=null&&e.getProjectile().getOwner().getTags().contains(TAG)&&e.getRayTraceResult() instanceof EntityHitResult hit&&hit.getEntity().getTags().contains(TAG)){e.setCanceled(true);e.getProjectile().discard();}});
        NeoForge.EVENT_BUS.addListener((LivingDeathEvent e)->{if(e.getEntity().getTags().contains(TAG)&&e.getEntity().level().getServer()!=null){JsonObject run=run(e.getEntity().level().getServer());JsonObject mobs=RpgStore.object(run,"mobs");JsonElement saved=mobs.get(e.getEntity().getUUID().toString());if(saved!=null){saved.getAsJsonObject().addProperty("dead",true);RpgStore.of(e.getEntity().level().getServer()).setDirty();}}else if(e.getEntity() instanceof ServerPlayer p&&participant(p)){RpgStore.evidence(p,"trialDeaths",1);RpgStore.player(p).addProperty("trialReturnPending",true);RpgStore.dirty(p);}});
        NeoForge.EVENT_BUS.addListener((MobEffectEvent.Applicable e)->{Entity source=e.getEffectSource();if(source instanceof Projectile projectile)source=projectile.getOwner();if(e.getEntity().getTags().contains(TAG)&&source!=null&&source.getTags().contains(TAG))e.setResult(MobEffectEvent.Applicable.Result.DO_NOT_APPLY);});
        NeoForge.EVENT_BUS.addListener((LivingExperienceDropEvent e)->{if(e.getEntity().getTags().contains(TAG))e.setDroppedExperience(0);});
        NeoForge.EVENT_BUS.addListener((MobSpawnEvent.SpawnPlacementCheck e)->{if(e.getLevel().getLevel().dimension()==DIMENSION&&e.getSpawnType()==MobSpawnType.NATURAL)e.setResult(MobSpawnEvent.SpawnPlacementCheck.Result.FAIL);});
        NeoForge.EVENT_BUS.addListener((LivingDropsEvent e)->{if(e.getEntity().getTags().contains(TAG))e.getDrops().clear();});
        NeoForge.EVENT_BUS.addListener((PlayerEvent.PlayerRespawnEvent e)->{if(e.getEntity() instanceof ServerPlayer p&&RpgStore.player(p).has("trialReturnPending")){RpgStore.player(p).remove("trialReturnPending");lobbyDirect(p);p.sendSystemMessage(Component.literal("试炼奖励仍在你的个人箱；入口奖励箱或 /mycli arena stash 打开，死亡地点没有本次试炼奖励。"));}});
    }
    static JsonObject run(MinecraftServer server){return RpgStore.object(RpgStore.of(server).root,"trialRun");}
    static boolean participant(ServerPlayer p){JsonObject run=run(p.getServer());return run.has("active")&&run.get("active").getAsBoolean()&&RpgStore.object(run,"participants").has(p.getUUID().toString());}
    private static ServerLevel dimension(MinecraftServer server){ServerLevel level=server.getLevel(DIMENSION);if(level==null)throw new IllegalArgumentException("trial_dimension_not_installed_restart_required");return level;}
    private static BlockPos center(int floor){return new BlockPos((floor-1)*64,80,0);}
    static BlockPos lobby(){return new BlockPos(-64,80,0);}
    private static void teleport(ServerPlayer p,BlockPos at){RpgSkills.clearFlight(p);p.teleportTo(dimension(p.getServer()),at.getX()+.5,at.getY()+1,at.getZ()+.5,p.getYRot(),p.getXRot());p.connection.resetPosition();}
    static void lobbyDirect(ServerPlayer p){teleport(p,lobby());}
    private static boolean inFloor(ServerPlayer p,int floor){BlockPos c=center(floor);return p.level().dimension()==DIMENSION&&Math.abs(p.getX()-c.getX())<=13&&Math.abs(p.getZ()-c.getZ())<=13&&p.getY()>=77&&p.getY()<=90;}
    static JsonObject state(ServerPlayer p){JsonObject run=run(p.getServer()),r=new JsonObject();boolean active=run.has("active")&&run.get("active").getAsBoolean();int floor=RpgStore.integer(run,"floor");r.addProperty("participant",participant(p));r.addProperty("personalStatus",participant(p)?p.level().dimension()==DIMENSION?"in_trial":"return_to_current_floor":"not_participating");r.addProperty("worldActive",active);r.addProperty("worldFloor",floor);r.addProperty("floor",participant(p)?floor:0);r.addProperty("totalFloors",15);r.addProperty("ready",RpgStore.of(p.getServer()).root.has("trialBuilt"));r.addProperty("buildProgress",buildIndex);r.add("lobby",ModRequest.position(lobby()));r.addProperty("dimension","maw:trials");JsonArray mobs=new JsonArray();int alive=0;String anomaly="none";
        if(active){ServerLevel level=dimension(p.getServer());for(var entry:RpgStore.object(run,"mobs").entrySet()){JsonObject saved=entry.getValue().getAsJsonObject();if(saved.has("dead")&&saved.get("dead").getAsBoolean())continue;alive++;Entity entity=level.getEntity(UUID.fromString(entry.getKey()));JsonObject row=saved.deepCopy();row.addProperty("uuid",entry.getKey());row.addProperty("entityLoaded",entity!=null);if(entity instanceof Mob mob){row.add("position",ModRequest.position(mob.blockPosition()));row.addProperty("alive",mob.isAlive());row.addProperty("ai",!mob.isNoAi());row.addProperty("mainHand",BuiltInRegistries.ITEM.getKey(mob.getMainHandItem().getItem()).toString());row.addProperty("targetUuid",mob.getTarget()==null?"":mob.getTarget().getUUID().toString());}else anomaly=level.getGameTime()-RpgStore.number(run,"spawnAt")<100||p.getServer().getTickCount()<100?"loading_entities":"monster_record_not_loaded";if(participant(p))mobs.add(row);}}
        r.addProperty("remainingMonsters",participant(p)?alive:0);r.addProperty("worldRemainingMonsters",alive);if(run.has("rewardBlocked")&&run.get("rewardBlocked").getAsBoolean())anomaly="reward_storage_full";r.addProperty("anomaly",anomaly);r.addProperty("phase",active?(anomaly.equals("reward_storage_full")?"awaiting_reward_space":(anomaly.equals("loading_entities")?"spawning":RpgStore.number(run,"nextAt")>0?"countdown":"combat")):"idle");r.add("monsters",mobs);String difficulty=run.has("difficulty")?run.get("difficulty").getAsString():"normal";r.addProperty("difficulty",difficulty);long rewardDay=p.getServer().overworld().getGameTime()/24000;r.addProperty("rewardDay",rewardDay);r.addProperty("rewardPeriodTicks",24000);r.addProperty("currentFloorRewardEligible",floor!=7&&RpgStore.number(RpgStore.object(RpgStore.player(p),"trialRewardDays"),difficulty+":"+floor)!=rewardDay+1);r.addProperty("nextStep",!participant(p)?"从冒险指南打开试炼入口，选择难度；这不是你的当前战斗。":anomaly.equals("reward_storage_full")?"清理个人试炼箱或回收装备，奖励与本层保留，腾出空间自动继续。":anomaly.equals("loading_entities")?"等待本层实体加载，稍后查询；勿反复启动。":anomaly.equals("none")?"消灭本层敌人，10秒后自动续层；第7层可休息或补给。":"停止盲目搜索，向服主报告当前场次和异常。");return r;
    }
    static JsonObject act(ServerPlayer p,String kind,JsonObject input){
        if(!RpgStore.of(p.getServer()).root.has("trialBuilt"))throw new IllegalArgumentException("trial_rooms_building_retry_state_later");JsonObject run=run(p.getServer());
        if(kind.equals("arena_lobby")){if(participant(p))throw new IllegalArgumentException("use_arena_leave");lobbyDirect(p);return state(p);}
        if(kind.equals("arena_leave")){if(participant(p)){RpgStore.object(run,"participants").remove(p.getUUID().toString());RpgStore.of(p.getServer()).setDirty();}lobbyDirect(p);return state(p);}
        if(kind.equals("arena_resume")){if(!participant(p))throw new IllegalArgumentException("not_participant");teleport(p,center(RpgStore.integer(run,"floor")).offset(-9,0,0));return state(p);}
        if(!kind.equals("arena_start"))throw new IllegalArgumentException("unsupported_trial_operation");
        if(run.has("active")&&run.get("active").getAsBoolean())throw new IllegalArgumentException("trial_in_progress");if(p.level().dimension()!=DIMENSION||!p.blockPosition().closerThan(lobby(),18))throw new IllegalArgumentException("start_at_trial_lobby");
        String difficulty=ModRequest.text(input,"difficulty",32);if(!Set.of("normal","adventure","apocalypse").contains(difficulty))throw new IllegalArgumentException("invalid_trial_difficulty");
        JsonObject party=new JsonObject();for(ServerPlayer friend:p.serverLevel().players())if(friend.isAlive()&&!friend.isSpectator()&&PlayerAuthBridge.authenticated(friend)&&friend.distanceTo(p)<=12)party.addProperty(friend.getUUID().toString(),true);if(party.size()>4)throw new IllegalArgumentException("party_limit_four");
        run.entrySet().clear();run.addProperty("runId",UUID.randomUUID().toString());run.addProperty("active",true);run.addProperty("floor",1);run.addProperty("difficulty",difficulty);run.add("participants",party);run.add("rewardsClaimed",new JsonObject());run.add("mobs",new JsonObject());run.addProperty("nextAt",0);RpgStore.of(p.getServer()).setDirty();spawn(p.getServer(),1);return state(p);
    }
    static void tick(MinecraftServer server){
        if(buildingServer!=server){buildingServer=server;buildIndex=0;restoredTicks=0;}ServerLevel level=server.getLevel(DIMENSION);if(level==null)return;
        if(!RpgStore.of(server).root.has("trialBuilt")){build(level);return;}
        if(server.getTickCount()%20!=0)return;
        // Time-bounded owned summons, including after a saved world is reopened.
        for(ServerLevel l:server.getAllLevels())for(Entity e:l.getAllEntities())if(e.getPersistentData().contains("maw_summon_expires")&&l.getGameTime()>=e.getPersistentData().getLong("maw_summon_expires"))e.discard();
        JsonObject run=run(server);if(!run.has("active")||!run.get("active").getAsBoolean())return;int floor=RpgStore.integer(run,"floor");force(level,center(floor),true);restoredTicks++;
        JsonObject participants=RpgStore.object(run,"participants");
        // Anyone who physically arrives on the active floor joins the SAME persisted party.
        for(ServerPlayer p:level.players())if(inFloor(p,floor)&&p.isAlive()&&!p.isSpectator()&&PlayerAuthBridge.authenticated(p)&&participants.size()<4&&!participants.has(p.getUUID().toString())){participants.addProperty(p.getUUID().toString(),true);RpgStore.of(server).setDirty();}
        List<ServerPlayer> online=server.getPlayerList().getPlayers().stream().filter(p->participants.has(p.getUUID().toString())&&p.isAlive()&&inFloor(p,floor)).toList();
        if(participants.size()==0){cleanup(server);return;}long now=level.getGameTime(),previous=RpgStore.number(run,"lastTick");run.addProperty("lastTick",now);if(online.isEmpty()){if(RpgStore.number(run,"nextAt")>0&&previous>0)run.addProperty("nextAt",RpgStore.number(run,"nextAt")+now-previous);RpgStore.of(server).setDirty();return;}
        boolean living=false,unknown=false;
        for(var entry:RpgStore.object(run,"mobs").entrySet()){JsonObject saved=entry.getValue().getAsJsonObject();if(saved.has("dead")&&saved.get("dead").getAsBoolean())continue;Entity entity=level.getEntity(UUID.fromString(entry.getKey()));if(!(entity instanceof Mob mob)){unknown=true;continue;}if(!mob.isAlive()){unknown=true;continue;}living=true;BlockPos c=center(floor);
            if(Math.abs(mob.getX()-c.getX())>12||Math.abs(mob.getZ())>12||mob.getY()<78||mob.getY()>89)mob.teleportTo(c.getX()+.5,81,.5);
            mob.setNoAi(false);ServerPlayer nearest=online.stream().min(Comparator.comparingDouble(mob::distanceToSqr)).orElseThrow();if(mob.getTarget()==null||!online.contains(mob.getTarget()))mob.setTarget(nearest);
        }
        if(living||unknown)return;
        if(RpgStore.number(run,"nextAt")==0){if(!award(server,online,floor))return;run.addProperty("nextAt",level.getGameTime()+(floor==7?1200:200));RpgStore.of(server).setDirty();return;}
        if(level.getGameTime()<RpgStore.number(run,"nextAt"))return;
        if(floor==15){for(ServerPlayer p:online){RpgStore.evidence(p,"trialWins",1);lobbyDirect(p);p.sendSystemMessage(Component.literal("十五层试炼通关！奖励在个人试炼箱。"));}cleanup(server);return;}
        force(level,center(floor),false);spawn(server,floor+1);
    }
    private static void force(ServerLevel level,BlockPos pos,boolean value){int cx=pos.getX()>>4,cz=pos.getZ()>>4;for(int x=cx-1;x<=cx+1;x++)for(int z=cz-1;z<=cz+1;z++)level.setChunkForced(x,z,value);}
    private static void cleanup(MinecraftServer server){JsonObject run=run(server);ServerLevel level=dimension(server);for(var e:RpgStore.object(run,"mobs").entrySet()){Entity entity=level.getEntity(UUID.fromString(e.getKey()));if(entity!=null)entity.discard();}force(level,center(Math.max(1,RpgStore.integer(run,"floor"))),false);run.addProperty("active",false);RpgStore.of(server).setDirty();}
    private static void spawn(MinecraftServer server,int floor){ServerLevel level=dimension(server);JsonObject run=run(server);run.addProperty("floor",floor);run.addProperty("nextAt",0);run.addProperty("spawnAt",level.getGameTime());run.addProperty("rewardBlocked",false);JsonObject records=new JsonObject();run.add("mobs",records);BlockPos c=center(floor);force(level,c,true);
        for(ServerPlayer p:server.getPlayerList().getPlayers())if(RpgStore.object(run,"participants").has(p.getUUID().toString())&&p.isAlive()){teleport(p,c.offset(-9,0,0));p.setHealth(p.getMaxHealth());p.getFoodData().setFoodLevel(20);p.sendSystemMessage(Component.literal("第 "+floor+"/15 层 · "+RpgSkills.CATALOG.getAsJsonArray("floors").get(floor-1).getAsJsonObject().get("name").getAsString()+"；清层10秒后自动继续，奖励进个人箱。"));}
        JsonObject def=RpgSkills.CATALOG.getAsJsonArray("floors").get(floor-1).getAsJsonObject();String difficulty=run.get("difficulty").getAsString();JsonArray enemies=!difficulty.equals("normal")&&!def.getAsJsonArray("enhancedEnemies").isEmpty()?def.getAsJsonArray("enhancedEnemies"):def.getAsJsonArray("enemies");double multiplier=difficulty.equals("normal")?1.15:difficulty.equals("adventure")?1.7:2.5;int n=0;
        for(JsonElement v:enemies){JsonObject enemy=v.getAsJsonObject();EntityType<?> type=BuiltInRegistries.ENTITY_TYPE.get(ResourceLocation.parse(enemy.get("type").getAsString()));Entity entity=type.create(level);if(!(entity instanceof Monster)&&!(entity instanceof net.minecraft.world.entity.monster.Slime))throw new IllegalStateException("trial_enemy_not_native_mob");Mob mob=(Mob)entity;BlockPos at=c.offset(7+(n%2)*3,1,-9+(n/2)*3);n++;mob.moveTo(at.getX()+.5,at.getY(),at.getZ()+.5,180,0);mob.addTag(TAG);mob.finalizeSpawn(level,level.getCurrentDifficultyAt(at),MobSpawnType.EVENT,null);mob.getPersistentData().putString("maw_trial_run",run.get("runId").getAsString());mob.setPersistenceRequired();mob.setNoAi(false);
            String id=enemy.get("type").getAsString();ItemStack weapon=id.endsWith("pillager")?new ItemStack(Items.CROSSBOW):id.endsWith("vindicator")?new ItemStack(Items.IRON_AXE):id.endsWith("wither_skeleton")?new ItemStack(Items.STONE_SWORD):id.endsWith("skeleton")||id.endsWith("stray")?new ItemStack(Items.BOW):ItemStack.EMPTY;mob.setItemSlot(EquipmentSlot.MAINHAND,weapon);mob.setDropChance(EquipmentSlot.MAINHAND,0);mob.setDropChance(EquipmentSlot.OFFHAND,0);for(EquipmentSlot slot:List.of(EquipmentSlot.HEAD,EquipmentSlot.CHEST,EquipmentSlot.LEGS,EquipmentSlot.FEET))mob.setDropChance(slot,0);
            if(mob.getAttribute(Attributes.MAX_HEALTH)!=null){double health=(enemy.has("health")?enemy.get("health").getAsDouble():mob.getMaxHealth())*multiplier;mob.getAttribute(Attributes.MAX_HEALTH).setBaseValue(health);mob.setHealth((float)health);}if(mob.getAttribute(Attributes.ATTACK_DAMAGE)!=null)mob.getAttribute(Attributes.ATTACK_DAMAGE).setBaseValue(mob.getAttributeBaseValue(Attributes.ATTACK_DAMAGE)*(difficulty.equals("normal")?1.1:difficulty.equals("adventure")?1.4:1.85));
            if(enemy.has("name")){mob.setCustomName(Component.literal(enemy.get("name").getAsString()));mob.setCustomNameVisible(true);}mob.getPersistentData().putString("maw_no_loot","true");level.addFreshEntity(mob);JsonObject record=new JsonObject();record.addProperty("type",id);record.add("spawn",ModRequest.position(at));record.addProperty("dead",false);records.add(mob.getUUID().toString(),record);
        }RpgStore.of(server).setDirty();
    }
    private static boolean award(MinecraftServer server,List<ServerPlayer> online,int floor){JsonObject run=run(server);JsonObject claimed=RpgStore.object(run,"rewardsClaimed");
        // Never throw from the tick listener or discard an earned reward when the bounded queue is full.
        JsonObject rewardDef=RpgSkills.CATALOG.getAsJsonArray("floors").get(floor-1).getAsJsonObject();
        for(ServerPlayer p:online){String key=p.getUUID()+":"+floor,daily=run.get("difficulty").getAsString()+":"+floor;long day=server.overworld().getGameTime()/24000;
            if(!claimed.has(key)&&floor!=7&&RpgStore.number(RpgStore.object(RpgStore.player(p),"trialRewardDays"),daily)!=day+1&&!RpgStorage.hasRewardCapacity(p,rewardDef.getAsJsonArray("supplies").size()+2)){
                if(!run.has("rewardBlocked")||!run.get("rewardBlocked").getAsBoolean())p.sendSystemMessage(Component.literal("奖励待领取队列已满；请清理个人试炼箱或回收装备。当前层已保留，腾出空间后自动继续。"));
                run.addProperty("rewardBlocked",true);RpgStore.of(server).setDirty();return false;
            }
        }run.addProperty("rewardBlocked",false);for(ServerPlayer p:online){String key=p.getUUID()+":"+floor;if(claimed.has(key))continue;JsonObject days=RpgStore.object(RpgStore.player(p),"trialRewardDays");long day=server.overworld().getGameTime()/24000;String daily=run.get("difficulty").getAsString()+":"+floor;int count=RpgStore.integer(RpgStore.object(RpgStore.player(p),"evidence"),"trialFloors");int recommended=count>=40?2:count>=10?1:0,played=run.get("difficulty").getAsString().equals("normal")?0:run.get("difficulty").getAsString().equals("adventure")?1:2;double scale=Math.max(0,recommended-played)==0?1:recommended-played==1?.6:.3;
            if(floor!=7&&RpgStore.number(days,daily)!=day+1){List<ItemStack> loot=new ArrayList<>();JsonObject def=RpgSkills.CATALOG.getAsJsonArray("floors").get(floor-1).getAsJsonObject();for(JsonElement e:def.getAsJsonArray("supplies")){JsonObject item=e.getAsJsonObject();loot.add(new ItemStack(BuiltInRegistries.ITEM.get(ResourceLocation.parse(item.get("item").getAsString())),Math.max(1,(int)Math.ceil(item.get("count").getAsInt()*scale))));}
                if(floor<=3){loot.add(new ItemStack(floor==1?Items.TORCH:floor==2?Items.ARROW:Items.PUFFERFISH,floor==3?2:8));}
                if(floor>=4&&server.overworld().getRandom().nextDouble()<.35*scale){Item[] gear={Items.IRON_SWORD,Items.IRON_AXE,Items.BOW,Items.CROSSBOW,Items.IRON_HELMET,Items.IRON_CHESTPLATE,Items.IRON_LEGGINGS,Items.IRON_BOOTS,Items.SHIELD};ItemStack reward=new ItemStack(gear[server.overworld().getRandom().nextInt(gear.length)]);reward=net.minecraft.world.item.enchantment.EnchantmentHelper.enchantItem(server.overworld().getRandom(),reward,Math.min(22,4+floor),p.registryAccess(),Optional.empty());net.minecraft.nbt.CompoundTag tag=reward.getOrDefault(net.minecraft.core.component.DataComponents.CUSTOM_DATA,net.minecraft.world.item.component.CustomData.EMPTY).copyTag();tag.putBoolean("maw_trial_reward",true);reward.set(net.minecraft.core.component.DataComponents.CUSTOM_DATA,net.minecraft.world.item.component.CustomData.of(tag));loot.add(reward);}
                if(floor>=8&&server.overworld().getRandom().nextDouble()<.25*scale)loot.add(new ItemStack(Items.ENDER_PEARL,1));RpgStorage.enqueue(p,loot);days.addProperty(daily,day+1);p.sendSystemMessage(Component.literal("第 "+floor+" 层奖励已存入个人试炼箱；/mycli arena stash。相同难度楼层每24000服务器tick限领奖一次，高等级打低难度减奖。"));
            }claimed.addProperty(key,true);RpgStore.evidence(p,"trialFloors",floor==7?0:1);p.setHealth(p.getMaxHealth());RpgStore.dirty(p);}return true;}
    private static void build(ServerLevel level){
        // Only the new dedicated void dimension. No edits to the inhabited overworld.
        int width=27,height=11,per=width*width*height,total=16*per;int budget=512;
        while(buildIndex<total&&budget-->0){int index=buildIndex++,room=index/per,offset=index%per,x=offset%width-13,y=offset/width%height-1,z=offset/(width*height)-13;BlockPos c=room==0?lobby():center(room),pos=c.offset(x,y,z);boolean wall=Math.abs(x)==13||Math.abs(z)==13;
            JsonObject theme=room==0?null:RpgSkills.CATALOG.getAsJsonArray("floors").get(room-1).getAsJsonObject();
            var floorBlock=theme==null?Blocks.STONE_BRICKS:BuiltInRegistries.BLOCK.get(ResourceLocation.parse(theme.get("floorBlock").getAsString()));
            var wallBlock=theme==null?Blocks.DEEPSLATE_BRICKS:BuiltInRegistries.BLOCK.get(ResourceLocation.parse(theme.get("wallBlock").getAsString()));
            var pillarBlock=theme==null?Blocks.POLISHED_ANDESITE:BuiltInRegistries.BLOCK.get(ResourceLocation.parse(theme.get("pillarBlock").getAsString()));
            var block=y==-1||y==9?floorBlock:wall?wallBlock:Blocks.AIR;
            if(y==0)block=floorBlock;if(y>0&&y<4&&Math.abs(x)==4&&Math.abs(z)%6==0)block=pillarBlock;if(y==1&&x==0&&Math.abs(z)==10)block=Blocks.SEA_LANTERN;
            if(room==0&&y==1&&x==-8&&z==0)block=Blocks.CHEST;if(room==0&&y==1&&z==-10&&(x==-3||x==0||x==3))block=Blocks.LECTERN;
            if(room==7&&y==1){if(x==7&&z==0)block=Blocks.CRAFTING_TABLE;if(x==7&&z==2)block=Blocks.ENCHANTING_TABLE;if(x==7&&z==-2)block=Blocks.ANVIL;}
            if(room>=11&&y==1&&x>=-2&&x<=2&&z>=-2&&z<=2)block=Blocks.STONE_BRICKS;
            if(room==12&&y==1&&x>=5&&x<=8&&z>=-8&&z<=8)block=Blocks.WATER;
            if(room==13&&y==0&&x>=5&&x<=8&&z>=-8&&z<=8)block=Blocks.LAVA;
            if(room>=11&&y==1&&x>=-8&&x<=-5&&z>=4&&z<=7)block=Blocks.STONE_BRICK_STAIRS;
            if(!block.defaultBlockState().isAir()||!level.getBlockState(pos).isAir())level.setBlock(pos,block.defaultBlockState(),2);
        }
        if(buildIndex>=total){RpgStore.of(level.getServer()).root.addProperty("trialBuilt",1);RpgStore.of(level.getServer()).setDirty();com.mojang.logging.LogUtils.getLogger().info("MAW_RPG trial rooms ready: 15 floors, native weapons and reconnectable party");}
    }
}
