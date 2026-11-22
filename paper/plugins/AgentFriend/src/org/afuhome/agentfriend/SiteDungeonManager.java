package org.afuhome.agentfriend;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.File;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.block.Block;
import org.bukkit.block.data.type.Slab;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.*;
import org.bukkit.event.*;
import org.bukkit.event.block.*;
import org.bukkit.event.entity.*;
import org.bukkit.event.inventory.*;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.world.EntitiesLoadEvent;
import org.bukkit.inventory.*;
import org.bukkit.projectiles.ProjectileSource;

/** Encounters inside existing buildings. Entering an active site enrolls an
 * eligible visitor in that encounter, independently of their persistent RPG party. */
final class SiteDungeonManager implements Listener {
    private static final String ROOT="site-dungeons",TAG="afu_site_dungeon",SHOT_TAG="afu_site_projectile";
    private static final int GLOBAL_MOBS=48,PARTY_LIMIT=40,HISTORY_LIMIT=256,MAX_FAILURES=3;
    private static final long REJOIN_MS=300_000,TIMEOUT_MS=1_800_000;
    private static final long RETURN_DELAY_MS=30_000;
    private static final Gson JSON=new Gson();
    private record BossSkill(EntityType type,String name,DungeonEnemyMoves.Move move) { }
    private static final Map<String,BossSkill> BOSS_SKILLS=Map.of(
        "undead_crypt",new BossSkill(EntityType.VINDICATOR,"亡骸守墓者",DungeonEnemyMoves.Move.GRAVE_CLEAVE),
        "frost_keep",new BossSkill(EntityType.STRAY,"寒霜守望者",DungeonEnemyMoves.Move.FROST_LINE),
        "ember_foundry",new BossSkill(EntityType.WITHER_SKELETON,"熔火监工",DungeonEnemyMoves.Move.FORGE_SWEEP));
    private static final Set<Material> HAZARDS=Set.of(Material.LAVA,Material.WATER,Material.FIRE,Material.SOUL_FIRE,
            Material.MAGMA_BLOCK,Material.CACTUS,Material.SWEET_BERRY_BUSH,Material.CAMPFIRE,Material.SOUL_CAMPFIRE,Material.POWDER_SNOW);
    private record Room(String name,int x,int y,int z,int radius,List<DungeonWaveCatalog.Enemy> enemies,List<List<Integer>> spawnPoints,String hint) {
        Location center(World w){return new Location(w,x+.5,y,z+.5);}
        boolean contains(Location l){return Math.abs(l.getX()-(x+.5))<=radius+2&&Math.abs(l.getZ()-(z+.5))<=radius+2&&Math.abs(l.getY()-y)<=3;}
    }
    private record Site(String id,String name,String expedition,String hint,Material icon,String world,
                        List<Room> rooms,int emeralds,Material bonus,int bonusCount,List<Integer> entry,boolean outdoor,int conquestFloor,int minimumLevel) {
        boolean contains(Location l){
            if(l.getWorld()==null||!l.getWorld().getName().equals(world))return false;
            int minX=rooms.stream().mapToInt(Room::x).min().orElseThrow()-24,maxX=rooms.stream().mapToInt(Room::x).max().orElseThrow()+24;
            int minZ=rooms.stream().mapToInt(Room::z).min().orElseThrow()-24,maxZ=rooms.stream().mapToInt(Room::z).max().orElseThrow()+24;
            int minY=rooms.stream().mapToInt(Room::y).min().orElseThrow()-8,maxY=rooms.stream().mapToInt(Room::y).max().orElseThrow()+12;
            return l.getX()>=minX&&l.getX()<=maxX&&l.getZ()>=minZ&&l.getZ()<=maxZ&&l.getY()>=minY&&l.getY()<=maxY;
        }
    }
    private enum Mode {
        NORMAL("normal","普通",1,1,1),ADVENTURE("adventure","冒险",1.5,1.25,2),APOCALYPSE("apocalypse","末日",2.1,1.6,3);
        final String id,label;final double health,damage;final int reward;
        Mode(String id,String label,double health,double damage,int reward){this.id=id;this.label=label;this.health=health;this.damage=damage;this.reward=reward;}
        static Mode parse(String id){for(var m:values())if(m.id.equals(id))return m;throw new IllegalArgumentException("unknown_difficulty");}
    }
    private static final class Run {
        final Site site;String id=UUID.randomUUID().toString();final Mode mode;
        final Set<UUID> party=new LinkedHashSet<>();final Map<UUID,Integer> attendance=new HashMap<>();
        final Set<UUID> declined=new LinkedHashSet<>();
        final Set<UUID> roomParticipants=new LinkedHashSet<>();
        final Map<Integer,Set<UUID>> roomAttendance=new LinkedHashMap<>();
        int attempt,resets,failures;String pauseReason="",lastResetReason="";long lastResetAt,retryReadyAt;
        Location checkpoint;int checkpointRoom=1;boolean retryLoading,storageFault;
        boolean altarTactics, enemyMoves;
        EchoCitadel.Progress echo;
        AltarPoison poison;
        final Map<UUID,DungeonWaveCatalog.Enemy> mobs=new LinkedHashMap<>();final Set<Chunk> held=new HashSet<>();
        final Map<UUID,Long> hits=new HashMap<>();
        int stage;String phase="muster",fault="";long started=System.currentTimeMillis(),readyAt=started+10_000,pausedAt,faultPausedMillis,storageRetryAt;int storageRetryAttempts;boolean invalid;
        Run(Site site,Mode mode){this.site=site;this.mode=mode;}
        Room room(){return site.rooms.get(Math.min(stage,site.rooms.size()-1));}
    }
    private record EntryMember(UUID id,String name,String blocker,List<String> missing){}
    private record EntryOffer(UUID token,long expires,String site,String action,String difficulty,List<EntryMember> roster){}
    private record EntryPermit(String site,long expires){}
    private record Menu(String site,boolean pendingReward,EntryOffer offer){
        Menu(String site,boolean pendingReward){this(site,pendingReward,null);}
    }
    private final Map<UUID,EntryOffer> entryOffers=new HashMap<>();
    private final Map<UUID,EntryPermit> entryPermits=new HashMap<>();
    private record Shot(Run run,long expires){}
    private static final class StorageUnavailable extends IllegalArgumentException {
        StorageUnavailable(Exception cause){super("data_unavailable",cause);}
    }
    private final AgentFriendPlugin plugin;
    private Map<String,Site> sites=Map.of();
    Set<String> configuredSiteIds(){return Set.copyOf(sites.keySet());}
    private record BuildingAreas(ProtectionArea envelope,List<ProtectionArea> pieces) {}
    private Map<String,BuildingAreas> protectionAreas=Map.of();
    private Map<String,DungeonEntrance> approaches=Map.of();
    private record GroundMuster(DungeonEntrance entrance, ProtectionArea platform) {}
    private Map<String,GroundMuster> groundMusters=Map.of();
    private DungeonEntrance approach(Site site){var ground=groundMusters.get(site.id);return ground==null?approaches.get(site.id):ground.entrance();}
    private List<Integer> entry(Site site){var approach=approach(site);return approach==null?site.entry:approach.entry();}
    private String routeHint(Site site){var approach=approach(site);return approach==null?site.hint:approach.hint();}
    private World entryWorld(Site site){var ground=groundMusters.get(site.id);return ground==null?Bukkit.getWorld(site.world):ground.platform().world();}
    private List<Integer> combatEntry(Site site){var first=site.rooms.getFirst();return site.entry.isEmpty()||!first.contains(point(Bukkit.getWorld(site.world),site.entry))
            ?List.of(first.x,first.y,first.z):site.entry;}
    private DungeonEntrance.Station station(Site site){
        var approach=approach(site);
        return approach==null?null:approach.station();
    }
    private boolean atStation(Site site,Location at){
        var station=station(site);
        return station!=null&&at.getWorld()==entryWorld(site)
                &&station.contains(at.getBlockX(),at.getBlockY(),at.getBlockZ());
    }
    private boolean atFirstRoom(Site site,Location at){
        Room first=site.rooms.getFirst();
        return site.contains(at)&&first.contains(at)&&(station(site)==null
                || !atStation(site,at)&&at.getY()>=first.y-.6);
    }
    private boolean atReturnPoint(Site site,Location at){
        if(station(site)==null||!site.contains(at)||atStation(site,at)||belowEncounter(site,at))return false;
        return groundMusters.containsKey(site.id)||site.rooms.stream().anyMatch(room->room.contains(at)&&at.getY()>=room.y-.6);
    }
    private boolean canReturn(Site site,Player p){
        return playing(p)&&!plugin.isDowned(p)&&!p.isInsideVehicle()&&own(p)==null
                &&!plugin.dungeonParticipant(p)&&!plugin.pvpParticipant(p)&&atReturnPoint(site,p.getLocation());
    }
    private record ScheduledReturn(String site,String run,long dueAt) {}
    private final Map<UUID,ScheduledReturn> scheduledReturns=new HashMap<>();
    private final Set<UUID> passages=new HashSet<>();
    private String returnPath(UUID id){return ROOT+".ground-returns."+id;}

    private void restoreReturn(Player p){
        var row=plugin.getConfig().getConfigurationSection(returnPath(p.getUniqueId()));
        if(row==null)return;
        String site=row.getString("site",""),run=row.getString("run","");long due=row.getLong("dueAt");
        if(groundMusters.containsKey(site)&&!run.isEmpty()&&due>0)scheduledReturns.put(p.getUniqueId(),new ScheduledReturn(site,run,due));
    }
    private void clearReturn(UUID id,ScheduledReturn scheduled){
        String path=returnPath(id);
        if(scheduled.run().equals(plugin.getConfig().getString(path+".run")))atomic(()->plugin.getConfig().set(path,null));
        scheduledReturns.remove(id,scheduled);
    }
    private void updateReturns(long now){
        for(var entry:new ArrayList<>(scheduledReturns.entrySet())){
            UUID id=entry.getKey();var scheduled=entry.getValue();var site=sites.get(scheduled.site());var p=ResidentCli.find(id);
            if(p==null||!p.isOnline()){scheduledReturns.remove(id,scheduled);continue;}
            if(site==null||!groundMusters.containsKey(site.id)||!atReturnPoint(site,p.getLocation())||own(p)!=null){clearReturn(id,scheduled);continue;}
            long left=scheduled.dueAt()-now;
            if(left>0){
                p.sendActionBar(net.kyori.adventure.text.Component.text("已通关 · "+((left+999)/1000)+" 秒后返回地面 · 奖励已保留"));
                continue;
            }
            if(!canReturn(site,p)||passages.contains(id))continue;
            // Consume the exact completed run before dispatch; a canceled teleport leaves the manual exit available.
            clearReturn(id,scheduled);
            try{stationPassage(p,site,true,true);}
            catch(IllegalArgumentException failure){result(p,"exit",site.id,failure.getMessage());}
        }
    }
    private void returnGuidance(Map<String,Object> fields,Site site,Player p){
        if(site==null||!canReturn(site,p))return;
        var scheduled=scheduledReturns.get(p.getUniqueId());
        var guide=new LinkedHashMap<String,Object>(Map.of("command","/mycli dungeon exit "+site.id,
                "destination",station(site).name(),"position",entry(site),"world",entryWorld(site).getName(),"manaCost",0));
        if(scheduled!=null&&scheduled.site().equals(site.id))guide.put("autoReturnAt",scheduled.dueAt());
        fields.put("returnToGround",guide);
    }
    private void offerReturn(Site site,Player p){
        if(!canReturn(site,p))return;
        p.sendMessage(net.kyori.adventure.text.Component.text("[免费返回地面入口] "+station(site).name(),
                net.kyori.adventure.text.format.NamedTextColor.AQUA)
                .clickEvent(net.kyori.adventure.text.event.ClickEvent.runCommand("/mycli dungeon exit "+site.id)));
    }
    private boolean belowEncounter(Site site,Location at){
        return station(site)!=null&&at.getY()<site.rooms.stream().mapToInt(Room::y).min().orElseThrow()-.6;
    }
    private static Location point(World world,List<Integer> xyz){
        return new Location(world,xyz.get(0)+.5,xyz.get(1),xyz.get(2)+.5);
    }
    private Map<String,Object> stationGuide(Site site){
        var station=station(site);
        if(station==null)return Map.of();
        var first=site.rooms.getFirst();var relic=DungeonRelics.at(site.id);
        return Map.of("world",entryWorld(site).getName(),"name",station.name(),"landing",entry(site),"board",station.board(),
                "button",station.button(),"upperLanding",combatEntry(site),"firstRoom",List.of(first.x,first.y,first.z),
                "challengeButton",relic==null?List.of():List.of(relic.x(),relic.y(),relic.z()),
                "enterCommand","/mycli dungeon enter "+site.id,"returnCommand","/mycli dungeon exit "+site.id);
    }
    private boolean protectedApproachLanding(Site site,Location at){
        var muster=groundMusters.get(site.id);
        if(muster!=null)return muster.platform().contains(at.clone().add(0,-1,0))&&muster.platform().contains(at.clone().add(0,1,0));
        if(!approaches.containsKey(site.id))return true;
        var building=protectionAreas.get(site.id);if(building==null)return false;
        for(int dy=-1;dy<=1;dy++){Location part=at.clone().add(0,dy,0);if(building.pieces.stream().noneMatch(area->area.contains(part)))return false;}
        return true;
    }
    private final Map<String,Run> runs=new LinkedHashMap<>();
    private final Map<Inventory,Menu> menus=new IdentityHashMap<>();
    private final Map<UUID,Shot> shots=new HashMap<>();
    private final Set<String> blockedCheckpoints=new HashSet<>();
    private final Map<UUID,Long> lockHints=new HashMap<>();
    private boolean ready;
    private final ThreadLocal<Boolean> jsonOutput=ThreadLocal.withInitial(()->false);
    private final ThreadLocal<Boolean> verboseOutput=ThreadLocal.withInitial(()->false);

    /** Read only current runtime facts. Does not load chunks, enroll, resume,
     * clear an expired task, save a checkpoint or grant completion evidence. */
    Map<String,Object> advice(Player p,String id){
        Site s=sites.get(id);if(s==null)return DungeonAdvice.evaluate(id,id,Map.of("configured",false));
        Run run=runs.get(id),mine=own(p);Room first=s.rooms.getFirst();long now=System.currentTimeMillis();
        Map<String,Object> facts=new LinkedHashMap<>();
        var loadout=DungeonLoadout.missing(p);facts.put("loadoutReady",loadout.isEmpty());facts.put("missingLoadout",String.join("、",loadout));
        facts.put("configured",ready&&!blockedCheckpoints.contains(id)&&Bukkit.getWorld(s.world)!=null);
        facts.put("pendingReward",receipt(p.getUniqueId(),id)!=null);
        facts.put("participant",run!=null&&run.party.contains(p.getUniqueId()));
        if (run == null) {
            facts.put("resetFailed", plugin.dungeonEdits().failed("site-" + id));
            facts.put("resetPending", plugin.dungeonEdits().dirty("site-" + id));
        }
        facts.put("otherActivity",mine!=null&&mine!=run||plugin.dungeonParticipant(p)&&mine==null||plugin.pvpParticipant(p));
        facts.put("occupied",run!=null);facts.put("joinable",run!=null&&!run.phase.equals("returning")&&run.fault.isEmpty()&&run.party.size()<PARTY_LIMIT);
        facts.put("atFirstRoom",atFirstRoom(s,p.getLocation()));facts.put("atSite",s.contains(p.getLocation()));
        var station=station(s);
        if(station!=null){
            facts.put("stationName",station.name());facts.put("atStation",atStation(s,p.getLocation()));
            facts.put("stationButton",station.button().toString());
            if(p.getWorld()==entryWorld(s)){
                var pad=point(p.getWorld(),entry(s));
                facts.put("nearStation",Math.abs(p.getLocation().getY()-pad.getY())<=4
                        &&p.getLocation().distanceSquared(pad)<=4096);
                facts.put("stationLanding",entry(s).toString());
            }
        }
        var expedition=DungeonExpeditions.site(s.expedition);
        if(entry(s).isEmpty()&&expedition!=null)facts.put("nearApproach",DungeonArrival.nearApproach(
                p.getWorld().getName(),p.getLocation().getX(),p.getLocation().getZ(),s.world,
                expedition.x(),expedition.z(),expedition.approachX(),expedition.approachZ()));
        facts.put("firstRoom",s.world+" "+first.x+","+first.y+","+first.z);
        facts.put("cooldownMs",Math.max(0,120_000-(now-plugin.getConfig().getLong(ROOT+".cooldowns."+id,0))));
        if(run!=null){facts.put("phase",run.phase);facts.put("paused",run.pausedAt>0);facts.put("faulted",!run.fault.isEmpty());facts.put("remainingMobs",run.mobs.size());Room target=run.room();facts.put("target",s.world+" "+target.x+","+target.y+","+target.z);}
        var combat=plugin.combatRpg();String role=combat==null?"":combat.profession(p);int level=combat==null?1:combat.level(p);
        if(s.conquestFloor>0){
            String reason="",hint="",command="";
            if(!plugin.conquestWorldReady()){reason="CONQUEST_MAP_UNAVAILABLE";hint="攻略地图暂不可用，改选其他地点；不要反复传送或开场。";command="/mycli dungeon list";}
            else if(role.isEmpty()){reason="PROFESSION_REQUIRED";hint="正式攻略需先选择职业；原委托保留。";command="/mycli profession status";}
            else if(level<s.minimumLevel){reason="COMBAT_LEVEL_REQUIRED";hint="本层最低战斗Lv."+s.minimumLevel+"，你为Lv."+level+"；先练级整备。";command="/mycli rpg status";}
            else if(combat.floor(p)<s.conquestFloor-1){reason="PREVIOUS_FLOOR_REQUIRED";hint="须先实际通关前一层，旧练习塔成绩不能代替正式攻略。";command="/mycli rpg status";}
            facts.put("admissionReason",reason);facts.put("admissionHint",hint);facts.put("admissionCommand",command);
        }
        Map<String,Object> out=DungeonAdvice.evaluate(id,s.name,facts);var prep=DungeonAdvice.preparation(id,s.minimumLevel);
        returnGuidance(out,s,p);
        out.put("recommendedLevel",prep.recommendedLevel());out.put("minimumLevel",s.conquestFloor>0?s.minimumLevel:1);
        out.put("playerCombatLevel",level);out.put("recommendedEquipment",prep.equipment());out.put("recommendedParty",prep.party());
        out.put("requiredEquipment",DungeonLoadoutRules.REQUIREMENTS);out.put("missingEquipment",loadout);
        long armor=Arrays.stream(p.getInventory().getArmorContents()).filter(i->i!=null&&!i.getType().isAir()).count();
        out.put("currentEquipment","战斗Lv."+level+"、护甲"+armor+"/4、"+(p.getInventory().getItemInOffHand().getType()==Material.SHIELD?"已副手持盾":"副手未持盾")+(ResidentCli.isResident(p.getUniqueId())?"、原生女仆饥饿系统":"、饱食"+p.getFoodLevel()+"/20"));
        out.put("skillHint",DungeonAdvice.skill(role));out.put("firstRoom",facts.get("firstRoom"));
        if(ResidentCli.isResident(p.getUniqueId())){
            out.put("actorType","native_resident");out.put("skillHint","用 status 查看本人 rpg.abilities；按 effect、manaCost 和 cooldownRemainingMs 选择原生 cast 动作。实际背包和装备仍须检查。");
            if(Objects.toString(out.get("nextCommand"),"").startsWith("/mycli trade shop"))out.put("nextCommand","/mycli arena shop list");
            else if(Set.of("/mycli profession status","/mycli rpg status").contains(out.get("nextCommand")))out.put("nextCommand","/mycli status");
        }
        List<String> nativeEnemies=s.rooms.stream().flatMap(room->room.enemies.stream()).map(DungeonWaveCatalog.Enemy::mythic).filter(mob->mob!=null&&!mob.isEmpty()).distinct().toList();
        if(!nativeEnemies.isEmpty()){out.put("nativeEnemies",nativeEnemies);out.put("nativeContent",s.conquestFloor>0?"普通难度也启用Mythic首领机制":"冒险与末日启用Mythic精英；普通保留原版战斗");}
        String hint=routeHint(s);if(out.get("state").equals("approach")&&!hint.isBlank())out.put("nextAction",out.get("nextAction")+" 路线："+(hint.length()>180?hint.substring(0,180)+"…":hint));
        if(station!=null)out.put("station",stationGuide(s));
        if(run!=null&&run.party.contains(p.getUniqueId())&&Set.of("moving","fighting").contains(out.get("state"))&&!run.room().hint.isBlank()){
            out.put("routeHint",run.room().hint);
            out.put("nextAction",out.get("nextAction")+" 路线："+run.room().hint);
        }
        out.put("difficulty",List.of(Map.of("id","normal","label","普通","stars",prep.stars(),"healthMultiplier",1.0,"damageMultiplier",1.0),Map.of("id","adventure","label","冒险","stars",Math.min(5,prep.stars()+1),"healthMultiplier",1.5,"damageMultiplier",1.25),Map.of("id","apocalypse","label","末日","stars",5,"healthMultiplier",2.1,"damageMultiplier",1.6)));
        return out;
    }

    SiteDungeonManager(AgentFriendPlugin plugin){
        this.plugin=plugin;
        if(!new File(plugin.getDataFolder(),"dungeons.yml").exists())plugin.saveResource("dungeons.yml",false);
        reload();plugin.getServer().getPluginManager().registerEvents(this,plugin);
        for(World world:Bukkit.getWorlds())for(Entity e:world.getEntities())if(owned(e)||e.getScoreboardTags().contains(SHOT_TAG))e.remove();
        restore();new DungeonIntegrity(plugin);Bukkit.getScheduler().runTaskTimer(plugin,this::tick,20,20);
    }
    private static void require(boolean yes,String reason){if(!yes)throw new IllegalArgumentException(reason);}
    private String day(){return LocalDate.now(ZoneId.of("Asia/Shanghai")).toString();}
    private Run own(Entity p){return runs.values().stream().filter(r->r.party.contains(p.getUniqueId())).findFirst().orElse(null);}
    boolean isParticipant(Player p){return own(p)!=null;}
    String reinforcementProblem(Player actor,LivingEntity target,Location landing){
        Run targetRun=own(target),actorRun=own(actor);
        if(actorRun!=null&&actorRun!=targetRun)return "[team_leave_dungeon] 你仍在另一处遗迹；先 /mycli dungeon leave 正常离场，再支援。";
        if(targetRun==null){
            for(Run r:runs.values())if(r.site.contains(landing))return "[team_target_not_participating] 目标尚未加入这场挑战，请选择本场参战队友；/mycli dungeon status 查询。";
            return "";
        }
        String problem=entryProblem(actor,targetRun,landing);
        if(problem.isEmpty())return "";
        if(problem.equals("equipment_required"))return "[equipment_required] 增援需补齐："+String.join("、",DungeonLoadout.missing(actor))+"；/mycli shop menu 购买或 /mycli stash 取用装备。";
        String advice=switch(problem){
            case "walk_to_site" -> "队友已经离开遗迹，重新查询位置";
            case "already_in_activity_or_not_survival" -> "先正常离开当前其他活动，再来增援";
            case "challenge_not_accepting" -> "本场正在恢复或结算，先查询本场状态";
            case "left_this_visit" -> "你刚主动离开本场，请先走出遗迹区域，再传回增援";
            case "party_full" -> "本场队伍已满，选择其他队伍";
            case "claim_previous_reward_first" -> "先领取这处遗迹上一场的奖励";
            case "conquest_profession_required" -> "先选择职业";
            case "conquest_level_required" -> "先达到本层要求的职业等级";
            case "previous_floor_required" -> "先完成前置正式楼层";
            default -> "查看这处遗迹的实际准入条件";
        };
        return "["+problem+"] "+advice+"；/mycli dungeon info "+targetRun.site.id;
    }
    boolean enrollReinforcement(Player actor,LivingEntity target){
        Run r=own(target);
        return r==null?own(actor)==null:reinforcementProblem(actor,target,actor.getLocation()).isEmpty()&&enroll(actor,r);
    }
    boolean hasOpenSite() {
        return ready && sites.values().stream().anyMatch(site -> !runs.containsKey(site.id));
    }
    /** One optional outing from the installed sites. Use only loaded configuration and the caller's history. */
    Map<String,Object> lobbyOuting(Player player) {
        if(!ready || own(player)!=null)return Map.of();
        UUID id=player.getUniqueId();
        long now=System.currentTimeMillis();
        var config=plugin.getConfig();
        int level=plugin.combatRpg()==null?1:plugin.combatRpg().level(player);
        String today=day();
        var site=sites.values().stream()
            .filter(s->s.conquestFloor==0 && Bukkit.getWorld(s.world)!=null && !blockedCheckpoints.contains(s.id)
                && !runs.containsKey(s.id) && receipt(id,s.id)==null
                && !plugin.dungeonEdits().dirty("site-"+s.id) && !plugin.dungeonEdits().failed("site-"+s.id)
                && !today.equals(config.getString(ROOT+".claimed."+id+"."+s.id))
                && now-config.getLong(ROOT+".cooldowns."+s.id,0)>=120_000)
            .map(s->new DungeonAdvice.Outing(s.id,DungeonAdvice.preparation(s.id,s.minimumLevel).recommendedLevel(),
                config.contains(ROOT+".claimed."+id+"."+s.id),config.getLong(ROOT+".outcomes."+id+"."+s.id+".endedAt",0)))
            .min(DungeonAdvice.Outing.orderFor(level));
        if(site.isEmpty())return Map.of();
        Site s=sites.get(site.get().id());
        var guide=advice(player,s.id);
        return Map.of("id",s.id,"name",s.name,"state",guide.get("state"),"infoCommand","/mycli dungeon info "+s.id,
            "nextCommand",guide.get("nextCommand"),"missingEquipment",guide.get("missingEquipment"),
            "recommendedLevel",guide.get("recommendedLevel"),"approachMana",8,"firstRoom",s.rooms.getFirst().name,
            "tactic",DungeonAdvice.preparation(s.id,s.minimumLevel).party());
    }
    boolean hasActiveRuns(){return !runs.isEmpty()||!blockedCheckpoints.isEmpty();}
    boolean emptyForRestore(String id) {
        BuildingAreas building = protectionAreas.get(id);
        if (!ready || building == null || runs.containsKey(id) || blockedCheckpoints.contains(id)) return false;
        // Piece 0 also covers the search/approach buffer. For a surveyed site it is
        // enough to wait for everyone to leave the authored space that may be reset.
        List<ProtectionArea> occupiedAreas = building.pieces.size() > 1
                ? building.pieces.subList(1, building.pieces.size()) : building.pieces;
        return WildRuinResets.empty(occupiedAreas);
    }
    boolean overlapsResetSite(ProtectionArea area) {
        return !ready || protectionAreas.values().stream()
                .anyMatch(site -> site.pieces.stream().anyMatch(piece -> WildRuinResets.overlaps(piece, area)));
    }
    List<String> ids(){return new ArrayList<>(sites.keySet());}
    JsonObject gatheringRoute(Player player, String id) {
        Site target = sites.get(id);
        if (target == null) return null;
        Room first = target.rooms.getFirst();
        String hint = routeHint(target);
        JsonObject route = WorldActivityGuide.siteRoute(id, first.name + "（" + target.world + " "
                + first.x + "," + first.y + "," + first.z + "）",
                hint.length() > 180 ? hint.substring(0, 180) + "…" : hint, advice(player, id));
        route.add("firstRoomPosition", JSON.toJsonTree(Map.of(
                "world", target.world, "x", first.x, "y", first.y, "z", first.z)));
        List<Integer> approach = entry(target);
        if (!approach.isEmpty()) route.add("configuredApproach", JSON.toJsonTree(Map.of(
                "world", entryWorld(target).getName(), "x", approach.get(0), "y", approach.get(1), "z", approach.get(2))));
        return route;
    }
    boolean activityArea(Location at){return protectionArea(at)!=null;}
    String editDomain(Location at) {
        for (var station : groundMusters.entrySet())if(station.getValue().platform().contains(at))return "site-"+station.getKey();
        for (var item : protectionAreas.entrySet()) {
            BuildingAreas building = item.getValue();
            if (building.envelope.contains(at) && building.pieces.stream().anyMatch(piece -> piece.contains(at)))
                return "site-" + item.getKey();
        }
        return null;
    }

    boolean editableInterior(String id, Player player, Location at) {
        Site site = sites.get(id);
        BuildingAreas building = protectionAreas.get(id);
        if (!ready || site == null || building == null || blockedCheckpoints.contains(id) || campRescueLatch(at.getBlock())) return false;
        if (atStation(site,at)) return false;
        if (!canUseSite(id, player)) return false;
        // Piece zero is the broad combat/search buffer. Authored structure pieces define the
        // shell, including shared seams. A site without pieces opens just its combat rooms.
        if (building.pieces.size() > 1)
            return DungeonBuildPolicy.insidePieces(building.pieces.subList(1, building.pieces.size()), at);
        return site.rooms.stream().anyMatch(room -> Math.abs(at.getBlockX() - room.x) < room.radius
                && Math.abs(at.getBlockZ() - room.z) < room.radius && at.getBlockY() >= room.y && at.getBlockY() < room.y + 4);
    }
    boolean canUseSite(String id, Player player) {
        if (!ready || !sites.containsKey(id) || blockedCheckpoints.contains(id)) return false;
        Run run = runs.get(id);
        return run == null || !run.invalid && run.pausedAt == 0 && run.fault.isEmpty() && !run.retryLoading
                && !run.phase.equals("returning") && !run.phase.equals("retrying") && run.party.contains(player.getUniqueId());
    }
    boolean activeBuilder(String id, Player player) {
        Run run = runs.get(id);
        return run != null && player.getGameMode() == GameMode.SURVIVAL && run.site.contains(player.getLocation())
                && canUseSite(id, player);
    }
    ProtectionArea protectionArea(Location at) {
        for (var station : groundMusters.values())if(station.platform().contains(at))return station.platform();
        for(BuildingAreas building:protectionAreas.values()){
            if(!building.envelope.contains(at))continue;
            for(ProtectionArea area:building.pieces)if(area.contains(at))return area;
        }
        return null;
    }
    private String rescueKey(Run r){return "site:"+r.id;}
    String challengeContext(UUID id){Run r=runs.values().stream().filter(run->run.party.contains(id)).findFirst().orElse(null);return r==null?"":rescueKey(r)+":"+r.stage+":"+r.attempt;}
    String circleScene(Player p,Location ground){
        for(Run r:runs.values())if(companionCombatPosition(r,p,ground))return rescueKey(r)+":"+r.stage+":"+r.attempt;
        return null;
    }
    boolean activeCircleSite(Location ground){return runs.values().stream().anyMatch(r->r.site.contains(ground));}
    private static String circleProof(UUID id){return ROOT+".healing-circle-proofs."+id;}
    boolean circleReward(UUID id){return plugin.getConfig().isString(circleProof(id));}
    TrialRescueManager.Team rescueTeam(UUID id){
        Run r=runs.values().stream().filter(run->run.party.contains(id)).findFirst().orElse(null);if(r==null)return null;
        return new TrialRescueManager.Team(rescueKey(r),Set.copyOf(r.party),r.site::contains,r.pausedAt>0||!r.fault.isEmpty(),
                ()->r.phase.equals("fighting")&&r.mobs.isEmpty()&&!r.invalid&&(r.echo==null||!r.echo.hasNext(r.stage)),
                ()->defeated(r),checkpoint(r));
    }
    private Location checkpoint(Run r){return r.checkpoint==null?r.site.rooms.getFirst().center(Bukkit.getWorld(r.site.world)):r.checkpoint.clone();}
    private Map<String,Object> checkpointState(Run r){
        Location point=checkpoint(r);
        return Map.of("maxFailures",MAX_FAILURES,"failures",r.failures,"attemptsRemaining",Math.max(0,MAX_FAILURES-r.failures),
                "checkpointRoom",r.checkpointRoom,"checkpoint",List.of(point.getBlockX(),point.getBlockY(),point.getBlockZ()),
                "retrying",r.phase.equals("retrying"),"retryReadyAt",r.retryReadyAt);
    }
    Map<String,Object> checkpointState(UUID id){Run r=runs.values().stream().filter(run->run.party.contains(id)).findFirst().orElse(null);return r==null?Map.of():checkpointState(r);}
    private void lifecycle(Map<String,Object> fields,Run run,Player p,Map<String,Object> outcome){
        boolean participant=run!=null&&run.party.contains(p.getUniqueId());
        fields.put("lifecycle",participant?"active":outcome.isEmpty()?"none":"ended");
        fields.put("participantRun",participant?run.id:"");
        fields.put("rescueActive",participant&&plugin.trialRescue()!=null&&plugin.trialRescue().rescueActive(p));
        fields.put("timeLimitSeconds",TIMEOUT_MS/1000);
        if(participant){
            long now=!run.fault.isEmpty()&&run.pausedAt>0?run.pausedAt:System.currentTimeMillis();
            fields.put("remainingSeconds",Math.max(0,(TIMEOUT_MS-activeMillis(run.started,run.faultPausedMillis,now)+999)/1000));
        }else if(!outcome.isEmpty()){
            fields.put("endReason",outcome.get("reason"));fields.put("endedAt",outcome.get("endedAt"));
            fields.put("exitPolicy","standing_stay_downed_recover");
        }
    }
    private void defeated(Run r){
        if(runs.get(r.site.id)!=r||r.phase.equals("retrying")||!r.fault.isEmpty())return;
        int before=r.failures;String phase=r.phase;
        try{
            if(r.stage<r.site.rooms.size())r.failures++;
            if(r.failures>=MAX_FAILURES){end(r,"attempts_exhausted");return;}
            clean(r);r.phase="retrying";r.retryReadyAt=System.currentTimeMillis()+10_000;r.pausedAt=0;r.pauseReason="";persist();
            returnToCheckpoint(r);
        }catch(RuntimeException failure){
            r.failures=before;r.phase=phase;r.fault="data_unavailable";r.pauseReason="runtime_error";r.pausedAt=System.currentTimeMillis();
            plugin.getLogger().log(java.util.logging.Level.WARNING,"Dungeon checkpoint retry paused: "+r.site.id,failure);
            notice(r,"§c存档点恢复暂不可用，场次保留，不重复扣次数；请联系服主，恢复后 /mycli dungeon resume。");
        }
    }
    private void returnToCheckpoint(Run r){
        if(r.retryLoading||runs.get(r.site.id)!=r||!r.phase.equals("retrying"))return;
        Location point=checkpoint(r);World world=point.getWorld();if(world==null)throw new IllegalArgumentException("checkpoint_unavailable");
        r.retryLoading=true;
        ExistingChunkAccess.load(plugin,world,point.getBlockX()>>4,point.getBlockZ()>>4).whenComplete((chunk,error)->{if(!plugin.isEnabled())return;Bukkit.getScheduler().runTask(plugin,()->{
            r.retryLoading=false;if(runs.get(r.site.id)!=r||!r.phase.equals("retrying"))return;
            try{
            Location safe=null;
            if(error==null)for(int dy:new int[]{0,1,-1})for(int dx=-2;dx<=2&&safe==null;dx++)for(int dz=-2;dz<=2;dz++){
                Location candidate=point.clone().add(dx,dy,dz);
                if(world.isChunkLoaded(candidate.getBlockX()>>4,candidate.getBlockZ()>>4)&&AgentFriendPlugin.safeLanding(candidate.getBlock())){safe=candidate;break;}
            }
            if(safe==null){r.fault="checkpoint_unavailable";r.pausedAt=System.currentTimeMillis();r.pauseReason="runtime_error";persist();notice(r,"§c存档点暂不安全，场次已暂停、次数不再减少；不要拆建筑，联系服主检查后 /mycli dungeon resume。");return;}
            r.retryReadyAt=System.currentTimeMillis()+10_000;persist();
            if(plugin.trialRescue()!=null)plugin.trialRescue().releaseTeam(rescueKey(r),safe);
            notice(r,r.stage>=r.site.rooms.size()?"§a战斗已全部完成，已在最后存档点恢复；未扣机会，系统会按真实参战记录结算，无需返回首室。":"§e【存档点续关】本场第"+r.failures+"次战败，剩余"+(MAX_FAILURES-r.failures)+"次机会；已回第"+r.checkpointRoom+"室存档点，10秒后可继续当前段。已清房间保留，不必跑回主城；背包装备保留。");
            }catch(RuntimeException failure){r.fault="data_unavailable";r.pauseReason="runtime_error";r.pausedAt=System.currentTimeMillis();plugin.getLogger().log(java.util.logging.Level.WARNING,"Checkpoint return paused: "+r.site.id,failure);notice(r,"§c续关结果暂不可确认，场次保留，先查询 dungeon status；不要重复开场，请联系服主。");}
        });});
    }
    private boolean echoAvailable(Site site){
        return site.id.equals(EchoCitadel.SITE)&&site.world.equals("aincrad")
            &&plugin.getConfig().getBoolean("dungeon-encounters.void-citadel",false)
            &&plugin.dungeonEnemyMoves().enabled()&&echoGeometry(site);
    }
    private static boolean echoGeometry(Site site){
        return site.rooms.stream().map(room->List.of(room.x,room.y,room.z)).toList().equals(EchoCitadel.CENTERS);
    }
    private EchoCitadel.Wave echoWave(Run r,int wave){
        return EchoCitadel.wave(r.stage,wave,r.mode.id,r.room().enemies);
    }
    private boolean canSpawn(int count){
        return runs.values().stream().mapToInt(run->run.mobs.size()).sum()+count<=GLOBAL_MOBS;
    }
    private boolean bossLocked(Run r){return r.stage==r.site.rooms.size()-1&&Set.of("moving","fighting","retrying").contains(r.phase);}
    private boolean bossRoom(Run r,Location at){return at.getWorld()!=null&&at.getWorld().getName().equals(r.site.world)&&r.site.rooms.getLast().contains(at);}
    private boolean roomVisitor(Player p){return plugin.isObserver(p)||p.getGameMode()==GameMode.SPECTATOR||p.getGameMode()==GameMode.CREATIVE&&plugin.trustedBlockEditor(p);}
    private java.util.stream.Stream<Player> bossIntruders(Run r){return ResidentCli.online().stream().filter(p->p.getWorld()==Bukkit.getWorld(r.site.world)).filter(p->!roomVisitor(p)&&!r.party.contains(p.getUniqueId())&&bossRoom(r,p.getLocation()));}
    private void lockHint(Player p,String text){long now=System.currentTimeMillis();if(now-lockHints.getOrDefault(p.getUniqueId(),0L)<5000)return;lockHints.put(p.getUniqueId(),now);p.sendMessage("§e[boss_room_locked] "+text+" 可改选其他地点：/mycli dungeon list");}
    private void guardBoss(PlayerMoveEvent e){
        Player p=e.getPlayer();Location to=e.getTo();if(to==null||roomVisitor(p))return;
        for(Run r:runs.values())if(bossLocked(r)&&!r.party.contains(p.getUniqueId())&&bossRoom(r,to)&&!bossRoom(r,e.getFrom())){
            if(entryProblem(p,r,to).isEmpty())return;
            e.setCancelled(true);lockHint(p,"Boss房间正在由另一支参战队伍攻略，入口已锁；不要反复进入或传送。");return;
        }
    }
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void enterBoss(PlayerMoveEvent e){
        if(e instanceof PlayerTeleportEvent||e.getTo()==null)return;
        if(e.getFrom().getBlockX()==e.getTo().getBlockX()&&e.getFrom().getBlockY()==e.getTo().getBlockY()&&e.getFrom().getBlockZ()==e.getTo().getBlockZ())return;
        guardBoss(e);
    }
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void teleportBoss(PlayerTeleportEvent e){guardBoss(e);}
    private void clearLoginIntruder(Player p){
        if(!p.isOnline()||roomVisitor(p))return;
        for(Run r:runs.values())if(bossLocked(r)&&!r.party.contains(p.getUniqueId())&&bossRoom(r,p.getLocation())){
            if(enroll(p,r))return;
            Location exit=r.site.rooms.getFirst().center(Bukkit.getWorld(r.site.world));
            if(bossRoom(r,exit))exit=p.getWorld().getSpawnLocation();
            Location target=exit;
            ExistingChunkAccess.load(plugin,target.getWorld(),target.getBlockX()>>4,target.getBlockZ()>>4).thenRun(()->{if(plugin.isEnabled())Bukkit.getScheduler().runTask(plugin,()->{
                if(!p.isOnline()||runs.get(r.site.id)!=r||!bossLocked(r)||r.party.contains(p.getUniqueId())||!bossRoom(r,p.getLocation()))return;
                for(int y=0;y<=3;y++)for(int x=-2;x<=2;x++)for(int z=-2;z<=2;z++){
                    Location at=target.clone().add(x,y,z);if(!at.getWorld().isChunkLoaded(at.getBlockX()>>4,at.getBlockZ()>>4)||bossRoom(r,at)||!AgentFriendPlugin.safeLanding(at.getBlock()))continue;
                    if(p.teleport(at))lockHint(p,"登录位置属于其他队伍占用的Boss房间，已移至入口安全处。");return;
                }
                lockHint(p,"当前位置属于另一队Boss房间，请先退出门外；不能参与本场攻击。");
            });});return;
        }
    }
    @EventHandler public void forgetRoomHint(PlayerQuitEvent e){
        UUID id=e.getPlayer().getUniqueId();lockHints.remove(id);entryOffers.remove(id);entryPermits.remove(id);
    }
    private boolean playing(Player p){return p!=null&&p.isOnline()&&!p.isDead()&&p.getGameMode()==GameMode.SURVIVAL;}
    private String entryProblem(Player p,Run r,Location at){
        if(!playing(p)||roomVisitor(p)||plugin.isDowned(p))return "not_survival_or_observer";
        if(!r.site.contains(at)||atStation(r.site,at))return "walk_to_site";
        if(!r.attendance.containsKey(p.getUniqueId())&&belowEncounter(r.site,at))return "walk_to_station";
        Run other=own(p);DungeonManager trial=plugin.dungeon();
        if((other!=null&&other!=r)||(trial!=null&&trial.isParticipant(p))||plugin.pvpParticipant(p))return "already_in_activity_or_not_survival";
        if(!r.fault.isEmpty()||r.phase.equals("returning"))return "challenge_not_accepting";
        if(r.declined.contains(p.getUniqueId()))return "left_this_visit";
        if(!r.party.contains(p.getUniqueId())&&r.party.size()>=PARTY_LIMIT)return "party_full";
        if(!r.attendance.containsKey(p.getUniqueId())&&r.attendance.size()>=HISTORY_LIMIT)return "party_full";
        if(receipt(p.getUniqueId(),r.site.id)!=null)return "claim_previous_reward_first";
        try{conquestAdmission(p,r.site);}catch(IllegalArgumentException problem){return problem.getMessage();}
        return r.attendance.containsKey(p.getUniqueId())||hasEntryPermit(p,r.site)||DungeonLoadout.missing(p).isEmpty()?"":"equipment_required";
    }
    /** The attendance map is the existing durable contribution history; party
     * contains only this encounter's current members. Leaving never erases work. */
    private boolean enroll(Player p,Run r){
        if(r.party.contains(p.getUniqueId()))return true;
        String problem=entryProblem(p,r,p.getLocation());
        if(!problem.isEmpty()){
            if(!roomVisitor(p)&&r.site.contains(p.getLocation())&&!atStation(r.site,p.getLocation())
                    &&!Set.of("left_this_visit","walk_to_station").contains(problem)){
                long now=System.currentTimeMillis();if(now-lockHints.getOrDefault(p.getUniqueId(),0L)>=10_000){
                    lockHints.put(p.getUniqueId(),now);
                    if(problem.equals("equipment_required"))p.sendMessage("§e[战备不足] 尚未自动参战："+String.join("、",DungeonLoadout.missing(p))+"。可先补给，或用 /mycli dungeon join "+r.site.id+" 核对并确认入场。");
                    else p.sendMessage("§e[尚未参战] "+problem+"；/mycli dungeon info "+r.site.id+" 查询具体条件。");
                }
            }
            return false;
        }
        UUID id=p.getUniqueId();boolean known=r.attendance.containsKey(id);r.party.add(id);r.attendance.putIfAbsent(id,0);
        try{persist();}catch(RuntimeException failure){r.party.remove(id);if(!known)r.attendance.remove(id);throw failure;}
        entryPermits.remove(id);
        p.sendMessage("§a【自动参战】已加入 "+r.site.name+" 当前挑战；无需组队或加入指令。随时可离开，已经完成的参战记录保留；回来自动续接。全队最多3次战败机会，靠近倒地队友可救援。");
        return true;
    }
    private void reconcile(Run r){
        Set<UUID> before=new LinkedHashSet<>(r.party),declinedBefore=new LinkedHashSet<>(r.declined);
        r.declined.removeIf(id->{Player p=ResidentCli.find(id);return p==null||!r.site.contains(p.getLocation());});
        r.party.removeIf(id->{Player p=ResidentCli.find(id);return p==null||!r.site.contains(p.getLocation())||atStation(r.site,p.getLocation());});
        if(!before.equals(r.party)||!declinedBefore.equals(r.declined)){
            try{persist();}catch(RuntimeException failure){r.party.clear();r.party.addAll(before);r.declined.clear();r.declined.addAll(declinedBefore);throw failure;}
        }
        World world=Bukkit.getWorld(r.site.world);if(world==null)return;
        for(Player p:ResidentCli.online())if(r.site.contains(p.getLocation())&&!r.party.contains(p.getUniqueId()))enroll(p,r);
    }
    private List<Player> present(Run r){return r.party.stream().map(ResidentCli::find).filter(this::playing).filter(p->r.site.contains(p.getLocation())).toList();}
    private String label(Site site){return site.conquestFloor>0?"正式楼层攻略":site.outdoor?"野外据点讨伐":"遗迹地下城";}
    private void send(Player p,String prefix,Map<String,?> fields){
        Map<String,Object> data=new LinkedHashMap<>();data.put("schemaVersion",1);data.put("activityType","site_dungeon");
        Site site=sites.get(Objects.toString(fields.get("id"),""));data.put("activityLabel",site==null?"遗迹远征":label(site));
        if(site!=null)data.put("setting",site.outdoor?"outdoor":"interior");data.put("commandRoot","/mycli dungeon");data.put("language","zh-CN");data.putAll(fields);data.put("recipient",p.getName());
        Map<String,Object> guide=site==null?Map.of():advice(p,site.id);
        if(!guide.isEmpty())data.put("guidance",guide);
        if(!guide.isEmpty()&&prefix.equals("MC_SITE_DUNGEON_RESULT")&&!Boolean.TRUE.equals(fields.get("success"))&&Set.of("walk_to_first_room","site_busy","site_cooldown","muster_closed","claim_previous_reward_first","conquest_profession_required","conquest_level_required","previous_floor_required").contains(fields.get("reason"))){
            data.put("primaryBlocker",guide.get("reason"));data.put("nextAction",guide.get("nextAction"));data.put("nextCommand",guide.get("nextCommand"));data.put("nextCommands",List.of(guide.get("nextCommand")));
        }
        if(jsonOutput.get()){
            String line=prefix+" "+JSON.toJson(data);
            if(line.length()>4000&&!guide.isEmpty()){
                // Mineflayer's plain-text accessor clips a chat line at 4096 characters.
                // Keep the receipt and next action together, trimming repeated reference data first.
                var compact=new LinkedHashMap<String,Object>();
                for(String key:List.of("state","reason","nextAction","nextCommand","retryAfterMs","missingEquipment","station","returnToGround"))
                    if(guide.containsKey(key)&&!fields.containsKey(key)&&!(key.equals("station")&&fields.containsKey("arrival")))
                        compact.put(key,guide.get(key));
                data.put("guidance",compact);
                line=prefix+" "+JSON.toJson(data);
            }
            p.sendMessage(line);return;
        }
        if(prefix.equals("MC_SITE_DUNGEON_ITEM")){
            var prep=DungeonAdvice.preparation(site.id,site.minimumLevel);
            p.sendMessage("[地下城] "+site.name+" ("+site.id+") · "+DungeonAdvice.label(guide.get("state").toString())+" · 普通"+prep.stars()+"/5星，建议战斗Lv."+prep.recommendedLevel()+"；详情：/mycli dungeon info "+site.id);return;
        }
        if(prefix.equals("MC_SITE_DUNGEON_LIST")){p.sendMessage("[提示] 空闲需本人到首室 start；active=false不是未开放。详情用 info <ID>，状态用 status <ID>。" );return;}
        if(prefix.equals("MC_SITE_DUNGEON_RESULT")){
            boolean success=Boolean.TRUE.equals(fields.get("success"));String action=Objects.toString(fields.get("action"),"");
            String done=switch(action){case "start"->"已开启本次集结";case "join"->"已加入本次队伍";case "claim"->"奖励结算已保存";case "travel"->DungeonArrival.travelSuccess(site!=null&&!entry(site).isEmpty());case "resume"->"已处理恢复请求";case "leave"->"已退出本次场次";default->"操作已完成";};
            p.sendMessage("[地下城] "+(success?done:Objects.toString(fields.get("errorMessage"),"操作未完成"))+"（"+fields.get("reason")+"）。");
            if(!success&&!guide.isEmpty()&&Set.of("walk_to_first_room","site_busy","site_cooldown","muster_closed","claim_previous_reward_first","conquest_profession_required","conquest_level_required","previous_floor_required").contains(fields.get("reason"))){p.sendMessage("下一步："+guide.get("nextAction")+" 命令："+guide.get("nextCommand"));}
            return;
        }
        if(prefix.equals("MC_SITE_DUNGEON_STATE")&&!Boolean.TRUE.equals(fields.get("participant"))){
            if("ended".equals(fields.get("lifecycle")))p.sendMessage("[地下城] 本人上场已结束（"+endLabel(Objects.toString(fields.get("endReason")))+"）；存档点救援已失效。"
                    +(fields.containsKey("returnToGround")?"可以免费回地面。":"查询：/mycli dungeon status"+(site==null?"":" "+site.id)));
            else p.sendMessage("[地下城] 当前未参加该场次，存档点救援未生效。选择地点：/mycli dungeon list");
            if(!guide.isEmpty())p.sendMessage("下一步："+guide.get("nextAction")+" 命令："+guide.get("nextCommand"));
            else if(fields.get("pendingRewardDetails") instanceof List<?> pending&&!pending.isEmpty()&&pending.getFirst() instanceof Map<?,?> reward)
                p.sendMessage("[奖励] 已保存待领奖凭据；无需重打。命令："+reward.get("claimCommand"));
            if(!verboseOutput.get())return;
        }
        if(!guide.isEmpty()){
            p.sendMessage("[地下城] "+site.name+" · "+DungeonAdvice.label(guide.get("state").toString()));
            if(prefix.equals("MC_SITE_DUNGEON_STATE")&&Boolean.TRUE.equals(fields.get("participant"))&&fields.containsKey("attemptsRemaining"))
                p.sendMessage("[存档点] 第"+fields.get("checkpointRoom")+"室 "+fields.get("checkpoint")+"；剩余机会 "+fields.get("attemptsRemaining")+"/3，时限剩"+fields.get("remainingSeconds")+"秒。"+(!Boolean.TRUE.equals(fields.get("rescueActive"))?"此处救援未生效，先核对本场维度与范围。":Boolean.TRUE.equals(fields.get("retrying"))?"正在自动续关，不必跑回主城。":"仅本场范围内战败自动返回；结束后失效。"));
            if(prefix.equals("MC_SITE_DUNGEON_INFO")){
                var prep=DungeonAdvice.preparation(site.id,site.minimumLevel);
                p.sendMessage("普通"+prep.stars()+"/5星；"+(site.conquestFloor>0?"本层最低Lv."+site.minimumLevel+"；":"")+"建议战斗Lv."+prep.recommendedLevel()+"（装备和组队建议不设新门槛）。装备："+prep.equipment()+"。当前："+guide.get("currentEquipment"));
                p.sendMessage("队伍："+prep.party()+"；"+guide.get("skillHint")+"。技能用 /mycli skills status 按需查。" );
                if(guide.containsKey("nativeContent"))p.sendMessage("[机制] "+guide.get("nativeContent"));
                p.sendMessage("[规则] 本场时限30分钟；有效场次范围内战败回存档点，整场3次战败后结束。超时、结束或退出后救援失效；存活者原地保留，请及时沿原路撤离。队友救援、掉线和故障不扣次数；Boss房间由当前队伍独占。");
            }
            p.sendMessage("下一步："+guide.get("nextAction")+" 命令："+guide.get("nextCommand"));
            if(verboseOutput.get())p.sendMessage(prefix+" "+JSON.toJson(data));
        }else p.sendMessage("[地下城] 当前没有已开启的本人场次；查询不会开场。选择地点：/mycli dungeon list");
    }
    private void result(Player p,String action,String site,String reason){
        result(p,action,site,reason,Map.of());
    }
    private void result(Player p,String action,String site,String reason,Map<String,?> detail){
        Map<String,Object> data=new LinkedHashMap<>();data.put("action",action);data.put("id",site);
        data.put("success",reason.equals("success"));data.put("reason",reason);
        ActionFeedback.Advice advice=reason.equals("success")?null:ActionFeedback.advice("dungeon",reason,site);
        if(advice!=null){
            data.put("errorMessage",advice.message());data.put("nextAction",advice.next());data.put("nextCommands",advice.commands());
            if(reason.equals("unknown_dungeon"))data.put("nextCommand",advice.commands().getFirst());
        }
        if(reason.equals("claim_previous_reward_first"))data.put("pendingReward",pendingReward(p.getUniqueId(),site));
        data.putAll(detail);send(p,"MC_SITE_DUNGEON_RESULT",data);
        if(advice!=null&&!jsonOutput.get()&&!Set.of("walk_to_first_room","site_busy","site_cooldown","muster_closed","claim_previous_reward_first","conquest_profession_required","conquest_level_required","previous_floor_required").contains(reason))advice.send(p);
        if(reason.equals("claim_previous_reward_first"))explainPending(p,List.of(site));
        else if(reason.equals("specify_dungeon_id"))explainPending(p,pendingSites(p.getUniqueId()));
    }
    private void runResult(Player p,String action,String site,String run){
        result(p,action,site,"success",run==null||run.isBlank()?Map.of():Map.of("run",run));
    }
    private boolean hasEntryPermit(Player p,Site site){
        var permit=entryPermits.get(p.getUniqueId());
        return permit!=null&&permit.site().equals(site.id)&&permit.expires()>System.currentTimeMillis();
    }
    private void permit(Site site,EntryMember member){
        if(member.blocker().isEmpty()&&!member.missing().isEmpty())entryPermits.put(member.id(),new EntryPermit(site.id,System.currentTimeMillis()+180_000));
    }
    private EntryMember entryMember(Site site,Player p){
        String blocker=musterAdmission(site,p);
        return new EntryMember(p.getUniqueId(),p.getName(),blocker,blocker.isEmpty()&&!hasEntryPermit(p,site)?List.copyOf(DungeonLoadout.missing(p)):List.of());
    }
    private boolean reviewEntry(Player p,Site site,String action,String difficulty,List<EntryMember> roster,String confirmation){
        long now=System.currentTimeMillis();
        entryOffers.values().removeIf(offer->offer.expires()<=now);
        entryPermits.values().removeIf(permit->permit.expires()<=now);
        UUID actor=p.getUniqueId();
        var offer=entryOffers.get(actor);
        boolean same=offer!=null&&offer.site().equals(site.id)&&offer.action().equals(action)
                &&offer.difficulty().equals(difficulty)&&offer.roster().equals(roster);
        if(confirmation!=null&&same&&offer.token().toString().equals(confirmation)
                ||confirmation==null&&roster.stream().allMatch(member->member.blocker().isEmpty()&&member.missing().isEmpty())){
            entryOffers.remove(actor);return true;
        }
        if(!same){offer=new EntryOffer(UUID.randomUUID(),now+45_000,site.id,action,difficulty,List.copyOf(roster));entryOffers.put(actor,offer);}
        String command=entryConfirmation(offer);
        p.sendMessage("§e[遗迹集结] 尚未传送或开场。请核对战备，45 秒内可选择「确认入场」。");
        for(EntryMember member:roster){
            String message=entryDescription(member);
            p.sendMessage("§e"+message);
            Player affected=ResidentCli.find(member.id());
            if(affected!=null&&!member.id().equals(actor)&&(!member.blocker().isEmpty()||!member.missing().isEmpty()))affected.sendMessage("§e[遗迹集结] "+message);
        }
        result(p,action,site.id,"confirmation_required",Map.of("requiresConfirmation",true,"confirmationId",offer.token().toString(),
                "expiresAt",offer.expires(),"errorMessage","集结名单需要确认。只缺装备的队员可确认入场。","nextCommand",command,"nextCommands",List.of(command),
                "equipmentWarnings",roster.stream().filter(member->!member.missing().isEmpty()).limit(8)
                        .map(member->Map.of("name",member.name(),"missing",member.missing())).toList()));
        if(!jsonOutput.get())openEntryReview(p,offer);
        return false;
    }
    private String entryConfirmation(EntryOffer offer){
        return "/mycli dungeon "+offer.action()+" "+offer.site()+(offer.difficulty().isEmpty()?"":" "+offer.difficulty())+" --confirm "+offer.token();
    }
    private String entryDescription(EntryMember member){
        if(!member.blocker().isEmpty())return member.name()+"："+member.blocker()+"；仍留在原地";
        return member.name()+"："+(member.missing().isEmpty()?"战备就绪":"缺少 "+String.join("、",member.missing())+"；确认后仍可入场");
    }
    private void tell(Run r,String message){for(UUID id:r.party){Player p=ResidentCli.find(id);if(p!=null)p.sendMessage("§6【"+label(r.site)+"·"+r.site.name+"】§r "+message);}}
    private void notice(Run r,String message){
        tell(r,message);
        for(UUID id:r.party){Player p=ResidentCli.find(id);if(p!=null)p.sendActionBar(net.kyori.adventure.text.Component.text(ChatColor.stripColor(message)));}
    }
    private void observeRoom(Run r){
        for(Player p:present(r))if(!plugin.isDowned(p)&&r.room().contains(p.getLocation()))r.roomParticipants.add(p.getUniqueId());
    }
    void support(Player caster,Player beneficiary){
        if(caster==null||beneficiary==null||caster.getUniqueId().equals(beneficiary.getUniqueId()))return;
        Run r=own(caster);
        if(r!=null&&r.phase.equals("fighting")&&r.fault.isEmpty()&&r.pausedAt==0&&playing(caster)
                &&!plugin.isDowned(caster)&&r.party.contains(beneficiary.getUniqueId())&&r.site.contains(caster.getLocation())
                &&playing(beneficiary)&&r.site.contains(beneficiary.getLocation())&&r.room().contains(beneficiary.getLocation()))r.roomParticipants.add(caster.getUniqueId());
    }
    private List<String> missingRooms(Run r,UUID id){
        List<String> missing=new ArrayList<>();
        for(int i=0;i<r.stage;i++)if(r.roomAttendance.containsKey(i)&&!r.roomAttendance.get(i).contains(id))missing.add((i+1)+"·"+r.site.rooms.get(i).name);
        return missing;
    }
    private List<String> unverifiedRooms(Run r){
        List<String> unknown=new ArrayList<>();
        for(int i=0;i<r.stage;i++)if(!r.roomAttendance.containsKey(i))unknown.add((i+1)+"·"+r.site.rooms.get(i).name);
        return unknown;
    }
    private Map<String,Object> attendanceState(Run r,UUID id){
        Map<String,Object> data=new LinkedHashMap<>();
        data.put("attendance",r.attendance.getOrDefault(id,0));data.put("requiredRooms",r.site.rooms.size());
        data.put("currentRoomParticipated",r.roomParticipants.contains(id));data.put("missingRooms",missingRooms(r,id));
        data.put("unverifiedRooms",unverifiedRooms(r));return data;
    }
    private static String pauseLabel(String reason){return switch(reason){
        case "all_offline"->"全队离线";case "all_outside_site"->"全队离开挑战区";
        case "waiting_for_teammate"->"等待离线队友回场救援";case "server_restart"->"服务器重启，未清房间重新开始";
        case "runtime_error"->"发生故障，等待处理后 resume";case "recovery_return"->"故障已恢复，等待队员回场";default->"暂无活跃队员";
    };}
    private static String endLabel(String reason){return switch(reason){
        case "completed"->"全部房间已清理并完成结算，无需返回首室";case "party_defeated"->"全队倒地，挑战失败";case "attempts_exhausted"->"本场已战败3次，机会用尽，挑战结束";
        case "party_left"->"最后一名队员主动退出";case "member_left"->"本人主动退出队伍";
        case "time_limit"->"超过30分钟时限";case "return_grace_expired"->"全队离场或离线超过5分钟";
        case "missing_or_unloaded_enemy_retry_required"->"标记敌人异常消失，本室不能当作击杀通关";
        default->reason;
    };}
    private String siteRewardSlot(Run r,UUID id,String day){
        var pending=receipt(id,r.site.id);
        return SiteRewardPolicy.status(r.id,day,pending==null?null:pending.getString("run",""),
                plugin.getConfig().getString(ROOT+".claimed-runs."+id+"."+r.site.id),
                plugin.getConfig().getString(ROOT+".claimed."+id+"."+r.site.id));
    }
    private String rewardStatus(Run r,UUID id,String reason){
        String slot=siteRewardSlot(r,id,day());
        if(slot.equals("ready")||slot.equals("claimed"))return slot;
        if(!reason.equals("completed"))return "run_incomplete";
        if(r.attendance.getOrDefault(id,0)==0)return "missing_participation";
        return slot.equals("eligible")?"not_returned":slot;
    }
    private Map<String,Object> outcome(Run r,UUID id,String reason){
        Map<String,Object> data=new LinkedHashMap<>(attendanceState(r,id));String reward=rewardStatus(r,id,reason);
        data.put("id",r.site.id);data.put("name",r.site.name);data.put("run",r.id);data.put("reason",reason);data.put("endedAt",System.currentTimeMillis());
        data.put("startedAt",r.started);data.put("clearedRooms",r.stage);data.put("difficulty",r.mode.id);data.put("rewardStatus",reward);
        if(reward.equals("previous_reward_pending")) data.put("earlierRewardRun",receipt(id,r.site.id).getString("run",""));
        data.putAll(checkpointState(r));
        data.put("lifecycle","ended");data.put("active",false);data.put("participant",false);data.put("rescueActive",false);data.put("exitPolicy","standing_stay_downed_recover");
        data.put("resets",r.resets);data.put("lastResetReason",r.lastResetReason);
        if(r.echo!=null)data.put("encounterTiming",r.echo.timing());
        outcomeGuidance(data);return data;
    }
    private static void outcomeGuidance(Map<String,Object> data){
        String id=Objects.toString(data.get("id"),"");
        String info=id.matches("[a-z0-9_]{1,32}")?"/mycli dungeon info "+id:"/mycli dungeon list";
        String reward=Objects.toString(data.get("rewardStatus"),"");
        String next="本次记录已结束；查询 "+info+" 查看当前场次与下一步，不要根据旧记录重复开团或领奖。";
        List<String> commands=List.of(info);
        if(reward.equals("ready")&&id.matches("[a-z0-9_]{1,32}")){
            next="用 /mycli dungeon claim "+id+" 领取；奖励进入个人箱";commands=List.of("/mycli dungeon claim "+id);
        }else if(reward.equals("previous_reward_pending")&&id.matches("[a-z0-9_]{1,32}")){
            if(Boolean.FALSE.equals(data.get("earlierRewardStillPending"))){
                next="上次的待领奖已处理，本场没有另发奖励。下次挑战前可在遗迹列表查看可领地点。";
                commands=List.of("/mycli dungeon list");
            }else{
                next="上次的奖励占用本地点的待领栏，本场没有另发。用 /mycli dungeon claim "+id+" 领取上次奖励。";
                commands=List.of("/mycli dungeon claim "+id);
            }
        }else if(reward.equals("claimed")){
            next="用 /mycli arena rewards 查看奖励，/mycli arena stash 打开个人箱";commands=List.of("/mycli arena rewards","/mycli arena stash");
        }else if(reward.equals("daily_limit")&&"completed".equals(data.get("reason"))){
            next="本场已通关；今日奖励已领取，不会重复发奖，也无需返回首室。若正在考试，/mycli guild exam status 核对实操证明；仅 ready 时用 /mycli guild exam submit。";
            commands=List.of("/mycli guild exam status",info);
        }
        data.put("nextAction",next);data.put("nextCommands",commands);
    }
    private void saveOutcome(UUID id,String site,Map<String,Object> data){
        String path=ROOT+".outcomes."+id+"."+site;plugin.getConfig().set(path,null);plugin.getConfig().createSection(path,data);
    }
    private Map<String,Object> lastOutcome(UUID id,String site){
        var root=plugin.getConfig().getConfigurationSection(ROOT+".outcomes."+id);if(root==null)return Map.of();
        ConfigurationSection chosen=site.isEmpty()?root.getKeys(false).stream().map(root::getConfigurationSection).filter(Objects::nonNull).max(Comparator.comparingLong(c->c.getLong("endedAt"))).orElse(null):root.getConfigurationSection(site);
        if(chosen==null)return Map.of();
        Map<String,Object> data=new LinkedHashMap<>(chosen.getValues(false));
        var timing=chosen.getConfigurationSection("encounterTiming");
        if(timing!=null)data.put("encounterTiming",timing.getValues(false));
        data.put("lifecycle","ended");data.put("active",false);data.put("participant",false);data.put("rescueActive",false);data.put("exitPolicy","standing_stay_downed_recover");
        // Project current guidance without rewriting historical facts or granting proof.
        if("previous_reward_pending".equals(data.get("rewardStatus"))){
            var pending=receipt(id,Objects.toString(data.get("id"),""));
            data.put("earlierRewardStillPending",pending!=null&&Objects.equals(data.get("earlierRewardRun"),pending.getString("run","")));
        }
        outcomeGuidance(data);return data;
    }
    private void explainOutcome(Player p,Map<String,Object> data){
        String reward=Objects.toString(data.get("rewardStatus"),"run_incomplete");
        String detail=switch(reward){case "ready"->"已生成待领奖凭据";case "claimed"->"本轮奖励已领取到个人箱";case "daily_limit"->"今日该处已经领奖，重复挑战不再发奖";case "missing_participation"->"参战登记不足，未生成凭据";case "previous_reward_pending"->"通关时仍有上一场的待领奖，本轮未另发";case "not_returned"->"历史记录没有本场待领奖凭据，请查询当前状态，不要按旧提示返程";default->"本轮未完成，未生成新凭据";};
        Site site=sites.get(Objects.toString(data.get("id"),""));p.sendMessage("§e【"+(site==null?"遗迹远征":label(site))+"·结算】"+Objects.toString(data.get("name"),data.get("id").toString())+"："+endLabel(Objects.toString(data.get("reason")))+"；"+detail+"（参战 "+data.get("attendance")+"/"+data.get("requiredRooms")+"）。");
        if(data.get("missingRooms") instanceof List<?> missing&&!missing.isEmpty())p.sendMessage("§e缺席房间："+String.join("、",missing.stream().map(Object::toString).toList())+"。");
        p.sendMessage("§a下一步："+data.get("nextAction"));
    }
    private Site site(String id){Site s=sites.get(id);require(s!=null,"unknown_dungeon");return s;}
    private String reload(){
        if(hasActiveRuns())return "active_runs";
        if(sites.keySet().stream().anyMatch(id -> plugin.dungeonEdits().dirty("site-" + id))) return "pending_terrain_reset";
        try{
            var yaml=new YamlConfiguration();yaml.load(new File(plugin.getDataFolder(),"dungeons.yml"));
            require(yaml.getInt("schema-version")==1,"schema_version");var defs=yaml.getConfigurationSection("sites");require(defs!=null&&defs.getKeys(false).size()<=16,"sites_limit_16");
            Map<String,Site> next=new LinkedHashMap<>();
            for(String id:defs.getKeys(false)){
                require(id.matches("[a-z0-9_]{1,32}"),"invalid_id");var c=defs.getConfigurationSection(id);require(c!=null,"invalid_site");
                String world=c.getString("world","world"),name=c.getString("name",id),expedition=c.getString("expedition","");
                List<Integer> entry=c.getIntegerList("entry");
                require(entry.isEmpty()||entry.size()==3&&Math.abs((long)entry.get(0))<29_000_000&&Math.abs((long)entry.get(2))<29_000_000&&entry.get(1)>=-60&&entry.get(1)<310,"invalid_entry");
                require(Bukkit.getWorld(world)!=null&&name.length()<=32&&(!entry.isEmpty()||DungeonExpeditions.site(expedition)!=null),"invalid_world_or_approach");
                List<Room> rooms=new ArrayList<>();
                for(Map<?,?> row:c.getMapList("rooms")){
                    Object point=row.get("center");require(point instanceof List<?> && ((List<?>)point).size()==3,"invalid_room_center");List<?> v=(List<?>)point;
                    int x=Integer.parseInt(v.get(0).toString()),y=Integer.parseInt(v.get(1).toString()),z=Integer.parseInt(v.get(2).toString()),radius=Integer.parseInt(Objects.toString(row.get("radius"),"5"));
                    require(radius>=3&&radius<=8&&Math.abs((long)x)<29_000_000&&Math.abs((long)z)<29_000_000&&y>=-60&&y<310,"room_bounds");
                    var enemies=DungeonWaveCatalog.parse((List<?>)row.get("mobs"));
                    require(enemies.stream().noneMatch(e->e.type()==EntityType.RAVAGER),"large_enemy_requires_tower");
                    List<List<Integer>> spawnPoints=new ArrayList<>();
                    if(row.containsKey("spawn-points")){
                        require(row.get("spawn-points") instanceof List<?>,"invalid_spawn_points");
                        for(Object raw:(List<?>)row.get("spawn-points")){
                            require(raw instanceof List<?> p&&p.size()==3,"invalid_spawn_point");List<?> p=(List<?>)raw;List<Integer> spawnPoint=new ArrayList<>();
                            for(Object coordinate:p){require(coordinate instanceof Number n&&n.doubleValue()==n.intValue(),"integer_spawn_point_required");spawnPoint.add(((Number)coordinate).intValue());}
                            require(Math.abs((long)spawnPoint.get(0)-x)<=radius&&Math.abs((long)spawnPoint.get(2)-z)<=radius&&Math.abs((long)spawnPoint.get(1)-y)<=3,"spawn_point_outside_room");
                            require(!spawnPoints.contains(spawnPoint),"duplicate_spawn_point");spawnPoints.add(List.copyOf(spawnPoint));
                        }
                        require(spawnPoints.size()>=enemies.size()&&spawnPoints.size()<=24,"spawn_points_limit_24");
                    }
                    String roomHint=Objects.toString(row.get("hint"),"").strip();require(roomHint.length()<=220,"room_hint_limit_220");
                    rooms.add(new Room(Objects.toString(row.get("name"),"战斗室"),x,y,z,radius,enemies,List.copyOf(spawnPoints),roomHint));
                }
                require(!rooms.isEmpty()&&rooms.size()<=6,"rooms_limit_6");Room first=rooms.getFirst();
                for(Room r:rooms)require(Math.abs(r.x-first.x)<=128&&Math.abs(r.z-first.z)<=128&&Math.abs(r.y-first.y)<=128,"site_bounds");
                int emeralds=c.getInt("reward.emeralds",8),count=c.getInt("reward.count",4);Material bonus=Material.matchMaterial(c.getString("reward.item","LAPIS_LAZULI"));
                require(emeralds>=1&&emeralds<=64&&count>=1&&count<=21&&bonus!=null&&bonus.isItem(),"reward_bounds");
                int floor=c.getInt("conquest-floor",0),minimum=c.getInt("minimum-combat-level",1);
                require(floor>=0&&floor<=100&&minimum>=1&&minimum<=100,"conquest_bounds");
                require(floor==0||id.equals("aincrad_"+String.format(Locale.ROOT,"%02d",floor))&&ConquestWorld.WORLD.equals(world),"conquest_identity");
                Site s=new Site(id,name,expedition,c.getString("hint",""),Material.matchMaterial(c.getString("icon","STONE_BRICKS")),world,List.copyOf(rooms),emeralds,bonus,count,List.copyOf(entry),c.getBoolean("outdoor",false),floor,minimum);
                if(!entry.isEmpty())require(s.contains(new Location(Bukkit.getWorld(world),entry.get(0),entry.get(1),entry.get(2))),"entry_outside_site");
                require(s.icon!=null&&s.icon.isItem(),"invalid_icon");
                for(Site prior:next.values())require(!prior.contains(first.center(Bukkit.getWorld(world)))&&!s.contains(prior.rooms.getFirst().center(Bukkit.getWorld(prior.world))),"overlapping_sites");
                next.put(id,s);
            }
            Map<String,BuildingAreas> areas=new LinkedHashMap<>();Map<String,DungeonEntrance> entrances=new LinkedHashMap<>();
            for(Site s:next.values()){
                World world=Bukkit.getWorld(s.world);List<ProtectionArea> pieces=new ArrayList<>();
                pieces.add(ProtectionArea.box("site_dungeon_"+s.id,"副本建筑·"+s.name,world,
                    s.rooms.stream().mapToInt(Room::x).min().orElseThrow()-24,s.rooms.stream().mapToInt(Room::y).min().orElseThrow()-8,s.rooms.stream().mapToInt(Room::z).min().orElseThrow()-24,
                    s.rooms.stream().mapToInt(Room::x).max().orElseThrow()+24,s.rooms.stream().mapToInt(Room::y).max().orElseThrow()+12,s.rooms.stream().mapToInt(Room::z).max().orElseThrow()+24));
                var declared=defs.getConfigurationSection(s.id).getList("protection-boxes",List.of());require(declared.size()<=256,"protection_boxes_limit_256");
                List<int[]> declaredBounds=new ArrayList<>();for(Object raw:declared){
                    require(raw instanceof List<?> b&&b.size()==6,"invalid_protection_box");List<?> b=(List<?>)raw;int[] v=new int[6];
                    for(int i=0;i<6;i++){require(b.get(i) instanceof Number n&&n.doubleValue()==n.intValue(),"integer_protection_box_required");v[i]=((Number)b.get(i)).intValue();}
                    require(v[0]<=v[3]&&v[1]<=v[4]&&v[2]<=v[5]&&v[1]>=world.getMinHeight()&&v[4]<world.getMaxHeight(),"protection_box_bounds");
                    Room first=s.rooms.getFirst();require(Math.abs((long)v[0]-first.x)<=256&&Math.abs((long)v[3]-first.x)<=256&&Math.abs((long)v[2]-first.z)<=256&&Math.abs((long)v[5]-first.z)<=256,"protection_box_distance");
                    pieces.add(ProtectionArea.box("site_dungeon_"+s.id+"_building_"+pieces.size(),"副本建筑·"+s.name,world,v[0],v[1],v[2],v[3],v[4],v[5]));
                    declaredBounds.add(v);
                }
                var approach=defs.getConfigurationSection(s.id).getConfigurationSection("approach");
                if(approach!=null){
                    require(Set.of("entry","hint","station").containsAll(approach.getKeys(false)),"unknown_approach_field");Room first=s.rooms.getFirst();
                    var terminal=approach.getConfigurationSection("station");
                    require(terminal!=null||!approach.contains("station"),"invalid_station");
                    var entrance=DungeonEntrance.parse(approach.get("entry"),approach.getString("hint"),
                            terminal==null?null:terminal.getValues(false),world.getMinHeight(),world.getMaxHeight(),first.x,first.y,first.z);
                    require(entrance.protectedBy(declaredBounds),"approach_entry_unprotected");
                    if(entrance.station()!=null){
                        require(!s.entry.isEmpty()&&first.contains(point(world,s.entry))
                                &&!entrance.station().covers(s.entry),"station_missing_separate_upper_landing");
                        require(entrance.station().protectedBy(declaredBounds),"station_unprotected");
                    }
                    Location at=new Location(world,entrance.entry().get(0),entrance.entry().get(1),entrance.entry().get(2));
                    for(Site other:next.values())if(other!=s)require(!other.contains(at),"approach_inside_other_site");
                    entrances.put(s.id,entrance);
                }else require(!defs.getConfigurationSection(s.id).contains("approach"),"invalid_approach");
                var envelope=ProtectionArea.box("site_dungeon_"+s.id+"_envelope","副本建筑·"+s.name,world,
                    pieces.stream().mapToInt(ProtectionArea::minX).min().orElseThrow(),pieces.stream().mapToInt(ProtectionArea::minY).min().orElseThrow(),pieces.stream().mapToInt(ProtectionArea::minZ).min().orElseThrow(),
                    pieces.stream().mapToInt(ProtectionArea::maxX).max().orElseThrow(),pieces.stream().mapToInt(ProtectionArea::maxY).max().orElseThrow(),pieces.stream().mapToInt(ProtectionArea::maxZ).max().orElseThrow());
                areas.put(s.id,new BuildingAreas(envelope,List.copyOf(pieces)));
            }
            var musters=loadGroundMusters(next,areas);
            sites=Collections.unmodifiableMap(next);protectionAreas=Collections.unmodifiableMap(areas);approaches=Collections.unmodifiableMap(entrances);
            groundMusters=Map.copyOf(musters);ready=true;return "success";
        }catch(Exception e){plugin.getLogger().warning("Dungeon sites configuration retained: "+e.getMessage());return "invalid_configuration";}
    }
    private Map<String,GroundMuster> loadGroundMusters(Map<String,Site> definitions,Map<String,BuildingAreas> buildings) throws Exception {
        var file=new File(plugin.getDataFolder(),"dungeon-muster.yml");
        if(!file.isFile())return Map.of();
        var yaml=new YamlConfiguration();yaml.load(file);
        require(yaml.getKeys(false).equals(Set.of("schema-version","world","platforms"))&&yaml.getInt("schema-version")==1,"muster_schema");
        World world=Bukkit.getWorlds().getFirst();
        require(world.getEnvironment()==World.Environment.NORMAL&&world.getName().equals(yaml.getString("world")),"muster_requires_overworld");
        var platforms=yaml.getConfigurationSection("platforms");
        require(platforms!=null&&platforms.getKeys(false).equals(definitions.keySet()),"muster_requires_all_sites");
        Map<String,GroundMuster> result=new LinkedHashMap<>();
        for(Site site:definitions.values()){
            var row=platforms.getConfigurationSection(site.id);
            require(row!=null&&row.getKeys(false).equals(Set.of("entry","hint","station")),"muster_fields:"+site.id);
            var station=row.getConfigurationSection("station");require(station!=null,"muster_station:"+site.id);
            var route=DungeonEntrance.groundStation(row.get("entry"),row.getString("hint"),station.getValues(false),world.getMinHeight(),world.getMaxHeight());
            var bounds=route.station().bounds();
            var area=ProtectionArea.box("site_muster_"+site.id,"地面集结·"+site.name,world,bounds.get(0),bounds.get(1),bounds.get(2),bounds.get(3),bounds.get(4),bounds.get(5));
            require(result.values().stream().noneMatch(other->WildRuinResets.overlaps(area,other.platform()))
                    &&buildings.values().stream().noneMatch(building->building.pieces.stream().anyMatch(piece->WildRuinResets.overlaps(area,piece))),"muster_overlaps:"+site.id);
            result.put(site.id,new GroundMuster(route,area));
        }
        return result;
    }
    void admin(CommandSender sender,String action){
        if(action.equals("reload"))sender.sendMessage("MC_SITE_DUNGEON_ADMIN status="+reload());
        audit(sender);
    }
    void audit(CommandSender sender){
        sender.sendMessage("MC_AGENT_STATE_STORAGE "+JSON.toJson(DurableConfigStore.audit(plugin)));
        sender.sendMessage("MC_SITE_DUNGEON_AUDIT ready="+ready+" sites="+sites.size()+" activeRuns="+runs.size()+" trackedMobs="+runs.values().stream().mapToInt(r->r.mobs.size()).sum()+" globalMobLimit="+GLOBAL_MOBS+" trackedProjectiles="+shots.size()+" projectileLimit=128");
        for(Site s:sites.values()){Run r=runs.get(s.id);sender.sendMessage("MC_SITE_DUNGEON_SITE id="+s.id+" rooms="+s.rooms.size()+" active="+(r!=null)+" stage="+(r==null?0:r.stage+1)+" phase="+(r==null?"idle":r.phase)+" party="+(r==null?0:r.party.size()));}
        for(Run r:runs.values())for(UUID id:r.mobs.keySet()){Entity e=Bukkit.getEntity(id);if(e instanceof Mob m)sender.sendMessage("MC_SITE_DUNGEON_MOB site="+r.site.id+" id="+id+" type="+m.getType()+" health="+m.getHealth()+" target="+(m.getTarget()==null?"none":m.getTarget().getUniqueId())+" x="+m.getLocation().getBlockX()+" y="+m.getLocation().getBlockY()+" z="+m.getLocation().getBlockZ());}
    }
    void command(Player p,String[] raw){
        if(Arrays.stream(raw).anyMatch(word->word.equals("--help")||word.equals("-h"))){AgentCliCatalog.commandHelp(p,raw);return;}
        DungeonAdvice.Request request;
        try{request=DungeonAdvice.parse(raw);}catch(IllegalArgumentException e){
            String next=e instanceof DungeonAdvice.Usage usage?usage.nextCommand:"/mycli dungeon --help";
            JsonObject out=JsonParser.parseString(JSON.toJson(Map.of("schemaVersion",1,"success",false,"changed",false,"reason","INVALID_ARGUMENT","errorMessage",e.getMessage(),"retryable",false,"nextCommand",next))).getAsJsonObject();
            plugin.cliRecovery().enrich(p,raw,out);
            if(Arrays.asList(raw).contains("--json"))p.sendMessage("MC_SITE_DUNGEON_RESULT "+out);
            else {p.sendMessage("[地下城] 未执行（INVALID_ARGUMENT）："+e.getMessage());plugin.cliRecovery().plain(out,p);}return;
        }
        format(request.json(),request.verbose(),()->execute(p,request.args(),request.page(),request.confirmation()));
    }
    private void format(boolean json,boolean verbose,Runnable work){
        boolean beforeJson=jsonOutput.get(),beforeVerbose=verboseOutput.get();jsonOutput.set(json);verboseOutput.set(verbose);
        try{work.run();}finally{jsonOutput.set(beforeJson);verboseOutput.set(beforeVerbose);}
    }
    private void execute(Player p,String[] args,int page,String confirmation){
        String action=args.length>1?args[1].toLowerCase(Locale.ROOT):"list",id=args.length>2?args[2]:"";
        if(verboseOutput.get()&&!jsonOutput.get()&&Set.of("list","info","status").contains(action))p.sendMessage("[提示] dungeon为真实遗迹；arena为练习塔。逐室清怪后就地登记奖励，可领取到个人箱。");
        try{
            require(ready,"configuration_unavailable");
            switch(action){
                case "list"->listing(p,page);
                case "menu"->open(p,id);
                case "info"->info(p,site(id));
                case "travel"->travel(p,site(id));
                case "start"->start(p,site(id),Mode.parse(args.length>3?args[3]:"normal"),confirmation);
                case "enter"->stationPassage(p,site(id),false,false,confirmation);
                case "exit"->stationPassage(p,site(id),true);
                case "join"->join(p,site(id),confirmation);
                case "status"->status(p,id);
                case "resume"->{Run r=own(p);require(r!=null&&!r.fault.isEmpty(),"not_fault_paused");resume(r);runResult(p,"resume",r.site.id,r.id);p.sendMessage("§a原地下城场次已恢复，已清进度保留；5分钟内返回目标房间。查询：/mycli dungeon status "+r.site.id);}
                case "leave"->leave(p);
                case "claim"->claim(p,id);
                default->throw new IllegalArgumentException("use_list_info_travel_enter_exit_start_join_status_resume_leave_claim_menu");
            }
        }catch(IllegalArgumentException e){result(p,action,id,e.getMessage());}
    }
    private void listing(Player p,int page){
        int first=(page-1)*7;var rows=new ArrayList<>(sites.values());require(first<rows.size()||first==0,"page_out_of_range");
        List<Map<String,Object>> items=new ArrayList<>();
        for(Site s:rows.subList(Math.min(first,rows.size()),Math.min(first+7,rows.size()))){
            var prep=DungeonAdvice.preparation(s.id,s.minimumLevel);
            if(jsonOutput.get())items.add(Map.of("id",s.id,"name",s.name,"active",runs.containsKey(s.id),"state",advice(p,s.id).get("state"),"recommendedLevel",prep.recommendedLevel(),"normalStars",prep.stars(),"nextCommand","/mycli dungeon info "+s.id));
            else send(p,"MC_SITE_DUNGEON_ITEM",Map.of("id",s.id,"name",s.name,"rooms",s.rooms.size(),"active",runs.containsKey(s.id),"expedition",s.expedition));
        }
        Map<String,Object> summary=new LinkedHashMap<>();summary.put("total",sites.size());summary.put("page",page);summary.put("pages",Math.max(1,(sites.size()+6)/7));summary.put("partyLimit",PARTY_LIMIT);summary.put("parallelSites",true);
        summary.put("startPolicy", "player_initiated");
        if(!jsonOutput.get())p.sendMessage("§7开放遗迹到首室可主动开场，无需等随机集结。先查 /mycli dungeon info 地点ID 核对路线与准入。");
        if(jsonOutput.get())summary.put("items",items);
        if(first+7<rows.size())summary.put("nextCommand","/mycli dungeon list --page "+(page+1));
        send(p,"MC_SITE_DUNGEON_LIST",summary);
    }
    private void info(Player p,Site s){
        Room first=s.rooms.getFirst();
        Map<String,Object> detail=new LinkedHashMap<>(Map.of("id",s.id,"name",s.name,"world",s.world,"start",List.of(first.x,first.y,first.z),"rooms",s.rooms.stream().map(r->Map.of("name",r.name,"center",List.of(r.x,r.y,r.z),"radius",r.radius,"enemies",r.enemies.size())).toList(),"hint",s.hint,"dailyRewardPerSite",1,"approachMana",8,"lifecycleRules",Map.of("timeLimitSeconds",TIMEOUT_MS/1000,"rescueScope","current_run_and_site","exitPolicy","standing_stay_downed_recover","instruction","有效场次且身处范围内才有存档点救援；超时、结束或退出后失效，存活者留在原地须及时撤离。")));
        var expedition=DungeonExpeditions.site(s.expedition);
        detail.put("hint",routeHint(s));
        detail.put("roomHints",s.rooms.stream().map(Room::hint).toList());
        var arrival=DungeonArrival.describe(entryWorld(s).getName(),entry(s),expedition==null?null:expedition.approachX(),expedition==null?null:expedition.approachZ());
        if(approach(s)!=null){arrival.put("entranceScope","navigation_only");arrival.put("buildingProtected",true);arrival.put("startRequiresFirstRoom",true);}
        if(station(s)!=null){
            arrival.put("station",stationGuide(s));
            arrival.put("instruction",routeHint(s));
            returnGuidance(arrival,s,p);
            if(groundMusters.containsKey(s.id)){
                arrival.put("platformGroup",true);
                arrival.put("autoReturnSeconds",RETURN_DELAY_MS/1000);
            }
        }
        detail.put("arrival",arrival);
        var relic=DungeonRelics.at(s.id);
        if(relic!=null){
            detail.put("relic",relic.preview(s.world,relicClaimed(p.getUniqueId(),s.id),pendingRelic(p.getUniqueId(),s.id)!=null));
            detail.put("collection",relicCollection(p.getUniqueId()));
        }
        if(echoAvailable(s)){
            var modes=Arrays.stream(Mode.values()).map(mode->Map.of("mode",mode.id,
                "emeralds",s.emeralds*mode.reward,"item",s.bonus.name(),"count",s.bonusCount*mode.reward,
                "bossMove",EchoCitadel.wave(2,1,mode.id,List.of()).move().name)).toList();
            detail.put("encounter",Map.of("wavesByRoom",List.of(1,2,2),"rewards",modes,
                "claim","/mycli dungeon claim "+s.id,"stash","/mycli arena stash",
                "instruction","前庭热身 → 卫所侧翼援军 → 投影与执政官两阶段。按房间结算参战，通关原地领取。"));
        }
        send(p,"MC_SITE_DUNGEON_INFO",detail);
        if(!jsonOutput.get())p.sendMessage("[抵达] "+arrival.get("instruction"));
        if(echoAvailable(s)&&!jsonOutput.get())p.sendMessage("§d【回响城】前庭一波、卫所两波、末室投影和本体。普通躲紫色圆圈，冒险横移出光带；掉落一次/日，通关原地领到个人箱。");
        if(!jsonOutput.get()&&relic!=null)
            p.sendMessage("§6【入口】"+relic.x()+", "+relic.y()+", "+relic.z()+" 石钮 · "+relic.tactic()
                    +" §d秘宝："+relic.name()+"，首次登记终室参战并通关后可领。");
        if(verboseOutput.get()&&!jsonOutput.get())p.sendMessage("[路线] "+routeHint(s)+"；逐室清怪，通关后直接领取个人奖励。普通/冒险/末日的生命倍率为1/1.5/2.1，伤害倍率为1/1.25/1.6；进入遗迹自动同队，可中途加入和离开。");
    }
    private void travel(Player p,Site s){
        require(own(p)==null,"already_in_site_dungeon");
        require(playing(p)&&!plugin.dungeonParticipant(p)&&!plugin.pvpParticipant(p),"already_in_activity_or_not_survival");
        List<Integer> destination=entry(s);if(destination.isEmpty()){
            boolean requestedJson=jsonOutput.get(),requestedVerbose=verboseOutput.get();
            new DungeonExpeditions(plugin).travel(p,s.expedition,outcome->format(requestedJson,requestedVerbose,()->{
                if(outcome.reason().equals("loading"))return;
                String reason=outcome.success()?"success":switch(outcome.reason()){
                    case "chunk_unavailable","world_unavailable","timeout"->"entry_unavailable";
                    case "unsafe_landing","unsafe_height","world_border"->"entry_blocked";
                    case "moved","in_activity","spectator","dead","spectator_or_dead","point_changed"->"player_state_changed";
                    case "teleport_rejected","protected_entry","protected_exit","protection_unavailable"->"travel_denied";
                    default->outcome.reason();
                };
                result(p,"travel",s.id,reason);
            }));return;
        }
        World w=entryWorld(s);int x=destination.get(0),y=destination.get(1),z=destination.get(2);
        require(w.isChunkGenerated(x>>4,z>>4),"entry_not_generated");Location origin=p.getLocation().clone();
        boolean requestedJson=jsonOutput.get(),requestedVerbose=verboseOutput.get();
        ExistingChunkAccess.load(plugin,w,x>>4,z>>4).whenComplete((chunk,error)->Bukkit.getScheduler().runTask(plugin,()->format(requestedJson,requestedVerbose,()->{
            if(!p.isOnline())return;
            if(error!=null||chunk==null){result(p,"travel",s.id,"entry_unavailable");return;}
            if(!playing(p)||own(p)!=null||plugin.dungeonParticipant(p)||plugin.pvpParticipant(p)||p.getWorld()!=origin.getWorld()||p.getLocation().distanceSquared(origin)>4){result(p,"travel",s.id,"player_state_changed");return;}
            Location landing=null;
            for(int dx=-2;dx<=2&&landing==null;dx++)for(int dz=-2;dz<=2;dz++){
                int px=x+dx,pz=z+dz;if(!w.isChunkLoaded(px>>4,pz>>4))continue;
                Location at=new Location(w,px+.5,y,pz+.5);
                if(protectedApproachLanding(s,at)&&AgentFriendPlugin.safeLanding(w.getBlockAt(px,y,pz))&&w.getNearbyEntities(at,.7,1,.7).isEmpty()){landing=at;break;}
            }
            if(landing==null){result(p,"travel",s.id,"entry_blocked");return;}
            if(plugin.travelMagic().teleport(p,landing,"dungeon:"+s.id,"遗迹入口传送术",TravelMagic.DISTANT_MANA)){
                if(station(s)!=null){
                    Location actual=p.getLocation();
                    result(p,"travel",s.id,"success",Map.of("position",List.of(actual.getBlockX(),actual.getBlockY(),actual.getBlockZ()),"station",stationGuide(s)));
                    p.sendMessage("§6"+routeHint(s));
                    highlight(p,point(w,station(s).button()).add(0,.5,0));
                    return;
                }
                result(p,"travel",s.id,"success");
                if (s.id.equals(BlackBannerCamp.SITE) && surveyedCamp() != null) {
                    p.sendMessage("§6已到黑旗林营外哨。用「使用」打开入口路牌，选择开始清剿，守卫在集结倒计时后出现。");
                } else {
                    highlightEntrance(p,s);
                    var relic=DungeonRelics.at(s.id);
                    p.sendMessage(relic==null ? "§6已到"+label(s)+"入口，站到首室后选择难度。"
                            : "§6已到"+s.name+"。找发光路牌和石钮，按使用键打开挑战菜单。");
                }
            }
            else result(p,"travel",s.id,"travel_denied");
        })));
    }

    private void stationPassage(Player p,Site s,boolean exit){
        stationPassage(p,s,exit,false,null);
    }
    private void stationPassage(Player p,Site s,boolean exit,boolean automatic){
        stationPassage(p,s,exit,automatic,null);
    }
    private void stationPassage(Player p,Site s,boolean exit,boolean automatic,String confirmation){
        String action=exit?"exit":"enter";
        var station=station(s);require(station!=null,"station_unavailable");
        require(playing(p)&&!plugin.isDowned(p)&&!p.isInsideVehicle()&&own(p)==null
                &&!plugin.dungeonParticipant(p)&&!plugin.pvpParticipant(p),"already_in_activity_or_not_survival");
        var origin=p.getLocation().clone();var w=exit?entryWorld(s):Bukkit.getWorld(s.world);
        require(exit?origin.getWorld().getName().equals(s.world):origin.getWorld()==entryWorld(s),exit?"return_from_encounter_room":"walk_to_station");
        var button=point(entryWorld(s),station.button());
        if(exit)require(atReturnPoint(s,origin),"return_from_encounter_room");
        else require(atStation(s,origin)&&origin.distanceSquared(button)<=36
                &&button.getBlock().getType()==Material.STONE_BUTTON,"walk_to_station");
        var target=exit?entry(s):combatEntry(s);
        var roster=exit?List.<EntryMember>of():entryRoster(p,s,true);
        if(!exit){
            String blocked=roster.getFirst().blocker();
            require(!blocked.equals("请先领取这处遗迹的旧奖励"),"claim_previous_reward_first");
            require(blocked.isEmpty(),"already_in_activity_or_not_survival");
            if(!reviewEntry(p,s,"enter","",roster,confirmation))return;
        }
        int cx=target.get(0)>>4,cz=target.get(2)>>4;
        require(w.isChunkGenerated(cx,cz),"entry_not_generated");
        require(passages.add(p.getUniqueId()),"station_passage_pending");
        boolean json=jsonOutput.get(),verbose=verboseOutput.get();
        ExistingChunkAccess.load(plugin,w,cx,cz).whenComplete((chunk,error)->Bukkit.getScheduler().runTask(plugin,()->format(json,verbose,()->{
            passages.remove(p.getUniqueId());
            if(!p.isOnline())return;
            if(error!=null||chunk==null){result(p,action,s.id,"entry_unavailable");return;}
            if(!playing(p)||plugin.isDowned(p)||p.isInsideVehicle()||own(p)!=null||plugin.dungeonParticipant(p)
                    ||plugin.pvpParticipant(p)||p.getWorld()!=origin.getWorld()
                    ||(automatic?!atReturnPoint(s,p.getLocation()):p.getLocation().distanceSquared(origin)>2)){
                result(p,action,s.id,"player_state_changed");return;
            }
            if(!exit&&!roster.equals(entryRoster(p,s,true))){result(p,action,s.id,"assembly_changed");return;}
            Location center=point(w,target),landing=passageLanding(s,center,exit);
            if(landing==null){result(p,action,s.id,"entry_blocked");return;}
            if(!p.teleport(landing,PlayerTeleportEvent.TeleportCause.PLUGIN)){
                result(p,action,s.id,"travel_denied");return;
            }
            Location arrived=p.getLocation();
            if(arrived.getWorld()!=w||arrived.distanceSquared(landing)>1){
                boolean returned=p.teleport(origin,PlayerTeleportEvent.TeleportCause.PLUGIN);
                result(p,action,s.id,"station_landing_unconfirmed",Map.of("returnedToOrigin",returned));
                return;
            }
            List<String> entered=new ArrayList<>();Map<String,String> stayed=new LinkedHashMap<>();
            if(!exit)permit(s,roster.getFirst());
            for(EntryMember checked:exit?roster:roster.subList(1,roster.size())){
                Player member=ResidentCli.find(checked.id());
                if(member==null||!atStation(s,member.getLocation()))continue;
                String reason=checked.blocker();
                if(reason.isEmpty()){
                    Location candidate=passageLanding(s,center,false);
                    if(candidate==null)reason="入口没有空余安全落点";
                    else if(!member.teleport(candidate,PlayerTeleportEvent.TeleportCause.PLUGIN)
                            ||member.getWorld()!=w||member.getLocation().distanceSquared(candidate)>1)reason="入口传送被拒绝";
                    else {entered.add(member.getName());permit(s,checked);}
                }
                if(!reason.isEmpty()){
                    stayed.put(member.getName(),reason.startsWith("缺少 ")?"缺少入场装备，已通知本人具体项":reason);
                    member.sendMessage("§e【集结】暂留地面。"+reason+"。准备好后可再次使用石钮。");
                }
            }
            result(p,action,s.id,"success",Map.of("position",List.of(arrived.getBlockX(),arrived.getBlockY(),arrived.getBlockZ()),
                    "world",w.getName(),"station",stationGuide(s),"companionsEntered",entered,"companionsStayed",stayed));
            if(!stayed.isEmpty())p.sendMessage("§e【集结】以下队友仍在地面 "+stayed);
            if(exit){
                var scheduled=scheduledReturns.get(p.getUniqueId());
                if(scheduled!=null&&scheduled.site().equals(s.id))clearReturn(p.getUniqueId(),scheduled);
            }
            if(!exit){
                highlightEntrance(p,s);
                if(!json)open(p,s.id);
            }
        })));
    }

    private List<EntryMember> entryRoster(Player starter,Site site,boolean stationEntry){
        var roster=new ArrayList<EntryMember>();roster.add(entryMember(site,starter));
        if(!stationEntry||groundMusters.containsKey(site.id)){
            ResidentCli.online().stream().filter(member->!member.getUniqueId().equals(starter.getUniqueId()))
                    .filter(member->stationEntry?atStation(site,member.getLocation()):atFirstRoom(site,member.getLocation()))
                    .sorted(Comparator.comparing(Player::getUniqueId)).limit(PARTY_LIMIT-1L)
                    .forEach(member->roster.add(entryMember(site,member)));
        }
        return List.copyOf(roster);
    }

    private Location passageLanding(Site site,Location center,boolean exit){
        World world=center.getWorld();
        for(int radius=0;radius<=2;radius++)for(int dx=-radius;dx<=radius;dx++)for(int dz=-radius;dz<=radius;dz++){
            if(Math.max(Math.abs(dx),Math.abs(dz))!=radius)continue;
            var at=center.clone().add(dx,0,dz);
            if(world.isChunkLoaded(at.getBlockX()>>4,at.getBlockZ()>>4)
                    &&(exit?atStation(site,at)&&protectedApproachLanding(site,at):atFirstRoom(site,at))
                    &&AgentFriendPlugin.safeLanding(at.getBlock())&&world.getNearbyEntities(at,.6,1,.6,e->e instanceof LivingEntity).isEmpty())return at;
        }
        return null;
    }

    private String musterAdmission(Site site,Player member){
        if(!playing(member)||plugin.isDowned(member)||member.isInsideVehicle()||plugin.isObserver(member)||own(member)!=null
                ||plugin.dungeonParticipant(member)||plugin.pvpParticipant(member)||passages.contains(member.getUniqueId()))return "当前状态不允许进入";
        if(receipt(member.getUniqueId(),site.id)!=null)return "请先领取这处遗迹的旧奖励";
        return "";
    }

    private void highlight(Player player,Location mark){
        if(player.getWorld()==mark.getWorld()&&player.getLocation().distanceSquared(mark)<400)
            player.spawnParticle(Particle.HAPPY_VILLAGER,mark,12,.25,.4,.25,.002);
    }

    private void highlightEntrance(Player player,Site site){
        var relic=DungeonRelics.at(site.id);
        if(relic==null)return;
        World world=player.getWorld();
        Location button=new Location(world,relic.x()+.5,relic.y()+.5,relic.z()+.5);
        if(!site.world.equals(world.getName())||!site.rooms.getFirst().contains(button)
                ||player.getLocation().distanceSquared(button)>144
                ||!world.isChunkLoaded(relic.x()>>4,relic.z()>>4)
                ||button.getBlock().getType()!=Material.STONE_BUTTON)return;
        player.spawnParticle(Particle.HAPPY_VILLAGER,button,12,.25,.4,.25,.002);
    }
    private void start(Player p,Site s,Mode mode,String confirmation){
        conquestAdmission(p,s);
        require(own(p)==null,"already_in_site_dungeon");
        require(playing(p)&&!plugin.dungeonParticipant(p)&&!plugin.pvpParticipant(p),"already_in_activity_or_not_survival");
        require(atFirstRoom(s,p.getLocation()),"walk_to_first_room");
        require(!runs.containsKey(s.id),"site_busy");require(receipt(p.getUniqueId(),s.id)==null,"claim_previous_reward_first");
        require(!plugin.dungeonEdits().failed("site-" + s.id), "site_reset_fault");
        require(!plugin.dungeonEdits().dirty("site-" + s.id), "site_reset_pending");
        require(System.currentTimeMillis()-plugin.getConfig().getLong(ROOT+".cooldowns."+s.id,0)>=120_000,"site_cooldown");
        require(receiptCount()<1024,"pending_receipt_capacity");
        var roster=entryRoster(p,s,false);
        if(!reviewEntry(p,s,"start",mode.id,roster,confirmation))return;
        Run r=new Run(s,mode);r.altarTactics=s.id.equals(AltarPoison.SITE)&&plugin.nativeRpg().healingCircleEnabled();
        r.enemyMoves=BOSS_SKILLS.containsKey(s.id)&&plugin.dungeonEnemyMoves().enabled();
        if(echoAvailable(s))r.echo=new EchoCitadel.Progress();
        r.checkpoint=p.getLocation().clone();r.party.add(p.getUniqueId());r.attendance.put(p.getUniqueId(),0);runs.put(s.id,r);
        try{persist();}catch(RuntimeException failure){runs.remove(s.id);throw failure;}
        roster.forEach(member->permit(s,member));entryPermits.remove(p.getUniqueId());
        reconcile(r);
        runResult(p,"start",s.id,r.id);tell(r,"§6"+s.name+"〔"+mode.label+"〕10秒后开始；遗迹内达标的玩家与Agent自动同队，目前"+r.party.size()+"人。中途可加入、离开，已参战的房间保留，通关奖励会给每位真实参战者生成凭据。致命伤害先倒地，队友靠近4格停留10秒救援，清室也可复活。单人或全队战败返回存档点，第三次战败才结束；时限30分钟，全员离场宽限5分钟，故障和断线不扣次数。无需建立或修改日常队伍。");
    }
    private void join(Player p,Site s,String confirmation){
        Run r=runs.get(s.id);require(r!=null,"not_participating");
        // Kept as an idempotent compatibility entry; normal play auto-enrolls.
        boolean declined=r.declined.remove(p.getUniqueId());
        try{
            String problem=entryProblem(p,r,p.getLocation());
            if(problem.equals("equipment_required")||confirmation!=null&&problem.isEmpty()){
                EntryMember member=entryMember(s,p);
                if(!reviewEntry(p,s,"join","",List.of(member),confirmation)){
                    if(declined)r.declined.add(p.getUniqueId());return;
                }
                permit(s,member);
            }else require(problem.isEmpty(),problem);
            require(enroll(p,r),"not_participating");
        }
        catch(RuntimeException failure){if(declined)r.declined.add(p.getUniqueId());throw failure;}
        runResult(p,"join",s.id,r.id);
    }
    private void conquestAdmission(Player p,Site s){
        if(s.conquestFloor==0)return;
        require(plugin.conquestWorldReady(),"conquest_map_unavailable");
        var combat=plugin.combatRpg();require(combat!=null,"combat_progress_unavailable");
        require(!combat.profession(p).isEmpty(),"conquest_profession_required");
        require(combat.level(p)>=s.minimumLevel,"conquest_level_required");
        require(combat.floor(p)>=s.conquestFloor-1,"previous_floor_required");
    }
    private void status(Player p,String id){
        if(plugin.trialRescue()!=null&&(jsonOutput.get()||verboseOutput.get()))plugin.trialRescue().report(p);
        Run r=id.isEmpty()?own(p):runs.get(site(id).id);
        if(r==null){
            List<String> pending=pendingSites(p.getUniqueId());
            Map<String,Object> fields=new LinkedHashMap<>();if(!id.isEmpty())fields.put("id",id);fields.put("active",false);fields.put("participant",false);fields.put("pendingRewards",pending);
            fields.put("pendingRewardDetails",pending.stream().map(s->pendingReward(p.getUniqueId(),s)).toList());
            Map<String,Object> outcome=lastOutcome(p.getUniqueId(),id);fields.put("lastOutcome",outcome);fields.put("outcomeKnown",!outcome.isEmpty());
            fields.put("phase",outcome.isEmpty()?"idle":"ended");lifecycle(fields,null,p,outcome);
            returnGuidance(fields,sites.get(id.isEmpty()?Objects.toString(outcome.get("id"),""):id),p);
            send(p,"MC_SITE_DUNGEON_STATE",fields);
            if(!verboseOutput.get())return;
            explainPending(p,pending);
            if(!outcome.isEmpty())explainOutcome(p,outcome);
            else if(!pending.isEmpty())p.sendMessage("§e【遗迹远征】当前没有正在参与的挑战；以上是已保存的待领奖凭据，可直接领取，无需重打或返回首处集结点。");
            else p.sendMessage("§e【遗迹远征】当前没有你的活动记录，也没有待领奖凭据；旧版未保存结束原因，不能据此确认通关或补发。用 /mycli dungeon list 选地点，info 查看规则。");
            return;
        }
        Room target=r.stage>=r.site.rooms.size()?r.site.rooms.getFirst():r.room();
        Map<String,Object> fields=new LinkedHashMap<>();fields.put("id",r.site.id);fields.put("run",r.id);fields.put("active",true);fields.put("participant",r.party.contains(p.getUniqueId()));fields.put("phase",r.phase);fields.put("stage",Math.min(r.stage+1,r.site.rooms.size()));fields.put("stages",r.site.rooms.size());fields.put("remainingMobs",r.mobs.size());fields.put("target",List.of(target.x,target.y,target.z));fields.put("difficulty",r.mode.id);fields.put("paused",r.pausedAt>0||!r.fault.isEmpty());fields.put("fault",r.fault);
        if(r.party.contains(p.getUniqueId())){
            var present=present(r).stream().filter(member->target.contains(member.getLocation()))
                .map(Player::getUniqueId).collect(java.util.stream.Collectors.toSet());
            var count=CompanionTravelAccess.countPresent(target.center(Bukkit.getWorld(r.site.world)),
                target.radius+2,3,r.party,present,target::contains);
            fields.put("presentCount",count.total());fields.put("presentPlayers",count.players());
            fields.put("presentMaidAgents",count.maids());
        }
        fields.putAll(attendanceState(r,p.getUniqueId()));fields.put("attempt",r.attempt);fields.put("resets",r.resets);fields.put("pauseReason",r.pauseReason);fields.put("lastResetReason",r.lastResetReason);fields.put("lastResetAt",r.lastResetAt);
        fields.putAll(checkpointState(r));fields.put("bossRoomLocked",bossLocked(r));
        fields.put("faultPausedMillis",r.faultPausedMillis);fields.put("resumable",r.party.contains(p.getUniqueId())&&!r.fault.isEmpty());
        fields.put("storageRecovery",r.storageFault?"return_with_original_party":"none");
        fields.put("nextCommand",r.party.contains(p.getUniqueId())&&!r.fault.isEmpty()?"/mycli dungeon resume":"/mycli dungeon status "+r.site.id);
        List<String> pending=pendingSites(p.getUniqueId());fields.put("pendingRewards",pending);
        fields.put("pendingRewardDetails",pending.stream().map(s->pendingReward(p.getUniqueId(),s)).toList());
        fields.put("combatBounds",Map.of("world",r.site.world,"min",List.of(target.x+.5-target.radius-2,target.y-3,target.z+.5-target.radius-2),"max",List.of(target.x+.5+target.radius+2,target.y+3,target.z+.5+target.radius+2)));
        if(r.poison!=null&&companionCombatPosition(r,p,p.getLocation())){
            var hazard=r.poison.observation(System.currentTimeMillis());if(!hazard.isEmpty())fields.put("hazard",hazard);
        }
        if((r.enemyMoves||r.echo!=null)&&companionCombatPosition(r,p,p.getLocation())){
            var moves=plugin.dungeonEnemyMoves().hazards(p);if(!moves.isEmpty())fields.put("enemyMoves",moves);
        }
        if(r.echo!=null&&r.party.contains(p.getUniqueId())){
            fields.put("encounterTiming",r.echo.timing());
            if(r.phase.equals("moving"))fields.put("route",EchoCitadel.route(r.stage));
            if(r.phase.equals("fighting")){
                var wave=echoWave(r,r.echo.waiting()?r.echo.wave+1:r.echo.wave);
                fields.put("encounter",Map.of("wave",r.echo.wave+(r.echo.waiting()?2:1),"waves",EchoCitadel.waves(r.stage),
                    "name",wave.name(),"tactic",wave.tactic(),"waiting",r.echo.waiting(),
                    "nextWaveInMs",r.echo.waiting()?Math.max(0,r.echo.nextAt-System.currentTimeMillis()):0));
            }
        }
        Map<String,Object> previousOutcome=r.party.contains(p.getUniqueId())?Map.of():lastOutcome(p.getUniqueId(),r.site.id);
        lifecycle(fields,r,p,previousOutcome);
        if(!r.party.contains(p.getUniqueId())){fields.put("lastOutcome",previousOutcome);fields.put("outcomeKnown",!previousOutcome.isEmpty());}
        returnGuidance(fields,r.site,p);
        send(p,"MC_SITE_DUNGEON_STATE",fields);
        if(!verboseOutput.get())return;
        explainPending(p,pending);
        if(r.party.contains(p.getUniqueId())){
            p.sendMessage("§b【"+label(r.site)+"】"+r.site.name+" · "+target.name+"；参战登记 "+r.attendance.getOrDefault(p.getUniqueId(),0)+"/"+r.site.rooms.size()+"，"+(r.phase.equals("returning")?"正在登记通关奖励，无须返回首室":"本段"+(r.roomParticipants.contains(p.getUniqueId())?"已记录":"尚未记录"))+"。"+(!r.fault.isEmpty()?(r.storageFault?"存储故障暂停，等待不计挑战时限；原队伍回到遗迹后自动核对恢复，也可本人用 /mycli dungeon resume。":"故障暂停，等待不计挑战时限；准备好后本人用 /mycli dungeon resume，恢复后5分钟内回场。"):r.pausedAt>0?"暂停："+pauseLabel(r.pauseReason)+"；5分钟内回场，未清段落重刷。":""));
            p.sendMessage("§7本室在场 "+fields.get("presentCount")+" 位，其中女仆 Agent "+fields.get("presentMaidAgents")+" 位。");
            if(!missingRooms(r,p.getUniqueId()).isEmpty())p.sendMessage("§e缺席房间："+String.join("、",missingRooms(r,p.getUniqueId()))+"；已有参战记录保留，实际参战者在全场通关后均可领奖。");
            if(!unverifiedRooms(r).isEmpty())p.sendMessage("§7旧版房间明细未保存，保留原登记数量，不推断缺席房间。本人当前总数以回执 attendance 为准。");
        }else if(!previousOutcome.isEmpty()){p.sendMessage("§7该地点有其他队伍正在挑战；以下是你本人最近一次结果。");explainOutcome(p,previousOutcome);}
    }
    private void leave(Player p){
        Run r=own(p);require(r!=null,"not_participating");int count=r.attendance.getOrDefault(p.getUniqueId(),0);
        require(!plugin.isDowned(p),"downed_wait_for_rescue");
        r.party.remove(p.getUniqueId());r.declined.add(p.getUniqueId());
        try{persist();}catch(RuntimeException e){r.party.add(p.getUniqueId());r.declined.remove(p.getUniqueId());throw e;}
        runResult(p,"leave",r.site.id,r.id);p.sendMessage("§e已退出本次在场参战，已完成"+count+"室的记录保留；同伴通关后仍可领取奖励。请沿原路撤离；离开遗迹后再回来会自动续接。当前停留期间不会自动重新加入。");
    }
    private int receiptCount(){var c=plugin.getConfig().getConfigurationSection(ROOT+".receipts");if(c==null)return 0;int total=0;for(String owner:c.getKeys(false)){var section=c.getConfigurationSection(owner);if(section!=null)total+=section.getKeys(false).size();}return total;}
    private ConfigurationSection receipt(UUID id,String site){return plugin.getConfig().getConfigurationSection(ROOT+".receipts."+id+"."+site);}
    private String relicPath(UUID id,String site){return ROOT+".relics."+id+"."+site;}
    private boolean relicClaimed(UUID id,String site){return plugin.getConfig().isString(relicPath(id,site));}
    private ItemStack pendingRelic(UUID id,String site){
        var saved=receipt(id,site);
        return saved==null?null:saved.getItemStack("relic");
    }
    private Map<String,Object> relicCollection(UUID id){
        long completed=sites.keySet().stream().filter(site->relicClaimed(id,site)).count();
        String title=completed>=15?"群境开拓者":completed>=10?"十境寻迹者":completed>=5?"遗迹巡行者":completed>=1?"遗迹先行者":"";
        return Map.of("found",completed,"total",sites.keySet().stream().filter(site->DungeonRelics.at(site)!=null).count(),"title",title);
    }
    private List<String> pendingSites(UUID id){var c=plugin.getConfig().getConfigurationSection(ROOT+".receipts."+id);return c==null?List.of():new ArrayList<>(c.getKeys(false));}
    private Map<String,Object> pendingReward(UUID owner,String id){
        var saved=receipt(owner,id);if(saved==null)return Map.of();Site s=sites.get(id);
        Map<String,Object> data=new LinkedHashMap<>();data.put("id",id);data.put("name",s==null?id:s.name);if(s!=null){data.put("activityLabel",label(s));data.put("setting",s.outdoor?"outdoor":"interior");}
        data.put("status","ready");data.put("run",saved.getString("run",""));data.put("day",saved.getString("day",""));
        data.put("emeralds",saved.getInt("emeralds"));data.put("item",saved.getString("item",""));data.put("count",saved.getInt("count"));
        var relic=DungeonRelics.at(id);
        if(relic!=null&&relic.recognizes(saved.getItemStack("relic")))data.put("relic",relic.name());
        data.put("claimCommand","/mycli dungeon claim "+id);return data;
    }
    private void explainPending(Player p,List<String> pending){
        for(String id:pending){
            var saved=receipt(p.getUniqueId(),id);if(saved==null)continue;Site s=sites.get(id);
            p.sendMessage("§6【"+(s==null?"遗迹远征":label(s))+"·待领奖】"+(s==null?id:s.name)+"（"+saved.getString("day","日期未记录")+"）已完成，奖励尚未领取。");
            p.sendMessage(net.kyori.adventure.text.Component.text("[点击领取到个人奖励箱] /mycli dungeon claim "+id,net.kyori.adventure.text.format.NamedTextColor.GREEN)
                    .clickEvent(net.kyori.adventure.text.event.ClickEvent.runCommand("/mycli dungeon claim "+id)));
        }
    }
    private void claim(Player p,String id){
        if(id.isEmpty()){var pending=pendingSites(p.getUniqueId());require(!pending.isEmpty(),"no_pending_reward");require(pending.size()==1,"specify_dungeon_id");id=pending.getFirst();}
        String chosen=id;var receipt=receipt(p.getUniqueId(),chosen);
        if(receipt==null){Map<String,Object> outcome=lastOutcome(p.getUniqueId(),chosen);if(!outcome.isEmpty())explainOutcome(p,outcome);require(false,"no_pending_reward");}
        String claimedRun=receipt.getString("run");
        ItemStack gear=receipt.getItemStack("relic");
        var relic=DungeonRelics.at(chosen);
        if(receipt.contains("relic"))
            require(relic!=null&&relic.recognizes(gear)&&!relicClaimed(p.getUniqueId(),chosen),"data_unavailable");
        applyCompletion(p,chosen,receipt);
        atomic(()->{
            if(!receipt.getBoolean("relic-only"))
                require(plugin.dungeon().queueGuildRewards(p.getUniqueId(),receipt.getInt("emeralds"),Material.valueOf(receipt.getString("item")),receipt.getInt("count")),"personal_reward_queue_full");
            if(gear!=null){
                require(plugin.dungeon().queuePurchased(p.getUniqueId(),gear),"personal_reward_queue_full");
                plugin.getConfig().set(relicPath(p.getUniqueId(),chosen),claimedRun);
            }
            // Proof and consumed receipt commit together; a crash cannot lose or duplicate the hand-in.
            plugin.taskMarket().worldAction(p,GuildManager.Goal.SITE_CLEAR,chosen,"site:"+receipt.getString("run"),receipt.getLong("started-at",0),false);
            plugin.getConfig().set(ROOT+".claimed."+p.getUniqueId()+"."+chosen,receipt.getString("day"));plugin.getConfig().set(ROOT+".receipts."+p.getUniqueId()+"."+chosen,null);
            plugin.getConfig().set(ROOT+".claimed-runs."+p.getUniqueId()+"."+chosen,receipt.getString("run"));
            String history=ROOT+".outcomes."+p.getUniqueId()+"."+chosen;
            if(receipt.getString("run").equals(plugin.getConfig().getString(history+".run"))){
                plugin.getConfig().set(history+".rewardStatus","claimed");plugin.getConfig().set(history+".nextAction","用 /mycli arena rewards 查看奖励，/mycli arena stash 打开个人箱");
                plugin.getConfig().set(history+".nextCommands",List.of("/mycli arena rewards","/mycli arena stash"));
            }
        });
        runResult(p,"claim",chosen,claimedRun);p.sendMessage("§a"+(sites.containsKey(chosen)?label(sites.get(chosen)):"遗迹远征")+"奖励已保存到待入箱队列；打开个人箱时装入，箱满会保留。开箱 /mycli arena stash；免费查库存和待入箱数量 "+PersonalStashOverview.COMMAND+"。重复领取不会再次发奖。");
        if(gear!=null)p.sendMessage("§d已收录秘宝「"+relic.name()+"」。查看装备说明了解触发方式；遗迹菜单可查收藏与称号。");
        plugin.agentCoach().rememberAdventure(p, "遗迹攻略奖励已经领取");
    }
    private void tick(){
        long timestamp=System.currentTimeMillis();
        if(!scheduledReturns.isEmpty())try{updateReturns(timestamp);}
        catch(RuntimeException failure){plugin.getLogger().log(java.util.logging.Level.WARNING,"Ground return pending: storage unavailable",failure);}
        for(var entry:new ArrayList<>(shots.entrySet())){Entity e=Bukkit.getEntity(entry.getKey());if(e==null||!e.isValid()||timestamp>=entry.getValue().expires){if(e!=null)e.remove();shots.remove(entry.getKey());}}
        for(Run r:new ArrayList<>(runs.values())){
        if(!r.fault.isEmpty()){
            if(r.echo!=null)r.echo.sample(timestamp,r.phase,false);
            // Only a proven storage fault may recover itself. Return to the
            // saved phase; never rerun a failed game callback or infer a reward.
            if(r.storageFault&&r.storageRetryAt==0&&r.storageRetryAttempts==0)r.storageRetryAt=timestamp+1000;
            boolean recoveryPresent=r.phase.equals("muster")||r.party.stream().map(ResidentCli::find).anyMatch(p->playing(p)&&r.site.contains(p.getLocation()));
            if(r.storageRetryAt>0&&timestamp>=r.storageRetryAt&&recoveryPresent){
                r.storageRetryAt=0;r.storageRetryAttempts++;
                try{resume(r);notice(r,"§a【"+label(r.site)+"】存档已恢复，继续原场次；未新增奖励或重开场次。");}
                catch(RuntimeException failure){
                    if(failure instanceof StorageUnavailable&&r.storageRetryAttempts<(r.storageFault?5:2))r.storageRetryAt=timestamp+Math.min(5000,1000L*r.storageRetryAttempts);
                    else notice(r,"§c【"+label(r.site)+"】存档仍不可用，原场次保留。请联系服主；恢复后本人用 /mycli dungeon resume。");
                }
            }
            continue;
        }
        int previousStage=r.stage,previousCheckpointRoom=r.checkpointRoom;Location previousCheckpoint=r.checkpoint;String previousPhase=r.phase;Map<UUID,Integer> previousAttendance=new HashMap<>(r.attendance);
        Map<Integer,Set<UUID>> previousRoomAttendance=new LinkedHashMap<>(r.roomAttendance);
        boolean roomCheckpointCommitted=r.phase.equals("returning");
        try{
            reconcile(r);
            previousAttendance.clear();previousAttendance.putAll(r.attendance);
            if(r.phase.equals("returning")){complete(r);continue;}
            long now=System.currentTimeMillis();if(activeMillis(r.started,r.faultPausedMillis,now)>TIMEOUT_MS){end(r,"time_limit");continue;}
            List<Player> present=present(r);
            if(r.echo!=null)r.echo.sample(timestamp,r.phase,r.pausedAt==0&&!present.isEmpty());
            if(present.isEmpty() || present.stream().allMatch(plugin::isDowned)
                    && r.party.stream().anyMatch(id->ResidentCli.find(id)==null&&plugin.trialRescue()!=null&&!plugin.trialRescue().downed(id))){
                if(r.pausedAt==0){
                    r.pausedAt=now;r.pauseReason=present.isEmpty()?(r.party.stream().noneMatch(id->playing(ResidentCli.find(id)))?"all_offline":"all_outside_site"):"waiting_for_teammate";
                    if(r.phase.equals("fighting")){r.resets++;r.lastResetReason=r.pauseReason;r.lastResetAt=now;r.phase="moving";}
                    clean(r);persist();notice(r,"§e【"+label(r.site)+"·暂停】"+pauseLabel(r.pauseReason)+"；5分钟内回场。已清段落保留，未清段落重刷，本次未完成的参战记录不计入结算。");
                }
                else if(now-r.pausedAt>REJOIN_MS)end(r,"return_grace_expired");
                continue;
            }
            if(r.pausedAt>0){r.pausedAt=0;String reason=r.pauseReason;r.pauseReason="";persist();notice(r,"§e【"+label(r.site)+"·续接】此前"+pauseLabel(reason)+"；未通关段落重新出怪，已通关进度保留。");}
            if(r.phase.equals("muster")){if(now<r.readyAt)continue;r.phase="moving";persist();}
            if(r.phase.equals("retrying")){
                if(plugin.trialRescue()!=null&&plugin.trialRescue().hasDowned(rescueKey(r))){returnToCheckpoint(r);continue;}
                if(now<r.retryReadyAt)continue;r.phase=r.stage>=r.site.rooms.size()?"returning":"moving";persist();
            }
            if(r.phase.equals("moving")){
                if(present.stream().noneMatch(p->r.room().contains(p.getLocation()))){
                    if(r.echo!=null)markEchoRoute(r,present);
                    continue;
                }
                if(bossLocked(r)&&bossIntruders(r).findAny().isPresent()){for(Player member:present)lockHint(member,"Boss房间还有非本场队员，请其退出门外；未开始本段战斗、未扣次数。");continue;}
                if(!canSpawn(r.echo==null?r.room().enemies.size():echoWave(r,0).enemies().size()))continue;
                spawn(r);continue;
            }
            if(!r.phase.equals("fighting"))continue;
            observeRoom(r);
            if(r.invalid){end(r,"missing_or_unloaded_enemy_retry_required");continue;}
            for(UUID id:new ArrayList<>(r.mobs.keySet())){
                Entity e=Bukkit.getEntity(id);if(!(e instanceof Mob mob)||!e.isValid()||mob.isDead()){r.invalid=true;continue;}
                Player nearest=present.stream().filter(p->!plugin.isDowned(p)&&r.room().contains(p.getLocation())).min(Comparator.comparingDouble(p->p.getLocation().distanceSquared(mob.getLocation()))).orElse(null);
                if(nearest!=null){mob.setTarget(ResidentCli.living(nearest));if(!r.room().contains(mob.getLocation())){Location safe=safeSpots(r).stream().filter(l->l.distanceSquared(nearest.getLocation())>=9).findFirst().orElse(null);if(safe!=null)mob.teleport(safe);}}
            }
            if(r.invalid)continue;
            tickAltar(r,present,timestamp);
            if(runs.get(r.site.id)!=r)continue;
            if(r.mobs.isEmpty()){
                if(r.echo!=null&&r.echo.hasNext(r.stage)){
                    var next=echoWave(r,r.echo.wave+1);
                    if(!r.echo.waiting()){
                        clearShots(r);
                        r.echo.schedule(timestamp);
                        notice(r,"§d"+next.name()+"即将出现。"+next.tactic());
                    }
                    if(timestamp<r.echo.nextAt||!canSpawn(next.enemies().size())
                            ||present.stream().noneMatch(p->!plugin.isDowned(p)&&r.room().contains(p.getLocation())))continue;
                    r.echo.advance();
                    spawn(r);
                    continue;
                }
                Set<UUID> credited=new LinkedHashSet<>(r.roomParticipants);credited.retainAll(r.attendance.keySet());
                r.roomAttendance.put(r.stage,Set.copyOf(credited));
                for(UUID id:credited)r.attendance.merge(id,1,Integer::sum);
                String challengeContext=rescueKey(r)+":"+r.stage+":"+r.attempt;
                Set<UUID> challengePresent=present(r).stream().filter(p->r.room().contains(p.getLocation())&&credited.contains(p.getUniqueId())).map(Player::getUniqueId).collect(java.util.stream.Collectors.toSet());
                Player anchor=present.stream().filter(p->r.room().contains(p.getLocation())&&AgentFriendPlugin.safeLanding(p.getLocation().getBlock())).findFirst().orElse(null);
                if(anchor!=null){r.checkpoint=anchor.getLocation().clone();r.checkpointRoom=r.stage+1;}
                var clearedRoom = r.room();
                String roomName=clearedRoom.name;clean(r);r.stage++;r.attempt=0;r.phase=r.stage==r.site.rooms.size()?"returning":"moving";persist();
                roomCheckpointCommitted=true;
                if(plugin.trialRescue()!=null)plugin.trialRescue().reviveTeam(rescueKey(r),"room_cleared");
                DungeonRecovery.apply(plugin, present(r).stream()
                    .filter(p -> credited.contains(p.getUniqueId()) && clearedRoom.contains(p.getLocation())).toList(), r.site.id, r.stage);
                if(plugin.lifeChallenges()!=null)plugin.lifeChallenges().roomCleared(challengeContext,challengePresent);
                for(UUID id:r.party){Player p=ResidentCli.find(id);if(p!=null)p.sendMessage((credited.contains(id)?"§a":"§e")+"【"+label(r.site)+"·参战登记】"+roomName+"："+(credited.contains(id)?"已记录本段参战":"本段尚无参战记录")+"；累计 "+r.attendance.getOrDefault(id,0)+"/"+r.site.rooms.size()+"。中途离开仍保留已经完成的登记。");}
                notice(r,"§a战斗室已清理；"+(r.phase.equals("returning")?"全场通关，正在为所有真实参战者登记奖励，无须返回首室。":"步行前往下一室："+r.room().name+" "+r.room().x+","+r.room().y+","+r.room().z));
                if(!r.phase.equals("returning")){
                    Room next=r.room();
                    for(Player player:present)if(player.isOnline()){
                        player.sendTitle("§a"+roomName+" · 已攻克","§e下一步：前往"+next.name,5,38,10);
                        if(r.echo!=null)player.sendMessage("§e【行进指引】沿紫色粒子和柱廊前进："+EchoCitadel.route(r.stage)
                            +"。进到目标房间即开战。");
                        else if(!next.hint.isBlank())player.sendMessage("§e【行进指引】"+next.hint);
                    }
                }
                if(r.phase.equals("returning"))complete(r);
            }
        }catch(RuntimeException e){
            plugin.getLogger().log(java.util.logging.Level.WARNING,"Site dungeon paused for explicit retry: "+r.site.id+" run="+r.id+" phase="+previousPhase,e);
            clean(r);
            if(!roomCheckpointCommitted){
                r.stage=previousStage;r.attendance.clear();r.attendance.putAll(previousAttendance);r.roomAttendance.clear();r.roomAttendance.putAll(previousRoomAttendance);
                r.checkpoint=previousCheckpoint;r.checkpointRoom=previousCheckpointRoom;
                r.phase=previousPhase.equals("fighting")?"moving":previousPhase;
            }
            r.pausedAt=System.currentTimeMillis();r.pauseReason="runtime_error";
            if(!roomCheckpointCommitted&&previousPhase.equals("fighting")){r.resets++;r.lastResetReason="runtime_error";r.lastResetAt=r.pausedAt;}
            r.fault=Objects.toString(e.getMessage(),"runtime_error");
            r.storageFault=e instanceof StorageUnavailable&&!Boolean.TRUE.equals(DurableConfigStore.audit(plugin).get("commitUnknown"));
            if(r.storageFault&&r.storageRetryAttempts<5)r.storageRetryAt=r.pausedAt+1000;
            try{persist();}catch(RuntimeException save){plugin.getLogger().log(java.util.logging.Level.WARNING,"Site dungeon fault checkpoint not saved: "+r.site.id,save);}
            String progress=roomCheckpointCommitted?"已保存本段通关与参战进度，后续登记尚未完成，不重刷已保存的房间":"本段未结算";
            notice(r,"§c"+label(r.site)+"已暂停："+faultHint(r)+"。"+progress+"，故障等待不计挑战时限；解决后 /mycli dungeon resume 重试，或 /mycli dungeon leave 退出。resume 是副本操作，不要加 cast 或副本ID。");
        }
        }
    }
    static long activeMillis(long started,long faultPausedMillis,long now){return Math.max(0,now-started-faultPausedMillis);}
    private void resume(Run r){
        String fault=r.fault,reason=r.pauseReason;long paused=r.pausedAt,excluded=r.faultPausedMillis;boolean storageFault=r.storageFault;
        long now=System.currentTimeMillis();
        r.faultPausedMillis+=Math.max(0,now-Math.max(r.started,paused));
        r.fault="";r.storageFault=false;r.pausedAt=now;r.pauseReason="recovery_return";
        try{persist();}catch(RuntimeException failure){r.fault=fault;r.storageFault=storageFault;r.pausedAt=paused;r.pauseReason=reason;r.faultPausedMillis=excluded;throw failure;}
        r.storageRetryAt=0;
    }
    private String faultHint(Run r){
        if(r.fault.equals("data_unavailable")&&Boolean.TRUE.equals(DurableConfigStore.audit(plugin).get("commitUnknown")))return "存储提交结果未知，原始提交文件已保留；请运营核对真实状态，勿重复开场、领奖或清空任务";
        if(r.storageFault)return "已确认存储故障，原存档与计时保留；原队伍回到遗迹后自动核对恢复，勿重开或重复领奖";
        if(r.fault.equals("camp_spawn_points_obstructed"))return "已勘察的出怪点被占用或现场发生变化。队员先让出周围空地，不拆原建筑；仍不成功请服主核查标记位置";
        var advice=ActionFeedback.advice("dungeon",r.fault,r.site.id);return advice==null?"现场暂不可确认，请先查当前活动并联系服主":advice.message();
    }
    private List<Location> safeSpots(Run r){
        World w=Bukkit.getWorld(r.site.world);Room room=r.room();List<Location> spots=new ArrayList<>();List<Player> present=present(r);
        List<List<Integer>> candidates=room.spawnPoints;
        if(candidates.isEmpty()){candidates=new ArrayList<>();for(int dx=-room.radius;dx<=room.radius;dx++)for(int dz=-room.radius;dz<=room.radius;dz++)candidates.add(List.of(room.x+dx,room.y,room.z+dz));}
        for(List<Integer> point:candidates){
            int x=point.get(0),y=point.get(1),z=point.get(2);if(!w.isChunkLoaded(x>>4,z>>4))continue;
            Block feet=w.getBlockAt(x,y,z),head=feet.getRelative(0,1,0),floor=feet.getRelative(0,-1,0);
            if(!feet.isPassable()||!head.isPassable()||!floor.getType().isSolid()||HAZARDS.contains(feet.getType())||HAZARDS.contains(head.getType())||HAZARDS.contains(floor.getType()))continue;
            if(feet.isLiquid()||head.isLiquid()||!flatSpawnSupport(floor))continue;
            Location at=new Location(w,x+.5,y,z+.5);
            double clearance=room.radius<=3?4:9;
            if(present.stream().noneMatch(p->p.getLocation().distanceSquared(at)<clearance))spots.add(at);
        }
        return spots;
    }
    static boolean flatSpawnSupport(Block floor){
        String name=floor.getType().name();
        // Double slabs have a complete top surface. Half slabs and stairs still
        // need another surveyed point; legacy map IDs alone do not prove shape.
        return floor.getType().isSolid()&&!name.endsWith("_LEAVES")&&!name.endsWith("_STAIRS")
                &&(!name.endsWith("_SLAB")||floor.getBlockData() instanceof Slab slab&&slab.getType()==Slab.Type.DOUBLE);
    }
    private void markEchoRoute(Run r,List<Player> present){
        for(Player p:present)for(var point:EchoCitadel.route(r.stage)){
            Location mark=new Location(p.getWorld(),point.get(0)+.5,point.get(1)+.1,point.get(2)+.5);
            if(p.getLocation().distanceSquared(mark)<196)
                p.spawnParticle(Particle.DUST,mark,4,.25,.07,.25,0,new Particle.DustOptions(org.bukkit.Color.FUCHSIA,1.2f));
        }
    }
    private void spawn(Run r){
        Room room=r.room();
        var wave=r.echo==null?null:echoWave(r,r.echo.wave);
        var enemies=wave==null?room.enemies:wave.enemies();
        List<Location> spots=safeSpots(r);
        require(spots.size()>=enemies.size(),room.spawnPoints.isEmpty()?"room_blocked_clear_floor_and_retry":"camp_spawn_points_obstructed");
        Collections.shuffle(spots);
        if(wave!=null&&wave.sideFlank()){
            var order=new ArrayList<Location>();
            spots.stream().min(Comparator.comparingDouble(Location::getX)).ifPresent(order::add);
            if(r.mode!=Mode.NORMAL){
                spots.stream().filter(at->!order.contains(at)).max(Comparator.comparingDouble(Location::getX)).ifPresent(order::add);
            }
            spots.removeAll(order);spots.addAll(0,order);
        }
        try{
            for(int i=0;i<enemies.size();i++){
                var spec=enemies.get(i);Location at=spots.get(i);Chunk chunk=at.getChunk();if(r.held.add(chunk))chunk.addPluginChunkTicket(plugin);
                Mob mob=spec.spawn(at,r.mode!=Mode.NORMAL||r.site.conquestFloor>0);
                r.mobs.put(mob.getUniqueId(),spec);
                mob.addScoreboardTag(TAG);mob.addScoreboardTag("afu_site_"+r.site.id);spec.equip(mob,r.mode.health*(1+Math.max(0,r.party.size()-1)*.2));
                String enemyName=spec.name().isEmpty()?(mob.getCustomName()==null?mob.getType().name():ChatColor.stripColor(mob.getCustomName())):spec.name();
                mob.setCustomName("§c"+r.site.name+" · "+enemyName);mob.setCustomNameVisible(true);
                r.mobs.put(mob.getUniqueId(),spec);
                if(wave!=null&&wave.move()!=null)registerBossMove(r,room,mob,wave.move());
                if(r.enemyMoves&&r.stage==r.site.rooms.size()-1){
                    var boss=BOSS_SKILLS.get(r.site.id);
                    if(boss!=null&&boss.type()==spec.type()&&boss.name().equals(spec.name()))
                        registerBossMove(r,room,mob,boss.move());
                }
            }
            if(!r.phase.equals("fighting"))r.attempt++;
            r.phase="fighting";r.invalid=false;
            if(r.echo!=null)r.echo.spawn(r.stage);
            observeRoom(r);persist();
            if(wave==null)notice(r,"§c"+room.name+"："+enemies.size()+"个标记敌人（本室第"+r.attempt+"次出怪）。在室内参战、实际命中或援助队友会记录；不要求最后一刻留在室内。");
            else notice(r,"§d【"+room.name+" "+(r.echo.wave+1)+"/"+EchoCitadel.waves(r.stage)+"】"+wave.name()+" · "+enemies.size()+"名敌人。"+wave.tactic());
        }catch(RuntimeException e){clean(r);r.phase="moving";throw e;}
    }
    private void registerBossMove(Run r,Room room,Mob mob,DungeonEnemyMoves.Move move){
        var scope=new DungeonEnemyMoves.Scope(
            ()->runs.get(r.site.id)==r&&r.room()==room&&r.phase.equals("fighting")&&r.pausedAt==0&&r.fault.isEmpty()
                &&!r.invalid&&r.mobs.containsKey(mob.getUniqueId()),
            ()->present(r).stream().filter(p->room.contains(p.getLocation())).toList(),room::contains);
        plugin.dungeonEnemyMoves().register(mob,move,scope);
    }
    private void tickAltar(Run r,List<Player> present,long now){
        if(!r.altarTactics||r.stage!=r.site.rooms.size()-1||!plugin.nativeRpg().healingCircleEnabled())return;
        Mob boss=altarBoss(r);
        if(boss==null){r.poison=null;return;}
        if(r.poison==null)r.poison=new AltarPoison();
        r.poison.tick(boss,present.stream().filter(p->r.room().contains(p.getLocation())&&plugin.nativeRpgMayAct(p)).toList(),now);
    }
    private Mob altarBoss(Run r){
        for(var enemy:r.mobs.entrySet()){
            if(!AltarPoison.BOSS.equals(enemy.getValue().mythic()))continue;
            if(Bukkit.getEntity(enemy.getKey()) instanceof Mob living&&living.isValid()&&!living.isDead())return living;
        }
        return null;
    }
    boolean interruptAltar(Player caster,boolean apply){
        Run r=runs.get(AltarPoison.SITE);
        if(r==null||r.poison==null||!companionCombatPosition(r,caster,caster.getLocation()))return false;
        Mob boss=altarBoss(r);
        if(boss==null||caster.getLocation().distanceSquared(boss.getLocation())>100||!caster.hasLineOfSight(boss)
                ||!r.poison.interrupt(System.currentTimeMillis(),apply))return false;
        if(apply){
            boss.getWorld().spawnParticle(Particle.ENCHANT,boss.getLocation().add(0,1,0),16,.2,.35,.2,.07);
            notice(r,"§b祭仪师的毒藤读条已被打断。");
        }
        return true;
    }

    private void complete(Run r){
        // A contribution belongs to its real UUID, even after departure or
        // disconnect. Snapshot once; receipt creation remains atomic/idempotent.
        var newlyEligible=new ArrayList<Player>();
        for(UUID id:new LinkedHashSet<>(r.attendance.keySet())){
            if(r.attendance.getOrDefault(id,0)==0)continue;
            Player participant=ResidentCli.find(id);
            if(participant!=null&&plugin.nativeRpgSelected()&&plugin.skillAssessments()!=null
                    &&missingRooms(r,id).isEmpty()&&unverifiedRooms(r).isEmpty())
                plugin.skillAssessments().siteCompleted(participant,r.site.id,r.id,r.started);
            String rewardDay=day();
            boolean bossParticipant=r.roomAttendance.getOrDefault(r.site.rooms.size()-1,Set.of()).contains(id);
            boolean grantLoot=siteRewardSlot(r,id,rewardDay).equals("eligible");
            var relic=DungeonRelics.at(r.site.id);
            boolean grantRelic=SiteRewardPolicy.relicEligible(relic!=null&&bossParticipant,relicClaimed(id,r.site.id),
                    receipt(id,r.site.id)!=null,r.id.equals(plugin.getConfig().getString(ROOT+".claimed-runs."+id+"."+r.site.id)));
            boolean grantCircle=r.altarTactics&&bossParticipant&&!circleReward(id)&&plugin.nativeRpg().healingCircleEnabled();
            if(!grantLoot&&!grantRelic&&!grantCircle)continue;
            atomic(()->{
                if(grantLoot||grantRelic){
                    String path=ROOT+".receipts."+id+"."+r.site.id;
                    var saved=plugin.getConfig().createSection(path,Map.of("day",rewardDay,"run",r.id,"started-at",r.started,
                            "emeralds",grantLoot?r.site.emeralds*r.mode.reward:0,"item",r.site.bonus.name(),
                            "count",grantLoot?r.site.bonusCount*r.mode.reward:0,"bossParticipant",bossParticipant));
                    if(grantRelic){
                        saved.set("relic",DungeonRelics.create(relic,r.mode.ordinal(),java.util.concurrent.ThreadLocalRandom.current()));
                        saved.set("relic-only",!grantLoot);
                    }
                    if(r.site.conquestFloor>0&&bossParticipant)plugin.getConfig().set(ROOT+".conquest-proofs."+id+"."+r.site.conquestFloor,r.id);
                }
                if(grantCircle)plugin.getConfig().set(circleProof(id),r.id);
            });
            if(participant!=null&&grantCircle)newlyEligible.add(participant);
            Player p=participant;if(p!=null&&(grantLoot||grantRelic)){
                applyCompletion(p,r.site.id,receipt(id,r.site.id));
                p.sendMessage("§6"+r.site.name+"已通关。罗盘 → 遗迹地下城 → "+r.site.name+" → 领取奖励。"
                        +(grantRelic?" §d本次发现秘宝「"+relic.name()+"」。":""));
            }
        }
        end(r,"completed");
        for(Player p:newlyEligible)announceCircleReward(p,r);
    }
    private void announceCircleReward(Player p,Run r){
        var circle=plugin.nativeRpg().state(p).getAsJsonObject("healingCircle");
        if(circle==null||circle.get("learned").getAsBoolean())return;
        p.sendMessage("§a【翠藤古神祭坛】已取得治愈之环学习资格。打开本处结算菜单可免费学习并装入轮盘。");
        if(!ResidentCli.isResident(p.getUniqueId())&&p.isOnline()&&r.party.contains(p.getUniqueId())
                &&p.getOpenInventory().getTopInventory().getType()==org.bukkit.event.inventory.InventoryType.CRAFTING)open(p,r.site.id);
    }
    private void applyCompletion(Player p,String id,ConfigurationSection saved){
        Site s=sites.get(id);if(saved==null||s==null)return;String run=saved.getString("run");
        // Old full-exploration receipts predate this field and remain valid.
        boolean boss=saved.getBoolean("bossParticipant",true);
        if(s.conquestFloor>0&&boss&&plugin.combatRpg()!=null)plugin.combatRpg().formalClear(run,p,s.conquestFloor);
        if(s.conquestFloor==0||boss)plugin.nativeSiteCompleted(p,id,run);
    }
    private void clearShots(Run r){for(var entry:new ArrayList<>(shots.entrySet()))if(entry.getValue().run==r){Entity e=Bukkit.getEntity(entry.getKey());if(e!=null)e.remove();shots.remove(entry.getKey());}}
    private void clean(Run r){r.poison=null;if(r.echo!=null)r.echo.resetRoom();clearShots(r);for(UUID id:r.mobs.keySet()){Entity e=Bukkit.getEntity(id);if(e!=null)e.remove();}r.mobs.clear();r.hits.clear();r.roomParticipants.clear();for(Chunk c:r.held)c.removePluginChunkTicket(plugin);r.held.clear();}
    private void end(Run r,String reason){
        Map<UUID,Map<String,Object>> outcomes=new LinkedHashMap<>();for(UUID id:r.attendance.keySet())outcomes.put(id,outcome(r,id,reason));
        Map<UUID,ScheduledReturn> returns=new LinkedHashMap<>();
        if(reason.equals("completed")&&groundMusters.containsKey(r.site.id)){
            long due=System.currentTimeMillis()+RETURN_DELAY_MS;
            for(UUID id:r.party){
                var p=ResidentCli.find(id);
                if(p!=null&&p.isOnline()&&atReturnPoint(r.site,p.getLocation()))returns.put(id,new ScheduledReturn(r.site.id,r.id,due));
            }
        }
        runs.remove(r.site.id);
        try{persist(()->{
            plugin.getConfig().set(ROOT+".cooldowns."+r.site.id,System.currentTimeMillis());
            plugin.getConfig().set(ROOT+".last-outcomes."+r.site.id,null);
            plugin.getConfig().createSection(ROOT+".last-outcomes."+r.site.id,Map.of("run",r.id,"reason",reason,"endedAt",System.currentTimeMillis(),"clearedRooms",r.stage,"requiredRooms",r.site.rooms.size(),"resets",r.resets,"lastResetReason",r.lastResetReason));
            outcomes.forEach((id,data)->saveOutcome(id,r.site.id,data));
            returns.forEach((id,scheduled)->{
                String path=returnPath(id);plugin.getConfig().set(path,null);
                plugin.getConfig().createSection(path,Map.of("site",scheduled.site(),"run",scheduled.run(),"dueAt",scheduled.dueAt()));
            });
        });}catch(RuntimeException e){runs.put(r.site.id,r);throw e;}
        scheduledReturns.putAll(returns);
        plugin.dungeonEdits().restore("site-" + r.site.id, () -> emptyForRestore(r.site.id));
        if(plugin.trialRescue()!=null)plugin.trialRescue().releaseTeam(rescueKey(r),r.site.rooms.getFirst().center(Bukkit.getWorld(r.site.world)));
        clean(r);notice(r,"§e【地下城结束】"+endLabel(reason)+"。本场参战与存档点救援已失效。"
                +(!returns.isEmpty()?"30 秒后返回地面集结平台；也可立即回程。":station(r.site)==null?"存活者留在原地，请沿原路及时撤离。":"可在任一战斗房间免费返回地面入口。")
                +"已保存结果；查询：/mycli dungeon status "+r.site.id);
        outcomes.forEach((id,data)->{Player p=ResidentCli.find(id);if(p!=null){explainOutcome(p,data);offerReturn(r.site,p);}});
        plugin.getLogger().info("MC_SITE_DUNGEON_END "+JSON.toJson(Map.of("site",r.site.id,"run",r.id,"reason",reason,"clearedRooms",r.stage,"endedAt",System.currentTimeMillis(),"active",false,"rescueActive",false,"exitPolicy","standing_stay_downed_recover","participants",r.party.stream().map(UUID::toString).toList())));
    }
    private void atomic(Runnable change){
        String before=plugin.getConfig().saveToString();
        String step="change";
        try{
            change.run();step="durable_commit";
            DurableConfigStore.persist(plugin);
        }catch(Exception e){
            try{plugin.getConfig().loadFromString(before);}catch(Exception restore){restore.addSuppressed(e);throw new IllegalStateException("state_restore_failed",restore);}
            if(e instanceof IllegalArgumentException argument)throw argument;
            plugin.getLogger().log(java.util.logging.Level.WARNING,"MC_SITE_DUNGEON_SAVE_FAILURE step="+step,e);
            if(e instanceof java.io.IOException)throw new StorageUnavailable(e);
            throw new IllegalArgumentException("data_unavailable",e);
        }
    }
    private void persist(){persist(()->{});}
    private void persist(Runnable extra){
        require(blockedCheckpoints.isEmpty(),"checkpoint_conflict_requires_operator");
        atomic(()->{
            extra.run();
            plugin.getConfig().set(ROOT+".runs",null);
            for(Run r:runs.values()){
                String path=ROOT+".runs."+r.site.id;Map<String,Object> saved=new LinkedHashMap<>();
                saved.put("id",r.id);saved.put("mode",r.mode.id);saved.put("definition",definition(r.site));saved.put("stage",r.stage);saved.put("phase",r.phase);saved.put("fault",r.fault);saved.put("started",r.started);saved.put("pausedAt",r.pausedAt);saved.put("faultPausedMillis",r.faultPausedMillis);saved.put("party",r.party.stream().map(UUID::toString).toList());
                saved.put("declined",r.declined.stream().map(UUID::toString).toList());
                if(r.altarTactics)saved.put("altarTactics",true);
                if(r.enemyMoves)saved.put("enemyMoves",true);
                if(r.echo!=null){saved.put("echoEncounter",EchoCitadel.VERSION);saved.put("echoTiming",r.echo.timing());}
                Map<String,Integer> attendance=new LinkedHashMap<>();r.attendance.forEach((id,count)->attendance.put(id.toString(),count));saved.put("attendance",attendance);plugin.getConfig().createSection(path,saved);
                Map<String,List<String>> roomAttendance=new LinkedHashMap<>();r.roomAttendance.forEach((stage,ids)->roomAttendance.put(stage.toString(),ids.stream().map(UUID::toString).toList()));
                plugin.getConfig().set(path+".roomAttendance",roomAttendance);plugin.getConfig().set(path+".attempt",r.attempt);plugin.getConfig().set(path+".resets",r.resets);
                plugin.getConfig().set(path+".pauseReason",r.pauseReason);plugin.getConfig().set(path+".lastResetReason",r.lastResetReason);plugin.getConfig().set(path+".lastResetAt",r.lastResetAt);
                if(r.storageFault)plugin.getConfig().set(path+".storageFault",true);
                plugin.getConfig().set(path+".failures",r.failures);plugin.getConfig().set(path+".checkpoint",r.checkpoint);plugin.getConfig().set(path+".checkpointRoom",r.checkpointRoom);plugin.getConfig().set(path+".retryReadyAt",r.retryReadyAt);
            }
        });
    }
    private String definition(Site site){
        // Keep old interior checkpoints byte compatible. Optional presentation
        // and spawn fields are serialized only when they actually alter rules.
        var value=JSON.toJsonTree(site).getAsJsonObject();if(!site.outdoor)value.remove("outdoor");
        for(var room:value.getAsJsonArray("rooms")){var object=room.getAsJsonObject();if(object.getAsJsonArray("spawnPoints").isEmpty())object.remove("spawnPoints");object.remove("hint");}
        return JSON.toJson(value);
    }
    private void restore(){
        var saved=plugin.getConfig().getConfigurationSection(ROOT+".runs");if(saved==null)return;
        List<Run> expired=new ArrayList<>();
        for(String id:saved.getKeys(false))try{
            Site site=site(id);var c=saved.getConfigurationSection(id);Run r=new Run(site,Mode.parse(c.getString("mode","normal")));
            r.altarTactics=id.equals(AltarPoison.SITE)&&c.getBoolean("altarTactics",false);
            r.enemyMoves=BOSS_SKILLS.containsKey(id)&&c.getBoolean("enemyMoves",false);
            if(c.contains("echoEncounter")){
                require(id.equals(EchoCitadel.SITE)&&c.getInt("echoEncounter")==EchoCitadel.VERSION
                    &&site.world.equals("aincrad")&&echoGeometry(site),"echo_checkpoint_incompatible");
                r.echo=new EchoCitadel.Progress();
                var timing=c.getConfigurationSection("echoTiming");
                if(timing!=null)r.echo.restore(timing.getLong("battleMs"),timing.getLong("travelMs"),
                    timing.getLong("waveTransitionMs"),timing.getIntegerList("observedWaves"));
            }
            r.id=c.getString("id",r.id);UUID.fromString(r.id);
            require(definition(site).equals(c.getString("definition")),"definition_changed_checkpoint_preserved");
            r.stage=c.getInt("stage");require(r.stage>=0&&r.stage<=site.rooms.size(),"invalid_checkpoint");r.started=c.getLong("started");
            r.phase=r.stage==site.rooms.size()?"returning":"moving";r.fault=c.getString("fault","");r.pausedAt=c.getLong("pausedAt",System.currentTimeMillis());if(r.pausedAt==0)r.pausedAt=System.currentTimeMillis();
            r.faultPausedMillis=c.getLong("faultPausedMillis",0);require(r.faultPausedMillis>=0&&r.faultPausedMillis<=Math.max(0,System.currentTimeMillis()-r.started),"invalid_fault_pause");
            if(!r.fault.isEmpty()&&c.getString("phase","").equals("muster"))r.phase="muster";
            for(String raw:c.getStringList("party")){UUID uuid=UUID.fromString(raw);require(r.party.size()<PARTY_LIMIT,"party_limit");require(runs.values().stream().noneMatch(old->old.party.contains(uuid)),"duplicate_participant");r.party.add(uuid);r.attendance.put(uuid,c.getInt("attendance."+raw));}
            var history=c.getConfigurationSection("attendance");if(history!=null){require(history.getKeys(false).size()<=HISTORY_LIMIT,"history_limit");for(String raw:history.getKeys(false))r.attendance.put(UUID.fromString(raw),history.getInt(raw));}
            require(c.getStringList("declined").size()<=HISTORY_LIMIT,"history_limit");for(String raw:c.getStringList("declined"))r.declined.add(UUID.fromString(raw));
            r.attempt=c.getInt("attempt");r.resets=c.getInt("resets");r.pauseReason=c.getString("pauseReason","server_restart");r.lastResetReason=c.getString("lastResetReason","");r.lastResetAt=c.getLong("lastResetAt");
            r.storageFault=c.getBoolean("storageFault",false)&&r.fault.equals("data_unavailable");
            r.failures=c.getInt("failures",0);require(r.failures>=0&&r.failures<MAX_FAILURES,"invalid_retry_checkpoint");
            r.checkpoint=c.getLocation("checkpoint");r.checkpointRoom=c.getInt("checkpointRoom",1);
            require(r.checkpointRoom>=1&&r.checkpointRoom<=Math.max(1,r.stage),"invalid_retry_checkpoint");
            if(r.checkpoint!=null)require(r.site.contains(r.checkpoint),"invalid_retry_checkpoint");
            if(c.getString("phase","").equals("retrying")){r.phase="retrying";r.retryReadyAt=System.currentTimeMillis()+10_000;}
            var roomAttendance=c.getConfigurationSection("roomAttendance");
            if(roomAttendance!=null)for(String key:roomAttendance.getKeys(false)){
                int room=Integer.parseInt(key);require(room>=0&&room<r.stage,"invalid_room_attendance");
                List<String> players=roomAttendance.getStringList(key);require(players.size()<=HISTORY_LIMIT,"invalid_room_attendance");
                Set<UUID> ids=new LinkedHashSet<>();players.forEach(raw->ids.add(UUID.fromString(raw)));r.roomAttendance.put(room,Set.copyOf(ids));
            }
            if(c.getString("phase","").equals("fighting")){r.resets++;r.pauseReason="server_restart";r.lastResetReason="server_restart";r.lastResetAt=System.currentTimeMillis();}
            for(UUID uuid:r.attendance.keySet())require(r.attendance.getOrDefault(uuid,0)>=0&&r.attendance.getOrDefault(uuid,0)<=r.stage,"invalid_attendance_count");
            require(!r.attendance.isEmpty(),"empty_party");runs.put(id,r);
            if(r.fault.isEmpty()&&activeMillis(r.started,r.faultPausedMillis,System.currentTimeMillis())>TIMEOUT_MS)expired.add(r);
        }catch(RuntimeException e){blockedCheckpoints.add(id);ready=false;plugin.getLogger().warning("Site dungeon checkpoint preserved for operator: "+id+" "+e.getMessage());}
        if(blockedCheckpoints.isEmpty())for(Run r:expired)try{end(r,"time_limit");}catch(RuntimeException e){r.fault="data_unavailable";plugin.getLogger().warning("Expired dungeon outcome not saved: "+r.site.id);}
    }
    void shutdown(){try{if(blockedCheckpoints.isEmpty())persist();}finally{for(Run r:runs.values())clean(r);}}
    private boolean owned(Entity e){return e!=null&&e.getScoreboardTags().contains(TAG);}
    private Run owner(Entity e){if(e==null)return null;Shot shot=shots.get(e.getUniqueId());if(shot!=null)return shot.run;if(!owned(e))return null;return runs.values().stream().filter(r->r.mobs.containsKey(e.getUniqueId())).findFirst().orElse(null);}
    private Entity actor(Entity e){if(e instanceof Projectile p){ProjectileSource source=p.getShooter();return source instanceof Entity a?a:null;}return e;}
    private boolean companionCombatPosition(Run run, Player player, Location position) {
        return ready && run != null
            && run.phase.equals("fighting") && run.fault.isEmpty() && run.pausedAt == 0 && !run.invalid
            && run.party.contains(player.getUniqueId())
            && position.getWorld().equals(player.getWorld()) && player.getWorld().getName().equals(run.site.world())
            && run.room().contains(player.getLocation()) && run.room().contains(position);
    }
    boolean companionCombatPosition(Player player, Location position) {
        return companionCombatPosition(own(player), player, position);
    }
    boolean companionCombatTarget(Player player, Entity companion, Entity target) {
        if (!owned(target)) return false;
        Run run = owner(target);
        return companionCombatPosition(run, player, companion.getLocation())
            && run.mobs.containsKey(target.getUniqueId()) && target.getWorld().equals(player.getWorld())
            && run.room().contains(target.getLocation());
    }
    private boolean validParticipant(Run run,Entity entity) {
        Player p=ResidentCli.fromEntity(entity);return p!=null&&playing(p)&&!plugin.isDowned(p)&&run.party.contains(p.getUniqueId())&&run.room().contains(p.getLocation());
    }
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void target(EntityTargetLivingEntityEvent e){Run r=owner(e.getEntity());if(r!=null&&e.getTarget()!=null&&!validParticipant(r,e.getTarget()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void damage(EntityDamageByEntityEvent e){
        Run from=owner(e.getDamager());if(from==null)from=owner(actor(e.getDamager()));Run to=owner(e.getEntity());
        Player victim=ResidentCli.fromEntity(e.getEntity()),attacker=ResidentCli.fromEntity(actor(e.getDamager()));
        if(from!=null&&victim!=null&&from.site.contains(victim.getLocation()))enroll(victim,from);
        if(to!=null&&attacker!=null&&to.site.contains(attacker.getLocation()))enroll(attacker,to);
        if(from!=null){if(!validParticipant(from,e.getEntity()))e.setCancelled(true);else{e.setDamage(e.getDamage()*from.mode.damage);from.hits.put(actor(e.getDamager()).getUniqueId(),System.currentTimeMillis());}}
        if(to!=null&&attacker!=null&&!to.party.contains(attacker.getUniqueId()))e.setCancelled(true);
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)public void participation(EntityDamageByEntityEvent e){
        if(e.getFinalDamage()<=0)return;
        Run r=owner(e.getEntity());Player attacker=ResidentCli.fromEntity(actor(e.getDamager()));
        if(r!=null&&r.phase.equals("fighting")&&attacker!=null&&playing(attacker)&&!plugin.isDowned(attacker)
                &&r.party.contains(attacker.getUniqueId())&&r.site.contains(attacker.getLocation()))r.roomParticipants.add(attacker.getUniqueId());
    }
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void launch(ProjectileLaunchEvent e){Run r=owner(actor(e.getEntity()));if(r==null)return;if(shots.size()>=128){e.setCancelled(true);return;}e.getEntity().addScoreboardTag(SHOT_TAG);shots.put(e.getEntity().getUniqueId(),new Shot(r,System.currentTimeMillis()+15_000));}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void splash(PotionSplashEvent e){Run r=owner(e.getPotion());if(r==null)r=owner(actor(e.getPotion()));if(r!=null)for(LivingEntity l:e.getAffectedEntities())if(!validParticipant(r,l))e.setIntensity(l,0);}
    @EventHandler public void death(EntityDeathEvent e){Run r=owner(e.getEntity());if(r!=null){r.mobs.remove(e.getEntity().getUniqueId());e.getDrops().clear();e.setDroppedExp(0);}}
    @EventHandler public void load(EntitiesLoadEvent e){for(Entity entity:e.getEntities())if((owned(entity)||entity.getScoreboardTags().contains(SHOT_TAG))&&owner(entity)==null)entity.remove();}
    @EventHandler public void rejoin(PlayerJoinEvent e){Run r=own(e.getPlayer());if(r!=null)e.getPlayer().sendMessage("§e地下城进度保留，剩余机会 "+(MAX_FAILURES-r.failures)+"/3；dungeon status 查本场。断线不扣次数，倒地续关会自动回存档点；主动离场仍须5分钟内回场。");Bukkit.getScheduler().runTaskLater(plugin,()->{clearLoginIntruder(e.getPlayer());restoreReturn(e.getPlayer());},5L);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void spawnNatural(SpawnerSpawnEvent e){if(runs.values().stream().anyMatch(r->r.site.contains(e.getLocation())))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void spawnWild(CreatureSpawnEvent e){if(e.getSpawnReason()==CreatureSpawnEvent.SpawnReason.NATURAL&&runs.values().stream().anyMatch(r->r.site.contains(e.getLocation())))e.setCancelled(true);}
    private Site surveyedCamp() {
        Site camp = sites.get(BlackBannerCamp.SITE);
        if (camp == null || !camp.outdoor || !camp.world.equals("world") || camp.rooms.size() != 2) return null;
        Room first = camp.rooms.getFirst(), second = camp.rooms.getLast();
        return first.x == -1077 && first.y == 67 && first.z == -1117
                && second.x == -1069 && second.y == 67 && second.z == -1116 ? camp : null;
    }

    boolean openCampMarker(Player player, String target) {
        Site camp = surveyedCamp();
        if (camp == null || !BlackBannerCamp.MARKER.equals(target) || !camp.contains(player.getLocation())) return false;
        open(player, camp.id);
        return true;
    }

    boolean campRescueLatch(Block block) {
        Site camp = surveyedCamp();
        return camp != null && camp.contains(block.getLocation()) && BlackBannerCamp.isLatch(block);
    }

    boolean handleCampRescue(PlayerInteractEvent event) {
        Block clicked = event.getClickedBlock();
        if (event.getAction() != Action.RIGHT_CLICK_BLOCK || clicked == null || !campRescueLatch(clicked)) return false;
        event.setCancelled(true);
        Player player = event.getPlayer();
        if (playing(player) && !plugin.isDowned(player)
                && player.getLocation().distanceSquared(clicked.getLocation().add(.5, .5, .5)) <= 25) {
            BlackBannerCamp.interact(plugin, player, clicked, room -> campGuardCleared(player, room));
        }
        return true;
    }

    @EventHandler(priority=EventPriority.HIGH,ignoreCancelled=true)
    public void approachButton(PlayerInteractEvent event){
        Block block=event.getClickedBlock();
        if(event.getHand()!=EquipmentSlot.HAND||event.getAction()!=Action.RIGHT_CLICK_BLOCK
                ||block==null||block.getType()!=Material.STONE_BUTTON)return;
        var player=event.getPlayer();
        for(Site s:sites.values()){
            var station=station(s);
            if(station==null)continue;
            if(block.getWorld()==entryWorld(s)&&station.button().equals(List.of(block.getX(),block.getY(),block.getZ()))){
                event.setCancelled(true);
                command(player,new String[]{"dungeon","enter",s.id});
                return;
            }
            var relic=DungeonRelics.at(s.id);
            if(relic!=null&&block.getWorld().getName().equals(s.world)&&relic.x()==block.getX()&&relic.y()==block.getY()&&relic.z()==block.getZ()
                    &&playing(player)&&atFirstRoom(s,player.getLocation())){
                event.setCancelled(true);open(player,s.id);return;
            }
        }
    }

    private boolean campGuardCleared(Player player, int room) {
        UUID id = player.getUniqueId();
        Run current = runs.get(BlackBannerCamp.SITE);
        if (current != null) return current.roomAttendance.getOrDefault(room, Set.of()).contains(id);
        Map<String,Object> last = lastOutcome(id, BlackBannerCamp.SITE);
        return "completed".equals(last.get("reason")) && last.get("attendance") instanceof Number cleared
                && cleared.intValue() >= 2;
    }

    private void openEntryReview(Player p,EntryOffer offer){
        Inventory inv=Bukkit.createInventory(null,54,"遗迹集结 · 确认入场");
        inv.setItem(4,icon(Material.BOOK,"§e确认前核对名单","缺装备可确认后入场；其他入场限制继续生效。"));
        int slot=9;
        for(EntryMember member:offer.roster()){
            inv.setItem(slot++,icon(member.missing().isEmpty()&&member.blocker().isEmpty()?Material.LIME_DYE:Material.ORANGE_DYE,
                    "§f"+member.name(),entryDescription(member)));
            if(slot==45)break;
        }
        inv.setItem(49,icon(Material.LIME_CONCRETE,"§a确认入场","保留当前队伍和装备，继续挑战"));
        inv.setItem(45,icon(Material.ARROW,"§7返回补给","本次不入场"));
        menus.put(inv,new Menu(offer.site(),false,offer));p.openInventory(inv);
    }
    private ItemStack icon(Material material,String name,String... lore){ItemStack item=new ItemStack(material);var meta=item.getItemMeta();meta.setDisplayName(name);meta.setLore(List.of(lore));item.setItemMeta(meta);return item;}
    private void open(Player p,String id){
        Inventory inv=Bukkit.createInventory(null,54,id.isEmpty()?"遗迹地下城":"地下城 · "+site(id).name);menus.put(inv,new Menu(id,receipt(p.getUniqueId(),id)!=null));
        if(id.isEmpty()){int slot=10;for(Site s:sites.values())inv.setItem(slot++,icon(s.icon,"§6"+s.name,routeHint(s),"点击查看入口、组队、挑战与奖励"));}
        else{Site s=site(id);inv.setItem(10,icon(Material.ENDER_PEARL,entry(s).isEmpty()?"§b前往遗迹外围":"§b前往挑战入口","8魔力；抵达后仍须主动开始、逐室清怪"));inv.setItem(12,icon(Material.IRON_SWORD,"§a开始普通挑战","须亲自站在首室；10秒组队集结"));inv.setItem(13,icon(Material.DIAMOND_SWORD,"§6开始冒险挑战","更强怪物；每日奖励二倍"));inv.setItem(14,icon(Material.NETHERITE_SWORD,"§5开始末日挑战","更强怪物；每日奖励三倍"));inv.setItem(16,icon(Material.SUNFLOWER,"§a确认当前参战","遗迹内达标者自动同队，可随时加入"));inv.setItem(22,icon(Material.BARRIER,"§c退出自己的挑战","留在原地；自行步行或使用传送技能"));inv.setItem(30,icon(Material.CHEST,"§6领取已完成奖励","存入个人箱；满队列时保留凭据"));inv.setItem(31,icon(Material.WRITTEN_BOOK,"§e路线与当前进度","逐室攻略，通关后就地登记奖励"));inv.setItem(49,icon(Material.ARROW,"§7返回地下城列表"));}
        if(id.isEmpty()){
            int slot=10;for(Site s:sites.values()){
                var relic=DungeonRelics.at(s.id);
                if(receipt(p.getUniqueId(),s.id)!=null)inv.setItem(slot,icon(s.icon,"§e"+s.name+" · 有奖励待领取",routeHint(s),"点击打开，再点奖励箱领取上次奖励","领取后才可开始或加入这处的新挑战"));
                else if(relic!=null)inv.setItem(slot,icon(s.icon,"§6"+s.name,
                        "秘宝："+relic.name()+(relicClaimed(p.getUniqueId(),s.id)?"（已收录）":"（待发现）"),
                        "点击查看秘宝、入口路线和难度"));
                slot++;
            }
            var collection=relicCollection(p.getUniqueId());
            String title=collection.get("title").toString();
            inv.setItem(45,icon(Material.NAME_TAG,"§d遗迹秘宝收藏 "+collection.get("found")+"/"+collection.get("total"),
                    title.isEmpty()?"首件秘宝解锁「遗迹先行者」":"当前称号："+title,
                    "不同遗迹累计收录 1、5、10、15 件时提升称号"));
        }else if(receipt(p.getUniqueId(),id)!=null){
            var saved=receipt(p.getUniqueId(),id);
            for(int slot:new int[]{12,13,14,16})inv.setItem(slot,icon(Material.GRAY_DYE,"§e先领取上次奖励","上次已完成，奖励保留中","请点下方「领取上次奖励」箱子","不会自动领取或替你开启新挑战"));
            inv.setItem(30,icon(Material.ENDER_CHEST,"§a领取上次奖励",saved.getString("day","日期未记录")+"完成的挑战","点击领取到个人奖励箱，随后重新开场","满队列时保留凭据；无需重打旧场次"));
        }
        if(!id.isEmpty()){
            var relic=DungeonRelics.at(id);
            if(relic!=null){
                var lore=new ArrayList<String>();
                lore.add(relicClaimed(p.getUniqueId(),id)?"已收录 · 秘宝每个角色限领一次"
                        :pendingRelic(p.getUniqueId(),id)!=null?"本次秘宝待领 · 点击右侧奖励箱"
                        :"首次在终室登记参战并通关，保证取得");
                lore.addAll(relic.instructions());
                inv.setItem(27,icon(relic.material(),"§d秘宝 · "+relic.name(),lore.toArray(String[]::new)));
                inv.setItem(28,icon(Material.COMPASS,"§6从哪里进",
                        "传送后沿实体路标到石钮，按使用键",
                        "入口："+relic.x()+", "+relic.y()+", "+relic.z(),relic.tactic()));
            }
            Site selected=site(id);
            var station=station(selected);
            var rooms=selected.rooms.stream().map(room->room.name+" · "+room.x+", "+room.y+", "+room.z).toList();
            inv.setItem(29,icon(Material.MAP,"§e行进路线",rooms.toArray(String[]::new)));
            if(echoAvailable(selected))inv.setItem(29,icon(Material.MAP,"§e回响城路线与打法",
                "前庭一波热身。卫所清完哨队后，有侧翼援军。",
                "末室先清投影，再战执政官本体。",
                "普通／末日撤出紫圈。冒险横移离开光带。",
                "战后沿紫色粒子转场，通关原地领取到个人箱。"));
            inv.setItem(32,icon(Material.ENDER_CHEST,"§b打开个人箱","领取后的装备会在个人箱中装入"));
            if(station!=null){
                inv.setItem(10,icon(Material.ENDER_PEARL,"§b前往"+station.name(),"8魔力；落地沿铺装和地灯走到入口牌"));
                inv.setItem(28,icon(Material.COMPASS,"§6入口 · "+station.name(),
                        "落脚点 "+entry(selected),"入口牌 "+station.board(),"地面石钮 "+station.button(),
                        groundMusters.containsKey(selected.id)?"站到地面集结区，石钮送达符合条件的队友；通关 30 秒后返回":"到石钮按使用键进入首室，再选难度"));
                if(atStation(selected,p.getLocation()))inv.setItem(11,icon(Material.STONE_BUTTON,"§a使用入口","走到入口牌旁后点击，免费到首室"));
                if(canReturn(selected,p))inv.setItem(23,icon(Material.OAK_DOOR,"§b返回"+station.name(),"免费返回地面入口，可先在原地领奖"));
            }
        }
        if (!id.isEmpty() && id.equals(BlackBannerCamp.SITE) && surveyedCamp() != null) {
            inv.setItem(24, icon(Material.DARK_OAK_FENCE, "§e救援牢笼",
                    "在外哨用这张菜单开始清剿，倒数结束后刷第一批守卫。",
                    BlackBannerCamp.RESCUE_HINT, "打完后回来使用入口路牌，可领取本场奖励。"));
        }
        if(id.equals(AltarPoison.SITE)&&plugin.nativeRpg().healingCircleEnabled()){
            var circle=plugin.nativeRpg().state(p).getAsJsonObject("healingCircle");
            inv.setItem(33,circle==null
                ?icon(Material.BOOK,"§b治愈之环","牧师职业技能。毒藤黄圈预警后及时散开。","终室参战通关可取得一次免费学习资格。")
                :circle.get("learned").getAsBoolean()
                    ?icon(Material.GLISTERING_MELON_SLICE,"§b装入治愈之环","已学会。放到空槽，或自行选择替换。")
                    :circle.get("rewardEligible").getAsBoolean()
                        ?icon(Material.GLISTERING_MELON_SLICE,"§a学会并装入轮盘","免费学习治愈之环。空槽自动装入，满槽可自己选择。")
                        :icon(Material.BOOK,"§b治愈之环","参与终室并通关后可免费学习。也可在牧师Lv.3用1个学习点学习。"));
        }
        p.openInventory(inv);
    }
    private void learnCircle(Player p){
        var circle=plugin.nativeRpg().state(p).getAsJsonObject("healingCircle");
        if(circle==null){p.sendMessage("§e治愈之环由牧师学习。终室参战通关可取得免费学习资格。");return;}
        if(!circle.get("rewardEligible").getAsBoolean()){
            if(circle.get("learned").getAsBoolean()){p.closeInventory();plugin.equipHealingCircle(p);}
            else p.sendMessage("§e参与本遗迹终室并通关，可免费学；也可在职业技能书中用1学习点学习（Lv.3）。");
            return;
        }
        p.closeInventory();
        plugin.nativeRpg().learnHealingCircle(p).whenComplete((learned,error)->{
            if(!plugin.isEnabled())return;
            Bukkit.getScheduler().runTask(plugin,()->{
                if(!p.isOnline())return;
                if(error!=null||!Boolean.TRUE.equals(learned)){
                    p.sendMessage("§e学习保存待确认，资格会保留。稍后打开本处结算重新核对。");
                }else if(p.getOpenInventory().getTopInventory().getType()==org.bukkit.event.inventory.InventoryType.CRAFTING){
                    plugin.equipHealingCircle(p);
                }else p.sendMessage("§a已学会治愈之环，可从本处结算或现有轮盘装入。");
            });
        });
    }
    @EventHandler public void click(InventoryClickEvent e){
        Menu menu=menus.get(e.getView().getTopInventory());if(menu==null)return;e.setCancelled(true);if(!(e.getWhoClicked() instanceof Player p))return;int slot=e.getRawSlot();if(slot<0||slot>=54)return;
        if(e.getClick()!=ClickType.LEFT&&e.getClick()!=ClickType.RIGHT)return;
        Bukkit.getScheduler().runTask(plugin,()->{
            if(!p.isOnline() || p.getOpenInventory().getTopInventory() != e.getView().getTopInventory())return;
            if(menu.offer!=null){
                if(slot==45){entryOffers.remove(p.getUniqueId(),menu.offer);open(p,menu.site);}
                else if(slot==49){p.closeInventory();command(p,entryConfirmation(menu.offer).substring("/mycli ".length()).split(" "));}
                return;
            }
            if(menu.site.isEmpty()){List<Site> list=new ArrayList<>(sites.values());if(slot>=10&&slot<10+list.size())open(p,list.get(slot-10).id);return;}
            if(slot==32){p.closeInventory();plugin.dungeon().openStash(p);return;}
            if(slot==33&&menu.site.equals(AltarPoison.SITE)&&plugin.nativeRpg().healingCircleEnabled()){learnCircle(p);return;}
            Site selected=sites.get(menu.site);
            if(selected==null)return;
            String action=switch(slot){
                case 10->"travel";
                case 11->atStation(selected,p.getLocation())?"enter":"";
                case 12,13,14->"start";case 16->"join";case 22->"leave";
                case 23->canReturn(selected,p)?"exit":"";
                case 30->"claim";case 31->"info";default->"";
            };
            if(slot==49){open(p,"");return;}if(action.isEmpty())return;
            if((action.equals("start")||action.equals("join"))&&(menu.pendingReward||receipt(p.getUniqueId(),menu.site)!=null)){
                // Inspecting the blocker never implicitly claims or starts a challenge.
                explainPending(p,List.of(menu.site));open(p,menu.site);return;
            }
            p.closeInventory();command(p,DungeonAdvice.menuArgs(action,menu.site,slot==13?"adventure":slot==14?"apocalypse":"normal"));
            if(slot==31)command(p,new String[]{"dungeon","status",menu.site});
        });
    }
    @EventHandler public void drag(InventoryDragEvent e){if(menus.containsKey(e.getView().getTopInventory()))e.setCancelled(true);}
    @EventHandler public void close(InventoryCloseEvent e){menus.remove(e.getInventory());}
}
