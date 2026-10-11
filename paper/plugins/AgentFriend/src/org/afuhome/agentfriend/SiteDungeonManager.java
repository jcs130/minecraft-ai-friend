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
import org.bukkit.event.world.EntitiesLoadEvent;
import org.bukkit.inventory.*;
import org.bukkit.projectiles.ProjectileSource;

/** Independent, opt-in encounters inside existing buildings. Never places blocks or generates terrain. */
final class SiteDungeonManager implements Listener {
    private static final String ROOT="site-dungeons",TAG="afu_site_dungeon",SHOT_TAG="afu_site_projectile";
    private static final int GLOBAL_MOBS=48,PARTY_LIMIT=8;
    private static final long REJOIN_MS=300_000,TIMEOUT_MS=1_800_000;
    private static final Gson JSON=new Gson();
    private static final Set<Material> HAZARDS=Set.of(Material.LAVA,Material.WATER,Material.FIRE,Material.SOUL_FIRE,
            Material.MAGMA_BLOCK,Material.CACTUS,Material.SWEET_BERRY_BUSH,Material.CAMPFIRE,Material.SOUL_CAMPFIRE,Material.POWDER_SNOW);
    private record Room(String name,int x,int y,int z,int radius,List<DungeonWaveCatalog.Enemy> enemies) {
        Location center(World w){return new Location(w,x+.5,y,z+.5);}
        boolean contains(Location l){return Math.abs(l.getX()-(x+.5))<=radius+2&&Math.abs(l.getZ()-(z+.5))<=radius+2&&Math.abs(l.getY()-y)<=3;}
    }
    private record Site(String id,String name,String expedition,String hint,Material icon,String world,
                        List<Room> rooms,int emeralds,Material bonus,int bonusCount,List<Integer> entry) {
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
        int attempt,resets;String pauseReason="",lastResetReason="";long lastResetAt;
        final Map<UUID,DungeonWaveCatalog.Enemy> mobs=new LinkedHashMap<>();final Set<Chunk> held=new HashSet<>();
        final Map<UUID,Long> hits=new HashMap<>();
        int stage;String phase="muster",fault="";long started=System.currentTimeMillis(),readyAt=started+10_000,pausedAt;boolean invalid;
        Run(Site site,Mode mode){this.site=site;this.mode=mode;}
        Room room(){return site.rooms.get(Math.min(stage,site.rooms.size()-1));}
    }
    private record Menu(String site){}
    private record Shot(Run run,long expires){}
    private final AgentFriendPlugin plugin;
    private Map<String,Site> sites=Map.of();
    private final Map<String,Run> runs=new LinkedHashMap<>();
    private final Map<Inventory,Menu> menus=new IdentityHashMap<>();
    private final Map<UUID,Shot> shots=new HashMap<>();
    private final Set<String> blockedCheckpoints=new HashSet<>();
    private boolean ready;

    SiteDungeonManager(AgentFriendPlugin plugin){
        this.plugin=plugin;
        if(!new File(plugin.getDataFolder(),"dungeons.yml").exists())plugin.saveResource("dungeons.yml",false);
        reload();plugin.getServer().getPluginManager().registerEvents(this,plugin);
        for(World world:Bukkit.getWorlds())for(Entity e:world.getEntities())if(owned(e)||e.getScoreboardTags().contains(SHOT_TAG))e.remove();
        restore();Bukkit.getScheduler().runTaskTimer(plugin,this::tick,20,20);
    }
    private static void require(boolean yes,String reason){if(!yes)throw new IllegalArgumentException(reason);}
    private String day(){return LocalDate.now(ZoneId.of("Asia/Shanghai")).toString();}
    private Run own(Player p){return runs.values().stream().filter(r->r.party.contains(p.getUniqueId())).findFirst().orElse(null);}
    boolean isParticipant(Player p){return own(p)!=null;}
    boolean hasActiveRuns(){return !runs.isEmpty()||!blockedCheckpoints.isEmpty();}
    List<String> ids(){return new ArrayList<>(sites.keySet());}
    boolean activityArea(Location at){return sites.values().stream().anyMatch(s->s.contains(at));}
    ProtectionArea protectionArea(Location at) {
        for (Run run : runs.values()) {
            Site s = run.site; if (!s.contains(at)) continue;
            return ProtectionArea.box("site_dungeon_" + s.id, "挑战中的" + s.name, at.getWorld(),
                    s.rooms.stream().mapToInt(Room::x).min().orElseThrow() - 24,
                    s.rooms.stream().mapToInt(Room::y).min().orElseThrow() - 8,
                    s.rooms.stream().mapToInt(Room::z).min().orElseThrow() - 24,
                    s.rooms.stream().mapToInt(Room::x).max().orElseThrow() + 24,
                    s.rooms.stream().mapToInt(Room::y).max().orElseThrow() + 12,
                    s.rooms.stream().mapToInt(Room::z).max().orElseThrow() + 24);
        }
        return null;
    }
    private String rescueKey(Run r){return "site:"+r.id;}
    TrialRescueManager.Team rescueTeam(UUID id){
        Run r=runs.values().stream().filter(run->run.party.contains(id)).findFirst().orElse(null);if(r==null)return null;
        return new TrialRescueManager.Team(rescueKey(r),Set.copyOf(r.party),r.site::contains,r.pausedAt>0||!r.fault.isEmpty(),
                ()->r.phase.equals("fighting")&&r.mobs.isEmpty()&&!r.invalid,
                ()->end(r,"party_defeated"),r.site.rooms.getFirst().center(Bukkit.getWorld(r.site.world)));
    }
    private boolean playing(Player p){return p!=null&&p.isOnline()&&!p.isDead()&&p.getGameMode()==GameMode.SURVIVAL;}
    private List<Player> present(Run r){return r.party.stream().map(Bukkit::getPlayer).filter(this::playing).filter(p->r.site.contains(p.getLocation())).toList();}
    private void send(Player p,String prefix,Map<String,?> fields){Map<String,Object> data=new LinkedHashMap<>();data.put("schemaVersion",1);data.putAll(fields);p.sendMessage(prefix+" "+JSON.toJson(data));}
    private void result(Player p,String action,String site,String reason){
        Map<String,Object> data=new LinkedHashMap<>();data.put("action",action);data.put("id",site);
        data.put("success",reason.equals("success"));data.put("reason",reason);
        ActionFeedback.Advice advice=reason.equals("success")?null:ActionFeedback.advice("dungeon",reason,site);
        if(advice!=null){data.put("errorMessage",advice.message());data.put("nextAction",advice.next());data.put("nextCommands",advice.commands());}
        send(p,"MC_SITE_DUNGEON_RESULT",data);if(advice!=null)advice.send(p);
    }
    private void tell(Run r,String message){for(UUID id:r.party){Player p=Bukkit.getPlayer(id);if(p!=null)p.sendMessage(message);}}
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
        case "runtime_error"->"发生故障，等待处理后 resume";default->"暂无活跃队员";
    };}
    private static String endLabel(String reason){return switch(reason){
        case "completed"->"全部房间已清理并完成返程结算";case "party_defeated"->"全队倒地，挑战失败";
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
        return chosen==null?Map.of():new LinkedHashMap<>(chosen.getValues(false));
    }
    private void explainOutcome(Player p,Map<String,Object> data){
        String reward=Objects.toString(data.get("rewardStatus"),"run_incomplete");
        String detail=switch(reward){case "ready"->"已生成待领奖凭据";case "claimed"->"本轮奖励已领取到个人箱";case "daily_limit"->"今日该处已经领奖，重复挑战不再发奖";case "missing_participation"->"参战登记不足，未生成凭据";case "not_returned"->"未完成返程登记，未生成凭据";default->"本轮未完成，未生成新凭据";};
        p.sendMessage("§e【地下城结算】"+Objects.toString(data.get("name"),data.get("id").toString())+"："+endLabel(Objects.toString(data.get("reason")))+"；"+detail+"（参战 "+data.get("attendance")+"/"+data.get("requiredRooms")+"）。");
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
                    rooms.add(new Room(Objects.toString(row.get("name"),"战斗室"),x,y,z,radius,enemies));
                }
                require(!rooms.isEmpty()&&rooms.size()<=6,"rooms_limit_6");Room first=rooms.getFirst();
                for(Room r:rooms)require(Math.abs(r.x-first.x)<=128&&Math.abs(r.z-first.z)<=128&&Math.abs(r.y-first.y)<=128,"site_bounds");
                int emeralds=c.getInt("reward.emeralds",8),count=c.getInt("reward.count",4);Material bonus=Material.matchMaterial(c.getString("reward.item","LAPIS_LAZULI"));
                require(emeralds>=1&&emeralds<=64&&count>=1&&count<=21&&bonus!=null&&bonus.isItem(),"reward_bounds");
                Site s=new Site(id,name,expedition,c.getString("hint",""),Material.matchMaterial(c.getString("icon","STONE_BRICKS")),world,List.copyOf(rooms),emeralds,bonus,count,List.copyOf(entry));
                if(!entry.isEmpty())require(s.contains(new Location(Bukkit.getWorld(world),entry.get(0),entry.get(1),entry.get(2))),"entry_outside_site");
                require(s.icon!=null&&s.icon.isItem(),"invalid_icon");
                for(Site prior:next.values())require(!prior.contains(first.center(Bukkit.getWorld(world)))&&!s.contains(prior.rooms.getFirst().center(Bukkit.getWorld(prior.world))),"overlapping_sites");
                next.put(id,s);
            }
            sites=Collections.unmodifiableMap(next);ready=true;return "success";
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
    void command(Player p,String[] args){
        String action=args.length>1?args[1].toLowerCase(Locale.ROOT):"list",id=args.length>2?args[2]:"";
        try{
            require(ready,"configuration_unavailable");
            switch(action){
                case "list"->{for(Site s:sites.values())send(p,"MC_SITE_DUNGEON_ITEM",Map.of("id",s.id,"name",s.name,"rooms",s.rooms.size(),"active",runs.containsKey(s.id),"expedition",s.expedition));send(p,"MC_SITE_DUNGEON_LIST",Map.of("total",sites.size(),"partyLimit",PARTY_LIMIT,"parallelSites",true));}
                case "menu"->open(p,"");
                case "info"->info(p,site(id));
                case "travel"->travel(p,site(id));
                case "start"->start(p,site(id),Mode.parse(args.length>3?args[3]:"normal"));
                case "join"->join(p,site(id));
                case "status"->status(p,id);
                case "resume"->{Run r=own(p);require(r!=null&&!r.fault.isEmpty(),"not_fault_paused");String fault=r.fault;r.fault="";try{persist();}catch(RuntimeException e){r.fault=fault;throw e;}result(p,"resume",r.site.id,"success");}
                case "leave"->leave(p);
                case "claim"->claim(p,id);
                default->throw new IllegalArgumentException("use_list_info_travel_start_join_status_resume_leave_claim_menu");
            }
        }catch(IllegalArgumentException e){result(p,action,id,e.getMessage());}
    }
    private void info(Player p,Site s){
        Room first=s.rooms.getFirst();send(p,"MC_SITE_DUNGEON_INFO",Map.of("id",s.id,"name",s.name,"world",s.world,"start",List.of(first.x,first.y,first.z),"rooms",s.rooms.stream().map(r->Map.of("name",r.name,"center",List.of(r.x,r.y,r.z),"radius",r.radius,"enemies",r.enemies.size())).toList(),"hint",s.hint,"dailyRewardPerSite",1,"approachMana",8));
        p.sendMessage("§6"+s.name+"："+s.hint+"。先 travel "+s.id+"（8魔力）"+(s.entry.isEmpty()?"到外围，步行深入首室":"到已勘察的墓穴入口")+"；start 自己参赛，队友10秒内 join。各室清怪后步行到下一室，最后返回首室；claim 奖励进个人箱。普通/冒险/末日可选，每处每日一次奖励。");
    }
    private void travel(Player p,Site s){
        require(playing(p)&&own(p)==null&&!plugin.dungeonParticipant(p)&&!plugin.pvpParticipant(p),"already_in_activity_or_not_survival");
        if(s.entry.isEmpty()){new DungeonExpeditions(plugin).travel(p,s.expedition);return;}
        World w=Bukkit.getWorld(s.world);int x=s.entry.get(0),y=s.entry.get(1),z=s.entry.get(2);
        require(w.isChunkGenerated(x>>4,z>>4),"entry_not_generated");Location origin=p.getLocation().clone();
        w.getChunkAtAsync(x>>4,z>>4,false).whenComplete((chunk,error)->Bukkit.getScheduler().runTask(plugin,()->{
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
            if(plugin.travelMagic().teleport(p,landing,"dungeon:"+s.id,"遗迹入口传送术",TravelMagic.DISTANT_MANA)){result(p,"travel",s.id,"success");p.sendMessage("§6已到地下城入口；仍须主动 start、逐室清怪并返回首室才能领取奖励。");}
            else result(p,"travel",s.id,"travel_denied");
        }));
    }
    private void start(Player p,Site s,Mode mode){
        require(playing(p)&&own(p)==null&&!plugin.dungeonParticipant(p)&&!plugin.pvpParticipant(p),"already_in_activity_or_not_survival");
        require(s.contains(p.getLocation())&&s.rooms.getFirst().contains(p.getLocation()),"walk_to_first_room");
        require(!runs.containsKey(s.id),"site_busy");require(receipt(p.getUniqueId(),s.id)==null,"claim_previous_reward_first");
        require(System.currentTimeMillis()-plugin.getConfig().getLong(ROOT+".cooldowns."+s.id,0)>=120_000,"site_cooldown");
        require(receiptCount()<1024,"pending_receipt_capacity");
        Run r=new Run(s,mode);r.party.add(p.getUniqueId());r.attendance.put(p.getUniqueId(),0);runs.put(s.id,r);
        try{persist();}catch(RuntimeException failure){runs.remove(s.id);throw failure;}
        result(p,"start",s.id,"success");tell(r,"§6"+s.name+"〔"+mode.label+"〕集结10秒；队友需主动 dungeon join "+s.id+"。房间清怪后自行前进，掉线宽限5分钟。");
    }
    private void join(Player p,Site s){
        Run r=runs.get(s.id);require(r!=null&&r.phase.equals("muster")&&System.currentTimeMillis()<r.readyAt,"muster_closed");
        require(playing(p)&&own(p)==null&&!plugin.dungeonParticipant(p)&&!plugin.pvpParticipant(p),"already_in_activity_or_not_survival");
        require(r.party.size()<PARTY_LIMIT&&s.contains(p.getLocation())&&s.rooms.getFirst().contains(p.getLocation()),"party_full_or_not_at_first_room");
        require(receipt(p.getUniqueId(),s.id)==null,"claim_previous_reward_first");
        r.party.add(p.getUniqueId());r.attendance.put(p.getUniqueId(),0);
        try{persist();}catch(RuntimeException failure){r.party.remove(p.getUniqueId());r.attendance.remove(p.getUniqueId());throw failure;}
        result(p,"join",s.id,"success");
    }
    private void status(Player p,String id){
        if(plugin.trialRescue()!=null)plugin.trialRescue().report(p);
        Run r=id.isEmpty()?own(p):runs.get(site(id).id);
        if(r==null){
            Map<String,Object> fields=new LinkedHashMap<>();fields.put("active",false);fields.put("participant",false);fields.put("pendingRewards",pendingSites(p.getUniqueId()));
            Map<String,Object> outcome=lastOutcome(p.getUniqueId(),id);fields.put("lastOutcome",outcome);fields.put("outcomeKnown",!outcome.isEmpty());
            send(p,"MC_SITE_DUNGEON_STATE",fields);
            if(!outcome.isEmpty())explainOutcome(p,outcome);
            else p.sendMessage("§e【地下城】当前没有你的活动记录；旧版未保存结束原因，不能据此确认通关或补发。用 /mycli dungeon list 选地点，info 查看规则。");
            return;
        }
        Room target=r.stage>=r.site.rooms.size()?r.site.rooms.getFirst():r.room();
        Map<String,Object> fields=new LinkedHashMap<>();fields.put("id",r.site.id);fields.put("run",r.id);fields.put("active",true);fields.put("participant",r.party.contains(p.getUniqueId()));fields.put("phase",r.phase);fields.put("stage",Math.min(r.stage+1,r.site.rooms.size()));fields.put("stages",r.site.rooms.size());fields.put("remainingMobs",r.mobs.size());fields.put("target",List.of(target.x,target.y,target.z));fields.put("difficulty",r.mode.id);fields.put("paused",r.pausedAt>0||!r.fault.isEmpty());fields.put("fault",r.fault);
        fields.putAll(attendanceState(r,p.getUniqueId()));fields.put("attempt",r.attempt);fields.put("resets",r.resets);fields.put("pauseReason",r.pauseReason);fields.put("lastResetReason",r.lastResetReason);fields.put("lastResetAt",r.lastResetAt);
        fields.put("combatBounds",Map.of("world",r.site.world,"min",List.of(target.x+.5-target.radius-2,target.y-3,target.z+.5-target.radius-2),"max",List.of(target.x+.5+target.radius+2,target.y+3,target.z+.5+target.radius+2)));
        Map<String,Object> previousOutcome=r.party.contains(p.getUniqueId())?Map.of():lastOutcome(p.getUniqueId(),r.site.id);
        if(!r.party.contains(p.getUniqueId())){fields.put("lastOutcome",previousOutcome);fields.put("outcomeKnown",!previousOutcome.isEmpty());}
        send(p,"MC_SITE_DUNGEON_STATE",fields);
        if(r.party.contains(p.getUniqueId())){
            p.sendMessage("§b【地下城】"+r.site.name+" · "+target.name+"；参战登记 "+r.attendance.getOrDefault(p.getUniqueId(),0)+"/"+r.site.rooms.size()+"，"+(r.phase.equals("returning")?"请返回首室结算":"本室"+(r.roomParticipants.contains(p.getUniqueId())?"已记录":"尚未记录"))+"。"+(r.pausedAt>0?"暂停："+pauseLabel(r.pauseReason)+"；5分钟内回场，未清房间重刷。":""));
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
        result(p,"leave",r.site.id,"success");p.sendMessage("§e已退出地下城；留在原地，可步行离开或自行使用传送技能。");
    }
    private int receiptCount(){var c=plugin.getConfig().getConfigurationSection(ROOT+".receipts");if(c==null)return 0;int total=0;for(String owner:c.getKeys(false)){var section=c.getConfigurationSection(owner);if(section!=null)total+=section.getKeys(false).size();}return total;}
    private ConfigurationSection receipt(UUID id,String site){return plugin.getConfig().getConfigurationSection(ROOT+".receipts."+id+"."+site);}
    private List<String> pendingSites(UUID id){var c=plugin.getConfig().getConfigurationSection(ROOT+".receipts."+id);return c==null?List.of():new ArrayList<>(c.getKeys(false));}
    private void claim(Player p,String id){
        if(id.isEmpty()){var pending=pendingSites(p.getUniqueId());require(pending.size()==1,"specify_dungeon_id");id=pending.getFirst();}
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
        result(p,"claim",chosen,"success");p.sendMessage("§a地下城奖励已存入个人箱；用 /mycli arena rewards 查看，/mycli arena stash 打开。重复领取不会再次发奖。");
    }
    private void tick(){
        long timestamp=System.currentTimeMillis();
        for(var entry:new ArrayList<>(shots.entrySet())){Entity e=Bukkit.getEntity(entry.getKey());if(e==null||!e.isValid()||timestamp>=entry.getValue().expires){if(e!=null)e.remove();shots.remove(entry.getKey());}}
        for(Run r:new ArrayList<>(runs.values())){
        if(!r.fault.isEmpty())continue;
        int previousStage=r.stage;String previousPhase=r.phase;Map<UUID,Integer> previousAttendance=new HashMap<>(r.attendance);
        Map<Integer,Set<UUID>> previousRoomAttendance=new LinkedHashMap<>(r.roomAttendance);
        try{
            long now=System.currentTimeMillis();if(now-r.started>TIMEOUT_MS){end(r,"time_limit");continue;}
            List<Player> present=present(r);
            if(present.isEmpty() || present.stream().allMatch(plugin::isDowned)
                    && r.party.stream().anyMatch(id->Bukkit.getPlayer(id)==null&&plugin.trialRescue()!=null&&!plugin.trialRescue().downed(id))){
                if(r.pausedAt==0){
                    r.pausedAt=now;r.pauseReason=present.isEmpty()?(r.party.stream().noneMatch(id->playing(Bukkit.getPlayer(id)))?"all_offline":"all_outside_site"):"waiting_for_teammate";
                    if(r.phase.equals("fighting")){r.resets++;r.lastResetReason=r.pauseReason;r.lastResetAt=now;r.phase="moving";}
                    clean(r);persist();notice(r,"§e【地下城暂停】"+pauseLabel(r.pauseReason)+"；5分钟内回场。已清房间保留，未清房间重刷，本次未完成的参战记录不计入结算。");
                }
                else if(now-r.pausedAt>REJOIN_MS)end(r,"return_grace_expired");
                continue;
            }
            if(r.pausedAt>0){r.pausedAt=0;String reason=r.pauseReason;r.pauseReason="";persist();notice(r,"§e【地下城续接】此前"+pauseLabel(reason)+"；未通关房间重新出怪，已通关进度保留。");}
            if(r.phase.equals("muster")){if(now<r.readyAt)continue;r.phase="moving";persist();}
            if(r.phase.equals("returning")){if(present.stream().anyMatch(p->r.site.rooms.getFirst().contains(p.getLocation())))complete(r);continue;}
            if(r.phase.equals("moving")){
                if(present.stream().noneMatch(p->r.room().contains(p.getLocation())))continue;
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
                String roomName=r.room().name;clean(r);r.stage++;r.attempt=0;r.phase=r.stage==r.site.rooms.size()?"returning":"moving";persist();
                for(UUID id:r.party){Player p=Bukkit.getPlayer(id);if(p!=null)p.sendMessage((credited.contains(id)?"§a":"§e")+"【参战登记】"+roomName+"："+(credited.contains(id)?"已记录本室参战":"本室缺席，未登记")+"；累计 "+r.attendance.getOrDefault(id,0)+"/"+r.site.rooms.size()+"。"+(credited.contains(id)?"":"继续可练习，完整奖励需重新组队挑战。"));}
                notice(r,"§a战斗室已清理；"+(r.phase.equals("returning")?"返回首室完成本次探索并登记奖励。":"步行前往下一室："+r.room().name+" "+r.room().x+","+r.room().y+","+r.room().z));
            }
        }catch(RuntimeException e){plugin.getLogger().warning("Site dungeon paused for explicit retry: "+r.site.id+" "+e.getMessage());clean(r);r.stage=previousStage;r.attendance.clear();r.attendance.putAll(previousAttendance);r.roomAttendance.clear();r.roomAttendance.putAll(previousRoomAttendance);r.phase=previousPhase.equals("fighting")?"moving":previousPhase;r.pausedAt=System.currentTimeMillis();r.pauseReason="runtime_error";if(previousPhase.equals("fighting")){r.resets++;r.lastResetReason="runtime_error";r.lastResetAt=r.pausedAt;}r.fault=Objects.toString(e.getMessage(),"runtime_error");try{persist();}catch(RuntimeException save){plugin.getLogger().warning("Site dungeon fault checkpoint not saved: "+r.site.id);}notice(r,"§c地下城已暂停："+r.fault+"。本室未结算；解决问题后 /mycli dungeon resume 重试，或 /mycli dungeon leave 退出。");}
        }
    }
    private List<Location> safeSpots(Run r){
        World w=Bukkit.getWorld(r.site.world);Room room=r.room();List<Location> spots=new ArrayList<>();List<Player> present=present(r);
        for(int dx=-room.radius;dx<=room.radius;dx++)for(int dz=-room.radius;dz<=room.radius;dz++){
            int x=room.x+dx,z=room.z+dz;if(!w.isChunkLoaded(x>>4,z>>4))continue;
            Block feet=w.getBlockAt(x,room.y,z),head=feet.getRelative(0,1,0),floor=feet.getRelative(0,-1,0);
            if(!feet.isPassable()||!head.isPassable()||!floor.getType().isSolid()||HAZARDS.contains(feet.getType())||HAZARDS.contains(head.getType())||HAZARDS.contains(floor.getType()))continue;
            if(feet.isLiquid()||head.isLiquid()||floor.getType().name().endsWith("_LEAVES")||floor.getType().name().endsWith("_SLAB")||floor.getType().name().endsWith("_STAIRS"))continue;
            Location at=new Location(w,x+.5,room.y,z+.5);
            double clearance=room.radius<=3?4:9;
            if(present.stream().noneMatch(p->p.getLocation().distanceSquared(at)<clearance))spots.add(at);
        }
        return spots;
    }
    private void spawn(Run r){
        World w=Bukkit.getWorld(r.site.world);Room room=r.room();List<Location> spots=safeSpots(r);
        require(spots.size()>=room.enemies.size(),"room_blocked_clear_floor_and_retry");Collections.shuffle(spots);
        try{
            for(int i=0;i<room.enemies.size();i++){
                var spec=room.enemies.get(i);Location at=spots.get(i);Chunk chunk=at.getChunk();if(r.held.add(chunk))chunk.addPluginChunkTicket(plugin);
                Mob mob=spec.spawn(at,r.mode!=Mode.NORMAL);
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
            atomic(()->{String path=ROOT+".receipts."+id+"."+r.site.id;plugin.getConfig().createSection(path,Map.of("day",rewardDay,"run",r.id,"started-at",r.started,"emeralds",r.site.emeralds*r.mode.reward,"item",r.site.bonus.name(),"count",r.site.bonusCount*r.mode.reward));});
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
        clean(r);notice(r,"§e【地下城结束】"+endLabel(reason)+"。已保存本轮结果；/mycli dungeon status "+r.site.id+"可回看。");
        outcomes.forEach((id,data)->{Player p=Bukkit.getPlayer(id);if(p!=null)explainOutcome(p,data);});
        plugin.getLogger().info("MC_SITE_DUNGEON_END "+JSON.toJson(Map.of("site",r.site.id,"run",r.id,"reason",reason,"clearedRooms",r.stage,"endedAt",System.currentTimeMillis())));
    }
    private void atomic(Runnable change){
        String before=plugin.getConfig().saveToString();Path file=plugin.getDataFolder().toPath().resolve("config.yml"),temp=file.resolveSibling("config.yml.site-dungeon.tmp");
        try{
            change.run();byte[] bytes=plugin.getConfig().saveToString().getBytes(StandardCharsets.UTF_8);require(bytes.length<=16*1024*1024,"state_capacity");
            try(FileChannel out=FileChannel.open(temp,StandardOpenOption.CREATE,StandardOpenOption.TRUNCATE_EXISTING,StandardOpenOption.WRITE)){ByteBuffer b=ByteBuffer.wrap(bytes);while(b.hasRemaining())out.write(b);out.force(true);}
            Files.move(temp,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
        }catch(Exception e){try{plugin.getConfig().loadFromString(before);}catch(Exception restore){throw new IllegalStateException("state_restore_failed",restore);}if(e instanceof IllegalArgumentException argument)throw argument;throw new IllegalArgumentException("data_unavailable");}
    }
    private void persist(){persist(()->{});}
    private void persist(Runnable extra){
        require(blockedCheckpoints.isEmpty(),"checkpoint_conflict_requires_operator");
        atomic(()->{
            extra.run();
            plugin.getConfig().set(ROOT+".runs",null);
            for(Run r:runs.values()){
                String path=ROOT+".runs."+r.site.id;Map<String,Object> saved=new LinkedHashMap<>();
                saved.put("id",r.id);saved.put("mode",r.mode.id);saved.put("definition",JSON.toJson(r.site));saved.put("stage",r.stage);saved.put("phase",r.phase);saved.put("fault",r.fault);saved.put("started",r.started);saved.put("pausedAt",r.pausedAt);saved.put("party",r.party.stream().map(UUID::toString).toList());
                Map<String,Integer> attendance=new LinkedHashMap<>();r.attendance.forEach((id,count)->attendance.put(id.toString(),count));saved.put("attendance",attendance);plugin.getConfig().createSection(path,saved);
                Map<String,List<String>> roomAttendance=new LinkedHashMap<>();r.roomAttendance.forEach((stage,ids)->roomAttendance.put(stage.toString(),ids.stream().map(UUID::toString).toList()));
                plugin.getConfig().set(path+".roomAttendance",roomAttendance);plugin.getConfig().set(path+".attempt",r.attempt);plugin.getConfig().set(path+".resets",r.resets);
                plugin.getConfig().set(path+".pauseReason",r.pauseReason);plugin.getConfig().set(path+".lastResetReason",r.lastResetReason);plugin.getConfig().set(path+".lastResetAt",r.lastResetAt);
            }
        });
    }
    private void restore(){
        var saved=plugin.getConfig().getConfigurationSection(ROOT+".runs");if(saved==null)return;
        List<Run> expired=new ArrayList<>();
        for(String id:saved.getKeys(false))try{
            Site site=site(id);var c=saved.getConfigurationSection(id);Run r=new Run(site,Mode.parse(c.getString("mode","normal")));
            r.id=c.getString("id",r.id);UUID.fromString(r.id);
            require(JSON.toJson(site).equals(c.getString("definition")),"definition_changed_checkpoint_preserved");
            r.stage=c.getInt("stage");require(r.stage>=0&&r.stage<=site.rooms.size(),"invalid_checkpoint");r.started=c.getLong("started");
            r.phase=r.stage==site.rooms.size()?"returning":"moving";r.fault=c.getString("fault","");r.pausedAt=c.getLong("pausedAt",System.currentTimeMillis());if(r.pausedAt==0)r.pausedAt=System.currentTimeMillis();
            for(String raw:c.getStringList("party")){UUID uuid=UUID.fromString(raw);require(r.party.size()<PARTY_LIMIT,"party_limit");require(runs.values().stream().noneMatch(old->old.party.contains(uuid)),"duplicate_participant");r.party.add(uuid);r.attendance.put(uuid,c.getInt("attendance."+raw));}
            r.attempt=c.getInt("attempt");r.resets=c.getInt("resets");r.pauseReason=c.getString("pauseReason","server_restart");r.lastResetReason=c.getString("lastResetReason","");r.lastResetAt=c.getLong("lastResetAt");
            var roomAttendance=c.getConfigurationSection("roomAttendance");
            if(roomAttendance!=null)for(String key:roomAttendance.getKeys(false)){
                int room=Integer.parseInt(key);require(room>=0&&room<r.stage,"invalid_room_attendance");
                List<String> players=roomAttendance.getStringList(key);require(players.size()<=PARTY_LIMIT,"invalid_room_attendance");
                Set<UUID> ids=new LinkedHashSet<>();players.forEach(raw->ids.add(UUID.fromString(raw)));r.roomAttendance.put(room,Set.copyOf(ids));
            }
            if(c.getString("phase","").equals("fighting")){r.resets++;r.pauseReason="server_restart";r.lastResetReason="server_restart";r.lastResetAt=System.currentTimeMillis();}
            for(UUID uuid:r.party)require(r.attendance.getOrDefault(uuid,0)>=0&&r.attendance.getOrDefault(uuid,0)<=r.stage,"invalid_attendance_count");
            require(!r.party.isEmpty(),"empty_party");runs.put(id,r);
            if(System.currentTimeMillis()-r.started>TIMEOUT_MS)expired.add(r);
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
    @EventHandler public void rejoin(PlayerJoinEvent e){Run r=own(e.getPlayer());if(r!=null)e.getPlayer().sendMessage("§e地下城进度保留；dungeon status 查看当前室，5分钟内步行返回即可续打，不自动免费传送。");}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void breakBlock(BlockBreakEvent e){if(runs.values().stream().anyMatch(r->r.site.contains(e.getBlock().getLocation()))){e.setCancelled(true);plugin.protectionAdvisor().denied(e.getPlayer(),"break",e.getBlock().getLocation(),"site_dungeon",protectionArea(e.getBlock().getLocation()));}}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void placeBlock(BlockPlaceEvent e){if(runs.values().stream().anyMatch(r->r.site.contains(e.getBlock().getLocation()))){e.setCancelled(true);plugin.protectionAdvisor().denied(e.getPlayer(),"place",e.getBlock().getLocation(),"site_dungeon",protectionArea(e.getBlock().getLocation()));}}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void spawnNatural(SpawnerSpawnEvent e){if(runs.values().stream().anyMatch(r->r.site.contains(e.getLocation())))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void spawnWild(CreatureSpawnEvent e){if(e.getSpawnReason()==CreatureSpawnEvent.SpawnReason.NATURAL&&runs.values().stream().anyMatch(r->r.site.contains(e.getLocation())))e.setCancelled(true);}
    private ItemStack icon(Material material,String name,String... lore){ItemStack item=new ItemStack(material);var meta=item.getItemMeta();meta.setDisplayName(name);meta.setLore(List.of(lore));item.setItemMeta(meta);return item;}
    private void open(Player p,String id){
        Inventory inv=Bukkit.createInventory(null,54,id.isEmpty()?"遗迹地下城":"地下城 · "+site(id).name);menus.put(inv,new Menu(id));
        if(id.isEmpty()){int slot=10;for(Site s:sites.values())inv.setItem(slot++,icon(s.icon,"§6"+s.name,s.hint,"点击查看入口、组队、挑战与奖励"));}
        else{Site s=site(id);inv.setItem(10,icon(Material.ENDER_PEARL,s.entry.isEmpty()?"§b前往遗迹外围":"§b前往墓穴入口","8魔力；抵达后仍须主动开始、逐室清怪"));inv.setItem(12,icon(Material.IRON_SWORD,"§a开始普通挑战","须亲自站在首室；10秒组队集结"));inv.setItem(13,icon(Material.DIAMOND_SWORD,"§6开始冒险挑战","更强怪物；每日奖励二倍"));inv.setItem(14,icon(Material.NETHERITE_SWORD,"§5开始末日挑战","更强怪物；每日奖励三倍"));inv.setItem(16,icon(Material.SUNFLOWER,"§a加入正在集结的队伍","须站在首室；每队最多8人"));inv.setItem(22,icon(Material.BARRIER,"§c退出自己的挑战","留在原地；自行步行或使用传送技能"));inv.setItem(30,icon(Material.CHEST,"§6领取已完成奖励","存入个人箱；满队列时保留凭据"));inv.setItem(31,icon(Material.WRITTEN_BOOK,"§e路线与当前进度","清理每个标记房间并返回首室"));inv.setItem(49,icon(Material.ARROW,"§7返回地下城列表"));}
        p.openInventory(inv);
    }
    @EventHandler public void click(InventoryClickEvent e){
        Menu menu=menus.get(e.getView().getTopInventory());if(menu==null)return;e.setCancelled(true);if(!(e.getWhoClicked() instanceof Player p))return;int slot=e.getRawSlot();if(slot<0||slot>=54)return;
        Bukkit.getScheduler().runTask(plugin,()->{if(!p.isOnline())return;if(menu.site.isEmpty()){List<Site> list=new ArrayList<>(sites.values());if(slot>=10&&slot<10+list.size())open(p,list.get(slot-10).id);return;}String action=switch(slot){case 10->"travel";case 12,13,14->"start";case 16->"join";case 22->"leave";case 30->"claim";case 31->"info";default->"";};if(slot==49){open(p,"");return;}if(action.isEmpty())return;p.closeInventory();command(p,new String[]{"dungeon",action,menu.site,slot==13?"adventure":slot==14?"apocalypse":"normal"});if(slot==31)command(p,new String[]{"dungeon","status",menu.site});});
    }
    @EventHandler public void drag(InventoryDragEvent e){if(menus.containsKey(e.getView().getTopInventory()))e.setCancelled(true);}
    @EventHandler public void close(InventoryCloseEvent e){menus.remove(e.getInventory());}
}
