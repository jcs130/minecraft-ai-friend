package org.afuhome.agentfriend;

import com.google.gson.Gson;
import java.io.File;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.block.Block;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.*;
import org.bukkit.event.*;
import org.bukkit.event.block.*;
import org.bukkit.event.entity.*;
import org.bukkit.event.inventory.*;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.world.EntitiesLoadEvent;
import org.bukkit.inventory.*;
import org.bukkit.projectiles.ProjectileSource;

/** Independent, opt-in encounters inside existing buildings. Never places blocks or generates terrain. */
final class SiteDungeonManager implements Listener {
    private static final String ROOT="site-dungeons",TAG="afu_site_dungeon",SHOT_TAG="afu_site_projectile";
    private static final int GLOBAL_MOBS=48,PARTY_LIMIT=8,MAX_FAILURES=3;
    private static final long REJOIN_MS=300_000,TIMEOUT_MS=1_800_000;
    private static final Gson JSON=new Gson();
    private static final Set<Material> HAZARDS=Set.of(Material.LAVA,Material.WATER,Material.FIRE,Material.SOUL_FIRE,
            Material.MAGMA_BLOCK,Material.CACTUS,Material.SWEET_BERRY_BUSH,Material.CAMPFIRE,Material.SOUL_CAMPFIRE,Material.POWDER_SNOW);
    private record Room(String name,int x,int y,int z,int radius,List<DungeonWaveCatalog.Enemy> enemies,List<List<Integer>> spawnPoints) {
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
        final Set<UUID> roomParticipants=new LinkedHashSet<>();
        final Map<Integer,Set<UUID>> roomAttendance=new LinkedHashMap<>();
        int attempt,resets,failures;String pauseReason="",lastResetReason="";long lastResetAt,retryReadyAt;
        Location checkpoint;int checkpointRoom=1;boolean retryLoading;
        final Map<UUID,DungeonWaveCatalog.Enemy> mobs=new LinkedHashMap<>();final Set<Chunk> held=new HashSet<>();
        final Map<UUID,Long> hits=new HashMap<>();
        int stage;String phase="muster",fault="";long started=System.currentTimeMillis(),readyAt=started+10_000,pausedAt,faultPausedMillis,storageRetryAt;int storageRetryAttempts;boolean invalid;
        Run(Site site,Mode mode){this.site=site;this.mode=mode;}
        Room room(){return site.rooms.get(Math.min(stage,site.rooms.size()-1));}
    }
    private record Menu(String site,boolean pendingReward){}
    private record Shot(Run run,long expires){}
    private static final class StorageUnavailable extends IllegalArgumentException {
        StorageUnavailable(Exception cause){super("data_unavailable",cause);}
    }
    private final AgentFriendPlugin plugin;
    private Map<String,Site> sites=Map.of();
    private record BuildingAreas(ProtectionArea envelope,List<ProtectionArea> pieces) {}
    private Map<String,BuildingAreas> protectionAreas=Map.of();
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
        facts.put("otherActivity",mine!=null&&mine!=run||plugin.dungeonParticipant(p)&&mine==null||plugin.pvpParticipant(p));
        facts.put("occupied",run!=null);facts.put("joinable",run!=null&&run.phase.equals("muster")&&now<run.readyAt&&run.party.size()<PARTY_LIMIT);
        facts.put("atFirstRoom",first.contains(p.getLocation())&&s.contains(p.getLocation()));facts.put("atSite",s.contains(p.getLocation()));
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
        out.put("recommendedLevel",prep.recommendedLevel());out.put("minimumLevel",s.conquestFloor>0?s.minimumLevel:1);
        out.put("playerCombatLevel",level);out.put("recommendedEquipment",prep.equipment());out.put("recommendedParty",prep.party());
        out.put("requiredEquipment","穿齐头、胸、腿、脚四件护甲，并携带近战武器、弓弩或本职业法器");out.put("missingEquipment",loadout);
        long armor=Arrays.stream(p.getInventory().getArmorContents()).filter(i->i!=null&&!i.getType().isAir()).count();
        out.put("currentEquipment","战斗Lv."+level+"、护甲"+armor+"/4、"+(p.getInventory().getItemInOffHand().getType()==Material.SHIELD?"已副手持盾":"副手未持盾")+"、饱食"+p.getFoodLevel()+"/20");
        out.put("skillHint",DungeonAdvice.skill(role));out.put("firstRoom",facts.get("firstRoom"));
        List<String> nativeEnemies=s.rooms.stream().flatMap(room->room.enemies.stream()).map(DungeonWaveCatalog.Enemy::mythic).filter(mob->mob!=null&&!mob.isEmpty()).distinct().toList();
        if(!nativeEnemies.isEmpty()){out.put("nativeEnemies",nativeEnemies);out.put("nativeContent",s.conquestFloor>0?"普通难度也启用Mythic首领机制":"冒险与末日启用Mythic精英；普通保留原版战斗");}
        if(out.get("state").equals("approach")&&!s.hint.isBlank())out.put("nextAction",out.get("nextAction")+" 路线："+(s.hint.length()>180?s.hint.substring(0,180)+"…":s.hint));
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
    private Run own(Player p){return runs.values().stream().filter(r->r.party.contains(p.getUniqueId())).findFirst().orElse(null);}
    boolean isParticipant(Player p){return own(p)!=null;}
    boolean hasActiveRuns(){return !runs.isEmpty()||!blockedCheckpoints.isEmpty();}
    List<String> ids(){return new ArrayList<>(sites.keySet());}
    boolean activityArea(Location at){return protectionArea(at)!=null;}
    ProtectionArea protectionArea(Location at) {
        for(BuildingAreas building:protectionAreas.values()){
            if(!building.envelope.contains(at))continue;
            for(ProtectionArea area:building.pieces)if(area.contains(at))return area;
        }
        return null;
    }
    private String rescueKey(Run r){return "site:"+r.id;}
    String challengeContext(UUID id){Run r=runs.values().stream().filter(run->run.party.contains(id)).findFirst().orElse(null);return r==null?"":rescueKey(r)+":"+r.stage+":"+r.attempt;}
    TrialRescueManager.Team rescueTeam(UUID id){
        Run r=runs.values().stream().filter(run->run.party.contains(id)).findFirst().orElse(null);if(r==null)return null;
        return new TrialRescueManager.Team(rescueKey(r),Set.copyOf(r.party),r.site::contains,r.pausedAt>0||!r.fault.isEmpty(),
                ()->r.phase.equals("fighting")&&r.mobs.isEmpty()&&!r.invalid,
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
        world.getChunkAtAsync(point.getBlockX()>>4,point.getBlockZ()>>4).whenComplete((chunk,error)->{if(!plugin.isEnabled())return;Bukkit.getScheduler().runTask(plugin,()->{
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
            notice(r,r.stage>=r.site.rooms.size()?"§a战斗已全部完成，已在最后存档点恢复；未扣机会，返回首室结算即可。":"§e【存档点续关】本场第"+r.failures+"次战败，剩余"+(MAX_FAILURES-r.failures)+"次机会；已回第"+r.checkpointRoom+"室存档点，10秒后可继续当前段。已清房间保留，不必跑回主城；背包装备保留。");
            }catch(RuntimeException failure){r.fault="data_unavailable";r.pauseReason="runtime_error";r.pausedAt=System.currentTimeMillis();plugin.getLogger().log(java.util.logging.Level.WARNING,"Checkpoint return paused: "+r.site.id,failure);notice(r,"§c续关结果暂不可确认，场次保留，先查询 dungeon status；不要重复开场，请联系服主。");}
        });});
    }
    private boolean bossLocked(Run r){return r.stage==r.site.rooms.size()-1&&Set.of("moving","fighting","retrying").contains(r.phase);}
    private boolean bossRoom(Run r,Location at){return at.getWorld()!=null&&at.getWorld().getName().equals(r.site.world)&&r.site.rooms.getLast().contains(at);}
    private boolean roomVisitor(Player p){return plugin.isObserver(p)||p.getGameMode()==GameMode.SPECTATOR||p.getGameMode()==GameMode.CREATIVE&&plugin.trustedBlockEditor(p);}
    private java.util.stream.Stream<Player> bossIntruders(Run r){return Bukkit.getWorld(r.site.world).getPlayers().stream().filter(p->!roomVisitor(p)&&!r.party.contains(p.getUniqueId())&&bossRoom(r,p.getLocation()));}
    private void lockHint(Player p,String text){long now=System.currentTimeMillis();if(now-lockHints.getOrDefault(p.getUniqueId(),0L)<5000)return;lockHints.put(p.getUniqueId(),now);p.sendMessage("§e[boss_room_locked] "+text+" 可改选其他地点：/mycli dungeon list");}
    private void guardBoss(PlayerMoveEvent e){
        Player p=e.getPlayer();Location to=e.getTo();if(to==null||roomVisitor(p))return;
        for(Run r:runs.values())if(bossLocked(r)&&!r.party.contains(p.getUniqueId())&&bossRoom(r,to)&&!bossRoom(r,e.getFrom())){
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
            Location exit=r.site.rooms.getFirst().center(Bukkit.getWorld(r.site.world));
            if(bossRoom(r,exit))exit=p.getWorld().getSpawnLocation();
            Location target=exit;
            target.getWorld().getChunkAtAsync(target.getBlockX()>>4,target.getBlockZ()>>4).thenRun(()->{if(plugin.isEnabled())Bukkit.getScheduler().runTask(plugin,()->{
                if(!p.isOnline()||runs.get(r.site.id)!=r||!bossLocked(r)||r.party.contains(p.getUniqueId())||!bossRoom(r,p.getLocation()))return;
                for(int y=0;y<=3;y++)for(int x=-2;x<=2;x++)for(int z=-2;z<=2;z++){
                    Location at=target.clone().add(x,y,z);if(!at.getWorld().isChunkLoaded(at.getBlockX()>>4,at.getBlockZ()>>4)||bossRoom(r,at)||!AgentFriendPlugin.safeLanding(at.getBlock()))continue;
                    if(p.teleport(at))lockHint(p,"登录位置属于其他队伍占用的Boss房间，已移至入口安全处。");return;
                }
                lockHint(p,"当前位置属于另一队Boss房间，请先退出门外；不能参与本场攻击。");
            });});return;
        }
    }
    @EventHandler public void forgetRoomHint(PlayerQuitEvent e){lockHints.remove(e.getPlayer().getUniqueId());}
    private boolean playing(Player p){return p!=null&&p.isOnline()&&!p.isDead()&&p.getGameMode()==GameMode.SURVIVAL;}
    private List<Player> present(Run r){return r.party.stream().map(Bukkit::getPlayer).filter(this::playing).filter(p->r.site.contains(p.getLocation())).toList();}
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
        if(jsonOutput.get()){p.sendMessage(prefix+" "+JSON.toJson(data));return;}
        if(prefix.equals("MC_SITE_DUNGEON_ITEM")){
            var prep=DungeonAdvice.preparation(site.id,site.minimumLevel);
            p.sendMessage("[地下城] "+site.name+" ("+site.id+") · "+DungeonAdvice.label(guide.get("state").toString())+" · 普通"+prep.stars()+"/5星，建议战斗Lv."+prep.recommendedLevel()+"；详情：/mycli dungeon info "+site.id);return;
        }
        if(prefix.equals("MC_SITE_DUNGEON_LIST")){p.sendMessage("[提示] 空闲需本人到首室 start；active=false不是未开放。详情用 info <ID>，状态用 status <ID>。" );return;}
        if(prefix.equals("MC_SITE_DUNGEON_RESULT")){
            boolean success=Boolean.TRUE.equals(fields.get("success"));String action=Objects.toString(fields.get("action"),"");
            String done=switch(action){case "start"->"已开启本次集结";case "join"->"已加入本次队伍";case "claim"->"奖励结算已保存";case "travel"->"已到入口";case "resume"->"已处理恢复请求";case "leave"->"已退出本次场次";default->"操作已完成";};
            p.sendMessage("[地下城] "+(success?done:Objects.toString(fields.get("errorMessage"),"操作未完成"))+"（"+fields.get("reason")+"）。");
            if(!success&&!guide.isEmpty()&&Set.of("walk_to_first_room","site_busy","site_cooldown","muster_closed","claim_previous_reward_first","conquest_profession_required","conquest_level_required","previous_floor_required").contains(fields.get("reason"))){p.sendMessage("下一步："+guide.get("nextAction")+" 命令："+guide.get("nextCommand"));}
            return;
        }
        if(prefix.equals("MC_SITE_DUNGEON_STATE")&&!Boolean.TRUE.equals(fields.get("participant"))){
            if("ended".equals(fields.get("lifecycle")))p.sendMessage("[地下城] 本人上场已结束（"+endLabel(Objects.toString(fields.get("endReason")))+"）；存档点救援已失效。存活者留在原地，请沿原路及时撤离。查询：/mycli dungeon status"+(site==null?"":" "+site.id));
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
        if(advice!=null){data.put("errorMessage",advice.message());data.put("nextAction",advice.next());data.put("nextCommands",advice.commands());}
        if(reason.equals("claim_previous_reward_first"))data.put("pendingReward",pendingReward(p.getUniqueId(),site));
        data.putAll(detail);send(p,"MC_SITE_DUNGEON_RESULT",data);
        if(advice!=null&&!jsonOutput.get()&&!Set.of("walk_to_first_room","site_busy","site_cooldown","muster_closed","claim_previous_reward_first","conquest_profession_required","conquest_level_required","previous_floor_required").contains(reason))advice.send(p);
        if(reason.equals("claim_previous_reward_first"))explainPending(p,List.of(site));
        else if(reason.equals("specify_dungeon_id"))explainPending(p,pendingSites(p.getUniqueId()));
    }
    private boolean loadout(Player p,String action,Site site){
        var missing=DungeonLoadout.missing(p);if(missing.isEmpty())return true;
        send(p,"MC_SITE_DUNGEON_RESULT",Map.of("action",action,"id",site.id,"success",false,"reason","equipment_required",
            "errorMessage","未满足入场战备，缺少："+String.join("、",missing),"missingEquipment",missing,
            "nextAction","穿齐四件护甲，并携带可用战斗装备；近战、弓弩、法杖、圣典等均可，不强制带剑。", "nextCommand","/mycli guild shared"));
        if(!jsonOutput.get())p.sendMessage("[战备] 穿齐四件护甲，带上可用战斗装备，再开场或加入；法器须为本人职业可用的真实装备。公共补给：/mycli guild shared");
        return false;
    }
    private void tell(Run r,String message){for(UUID id:r.party){Player p=Bukkit.getPlayer(id);if(p!=null)p.sendMessage("§6【"+label(r.site)+"·"+r.site.name+"】§r "+message);}}
    private void notice(Run r,String message){
        tell(r,message);
        for(UUID id:r.party){Player p=Bukkit.getPlayer(id);if(p!=null)p.sendActionBar(net.kyori.adventure.text.Component.text(ChatColor.stripColor(message)));}
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
        case "completed"->"全部房间已清理并完成返程结算";case "party_defeated"->"全队倒地，挑战失败";case "attempts_exhausted"->"本场已战败3次，机会用尽，挑战结束";
        case "party_left"->"最后一名队员主动退出";case "member_left"->"本人主动退出队伍";
        case "time_limit"->"超过30分钟时限";case "return_grace_expired"->"全队离场或离线超过5分钟";
        case "missing_or_unloaded_enemy_retry_required"->"标记敌人异常消失，本室不能当作击杀通关";
        default->reason;
    };}
    private String rewardStatus(Run r,UUID id,String reason){
        var pending=receipt(id,r.site.id);
        if(pending!=null&&r.id.equals(pending.getString("run")))return "ready";
        if(r.id.equals(plugin.getConfig().getString(ROOT+".claimed-runs."+id+"."+r.site.id)))return "claimed";
        if(!reason.equals("completed"))return "run_incomplete";
        if(r.attendance.getOrDefault(id,0)<r.site.rooms.size())return "missing_participation";
        if(day().equals(plugin.getConfig().getString(ROOT+".claimed."+id+"."+r.site.id)))return "daily_limit";
        return "not_returned";
    }
    private Map<String,Object> outcome(Run r,UUID id,String reason){
        Map<String,Object> data=new LinkedHashMap<>(attendanceState(r,id));String reward=rewardStatus(r,id,reason);
        data.put("id",r.site.id);data.put("name",r.site.name);data.put("run",r.id);data.put("reason",reason);data.put("endedAt",System.currentTimeMillis());
        data.put("startedAt",r.started);data.put("clearedRooms",r.stage);data.put("difficulty",r.mode.id);data.put("rewardStatus",reward);
        data.putAll(checkpointState(r));
        data.put("lifecycle","ended");data.put("active",false);data.put("participant",false);data.put("rescueActive",false);data.put("exitPolicy","standing_stay_downed_recover");
        data.put("resets",r.resets);data.put("lastResetReason",r.lastResetReason);
        data.put("nextAction",reward.equals("ready")?"用 /mycli dungeon claim "+r.site.id+"领取；奖励进入个人箱":reward.equals("claimed")?"用 /mycli arena rewards 查看奖励，/mycli arena stash 打开个人箱":"查询 /mycli dungeon info "+r.site.id+"，冷却结束后重新组队；每室实际参战并返回首室");
        data.put("nextCommands",reward.equals("claimed")?List.of("/mycli arena rewards","/mycli arena stash"):List.of(reward.equals("ready")?"/mycli dungeon claim "+r.site.id:"/mycli dungeon info "+r.site.id));return data;
    }
    private void saveOutcome(UUID id,String site,Map<String,Object> data){
        String path=ROOT+".outcomes."+id+"."+site;plugin.getConfig().set(path,null);plugin.getConfig().createSection(path,data);
    }
    private Map<String,Object> lastOutcome(UUID id,String site){
        var root=plugin.getConfig().getConfigurationSection(ROOT+".outcomes."+id);if(root==null)return Map.of();
        ConfigurationSection chosen=site.isEmpty()?root.getKeys(false).stream().map(root::getConfigurationSection).filter(Objects::nonNull).max(Comparator.comparingLong(c->c.getLong("endedAt"))).orElse(null):root.getConfigurationSection(site);
        if(chosen==null)return Map.of();
        Map<String,Object> data=new LinkedHashMap<>(chosen.getValues(false));
        data.put("lifecycle","ended");data.put("active",false);data.put("participant",false);data.put("rescueActive",false);data.put("exitPolicy","standing_stay_downed_recover");return data;
    }
    private void explainOutcome(Player p,Map<String,Object> data){
        String reward=Objects.toString(data.get("rewardStatus"),"run_incomplete");
        String detail=switch(reward){case "ready"->"已生成待领奖凭据";case "claimed"->"本轮奖励已领取到个人箱";case "daily_limit"->"今日该处已经领奖，重复挑战不再发奖";case "missing_participation"->"参战登记不足，未生成凭据";case "not_returned"->"未完成返程登记，未生成凭据";default->"本轮未完成，未生成新凭据";};
        Site site=sites.get(Objects.toString(data.get("id"),""));p.sendMessage("§e【"+(site==null?"遗迹远征":label(site))+"·结算】"+Objects.toString(data.get("name"),data.get("id").toString())+"："+endLabel(Objects.toString(data.get("reason")))+"；"+detail+"（参战 "+data.get("attendance")+"/"+data.get("requiredRooms")+"）。");
        if(data.get("missingRooms") instanceof List<?> missing&&!missing.isEmpty())p.sendMessage("§e缺席房间："+String.join("、",missing.stream().map(Object::toString).toList())+"。");
        p.sendMessage("§a下一步："+data.get("nextAction"));
    }
    private Site site(String id){Site s=sites.get(id);require(s!=null,"unknown_dungeon");return s;}
    private String reload(){
        if(hasActiveRuns())return "active_runs";
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
                    rooms.add(new Room(Objects.toString(row.get("name"),"战斗室"),x,y,z,radius,enemies,List.copyOf(spawnPoints)));
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
            Map<String,BuildingAreas> areas=new LinkedHashMap<>();
            for(Site s:next.values()){
                World world=Bukkit.getWorld(s.world);List<ProtectionArea> pieces=new ArrayList<>();
                pieces.add(ProtectionArea.box("site_dungeon_"+s.id,"副本建筑·"+s.name,world,
                    s.rooms.stream().mapToInt(Room::x).min().orElseThrow()-24,s.rooms.stream().mapToInt(Room::y).min().orElseThrow()-8,s.rooms.stream().mapToInt(Room::z).min().orElseThrow()-24,
                    s.rooms.stream().mapToInt(Room::x).max().orElseThrow()+24,s.rooms.stream().mapToInt(Room::y).max().orElseThrow()+12,s.rooms.stream().mapToInt(Room::z).max().orElseThrow()+24));
                var declared=defs.getConfigurationSection(s.id).getList("protection-boxes",List.of());require(declared.size()<=256,"protection_boxes_limit_256");
                for(Object raw:declared){
                    require(raw instanceof List<?> b&&b.size()==6,"invalid_protection_box");List<?> b=(List<?>)raw;int[] v=new int[6];
                    for(int i=0;i<6;i++){require(b.get(i) instanceof Number n&&n.doubleValue()==n.intValue(),"integer_protection_box_required");v[i]=((Number)b.get(i)).intValue();}
                    require(v[0]<=v[3]&&v[1]<=v[4]&&v[2]<=v[5]&&v[1]>=world.getMinHeight()&&v[4]<world.getMaxHeight(),"protection_box_bounds");
                    Room first=s.rooms.getFirst();require(Math.abs((long)v[0]-first.x)<=256&&Math.abs((long)v[3]-first.x)<=256&&Math.abs((long)v[2]-first.z)<=256&&Math.abs((long)v[5]-first.z)<=256,"protection_box_distance");
                    pieces.add(ProtectionArea.box("site_dungeon_"+s.id+"_building_"+pieces.size(),"副本建筑·"+s.name,world,v[0],v[1],v[2],v[3],v[4],v[5]));
                }
                var envelope=ProtectionArea.box("site_dungeon_"+s.id+"_envelope","副本建筑·"+s.name,world,
                    pieces.stream().mapToInt(ProtectionArea::minX).min().orElseThrow(),pieces.stream().mapToInt(ProtectionArea::minY).min().orElseThrow(),pieces.stream().mapToInt(ProtectionArea::minZ).min().orElseThrow(),
                    pieces.stream().mapToInt(ProtectionArea::maxX).max().orElseThrow(),pieces.stream().mapToInt(ProtectionArea::maxY).max().orElseThrow(),pieces.stream().mapToInt(ProtectionArea::maxZ).max().orElseThrow());
                areas.put(s.id,new BuildingAreas(envelope,List.copyOf(pieces)));
            }
            sites=Collections.unmodifiableMap(next);protectionAreas=Collections.unmodifiableMap(areas);ready=true;return "success";
        }catch(Exception e){plugin.getLogger().warning("Dungeon sites configuration retained: "+e.getMessage());return "invalid_configuration";}
    }
    void admin(CommandSender sender,String action){
        if(action.equals("reload"))sender.sendMessage("MC_SITE_DUNGEON_ADMIN status="+reload());
        audit(sender);
    }
    void audit(CommandSender sender){
        sender.sendMessage("MC_SITE_DUNGEON_AUDIT ready="+ready+" sites="+sites.size()+" activeRuns="+runs.size()+" trackedMobs="+runs.values().stream().mapToInt(r->r.mobs.size()).sum()+" globalMobLimit="+GLOBAL_MOBS+" trackedProjectiles="+shots.size()+" projectileLimit=128");
        for(Site s:sites.values()){Run r=runs.get(s.id);sender.sendMessage("MC_SITE_DUNGEON_SITE id="+s.id+" rooms="+s.rooms.size()+" active="+(r!=null)+" stage="+(r==null?0:r.stage+1)+" phase="+(r==null?"idle":r.phase)+" party="+(r==null?0:r.party.size()));}
        for(Run r:runs.values())for(UUID id:r.mobs.keySet()){Entity e=Bukkit.getEntity(id);if(e instanceof Mob m)sender.sendMessage("MC_SITE_DUNGEON_MOB site="+r.site.id+" id="+id+" type="+m.getType()+" health="+m.getHealth()+" target="+(m.getTarget()==null?"none":m.getTarget().getUniqueId())+" x="+m.getLocation().getBlockX()+" y="+m.getLocation().getBlockY()+" z="+m.getLocation().getBlockZ());}
    }
    void command(Player p,String[] raw){
        DungeonAdvice.Request request;
        try{request=DungeonAdvice.parse(raw);}catch(IllegalArgumentException e){
            String next=e instanceof DungeonAdvice.Usage usage?usage.nextCommand:"/mycli dungeon --help";
            if(Arrays.asList(raw).contains("--json"))p.sendMessage("MC_SITE_DUNGEON_RESULT "+JSON.toJson(Map.of("schemaVersion",1,"success",false,"changed",false,"reason","INVALID_ARGUMENT","errorMessage",e.getMessage(),"retryable",false,"nextCommand",next)));
            else p.sendMessage("[地下城] 未执行（INVALID_ARGUMENT）："+e.getMessage()+"。命令："+next);return;
        }
        format(request.json(),request.verbose(),()->execute(p,request.args(),request.page()));
    }
    private void format(boolean json,boolean verbose,Runnable work){
        boolean beforeJson=jsonOutput.get(),beforeVerbose=verboseOutput.get();jsonOutput.set(json);verboseOutput.set(verbose);
        try{work.run();}finally{jsonOutput.set(beforeJson);verboseOutput.set(beforeVerbose);}
    }
    private void execute(Player p,String[] args,int page){
        String action=args.length>1?args[1].toLowerCase(Locale.ROOT):"list",id=args.length>2?args[2]:"";
        if(verboseOutput.get()&&!jsonOutput.get()&&Set.of("list","info","status").contains(action))p.sendMessage("[提示] dungeon为真实遗迹；arena为练习塔。逐室清怪后回首室结算，奖励进入个人箱。");
        try{
            require(ready,"configuration_unavailable");
            switch(action){
                case "list"->listing(p,page);
                case "menu"->open(p,"");
                case "info"->info(p,site(id));
                case "travel"->travel(p,site(id));
                case "start"->start(p,site(id),Mode.parse(args.length>3?args[3]:"normal"));
                case "join"->join(p,site(id));
                case "status"->status(p,id);
                case "resume"->{Run r=own(p);require(r!=null&&!r.fault.isEmpty(),"not_fault_paused");resume(r);result(p,"resume",r.site.id,"success");p.sendMessage("§a原地下城场次已恢复，已清进度保留；5分钟内返回目标房间。查询：/mycli dungeon status "+r.site.id);}
                case "leave"->leave(p);
                case "claim"->claim(p,id);
                default->throw new IllegalArgumentException("use_list_info_travel_start_join_status_resume_leave_claim_menu");
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
        if(jsonOutput.get())summary.put("items",items);
        if(first+7<rows.size())summary.put("nextCommand","/mycli dungeon list --page "+(page+1));
        send(p,"MC_SITE_DUNGEON_LIST",summary);
    }
    private void info(Player p,Site s){
        Room first=s.rooms.getFirst();send(p,"MC_SITE_DUNGEON_INFO",Map.of("id",s.id,"name",s.name,"world",s.world,"start",List.of(first.x,first.y,first.z),"rooms",s.rooms.stream().map(r->Map.of("name",r.name,"center",List.of(r.x,r.y,r.z),"radius",r.radius,"enemies",r.enemies.size())).toList(),"hint",s.hint,"dailyRewardPerSite",1,"approachMana",8,"lifecycleRules",Map.of("timeLimitSeconds",TIMEOUT_MS/1000,"rescueScope","current_run_and_site","exitPolicy","standing_stay_downed_recover","instruction","有效场次且身处范围内才有存档点救援；超时、结束或退出后失效，存活者留在原地须及时撤离。")));
        if(verboseOutput.get()&&!jsonOutput.get())p.sendMessage("[路线] "+s.hint+"；逐室清怪，最后返回首室领取结算。普通/冒险/末日的生命倍率为1/1.5/2.1，伤害倍率为1/1.25/1.6；队友在10秒集结期主动加入。");
    }
    private void travel(Player p,Site s){
        require(own(p)==null,"already_in_site_dungeon");
        require(playing(p)&&!plugin.dungeonParticipant(p)&&!plugin.pvpParticipant(p),"already_in_activity_or_not_survival");
        if(s.entry.isEmpty()){require(!jsonOutput.get(),"legacy_travel_format_unavailable");new DungeonExpeditions(plugin).travel(p,s.expedition);return;}
        World w=Bukkit.getWorld(s.world);int x=s.entry.get(0),y=s.entry.get(1),z=s.entry.get(2);
        require(w.isChunkGenerated(x>>4,z>>4),"entry_not_generated");Location origin=p.getLocation().clone();
        boolean requestedJson=jsonOutput.get(),requestedVerbose=verboseOutput.get();
        w.getChunkAtAsync(x>>4,z>>4,false).whenComplete((chunk,error)->Bukkit.getScheduler().runTask(plugin,()->format(requestedJson,requestedVerbose,()->{
            if(!p.isOnline())return;
            if(error!=null||chunk==null){result(p,"travel",s.id,"entry_unavailable");return;}
            if(!playing(p)||own(p)!=null||plugin.dungeonParticipant(p)||plugin.pvpParticipant(p)||p.getWorld()!=origin.getWorld()||p.getLocation().distanceSquared(origin)>4){result(p,"travel",s.id,"player_state_changed");return;}
            Location landing=null;
            for(int dx=-2;dx<=2&&landing==null;dx++)for(int dz=-2;dz<=2;dz++){
                int px=x+dx,pz=z+dz;if(!w.isChunkLoaded(px>>4,pz>>4))continue;
                Location at=new Location(w,px+.5,y,pz+.5);
                if(AgentFriendPlugin.safeLanding(w.getBlockAt(px,y,pz))&&w.getNearbyEntities(at,.7,1,.7).isEmpty()){landing=at;break;}
            }
            if(landing==null){result(p,"travel",s.id,"entry_blocked");return;}
            if(plugin.travelMagic().teleport(p,landing,"dungeon:"+s.id,"遗迹入口传送术",TravelMagic.DISTANT_MANA)){result(p,"travel",s.id,"success");p.sendMessage("§6已到"+label(s)+"入口；仍须主动 start、分段清怪并返回首处集结点才能领取奖励。");}
            else result(p,"travel",s.id,"travel_denied");
        })));
    }
    private void start(Player p,Site s,Mode mode){
        conquestAdmission(p,s);
        require(own(p)==null,"already_in_site_dungeon");
        require(playing(p)&&!plugin.dungeonParticipant(p)&&!plugin.pvpParticipant(p),"already_in_activity_or_not_survival");
        require(s.contains(p.getLocation())&&s.rooms.getFirst().contains(p.getLocation()),"walk_to_first_room");
        require(!runs.containsKey(s.id),"site_busy");require(receipt(p.getUniqueId(),s.id)==null,"claim_previous_reward_first");
        require(System.currentTimeMillis()-plugin.getConfig().getLong(ROOT+".cooldowns."+s.id,0)>=120_000,"site_cooldown");
        require(receiptCount()<1024,"pending_receipt_capacity");
        if(!loadout(p,"start",s))return;
        List<Player> entrants=new ArrayList<>();entrants.add(p);
        if(plugin.nativeRpg().selected()){
            var team=plugin.nativeRpg().party(p);
            require(team.has("available")&&team.get("available").getAsBoolean(),"party_data_unavailable");
            if(team.has("members")&&team.getAsJsonArray("members").size()>1){
                require(p.getUniqueId().toString().equals(team.get("leaderUuid").getAsString()),"party_leader_required");
                require(team.getAsJsonArray("members").size()<=PARTY_LIMIT,"party_full_or_not_at_first_room");
                entrants.clear();
                for(var member:team.getAsJsonArray("members")){
                    Player mate=Bukkit.getPlayer(UUID.fromString(member.getAsString()));
                    if(!playing(mate)||!s.contains(mate.getLocation())||!s.rooms.getFirst().contains(mate.getLocation())
                            ||own(mate)!=null||plugin.dungeonParticipant(mate)||plugin.pvpParticipant(mate)){
                        String who=mate==null?Objects.toString(Bukkit.getOfflinePlayer(UUID.fromString(member.getAsString())).getName(),"离线队员"):mate.getName();
                        result(p,"start",s.id,"party_not_ready",Map.of("blockedPlayer",who,"errorMessage","队友 "+who+" 尚未就绪；全队须在线、结束其他活动并到首室 "+s.world+" "+s.rooms.getFirst().x+","+s.rooms.getFirst().y+","+s.rooms.getFirst().z+"。未开场、未消耗。"));return;
                    }
                    try{conquestAdmission(mate,s);}catch(IllegalArgumentException admission){
                        result(p,"start",s.id,admission.getMessage(),Map.of("blockedPlayer",mate.getName(),"errorMessage","队友 "+mate.getName()+" 不满足本层职业或等级条件（"+admission.getMessage()+"），全队未开场。"));return;
                    }
                    require(receipt(mate.getUniqueId(),s.id)==null,"party_pending_reward");
                    if(!loadout(mate,"start",s)){if(mate!=p)result(p,"start",s.id,"party_not_ready",Map.of("blockedPlayer",mate.getName(),"missingEquipment",DungeonLoadout.missing(mate),"errorMessage","队友 "+mate.getName()+" 装备不足："+String.join("、",DungeonLoadout.missing(mate))+"。全队未开场、未消耗。"));return;}
                    entrants.add(mate);
                }
            }
        }
        Run r=new Run(s,mode);r.checkpoint=p.getLocation().clone();for(Player mate:entrants){r.party.add(mate.getUniqueId());r.attendance.put(mate.getUniqueId(),0);}runs.put(s.id,r);
        try{persist();}catch(RuntimeException failure){runs.remove(s.id);throw failure;}
        result(p,"start",s.id,"success");tell(r,"§6"+s.name+"〔"+mode.label+"〕10秒后开始；本场已登记 "+r.party.size()+" 人："+String.join("、",entrants.stream().map(Player::getName).toList())+"。"+(r.party.size()>1?"致命伤害先倒地，队友靠近4格停留10秒救援，清室也可复活。":"当前单人场次。")+" 单人或全队战败自动返回存档点，整场共3次机会，第三次战败才结束；已清房间保留，Boss房间排他。时限30分钟，结束后救援失效、存活者原地保留须撤离。掉线宽限5分钟，故障和断线不扣次数。");
    }
    private void join(Player p,Site s){
        conquestAdmission(p,s);
        Run r=runs.get(s.id);require(r!=null&&r.phase.equals("muster")&&System.currentTimeMillis()<r.readyAt,"muster_closed");
        require(own(p)==null,"already_in_site_dungeon");
        require(playing(p)&&!plugin.dungeonParticipant(p)&&!plugin.pvpParticipant(p),"already_in_activity_or_not_survival");
        require(r.party.size()<PARTY_LIMIT&&s.contains(p.getLocation())&&s.rooms.getFirst().contains(p.getLocation()),"party_full_or_not_at_first_room");
        require(receipt(p.getUniqueId(),s.id)==null,"claim_previous_reward_first");
        if(!loadout(p,"join",s))return;
        r.party.add(p.getUniqueId());r.attendance.put(p.getUniqueId(),0);
        try{persist();}catch(RuntimeException failure){r.party.remove(p.getUniqueId());r.attendance.remove(p.getUniqueId());throw failure;}
        result(p,"join",s.id,"success");
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
        fields.putAll(attendanceState(r,p.getUniqueId()));fields.put("attempt",r.attempt);fields.put("resets",r.resets);fields.put("pauseReason",r.pauseReason);fields.put("lastResetReason",r.lastResetReason);fields.put("lastResetAt",r.lastResetAt);
        fields.putAll(checkpointState(r));fields.put("bossRoomLocked",bossLocked(r));
        fields.put("faultPausedMillis",r.faultPausedMillis);fields.put("resumable",r.party.contains(p.getUniqueId())&&!r.fault.isEmpty());
        fields.put("nextCommand",r.party.contains(p.getUniqueId())&&!r.fault.isEmpty()?"/mycli dungeon resume":"/mycli dungeon status "+r.site.id);
        List<String> pending=pendingSites(p.getUniqueId());fields.put("pendingRewards",pending);
        fields.put("pendingRewardDetails",pending.stream().map(s->pendingReward(p.getUniqueId(),s)).toList());
        fields.put("combatBounds",Map.of("world",r.site.world,"min",List.of(target.x+.5-target.radius-2,target.y-3,target.z+.5-target.radius-2),"max",List.of(target.x+.5+target.radius+2,target.y+3,target.z+.5+target.radius+2)));
        Map<String,Object> previousOutcome=r.party.contains(p.getUniqueId())?Map.of():lastOutcome(p.getUniqueId(),r.site.id);
        lifecycle(fields,r,p,previousOutcome);
        if(!r.party.contains(p.getUniqueId())){fields.put("lastOutcome",previousOutcome);fields.put("outcomeKnown",!previousOutcome.isEmpty());}
        send(p,"MC_SITE_DUNGEON_STATE",fields);
        if(!verboseOutput.get())return;
        explainPending(p,pending);
        if(r.party.contains(p.getUniqueId())){
            p.sendMessage("§b【"+label(r.site)+"】"+r.site.name+" · "+target.name+"；参战登记 "+r.attendance.getOrDefault(p.getUniqueId(),0)+"/"+r.site.rooms.size()+"，"+(r.phase.equals("returning")?"请返回首处集结点结算":"本段"+(r.roomParticipants.contains(p.getUniqueId())?"已记录":"尚未记录"))+"。"+(!r.fault.isEmpty()?"故障暂停，等待不计挑战时限；准备好后本人用 /mycli dungeon resume，恢复后5分钟内回场。":r.pausedAt>0?"暂停："+pauseLabel(r.pauseReason)+"；5分钟内回场，未清段落重刷。":""));
            if(!missingRooms(r,p.getUniqueId()).isEmpty())p.sendMessage("§e缺席房间："+String.join("、",missingRooms(r,p.getUniqueId()))+"；本轮不能领取完整奖励，可继续练习或正常退出后重新挑战。");
            if(!unverifiedRooms(r).isEmpty())p.sendMessage("§7旧版房间明细未保存，保留原登记数量，不推断缺席房间。本人当前总数以回执 attendance 为准。");
        }else if(!previousOutcome.isEmpty()){p.sendMessage("§7该地点有其他队伍正在挑战；以下是你本人最近一次结果。");explainOutcome(p,previousOutcome);}
    }
    private void leave(Player p){
        Run r=own(p);require(r!=null,"not_participating");int count=r.attendance.getOrDefault(p.getUniqueId(),0);
        if(r.party.size()==1)end(r,"party_left");else{
            Map<String,Object> outcome=outcome(r,p.getUniqueId(),"member_left");
            r.party.remove(p.getUniqueId());r.attendance.remove(p.getUniqueId());
            try{persist(()->saveOutcome(p.getUniqueId(),r.site.id,outcome));}catch(RuntimeException e){r.party.add(p.getUniqueId());r.attendance.put(p.getUniqueId(),count);throw e;}
            r.roomParticipants.remove(p.getUniqueId());explainOutcome(p,outcome);
        }
        result(p,"leave",r.site.id,"success");p.sendMessage("§e已退出"+label(r.site)+"，本场存档点救援已失效；留在原地，请沿原路及时撤离。若要回村：/mycli cast home，成功耗6魔力；先核对 /mycli status。");
    }
    private int receiptCount(){var c=plugin.getConfig().getConfigurationSection(ROOT+".receipts");if(c==null)return 0;int total=0;for(String owner:c.getKeys(false)){var section=c.getConfigurationSection(owner);if(section!=null)total+=section.getKeys(false).size();}return total;}
    private ConfigurationSection receipt(UUID id,String site){return plugin.getConfig().getConfigurationSection(ROOT+".receipts."+id+"."+site);}
    private List<String> pendingSites(UUID id){var c=plugin.getConfig().getConfigurationSection(ROOT+".receipts."+id);return c==null?List.of():new ArrayList<>(c.getKeys(false));}
    private Map<String,Object> pendingReward(UUID owner,String id){
        var saved=receipt(owner,id);if(saved==null)return Map.of();Site s=sites.get(id);
        Map<String,Object> data=new LinkedHashMap<>();data.put("id",id);data.put("name",s==null?id:s.name);if(s!=null){data.put("activityLabel",label(s));data.put("setting",s.outdoor?"outdoor":"interior");}
        data.put("status","ready");data.put("run",saved.getString("run",""));data.put("day",saved.getString("day",""));
        data.put("emeralds",saved.getInt("emeralds"));data.put("item",saved.getString("item",""));data.put("count",saved.getInt("count"));
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
        atomic(()->{
            require(plugin.dungeon().queueGuildRewards(p.getUniqueId(),receipt.getInt("emeralds"),Material.valueOf(receipt.getString("item")),receipt.getInt("count")),"personal_reward_queue_full");
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
        result(p,"claim",chosen,"success");p.sendMessage("§a"+(sites.containsKey(chosen)?label(sites.get(chosen)):"遗迹远征")+"奖励已保存到待入箱队列；打开个人箱时装入，箱满会保留。命令：/mycli arena stash；只查待入箱奖励：/mycli arena rewards list。重复领取不会再次发奖。");
    }
    private void tick(){
        long timestamp=System.currentTimeMillis();
        for(var entry:new ArrayList<>(shots.entrySet())){Entity e=Bukkit.getEntity(entry.getKey());if(e==null||!e.isValid()||timestamp>=entry.getValue().expires){if(e!=null)e.remove();shots.remove(entry.getKey());}}
        for(Run r:new ArrayList<>(runs.values())){
        if(!r.fault.isEmpty()){
            // Only the initial, uncredited muster transition may retry itself.
            // No award, item consumption or fighting transition is replayed.
            if(r.storageRetryAt>0&&timestamp>=r.storageRetryAt){
                r.storageRetryAt=0;r.storageRetryAttempts++;
                try{resume(r);notice(r,"§a【"+label(r.site)+"】存档已恢复，继续原场次；未新增奖励或重开场次。");}
                catch(RuntimeException failure){
                    if(failure instanceof StorageUnavailable&&r.storageRetryAttempts<2)r.storageRetryAt=timestamp+1000;
                    else notice(r,"§c【"+label(r.site)+"】存档仍不可用，原场次保留。请联系服主；恢复后本人用 /mycli dungeon resume。");
                }
            }
            continue;
        }
        int previousStage=r.stage,previousCheckpointRoom=r.checkpointRoom;Location previousCheckpoint=r.checkpoint;String previousPhase=r.phase;Map<UUID,Integer> previousAttendance=new HashMap<>(r.attendance);
        Map<Integer,Set<UUID>> previousRoomAttendance=new LinkedHashMap<>(r.roomAttendance);
        try{
            long now=System.currentTimeMillis();if(activeMillis(r.started,r.faultPausedMillis,now)>TIMEOUT_MS){end(r,"time_limit");continue;}
            List<Player> present=present(r);
            if(present.isEmpty() || present.stream().allMatch(plugin::isDowned)
                    && r.party.stream().anyMatch(id->Bukkit.getPlayer(id)==null&&plugin.trialRescue()!=null&&!plugin.trialRescue().downed(id))){
                if(r.pausedAt==0){
                    r.pausedAt=now;r.pauseReason=present.isEmpty()?(r.party.stream().noneMatch(id->playing(Bukkit.getPlayer(id)))?"all_offline":"all_outside_site"):"waiting_for_teammate";
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
            if(r.phase.equals("returning")){if(present.stream().anyMatch(p->r.site.rooms.getFirst().contains(p.getLocation())))complete(r);continue;}
            if(r.phase.equals("moving")){
                if(present.stream().noneMatch(p->r.room().contains(p.getLocation())))continue;
                if(bossLocked(r)&&bossIntruders(r).findAny().isPresent()){for(Player member:present)lockHint(member,"Boss房间还有非本场队员，请其退出门外；未开始本段战斗、未扣次数。");continue;}
                if(runs.values().stream().mapToInt(run->run.mobs.size()).sum()+r.room().enemies.size()>GLOBAL_MOBS)continue;
                spawn(r);continue;
            }
            if(!r.phase.equals("fighting"))continue;
            observeRoom(r);
            if(r.invalid){end(r,"missing_or_unloaded_enemy_retry_required");continue;}
            for(UUID id:new ArrayList<>(r.mobs.keySet())){
                Entity e=Bukkit.getEntity(id);if(!(e instanceof Mob mob)||!e.isValid()||mob.isDead()){r.invalid=true;continue;}
                Player nearest=present.stream().filter(p->!plugin.isDowned(p)&&r.room().contains(p.getLocation())).min(Comparator.comparingDouble(p->p.getLocation().distanceSquared(mob.getLocation()))).orElse(null);
                if(nearest!=null){mob.setTarget(nearest);if(!r.room().contains(mob.getLocation())){Location safe=safeSpots(r).stream().filter(l->l.distanceSquared(nearest.getLocation())>=9).findFirst().orElse(null);if(safe!=null)mob.teleport(safe);}}
            }
            if(r.invalid)continue;
            if(r.mobs.isEmpty()){
                if(plugin.trialRescue()!=null)plugin.trialRescue().reviveTeam(rescueKey(r),"room_cleared");
                Set<UUID> credited=new LinkedHashSet<>(r.roomParticipants);credited.retainAll(r.party);
                r.roomAttendance.put(r.stage,Set.copyOf(credited));
                for(UUID id:credited)r.attendance.merge(id,1,Integer::sum);
                String challengeContext=rescueKey(r)+":"+r.stage+":"+r.attempt;
                Set<UUID> challengePresent=present(r).stream().filter(p->r.room().contains(p.getLocation())&&credited.contains(p.getUniqueId())).map(Player::getUniqueId).collect(java.util.stream.Collectors.toSet());
                Player anchor=present.stream().filter(p->r.room().contains(p.getLocation())&&AgentFriendPlugin.safeLanding(p.getLocation().getBlock())).findFirst().orElse(null);
                if(anchor!=null){r.checkpoint=anchor.getLocation().clone();r.checkpointRoom=r.stage+1;}
                String roomName=r.room().name;clean(r);r.stage++;r.attempt=0;r.phase=r.stage==r.site.rooms.size()?"returning":"moving";persist();
                if(plugin.lifeChallenges()!=null)plugin.lifeChallenges().roomCleared(challengeContext,challengePresent);
                for(UUID id:r.party){Player p=Bukkit.getPlayer(id);if(p!=null)p.sendMessage((credited.contains(id)?"§a":"§e")+"【"+label(r.site)+"·参战登记】"+roomName+"："+(credited.contains(id)?"已记录本段参战":"本段缺席，未登记")+"；累计 "+r.attendance.getOrDefault(id,0)+"/"+r.site.rooms.size()+"。"+(credited.contains(id)?"":"继续可练习，完整奖励需重新组队挑战。"));}
                notice(r,"§a战斗室已清理；"+(r.phase.equals("returning")?"返回首室完成本次探索并登记奖励。":"步行前往下一室："+r.room().name+" "+r.room().x+","+r.room().y+","+r.room().z));
            }
        }catch(RuntimeException e){
            plugin.getLogger().log(java.util.logging.Level.WARNING,"Site dungeon paused for explicit retry: "+r.site.id+" run="+r.id+" phase="+previousPhase,e);
            clean(r);r.stage=previousStage;r.attendance.clear();r.attendance.putAll(previousAttendance);r.roomAttendance.clear();r.roomAttendance.putAll(previousRoomAttendance);
            r.checkpoint=previousCheckpoint;r.checkpointRoom=previousCheckpointRoom;
            r.phase=previousPhase.equals("fighting")?"moving":previousPhase;r.pausedAt=System.currentTimeMillis();r.pauseReason="runtime_error";
            if(previousPhase.equals("fighting")){r.resets++;r.lastResetReason="runtime_error";r.lastResetAt=r.pausedAt;}
            r.fault=Objects.toString(e.getMessage(),"runtime_error");
            if(e instanceof StorageUnavailable&&previousPhase.equals("muster")&&r.stage==0&&r.storageRetryAttempts<2)r.storageRetryAt=r.pausedAt+1000;
            try{persist();}catch(RuntimeException save){plugin.getLogger().log(java.util.logging.Level.WARNING,"Site dungeon fault checkpoint not saved: "+r.site.id,save);}
            notice(r,"§c"+label(r.site)+"已暂停："+faultHint(r)+"。本段未结算，故障等待不计挑战时限；解决后 /mycli dungeon resume 重试，或 /mycli dungeon leave 退出。");
        }
        }
    }
    static long activeMillis(long started,long faultPausedMillis,long now){return Math.max(0,now-started-faultPausedMillis);}
    private void resume(Run r){
        String fault=r.fault,reason=r.pauseReason;long paused=r.pausedAt,excluded=r.faultPausedMillis;
        long now=System.currentTimeMillis();
        r.faultPausedMillis+=Math.max(0,now-Math.max(r.started,paused));
        r.fault="";r.pausedAt=now;r.pauseReason="recovery_return";
        try{persist();}catch(RuntimeException failure){r.fault=fault;r.pausedAt=paused;r.pauseReason=reason;r.faultPausedMillis=excluded;throw failure;}
        r.storageRetryAt=0;
    }
    private String faultHint(Run r){
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
            if(feet.isLiquid()||head.isLiquid()||floor.getType().name().endsWith("_LEAVES")||floor.getType().name().endsWith("_SLAB")||floor.getType().name().endsWith("_STAIRS"))continue;
            Location at=new Location(w,x+.5,y,z+.5);
            double clearance=room.radius<=3?4:9;
            if(present.stream().noneMatch(p->p.getLocation().distanceSquared(at)<clearance))spots.add(at);
        }
        return spots;
    }
    private void spawn(Run r){
        World w=Bukkit.getWorld(r.site.world);Room room=r.room();List<Location> spots=safeSpots(r);
        require(spots.size()>=room.enemies.size(),room.spawnPoints.isEmpty()?"room_blocked_clear_floor_and_retry":"camp_spawn_points_obstructed");Collections.shuffle(spots);
        try{
            for(int i=0;i<room.enemies.size();i++){
                var spec=room.enemies.get(i);Location at=spots.get(i);Chunk chunk=at.getChunk();if(r.held.add(chunk))chunk.addPluginChunkTicket(plugin);
                Mob mob=spec.spawn(at,r.mode!=Mode.NORMAL||r.site.conquestFloor>0);
                r.mobs.put(mob.getUniqueId(),spec);
                mob.addScoreboardTag(TAG);mob.addScoreboardTag("afu_site_"+r.site.id);spec.equip(mob,r.mode.health*(1+Math.max(0,r.party.size()-1)*.2));
                String enemyName=spec.name().isEmpty()?(mob.getCustomName()==null?mob.getType().name():ChatColor.stripColor(mob.getCustomName())):spec.name();
                mob.setCustomName("§c"+r.site.name+" · "+enemyName);mob.setCustomNameVisible(true);
                r.mobs.put(mob.getUniqueId(),spec);
            }
            r.phase="fighting";r.invalid=false;r.attempt++;observeRoom(r);persist();notice(r,"§c"+room.name+"："+room.enemies.size()+"个标记敌人（本室第"+r.attempt+"次出怪）。在室内参战、实际命中或援助队友会记录；不要求最后一刻留在室内。");
        }catch(RuntimeException e){clean(r);r.phase="moving";throw e;}
    }
    private void complete(Run r){
        List<Player> eligible=present(r).stream().filter(p->r.site.rooms.getFirst().contains(p.getLocation())).filter(p->r.attendance.getOrDefault(p.getUniqueId(),0)==r.site.rooms.size()).toList();
        // Returning teammates may arrive separately; issue only to those physically back now.
        for(Player p:eligible){
            UUID id=p.getUniqueId();String rewardDay=day();
            if(rewardDay.equals(plugin.getConfig().getString(ROOT+".claimed."+id+"."+r.site.id))||receipt(id,r.site.id)!=null)continue;
            atomic(()->{String path=ROOT+".receipts."+id+"."+r.site.id;plugin.getConfig().createSection(path,Map.of("day",rewardDay,"run",r.id,"started-at",r.started,"emeralds",r.site.emeralds*r.mode.reward,"item",r.site.bonus.name(),"count",r.site.bonusCount*r.mode.reward));
                if(r.site.conquestFloor>0)plugin.getConfig().set(ROOT+".conquest-proofs."+id+"."+r.site.conquestFloor,r.id);
            });
            if(r.site.conquestFloor>0&&plugin.combatRpg()!=null)plugin.combatRpg().formalClear(r.id,p,r.site.conquestFloor);
            plugin.nativeSiteCompleted(p,r.site.id,r.id);
            p.sendMessage("§6"+r.site.name+"已完成；dungeon claim "+r.site.id+"领取到个人箱，今日该处仅奖励一次。");
        }
        // Keep the return phase while any eligible online teammate is still walking back.
        boolean waiting=r.party.stream().anyMatch(id->r.attendance.getOrDefault(id,0)==r.site.rooms.size()&&receipt(id,r.site.id)==null&&!day().equals(plugin.getConfig().getString(ROOT+".claimed."+id+"."+r.site.id)));
        if(!waiting)end(r,"completed");
    }
    private void clean(Run r){for(var entry:new ArrayList<>(shots.entrySet()))if(entry.getValue().run==r){Entity e=Bukkit.getEntity(entry.getKey());if(e!=null)e.remove();shots.remove(entry.getKey());}for(UUID id:r.mobs.keySet()){Entity e=Bukkit.getEntity(id);if(e!=null)e.remove();}r.mobs.clear();r.hits.clear();r.roomParticipants.clear();for(Chunk c:r.held)c.removePluginChunkTicket(plugin);r.held.clear();}
    private void end(Run r,String reason){
        Map<UUID,Map<String,Object>> outcomes=new LinkedHashMap<>();for(UUID id:r.party)outcomes.put(id,outcome(r,id,reason));
        runs.remove(r.site.id);
        try{persist(()->{
            plugin.getConfig().set(ROOT+".cooldowns."+r.site.id,System.currentTimeMillis());
            plugin.getConfig().set(ROOT+".last-outcomes."+r.site.id,null);
            plugin.getConfig().createSection(ROOT+".last-outcomes."+r.site.id,Map.of("run",r.id,"reason",reason,"endedAt",System.currentTimeMillis(),"clearedRooms",r.stage,"requiredRooms",r.site.rooms.size(),"resets",r.resets,"lastResetReason",r.lastResetReason));
            outcomes.forEach((id,data)->saveOutcome(id,r.site.id,data));
        });}catch(RuntimeException e){runs.put(r.site.id,r);throw e;}
        if(plugin.trialRescue()!=null)plugin.trialRescue().releaseTeam(rescueKey(r),r.site.rooms.getFirst().center(Bukkit.getWorld(r.site.world)));
        clean(r);notice(r,"§e【地下城结束】"+endLabel(reason)+"。本场参战与存档点救援已失效；存活者留在原地，请沿原路及时撤离。已保存结果；查询：/mycli dungeon status "+r.site.id);
        outcomes.forEach((id,data)->{Player p=Bukkit.getPlayer(id);if(p!=null)explainOutcome(p,data);});
        plugin.getLogger().info("MC_SITE_DUNGEON_END "+JSON.toJson(Map.of("site",r.site.id,"run",r.id,"reason",reason,"clearedRooms",r.stage,"endedAt",System.currentTimeMillis(),"active",false,"rescueActive",false,"exitPolicy","standing_stay_downed_recover","participants",r.party.stream().map(UUID::toString).toList())));
    }
    private void atomic(Runnable change){
        String before=plugin.getConfig().saveToString();Path file=plugin.getDataFolder().toPath().resolve("config.yml"),temp=file.resolveSibling("config.yml.site-dungeon.tmp");
        String step="change";
        try{
            change.run();step="serialize";byte[] bytes=plugin.getConfig().saveToString().getBytes(StandardCharsets.UTF_8);require(bytes.length<=16*1024*1024,"state_capacity");step="write_and_force";
            try(FileChannel out=FileChannel.open(temp,StandardOpenOption.CREATE,StandardOpenOption.TRUNCATE_EXISTING,StandardOpenOption.WRITE)){ByteBuffer b=ByteBuffer.wrap(bytes);while(b.hasRemaining())out.write(b);out.force(true);}
            step="atomic_replace";
            Files.move(temp,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
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
                Map<String,Integer> attendance=new LinkedHashMap<>();r.attendance.forEach((id,count)->attendance.put(id.toString(),count));saved.put("attendance",attendance);plugin.getConfig().createSection(path,saved);
                Map<String,List<String>> roomAttendance=new LinkedHashMap<>();r.roomAttendance.forEach((stage,ids)->roomAttendance.put(stage.toString(),ids.stream().map(UUID::toString).toList()));
                plugin.getConfig().set(path+".roomAttendance",roomAttendance);plugin.getConfig().set(path+".attempt",r.attempt);plugin.getConfig().set(path+".resets",r.resets);
                plugin.getConfig().set(path+".pauseReason",r.pauseReason);plugin.getConfig().set(path+".lastResetReason",r.lastResetReason);plugin.getConfig().set(path+".lastResetAt",r.lastResetAt);
                plugin.getConfig().set(path+".failures",r.failures);plugin.getConfig().set(path+".checkpoint",r.checkpoint);plugin.getConfig().set(path+".checkpointRoom",r.checkpointRoom);plugin.getConfig().set(path+".retryReadyAt",r.retryReadyAt);
            }
        });
    }
    private String definition(Site site){
        // Keep old interior checkpoints byte compatible. Optional presentation
        // and spawn fields are serialized only when they actually alter rules.
        var value=JSON.toJsonTree(site).getAsJsonObject();if(!site.outdoor)value.remove("outdoor");
        for(var room:value.getAsJsonArray("rooms")){var object=room.getAsJsonObject();if(object.getAsJsonArray("spawnPoints").isEmpty())object.remove("spawnPoints");}
        return JSON.toJson(value);
    }
    private void restore(){
        var saved=plugin.getConfig().getConfigurationSection(ROOT+".runs");if(saved==null)return;
        List<Run> expired=new ArrayList<>();
        for(String id:saved.getKeys(false))try{
            Site site=site(id);var c=saved.getConfigurationSection(id);Run r=new Run(site,Mode.parse(c.getString("mode","normal")));
            r.id=c.getString("id",r.id);UUID.fromString(r.id);
            require(definition(site).equals(c.getString("definition")),"definition_changed_checkpoint_preserved");
            r.stage=c.getInt("stage");require(r.stage>=0&&r.stage<=site.rooms.size(),"invalid_checkpoint");r.started=c.getLong("started");
            r.phase=r.stage==site.rooms.size()?"returning":"moving";r.fault=c.getString("fault","");r.pausedAt=c.getLong("pausedAt",System.currentTimeMillis());if(r.pausedAt==0)r.pausedAt=System.currentTimeMillis();
            r.faultPausedMillis=c.getLong("faultPausedMillis",0);require(r.faultPausedMillis>=0&&r.faultPausedMillis<=Math.max(0,System.currentTimeMillis()-r.started),"invalid_fault_pause");
            if(!r.fault.isEmpty()&&c.getString("phase","").equals("muster"))r.phase="muster";
            for(String raw:c.getStringList("party")){UUID uuid=UUID.fromString(raw);require(r.party.size()<PARTY_LIMIT,"party_limit");require(runs.values().stream().noneMatch(old->old.party.contains(uuid)),"duplicate_participant");r.party.add(uuid);r.attendance.put(uuid,c.getInt("attendance."+raw));}
            r.attempt=c.getInt("attempt");r.resets=c.getInt("resets");r.pauseReason=c.getString("pauseReason","server_restart");r.lastResetReason=c.getString("lastResetReason","");r.lastResetAt=c.getLong("lastResetAt");
            r.failures=c.getInt("failures",0);require(r.failures>=0&&r.failures<MAX_FAILURES,"invalid_retry_checkpoint");
            r.checkpoint=c.getLocation("checkpoint");r.checkpointRoom=c.getInt("checkpointRoom",1);
            require(r.checkpointRoom>=1&&r.checkpointRoom<=Math.max(1,r.stage),"invalid_retry_checkpoint");
            if(r.checkpoint!=null)require(r.site.contains(r.checkpoint),"invalid_retry_checkpoint");
            if(c.getString("phase","").equals("retrying")){r.phase="retrying";r.retryReadyAt=System.currentTimeMillis()+10_000;}
            var roomAttendance=c.getConfigurationSection("roomAttendance");
            if(roomAttendance!=null)for(String key:roomAttendance.getKeys(false)){
                int room=Integer.parseInt(key);require(room>=0&&room<r.stage,"invalid_room_attendance");
                List<String> players=roomAttendance.getStringList(key);require(players.size()<=PARTY_LIMIT,"invalid_room_attendance");
                Set<UUID> ids=new LinkedHashSet<>();players.forEach(raw->ids.add(UUID.fromString(raw)));r.roomAttendance.put(room,Set.copyOf(ids));
            }
            if(c.getString("phase","").equals("fighting")){r.resets++;r.pauseReason="server_restart";r.lastResetReason="server_restart";r.lastResetAt=System.currentTimeMillis();}
            for(UUID uuid:r.party)require(r.attendance.getOrDefault(uuid,0)>=0&&r.attendance.getOrDefault(uuid,0)<=r.stage,"invalid_attendance_count");
            require(!r.party.isEmpty(),"empty_party");runs.put(id,r);
            if(r.fault.isEmpty()&&activeMillis(r.started,r.faultPausedMillis,System.currentTimeMillis())>TIMEOUT_MS)expired.add(r);
        }catch(RuntimeException e){blockedCheckpoints.add(id);ready=false;plugin.getLogger().warning("Site dungeon checkpoint preserved for operator: "+id+" "+e.getMessage());}
        if(blockedCheckpoints.isEmpty())for(Run r:expired)try{end(r,"time_limit");}catch(RuntimeException e){r.fault="data_unavailable";plugin.getLogger().warning("Expired dungeon outcome not saved: "+r.site.id);}
    }
    void shutdown(){try{if(blockedCheckpoints.isEmpty())persist();}finally{for(Run r:runs.values())clean(r);}}
    private boolean owned(Entity e){return e!=null&&e.getScoreboardTags().contains(TAG);}
    private Run owner(Entity e){if(e==null)return null;Shot shot=shots.get(e.getUniqueId());if(shot!=null)return shot.run;if(!owned(e))return null;return runs.values().stream().filter(r->r.mobs.containsKey(e.getUniqueId())).findFirst().orElse(null);}
    private Entity actor(Entity e){if(e instanceof Projectile p){ProjectileSource source=p.getShooter();return source instanceof Entity a?a:null;}return e;}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void target(EntityTargetLivingEntityEvent e){Run r=owner(e.getEntity());if(r!=null&&e.getTarget()!=null&&!(e.getTarget() instanceof Player p&&playing(p)&&!plugin.isDowned(p)&&r.party.contains(p.getUniqueId())&&r.room().contains(p.getLocation())))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void damage(EntityDamageByEntityEvent e){
        Run from=owner(e.getDamager());if(from==null)from=owner(actor(e.getDamager()));Run to=owner(e.getEntity());
        if(from!=null){if(!(e.getEntity() instanceof Player p&&playing(p)&&!plugin.isDowned(p)&&from.party.contains(p.getUniqueId())&&from.room().contains(p.getLocation())))e.setCancelled(true);else{e.setDamage(e.getDamage()*from.mode.damage);from.hits.put(actor(e.getDamager()).getUniqueId(),System.currentTimeMillis());}}
        if(to!=null&&actor(e.getDamager()) instanceof Player p&&!to.party.contains(p.getUniqueId()))e.setCancelled(true);
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)public void participation(EntityDamageByEntityEvent e){
        if(e.getFinalDamage()<=0)return;
        Run r=owner(e.getEntity());Entity attacker=actor(e.getDamager());
        if(r!=null&&r.phase.equals("fighting")&&attacker instanceof Player p&&playing(p)&&!plugin.isDowned(p)
                &&r.party.contains(p.getUniqueId())&&r.site.contains(p.getLocation()))r.roomParticipants.add(p.getUniqueId());
    }
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void launch(ProjectileLaunchEvent e){Run r=owner(actor(e.getEntity()));if(r==null)return;if(shots.size()>=128){e.setCancelled(true);return;}e.getEntity().addScoreboardTag(SHOT_TAG);shots.put(e.getEntity().getUniqueId(),new Shot(r,System.currentTimeMillis()+15_000));}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void splash(PotionSplashEvent e){Run r=owner(e.getPotion());if(r==null)r=owner(actor(e.getPotion()));if(r!=null)for(LivingEntity l:e.getAffectedEntities())if(!(l instanceof Player p&&playing(p)&&!plugin.isDowned(p)&&r.party.contains(p.getUniqueId())&&r.room().contains(p.getLocation())))e.setIntensity(l,0);}
    @EventHandler public void death(EntityDeathEvent e){Run r=owner(e.getEntity());if(r!=null){r.mobs.remove(e.getEntity().getUniqueId());e.getDrops().clear();e.setDroppedExp(0);}}
    @EventHandler public void load(EntitiesLoadEvent e){for(Entity entity:e.getEntities())if((owned(entity)||entity.getScoreboardTags().contains(SHOT_TAG))&&owner(entity)==null)entity.remove();}
    @EventHandler public void rejoin(PlayerJoinEvent e){Run r=own(e.getPlayer());if(r!=null)e.getPlayer().sendMessage("§e地下城进度保留，剩余机会 "+(MAX_FAILURES-r.failures)+"/3；dungeon status 查本场。断线不扣次数，倒地续关会自动回存档点；主动离场仍须5分钟内回场。");Bukkit.getScheduler().runTaskLater(plugin,()->clearLoginIntruder(e.getPlayer()),5L);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void breakBlock(BlockBreakEvent e){
        if (plugin.trustedBlockEditor(e.getPlayer())) return;if(activityArea(e.getBlock().getLocation())){e.setCancelled(true);plugin.protectionAdvisor().denied(e.getPlayer(),"break",e.getBlock().getLocation(),"site_dungeon",protectionArea(e.getBlock().getLocation()));}}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void placeBlock(BlockPlaceEvent e){
        if (plugin.trustedBlockEditor(e.getPlayer())) return;if(activityArea(e.getBlock().getLocation())){e.setCancelled(true);plugin.protectionAdvisor().denied(e.getPlayer(),"place",e.getBlock().getLocation(),"site_dungeon",protectionArea(e.getBlock().getLocation()));}}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void spawnNatural(SpawnerSpawnEvent e){if(runs.values().stream().anyMatch(r->r.site.contains(e.getLocation())))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void spawnWild(CreatureSpawnEvent e){if(e.getSpawnReason()==CreatureSpawnEvent.SpawnReason.NATURAL&&runs.values().stream().anyMatch(r->r.site.contains(e.getLocation())))e.setCancelled(true);}
    private ItemStack icon(Material material,String name,String... lore){ItemStack item=new ItemStack(material);var meta=item.getItemMeta();meta.setDisplayName(name);meta.setLore(List.of(lore));item.setItemMeta(meta);return item;}
    private void open(Player p,String id){
        Inventory inv=Bukkit.createInventory(null,54,id.isEmpty()?"遗迹地下城":"地下城 · "+site(id).name);menus.put(inv,new Menu(id,receipt(p.getUniqueId(),id)!=null));
        if(id.isEmpty()){int slot=10;for(Site s:sites.values())inv.setItem(slot++,icon(s.icon,"§6"+s.name,s.hint,"点击查看入口、组队、挑战与奖励"));}
        else{Site s=site(id);inv.setItem(10,icon(Material.ENDER_PEARL,s.entry.isEmpty()?"§b前往遗迹外围":"§b前往挑战入口","8魔力；抵达后仍须主动开始、逐室清怪"));inv.setItem(12,icon(Material.IRON_SWORD,"§a开始普通挑战","须亲自站在首室；10秒组队集结"));inv.setItem(13,icon(Material.DIAMOND_SWORD,"§6开始冒险挑战","更强怪物；每日奖励二倍"));inv.setItem(14,icon(Material.NETHERITE_SWORD,"§5开始末日挑战","更强怪物；每日奖励三倍"));inv.setItem(16,icon(Material.SUNFLOWER,"§a加入正在集结的队伍","须站在首室；每队最多8人"));inv.setItem(22,icon(Material.BARRIER,"§c退出自己的挑战","留在原地；自行步行或使用传送技能"));inv.setItem(30,icon(Material.CHEST,"§6领取已完成奖励","存入个人箱；满队列时保留凭据"));inv.setItem(31,icon(Material.WRITTEN_BOOK,"§e路线与当前进度","清理每个标记房间并返回首室"));inv.setItem(49,icon(Material.ARROW,"§7返回地下城列表"));}
        if(id.isEmpty()){
            int slot=10;for(Site s:sites.values()){
                if(receipt(p.getUniqueId(),s.id)!=null)inv.setItem(slot,icon(s.icon,"§e"+s.name+" · 有奖励待领取",s.hint,"点击打开，再点奖励箱领取上次奖励","领取后才可开始或加入这处的新挑战"));
                slot++;
            }
        }else if(receipt(p.getUniqueId(),id)!=null){
            var saved=receipt(p.getUniqueId(),id);
            for(int slot:new int[]{12,13,14,16})inv.setItem(slot,icon(Material.GRAY_DYE,"§e先领取上次奖励","上次已完成，奖励保留中","请点下方「领取上次奖励」箱子","不会自动领取或替你开启新挑战"));
            inv.setItem(30,icon(Material.ENDER_CHEST,"§a领取上次奖励",saved.getString("day","日期未记录")+"完成的挑战","点击领取到个人奖励箱，随后重新开场","满队列时保留凭据；无需重打旧场次"));
        }
        p.openInventory(inv);
    }
    @EventHandler public void click(InventoryClickEvent e){
        Menu menu=menus.get(e.getView().getTopInventory());if(menu==null)return;e.setCancelled(true);if(!(e.getWhoClicked() instanceof Player p))return;int slot=e.getRawSlot();if(slot<0||slot>=54)return;
        Bukkit.getScheduler().runTask(plugin,()->{
            if(!p.isOnline())return;
            if(menu.site.isEmpty()){List<Site> list=new ArrayList<>(sites.values());if(slot>=10&&slot<10+list.size())open(p,list.get(slot-10).id);return;}
            String action=switch(slot){case 10->"travel";case 12,13,14->"start";case 16->"join";case 22->"leave";case 30->"claim";case 31->"info";default->"";};
            if(slot==49){open(p,"");return;}if(action.isEmpty())return;
            if((action.equals("start")||action.equals("join"))&&(menu.pendingReward||receipt(p.getUniqueId(),menu.site)!=null)){
                // Inspecting the blocker never implicitly claims or starts a challenge.
                explainPending(p,List.of(menu.site));open(p,menu.site);return;
            }
            p.closeInventory();command(p,new String[]{"dungeon",action,menu.site,slot==13?"adventure":slot==14?"apocalypse":"normal"});
            if(slot==31)command(p,new String[]{"dungeon","status",menu.site});
        });
    }
    @EventHandler public void drag(InventoryDragEvent e){if(menus.containsKey(e.getView().getTopInventory()))e.setCancelled(true);}
    @EventHandler public void close(InventoryCloseEvent e){menus.remove(e.getInventory());}
}
