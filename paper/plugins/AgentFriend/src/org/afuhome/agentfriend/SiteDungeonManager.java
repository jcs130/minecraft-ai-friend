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
        final Site site;final String id=UUID.randomUUID().toString();final Mode mode;
        final Set<UUID> party=new LinkedHashSet<>();final Map<UUID,Integer> attendance=new HashMap<>();
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
    private boolean playing(Player p){return p!=null&&p.isOnline()&&!p.isDead()&&p.getGameMode()==GameMode.SURVIVAL;}
    private List<Player> present(Run r){return r.party.stream().map(Bukkit::getPlayer).filter(this::playing).filter(p->r.site.contains(p.getLocation())).toList();}
    private void send(Player p,String prefix,Map<String,?> fields){Map<String,Object> data=new LinkedHashMap<>();data.put("schemaVersion",1);data.putAll(fields);p.sendMessage(prefix+" "+JSON.toJson(data));}
    private void result(Player p,String action,String site,String reason){send(p,"MC_SITE_DUNGEON_RESULT",Map.of("action",action,"id",site,"success",reason.equals("success"),"reason",reason));if(!reason.equals("success"))p.sendMessage("§c地下城操作未完成："+reason+"；用 /mycli dungeon info "+site+" 查看入口和规则。");}
    private void tell(Run r,String message){for(UUID id:r.party){Player p=Bukkit.getPlayer(id);if(p!=null)p.sendMessage(message);}}
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
        Run r=id.isEmpty()?own(p):runs.get(site(id).id);
        if(r==null){send(p,"MC_SITE_DUNGEON_STATE",Map.of("active",false,"participant",false,"pendingRewards",pendingSites(p.getUniqueId())));return;}
        Room target=r.stage>=r.site.rooms.size()?r.site.rooms.getFirst():r.room();
        Map<String,Object> fields=new LinkedHashMap<>();fields.put("id",r.site.id);fields.put("active",true);fields.put("participant",r.party.contains(p.getUniqueId()));fields.put("phase",r.phase);fields.put("stage",Math.min(r.stage+1,r.site.rooms.size()));fields.put("stages",r.site.rooms.size());fields.put("remainingMobs",r.mobs.size());fields.put("target",List.of(target.x,target.y,target.z));fields.put("difficulty",r.mode.id);fields.put("paused",r.pausedAt>0||!r.fault.isEmpty());fields.put("fault",r.fault);send(p,"MC_SITE_DUNGEON_STATE",fields);
    }
    private void leave(Player p){
        Run r=own(p);require(r!=null,"not_participating");int count=r.attendance.getOrDefault(p.getUniqueId(),0);
        if(r.party.size()==1)end(r,"party_left");else{r.party.remove(p.getUniqueId());r.attendance.remove(p.getUniqueId());try{persist();}catch(RuntimeException e){r.party.add(p.getUniqueId());r.attendance.put(p.getUniqueId(),count);throw e;}}
        result(p,"leave",r.site.id,"success");p.sendMessage("§e已退出地下城；留在原地，可步行离开或自行使用传送技能。");
    }
    private int receiptCount(){var c=plugin.getConfig().getConfigurationSection(ROOT+".receipts");if(c==null)return 0;int total=0;for(String owner:c.getKeys(false)){var section=c.getConfigurationSection(owner);if(section!=null)total+=section.getKeys(false).size();}return total;}
    private ConfigurationSection receipt(UUID id,String site){return plugin.getConfig().getConfigurationSection(ROOT+".receipts."+id+"."+site);}
    private List<String> pendingSites(UUID id){var c=plugin.getConfig().getConfigurationSection(ROOT+".receipts."+id);return c==null?List.of():new ArrayList<>(c.getKeys(false));}
    private void claim(Player p,String id){
        if(id.isEmpty()){var pending=pendingSites(p.getUniqueId());require(pending.size()==1,"specify_dungeon_id");id=pending.getFirst();}
        String chosen=id;var receipt=receipt(p.getUniqueId(),chosen);require(receipt!=null,"no_pending_reward");
        atomic(()->{
            require(plugin.dungeon().queueGuildRewards(p.getUniqueId(),receipt.getInt("emeralds"),Material.valueOf(receipt.getString("item")),receipt.getInt("count")),"personal_reward_queue_full");
            plugin.getConfig().set(ROOT+".claimed."+p.getUniqueId()+"."+chosen,receipt.getString("day"));plugin.getConfig().set(ROOT+".receipts."+p.getUniqueId()+"."+chosen,null);
        });result(p,"claim",chosen,"success");p.sendMessage("§a地下城奖励已存入个人箱；用 arena rewards/stash 查看。重复领取不会再次发奖。");
    }
    private void tick(){
        long timestamp=System.currentTimeMillis();
        for(var entry:new ArrayList<>(shots.entrySet())){Entity e=Bukkit.getEntity(entry.getKey());if(e==null||!e.isValid()||timestamp>=entry.getValue().expires){if(e!=null)e.remove();shots.remove(entry.getKey());}}
        for(Run r:new ArrayList<>(runs.values())){
        if(!r.fault.isEmpty())continue;
        int previousStage=r.stage;String previousPhase=r.phase;Map<UUID,Integer> previousAttendance=new HashMap<>(r.attendance);
        try{
            long now=System.currentTimeMillis();if(now-r.started>TIMEOUT_MS){end(r,"time_limit");continue;}
            List<Player> present=present(r);
            if(present.isEmpty()){
                if(r.pausedAt==0){r.pausedAt=now;clean(r);if(r.phase.equals("fighting"))r.phase="moving";persist();}
                else if(now-r.pausedAt>REJOIN_MS)end(r,"return_grace_expired");
                continue;
            }
            if(r.pausedAt>0){r.pausedAt=0;persist();tell(r,"§e地下城已续接；未通关房间重新出怪，已通关进度保留。");}
            if(r.phase.equals("muster")){if(now<r.readyAt)continue;r.phase="moving";persist();}
            if(r.phase.equals("returning")){if(present.stream().anyMatch(p->r.site.rooms.getFirst().contains(p.getLocation())))complete(r);continue;}
            if(r.phase.equals("moving")){
                if(present.stream().noneMatch(p->r.room().contains(p.getLocation())))continue;
                if(runs.values().stream().mapToInt(run->run.mobs.size()).sum()+r.room().enemies.size()>GLOBAL_MOBS)continue;
                spawn(r);continue;
            }
            if(!r.phase.equals("fighting"))continue;
            if(r.invalid){end(r,"missing_or_unloaded_enemy_retry_required");continue;}
            for(UUID id:new ArrayList<>(r.mobs.keySet())){
                Entity e=Bukkit.getEntity(id);if(!(e instanceof Mob mob)||!e.isValid()||mob.isDead()){r.invalid=true;continue;}
                Player nearest=present.stream().filter(p->r.room().contains(p.getLocation())).min(Comparator.comparingDouble(p->p.getLocation().distanceSquared(mob.getLocation()))).orElse(null);
                if(nearest!=null){mob.setTarget(nearest);if(!r.room().contains(mob.getLocation())){Location safe=safeSpots(r).stream().filter(l->l.distanceSquared(nearest.getLocation())>=9).findFirst().orElse(null);if(safe!=null)mob.teleport(safe);}}
            }
            if(r.invalid)continue;
            if(r.mobs.isEmpty()){
                for(Player p:present)if(r.room().contains(p.getLocation()))r.attendance.merge(p.getUniqueId(),1,Integer::sum);
                clean(r);r.stage++;r.phase=r.stage==r.site.rooms.size()?"returning":"moving";persist();
                tell(r,"§a战斗室已清理；"+(r.phase.equals("returning")?"返回首室完成本次探索并登记奖励。":"步行前往下一室："+r.room().name+" "+r.room().x+","+r.room().y+","+r.room().z));
            }
        }catch(RuntimeException e){plugin.getLogger().warning("Site dungeon paused for explicit retry: "+r.site.id+" "+e.getMessage());clean(r);r.stage=previousStage;r.attendance.clear();r.attendance.putAll(previousAttendance);r.phase=previousPhase.equals("fighting")?"moving":previousPhase;r.pausedAt=System.currentTimeMillis();r.fault=Objects.toString(e.getMessage(),"runtime_error");tell(r,"§c地下城已暂停："+r.fault+"。本室未结算；解决问题后 dungeon resume 重试，或 dungeon leave 退出。");}
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
                Mob mob=(Mob)w.spawnEntity(at,spec.type());mob.addScoreboardTag(TAG);mob.addScoreboardTag("afu_site_"+r.site.id);spec.equip(mob,r.mode.health*(1+Math.max(0,r.party.size()-1)*.2));
                mob.setCustomName("§c"+r.site.name+" · "+(spec.name().isEmpty()?mob.getType().name():spec.name()));mob.setCustomNameVisible(true);
                r.mobs.put(mob.getUniqueId(),spec);
            }
            r.phase="fighting";r.invalid=false;persist();tell(r,"§c"+room.name+"："+room.enemies.size()+"个标记敌人，优先处理女巫和远程怪。队员须在房间内共同清场。");
        }catch(RuntimeException e){clean(r);r.phase="moving";throw e;}
    }
    private void complete(Run r){
        List<Player> eligible=present(r).stream().filter(p->r.site.rooms.getFirst().contains(p.getLocation())).filter(p->r.attendance.getOrDefault(p.getUniqueId(),0)==r.site.rooms.size()).toList();
        // Returning teammates may arrive separately; issue only to those physically back now.
        for(Player p:eligible){
            UUID id=p.getUniqueId();String rewardDay=day();
            if(rewardDay.equals(plugin.getConfig().getString(ROOT+".claimed."+id+"."+r.site.id))||receipt(id,r.site.id)!=null)continue;
            atomic(()->{String path=ROOT+".receipts."+id+"."+r.site.id;plugin.getConfig().createSection(path,Map.of("day",rewardDay,"run",r.id,"emeralds",r.site.emeralds*r.mode.reward,"item",r.site.bonus.name(),"count",r.site.bonusCount*r.mode.reward));});
            p.sendMessage("§6"+r.site.name+"已完成；dungeon claim "+r.site.id+"领取到个人箱，今日该处仅奖励一次。");
        }
        // Keep the return phase while any eligible online teammate is still walking back.
        boolean waiting=r.party.stream().anyMatch(id->r.attendance.getOrDefault(id,0)==r.site.rooms.size()&&receipt(id,r.site.id)==null&&!day().equals(plugin.getConfig().getString(ROOT+".claimed."+id+"."+r.site.id)));
        if(!waiting)end(r,"completed");
    }
    private void clean(Run r){for(var entry:new ArrayList<>(shots.entrySet()))if(entry.getValue().run==r){Entity e=Bukkit.getEntity(entry.getKey());if(e!=null)e.remove();shots.remove(entry.getKey());}for(UUID id:r.mobs.keySet()){Entity e=Bukkit.getEntity(id);if(e!=null)e.remove();}r.mobs.clear();r.hits.clear();for(Chunk c:r.held)c.removePluginChunkTicket(plugin);r.held.clear();}
    private void end(Run r,String reason){
        Object before=plugin.getConfig().get(ROOT+".cooldowns."+r.site.id);runs.remove(r.site.id);plugin.getConfig().set(ROOT+".cooldowns."+r.site.id,System.currentTimeMillis());
        try{persist();}catch(RuntimeException e){runs.put(r.site.id,r);plugin.getConfig().set(ROOT+".cooldowns."+r.site.id,before);throw e;}
        clean(r);tell(r,"§e地下城结束："+reason+"。已登记的奖励仍可 claim；没有登记的房间不发奖。");
    }
    private void atomic(Runnable change){
        String before=plugin.getConfig().saveToString();Path file=plugin.getDataFolder().toPath().resolve("config.yml"),temp=file.resolveSibling("config.yml.site-dungeon.tmp");
        try{
            change.run();byte[] bytes=plugin.getConfig().saveToString().getBytes(StandardCharsets.UTF_8);require(bytes.length<=16*1024*1024,"state_capacity");
            try(FileChannel out=FileChannel.open(temp,StandardOpenOption.CREATE,StandardOpenOption.TRUNCATE_EXISTING,StandardOpenOption.WRITE)){ByteBuffer b=ByteBuffer.wrap(bytes);while(b.hasRemaining())out.write(b);out.force(true);}
            Files.move(temp,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
        }catch(Exception e){try{plugin.getConfig().loadFromString(before);}catch(Exception restore){throw new IllegalStateException("state_restore_failed",restore);}if(e instanceof IllegalArgumentException argument)throw argument;throw new IllegalArgumentException("data_unavailable");}
    }
    private void persist(){
        require(blockedCheckpoints.isEmpty(),"checkpoint_conflict_requires_operator");
        atomic(()->{
            plugin.getConfig().set(ROOT+".runs",null);
            for(Run r:runs.values()){
                String path=ROOT+".runs."+r.site.id;Map<String,Object> saved=new LinkedHashMap<>();
                saved.put("mode",r.mode.id);saved.put("definition",JSON.toJson(r.site));saved.put("stage",r.stage);saved.put("phase",r.phase);saved.put("fault",r.fault);saved.put("started",r.started);saved.put("pausedAt",r.pausedAt);saved.put("party",r.party.stream().map(UUID::toString).toList());
                Map<String,Integer> attendance=new LinkedHashMap<>();r.attendance.forEach((id,count)->attendance.put(id.toString(),count));saved.put("attendance",attendance);plugin.getConfig().set(path,saved);
            }
        });
    }
    private void restore(){
        var saved=plugin.getConfig().getConfigurationSection(ROOT+".runs");if(saved==null)return;
        for(String id:saved.getKeys(false))try{
            Site site=site(id);var c=saved.getConfigurationSection(id);Run r=new Run(site,Mode.parse(c.getString("mode","normal")));
            require(JSON.toJson(site).equals(c.getString("definition")),"definition_changed_checkpoint_preserved");
            r.stage=c.getInt("stage");require(r.stage>=0&&r.stage<=site.rooms.size(),"invalid_checkpoint");r.started=c.getLong("started");if(System.currentTimeMillis()-r.started>TIMEOUT_MS){plugin.getLogger().info("Site dungeon checkpoint expired: "+id);continue;}
            r.phase=r.stage==site.rooms.size()?"returning":"moving";r.fault=c.getString("fault","");r.pausedAt=c.getLong("pausedAt",System.currentTimeMillis());if(r.pausedAt==0)r.pausedAt=System.currentTimeMillis();
            for(String raw:c.getStringList("party")){UUID uuid=UUID.fromString(raw);require(r.party.size()<PARTY_LIMIT,"party_limit");require(runs.values().stream().noneMatch(old->old.party.contains(uuid)),"duplicate_participant");r.party.add(uuid);r.attendance.put(uuid,c.getInt("attendance."+raw));}
            require(!r.party.isEmpty(),"empty_party");runs.put(id,r);
        }catch(RuntimeException e){blockedCheckpoints.add(id);ready=false;plugin.getLogger().warning("Site dungeon checkpoint preserved for operator: "+id+" "+e.getMessage());}
    }
    void shutdown(){try{if(blockedCheckpoints.isEmpty())persist();}finally{for(Run r:runs.values())clean(r);}}
    private boolean owned(Entity e){return e!=null&&e.getScoreboardTags().contains(TAG);}
    private Run owner(Entity e){if(e==null)return null;Shot shot=shots.get(e.getUniqueId());if(shot!=null)return shot.run;if(!owned(e))return null;return runs.values().stream().filter(r->r.mobs.containsKey(e.getUniqueId())).findFirst().orElse(null);}
    private Entity actor(Entity e){if(e instanceof Projectile p){ProjectileSource source=p.getShooter();return source instanceof Entity a?a:null;}return e;}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void target(EntityTargetLivingEntityEvent e){Run r=owner(e.getEntity());if(r!=null&&e.getTarget()!=null&&!(e.getTarget() instanceof Player p&&playing(p)&&r.party.contains(p.getUniqueId())&&r.room().contains(p.getLocation())))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void damage(EntityDamageByEntityEvent e){
        Run from=owner(e.getDamager());if(from==null)from=owner(actor(e.getDamager()));Run to=owner(e.getEntity());
        if(from!=null){if(!(e.getEntity() instanceof Player p&&playing(p)&&from.party.contains(p.getUniqueId())&&from.room().contains(p.getLocation())))e.setCancelled(true);else{e.setDamage(e.getDamage()*from.mode.damage);from.hits.put(actor(e.getDamager()).getUniqueId(),System.currentTimeMillis());}}
        if(to!=null&&actor(e.getDamager()) instanceof Player p&&!to.party.contains(p.getUniqueId()))e.setCancelled(true);
    }
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void launch(ProjectileLaunchEvent e){Run r=owner(actor(e.getEntity()));if(r==null)return;if(shots.size()>=128){e.setCancelled(true);return;}e.getEntity().addScoreboardTag(SHOT_TAG);shots.put(e.getEntity().getUniqueId(),new Shot(r,System.currentTimeMillis()+15_000));}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void splash(PotionSplashEvent e){Run r=owner(e.getPotion());if(r==null)r=owner(actor(e.getPotion()));if(r!=null)for(LivingEntity l:e.getAffectedEntities())if(!(l instanceof Player p&&playing(p)&&r.party.contains(p.getUniqueId())&&r.room().contains(p.getLocation())))e.setIntensity(l,0);}
    @EventHandler public void death(EntityDeathEvent e){Run r=owner(e.getEntity());if(r!=null){r.mobs.remove(e.getEntity().getUniqueId());e.getDrops().clear();e.setDroppedExp(0);}}
    @EventHandler public void load(EntitiesLoadEvent e){for(Entity entity:e.getEntities())if((owned(entity)||entity.getScoreboardTags().contains(SHOT_TAG))&&owner(entity)==null)entity.remove();}
    @EventHandler public void rejoin(PlayerJoinEvent e){Run r=own(e.getPlayer());if(r!=null)e.getPlayer().sendMessage("§e地下城进度保留；dungeon status 查看当前室，5分钟内步行返回即可续打，不自动免费传送。");}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void breakBlock(BlockBreakEvent e){if(runs.values().stream().anyMatch(r->r.site.contains(e.getBlock().getLocation()))){e.setCancelled(true);e.getPlayer().sendMessage("§c挑战中的地下城不能拆建；请通过原有道路探索。");}}
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void placeBlock(BlockPlaceEvent e){if(runs.values().stream().anyMatch(r->r.site.contains(e.getBlock().getLocation()))){e.setCancelled(true);e.getPlayer().sendMessage("§c挑战中的地下城不能拆建。");}}
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
