package org.afuhome.agentfriend;

import com.google.gson.*;
import java.nio.*;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.entity.*;
import org.bukkit.event.*;
import org.bukkit.event.entity.*;
import org.bukkit.event.inventory.*;
import org.bukkit.event.player.*;
import org.bukkit.inventory.*;

/** Player-written, funded contracts. Currency, escrow, goods and receipts share one atomic state write. */
final class PlayerContracts implements Listener {
    private static final String ROOT="player-contracts", WALLET="dungeon-emerald-wallet.", CHANNEL="mcagent:commission";
    private static final Set<String> MOBS=Set.of("zombie","husk","drowned","skeleton","stray","wither_skeleton","spider","cave_spider","creeper","enderman","blaze","witch","pillager","vindicator","ravager","hoglin","piglin_brute","ghast","magma_cube","slime","phantom","wither","ender_dragon");
    // Small single-block structures cannot satisfy a four-zone walking survey.
    private static final Set<String> STRUCTURES=Set.of("mansion","fortress","end_city","stronghold","ancient_city","bastion_remnant","monument","mineshaft","mineshaft_mesa","village_plains","village_desert","village_savanna","village_snowy","village_taiga");
    private final AgentFriendPlugin plugin;
    private final ExplorationObjectives surveys;
    private final Map<Inventory,Menu> menus=new IdentityHashMap<>();
    private final Set<UUID> locked=new HashSet<>();
    private final Map<String,Long> participation=new HashMap<>();
    private int cursor;
    private record Menu(UUID owner,String kind,List<String> ids,int page,String type,String target,int count,int reward){}
    PlayerContracts(AgentFriendPlugin plugin) {
        this.plugin=plugin;
        surveys=new ExplorationObjectives(plugin,p->ROOT+".jobs."+active(p)+".survey");
        Bukkit.getPluginManager().registerEvents(this,plugin);
        Bukkit.getMessenger().registerOutgoingPluginChannel(plugin,CHANNEL);
        Bukkit.getScheduler().runTaskTimer(plugin,this::observe,5,5);
        Bukkit.getScheduler().runTaskTimer(plugin,surveys::flush,200,200);
        Bukkit.getScheduler().runTask(plugin,()->Bukkit.getOnlinePlayers().forEach(this::recover));
    }
    void shutdown(){surveys.flush();}
    private ConfigurationSection jobs(){return plugin.getConfig().getConfigurationSection(ROOT+".jobs");}
    private ConfigurationSection job(String id){return id!=null&&id.matches("pc_[a-f0-9]{12}")?plugin.getConfig().getConfigurationSection(ROOT+".jobs."+id):null;}
    private String active(Player p){return plugin.getConfig().getString(ROOT+".active."+p.getUniqueId(),"");}
    private int balance(UUID id){String path=WALLET+id;require(!plugin.getConfig().contains(path)||plugin.getConfig().isInt(path),"invalid_wallet");int value=plugin.getConfig().getInt(path,0);require(value>=0&&value<=1000000000,"invalid_wallet");return value;}
    private void validateLedger(){for(String path:List.of(ROOT,ROOT+".jobs",ROOT+".active"))require(!plugin.getConfig().contains(path)||plugin.getConfig().isConfigurationSection(path),"invalid_ledger");}
    private boolean valid(Player p){return p.getGameMode()==GameMode.SURVIVAL&&!p.isDead()&&!plugin.pvp().inMatch(p)&&!locked.contains(p.getUniqueId());}
    private static boolean live(ConfigurationSection c){return Set.of("open","accepted","settling").contains(c.getString("state",""));}
    private boolean own(Player p,ConfigurationSection c){return p.getUniqueId().toString().equals(c.getString("owner"));}
    private boolean taken(Player p,ConfigurationSection c){return p.getUniqueId().toString().equals(c.getString("runner"));}
    private void result(Player p,String action,String id,String reason){JsonObject j=new JsonObject();j.addProperty("action",action);j.addProperty("id",id);j.addProperty("success",reason.equals("success"));j.addProperty("reason",reason);send(p,"MC_COMMISSION_RESULT",j);String hint=switch(reason){case "insufficient_wallet"->"绿宝石余额不足，试炼或回收装备可赚取";case "plain_items_missing"->"普通物资不足，附魔、命名和绑定物品不计";case "objective_incomplete"->"尚未完成走查、返程或讨伐条件";case "self_contract"->"不能接自己的委托";case "not_open"->"委托已被接取或已结束";case "owner_only"->"只有发布者可以撤回";case "runner_only"->"只有接单者可以交付或放弃";case "not_accepted"->"委托已结束或未处于接单状态";case "accepted_contract_requires_abandon"->"只能撤回未接单委托；已接单须先由接单者放弃";case "already_accepting_contract"->"请先完成或放弃当前玩家委托";case "owner_pending_full"->"发布者奖励队列已满，请先腾出空间";case "data_unavailable"->"记录保存失败，本次未扣款，请联系服主";case "structure_not_supported"->"请选择府邸、要塞、末地城、古城、据点、村庄等可走查的大型遗迹";case "survival_required"->"需要存活的生存玩家，且不能处于竞技或交付恢复中";default->reason;};p.sendMessage(reason.equals("success")?"§a玩家委托操作完成。":"§e委托未执行："+hint+"；/mycli commission info "+id+" 查看约定。");}
    private void send(Player p,String prefix,JsonObject j){j.addProperty("schemaVersion",1);j.addProperty("type",prefix);p.sendMessage(prefix+" "+j);byte[] bytes=j.toString().getBytes(StandardCharsets.UTF_8);if(bytes.length<=32766)p.sendPluginMessage(plugin,CHANNEL,bytes);}
    private void require(boolean condition,String reason){if(!condition)throw new IllegalArgumentException(reason);}
    private void atomic(Runnable change) {
        String before=plugin.getConfig().saveToString();Path file=plugin.getDataFolder().toPath().resolve("config.yml"),temp=file.resolveSibling("config.yml.commission.tmp");
        try {
            validateLedger();
            change.run();byte[] bytes=plugin.getConfig().saveToString().getBytes(StandardCharsets.UTF_8);
            require(bytes.length<=16*1024*1024,"state_capacity");
            try(FileChannel out=FileChannel.open(temp,StandardOpenOption.CREATE,StandardOpenOption.TRUNCATE_EXISTING,StandardOpenOption.WRITE)){ByteBuffer b=ByteBuffer.wrap(bytes);while(b.hasRemaining())out.write(b);out.force(true);}
            Files.move(temp,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
        } catch(Exception e) {
            try{plugin.getConfig().loadFromString(before);}catch(Exception broken){throw new IllegalStateException("state_restore_failed",broken);}
            if(e instanceof IllegalArgumentException argument)throw argument;
            plugin.getLogger().warning("Player contract durable write failed: "+e.getClass().getSimpleName());
            throw new IllegalArgumentException("data_unavailable");
        }
    }
    void command(Player p,String[] args) {
        String action=args.length>1?args[1].toLowerCase(Locale.ROOT):"list",id=args.length>2?args[2]:"";
        try {
            validateLedger();
            switch(action) {
                case "list","mine"->{int page=args.length>2?Integer.parseInt(args[2]):1;list(p,action.equals("mine"),page);}
                case "menu"->open(p,1);
                case "publishmenu"->draft(p,"delivery","",64,10);
                case "info","status"->{if(id.isEmpty())id=active(p);ConfigurationSection c=job(id);require(c!=null,"unknown_contract");send(p,"MC_COMMISSION",info(p,id,c));}
                case "publish"->{require(args.length>=5,"usage_publish");String type=args[2].toLowerCase(Locale.ROOT),target=args[3].toLowerCase(Locale.ROOT);int count=type.equals("delivery")||type.equals("hunt")?Integer.parseInt(args[4]):4;int rewardIndex=type.equals("delivery")||type.equals("hunt")?5:4;require(args.length>rewardIndex,"usage_publish");int reward=Integer.parseInt(args[rewardIndex]);String title=args.length>rewardIndex+1?String.join(" ",Arrays.copyOfRange(args,rewardIndex+1,args.length)):type+" "+target;publish(p,type,target,count,reward,title);}
                case "accept"->accept(p,id);
                case "claim"->{if(id.isEmpty())id=active(p);claim(p,id);}
                case "abandon"->{if(id.isEmpty())id=active(p);abandon(p,id);}
                case "cancel"->cancel(p,id);
                default->help(p);
            }
        }catch(IllegalArgumentException e){result(p,action,id,e instanceof NumberFormatException?"invalid_number":e.getMessage());}
    }
    private void help(Player p){p.sendMessage("/mycli commission list|mine|menu|info <ID>|accept <ID>|claim [ID]|abandon [ID]|cancel <ID>");p.sendMessage("发布：publish delivery <物品ID> <数量> <绿宝石余额报酬> <标题>；publish hunt <怪物ID> <数量> <报酬> <标题>；publish explore <overworld|nether|end> <报酬> <标题>；publish structure <原版结构ID> <报酬> <标题>");p.sendMessage("余额见 /mycli arena wallet，回收装备或试炼可赚取。先托管后发布；每单一位接单者，结伴任务须发布者同行。");}
    private void publish(Player p,String type,String target,int count,int reward,String rawTitle) {
        require(valid(p),"survival_required");require(Set.of("delivery","hunt","explore","structure").contains(type),"invalid_type");require(reward>=1&&reward<=100000,"reward_1_to_100000");
        String title=ChatColor.stripColor(rawTitle).strip();require(!title.isBlank()&&title.codePointCount(0,title.length())<=40&&title.chars().noneMatch(Character::isISOControl),"title_1_to_40_characters");
        require(jobs()==null||jobs().getKeys(false).size()<4000,"history_capacity");
        int total=0,ownCount=0;if(jobs()!=null)for(String key:jobs().getKeys(false)){var c=job(key);require(c!=null,"invalid_ledger");if(live(c)){total++;if(own(p,c))ownCount++;}}
        require(total<200&&ownCount<5,"open_contract_limit");require(balance(p.getUniqueId())>=reward,"insufficient_wallet");
        String dimension=switch(p.getWorld().getEnvironment()){case NETHER->"nether";case THE_END->"end";default->"overworld";};
        if(type.equals("delivery")){Material m=Material.matchMaterial(target);require(m!=null&&m.isItem()&&!m.isAir(),"invalid_material");require(count>=1&&count<=1024,"quantity_1_to_1024");target=m.name().toLowerCase(Locale.ROOT);}
        if(type.equals("hunt")){target=target.replace("minecraft:","");require(MOBS.contains(target)&&count>=1&&count<=128,"hostile_type_or_quantity");}
        if(type.equals("explore")){require(Set.of("overworld","nether","end").contains(target),"invalid_dimension");dimension=target;count=4;}
        if(type.equals("structure")){NamespacedKey key=NamespacedKey.fromString(target);require(key!=null&&Registry.STRUCTURE.get(key)!=null,"unknown_structure");require(key.getNamespace().equals("minecraft")&&STRUCTURES.contains(key.getKey()),"structure_not_supported");target=key.toString();dimension=target.contains("fortress")||target.contains("bastion")?"nether":target.contains("end_city")?"end":"overworld";count=4;}
        final String selected=target,dim=dimension;final int amount=count;String id="pc_"+UUID.randomUUID().toString().replace("-","").substring(0,12);
        require(job(id)==null,"id_collision");
        atomic(()->{var c=plugin.getConfig().createSection(ROOT+".jobs."+id);c.set("owner",p.getUniqueId().toString());c.set("ownerName",p.getName());c.set("title",title);c.set("type",type);c.set("target",selected);c.set("dimension",dim);c.set("count",amount);c.set("reward",reward);c.set("state","open");c.set("createdAt",System.currentTimeMillis());plugin.getConfig().set(WALLET+p.getUniqueId(),balance(p.getUniqueId())-reward);});
        result(p,"publish",id,"success");send(p,"MC_COMMISSION",info(p,id,job(id)));p.sendMessage("§a报酬已托管；其他玩家 /mycli commission accept "+id+" 接单。");
    }
    private void accept(Player p,String id) {
        require(valid(p),"survival_required");var c=job(id);require(c!=null,"unknown_contract");require(c.getString("state").equals("open"),"not_open");require(!own(p,c),"self_contract");require(active(p).isEmpty(),"already_accepting_contract");
        atomic(()->{c.set("runner",p.getUniqueId().toString());c.set("runnerName",p.getName());c.set("state","accepted");c.set("acceptedAt",System.currentTimeMillis());c.set("progress",0);c.set("return",p.getLocation());plugin.getConfig().set(ROOT+".active."+p.getUniqueId(),id);});result(p,"accept",id,"success");send(p,"MC_COMMISSION",info(p,id,c));
    }
    private void cancel(Player p,String id) {
        var c=job(id);require(c!=null,"unknown_contract");require(own(p,c),"owner_only");require(c.getString("state").equals("open"),"accepted_contract_requires_abandon");
        atomic(()->{credit(p.getUniqueId(),c.getInt("reward"));c.set("state","cancelled");c.set("closedAt",System.currentTimeMillis());});result(p,"cancel",id,"success");
    }
    private void abandon(Player p,String id) {
        var c=job(id);require(c!=null&&taken(p,c),"runner_only");require(c.getString("state").equals("accepted"),"not_accepted");
        surveys.forget(p);atomic(()->{c.set("runner",null);c.set("runnerName",null);c.set("state","open");c.set("progress",0);c.set("survey",null);c.set("surveyReady",false);c.set("kills",null);plugin.getConfig().set(ROOT+".active."+p.getUniqueId(),null);});result(p,"abandon",id,"success");
    }
    private void credit(UUID id,int amount){long value=(long)balance(id)+amount;require(value>=0&&value<=1000000000L,"wallet_capacity");plugin.getConfig().set(WALLET+id,(int)value);}
    private void finish(Player p,String id) {
        var c=job(id);UUID owner=UUID.fromString(c.getString("owner"));
        atomic(()->{if(c.getString("type").equals("delivery")){for(Object entry:c.getList("goods",List.of())){require(entry instanceof ItemStack,"invalid_delivery_journal");require(plugin.dungeon().queuePurchased(owner,(ItemStack)entry),"owner_pending_full");}}
            credit(p.getUniqueId(),c.getInt("reward"));c.set("state","completed");c.set("closedAt",System.currentTimeMillis());c.set("before",null);c.set("after",null);c.set("goods",null);plugin.getConfig().set(ROOT+".active."+p.getUniqueId(),null);});
        locked.remove(p.getUniqueId());surveys.forget(p);result(p,"claim",id,"success");p.sendMessage("§a已获得 "+c.getInt("reward")+" 绿宝石余额。"+(c.getString("type").equals("delivery")?"物资已送入发布者个人奖励箱待入箱队列。":"同行目标已验收。"));
    }
    private void claim(Player p,String id) {
        require(valid(p),"survival_required");var c=job(id);require(c!=null&&taken(p,c),"runner_only");require(c.getString("state").equals("accepted"),"not_accepted");require((long)balance(p.getUniqueId())+c.getInt("reward")<=1000000000L,"wallet_capacity");
        if(!c.getString("type").equals("delivery")){require(ready(p,c),"objective_incomplete");finish(p,id);return;}
        p.closeInventory();Material material=Material.matchMaterial(c.getString("target"));int need=c.getInt("count");
        ItemStack[] before=cloneItems(p.getInventory().getStorageContents()),after=cloneItems(before);List<ItemStack> goods=new ArrayList<>();
        for(int i=0;i<after.length&&need>0;i++){var item=after[i];if(item==null||item.getType()!=material||item.hasItemMeta()||plugin.isSoulbound(item))continue;int take=Math.min(need,item.getAmount());var part=item.clone();part.setAmount(take);goods.add(part);need-=take;item.setAmount(item.getAmount()-take);if(item.getAmount()==0)after[i]=null;}
        require(need==0,"plain_items_missing");UUID owner=UUID.fromString(c.getString("owner"));require(plugin.dungeon().queuedItems(owner)+goods.size()<=1024,"owner_pending_full");
        atomic(()->{c.set("state","settling");c.set("before",Arrays.asList(before));c.set("after",Arrays.asList(after));c.set("goods",goods);});
        locked.add(p.getUniqueId());recover(p);
    }
    private ItemStack[] cloneItems(ItemStack[] items){return Arrays.stream(items).map(i->i==null?null:i.clone()).toArray(ItemStack[]::new);}
    private ItemStack[] journal(ConfigurationSection c,String key){List<?> items=c.getList(key);require(items!=null&&items.size()==36,"invalid_delivery_journal");ItemStack[] result=new ItemStack[36];for(int i=0;i<36;i++){Object o=items.get(i);require(o==null||o instanceof ItemStack,"invalid_delivery_journal");result[i]=o==null?null:((ItemStack)o).clone();}return result;}
    private void recover(Player p) {
        String id=active(p);var c=job(id);if(c==null||!taken(p,c)||!c.getString("state").equals("settling"))return;
        locked.add(p.getUniqueId());
        try{ItemStack[] before=journal(c,"before"),after=journal(c,"after"),now=p.getInventory().getStorageContents();require(Arrays.equals(now,before)||Arrays.equals(now,after),"delivery_inventory_conflict");p.getInventory().setStorageContents(after);p.saveData();finish(p,id);}
        catch(RuntimeException e){p.sendMessage("§c物资交付尚待安全恢复："+e.getMessage()+"；请联系服主，物品与报酬仍保留在交付记录。");}
    }
    private boolean together(Player runner,ConfigurationSection c){Player owner=Bukkit.getPlayer(UUID.fromString(c.getString("owner")));return owner!=null&&owner.getGameMode()==GameMode.SURVIVAL&&!owner.isDead()&&owner.getWorld()==runner.getWorld()&&owner.getLocation().distanceSquared(runner.getLocation())<=32*32;}
    private ExplorationObjectives.Target target(ConfigurationSection c){boolean structure=c.getString("type").equals("structure");int sections=c.getString("target").equals("minecraft:monument")?1:2;return new ExplorationObjectives.Target(structure?GuildManager.Goal.STRUCTURE:GuildManager.Goal.DIMENSION,c.getString("dimension"),structure?List.of(c.getString("target")):List.of(),structure?4:16,structure?24:64,20,structure?sections:0,1,0);}
    private boolean ready(Player p,ConfigurationSection c){if(c.getString("type").equals("hunt"))return c.getInt("progress")>=c.getInt("count");Location origin=c.getLocation("return");return c.getBoolean("surveyReady")&&origin!=null&&origin.getWorld()==p.getWorld()&&origin.distanceSquared(p.getLocation())<=16*16&&together(p,c);}
    private void observe() {
        List<Player> online=new ArrayList<>(Bukkit.getOnlinePlayers());if(online.isEmpty())return;long deadline=System.nanoTime()+2000000;
        for(int i=0;i<Math.min(4,online.size());i++) {Player p=online.get(Math.floorMod(cursor++,online.size()));var c=job(active(p));if(c==null||!c.getString("state").equals("accepted")||!Set.of("explore","structure").contains(c.getString("type")))continue;
            if(!valid(p)||!together(p,c)){surveys.resetMovement(p);continue;}
            var evidence=surveys.observe(p,target(c),4,active(p));c.set("surveyReady",evidence.ready());c.set("progress",evidence.progress());
            if(System.nanoTime()>=deadline)break;
        }
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void engaged(EntityDamageByEntityEvent e) {
        Entity source=e.getDamager();if(source instanceof Projectile projectile&&projectile.getShooter() instanceof Player player)source=player;
        if(!(source instanceof Player p)||!valid(p)||e.getFinalDamage()<=0)return;var c=job(active(p));
        if(c==null||!c.getString("state").equals("accepted")||!c.getString("type").equals("hunt")||!e.getEntityType().getKey().getKey().equals(c.getString("target"))||!together(p,c))return;
        long now=System.currentTimeMillis();participation.entrySet().removeIf(row->now-row.getValue()>30000);
        if(participation.size()<512)participation.put(p.getUniqueId()+":"+e.getEntity().getUniqueId(),now);
    }
    @EventHandler(priority=EventPriority.MONITOR) public void killed(EntityDeathEvent e) {
        Player killer=e.getEntity().getKiller();if(killer==null)return;
        for(Player p:Bukkit.getOnlinePlayers()){String id=active(p);var c=job(id);
        if(!valid(p)||c==null||!c.getString("state").equals("accepted")||!c.getString("type").equals("hunt")||!e.getEntity().getType().getKey().getKey().equals(c.getString("target"))||!together(p,c)||c.getInt("progress")>=c.getInt("count"))continue;
        boolean assisted=killer.getUniqueId().toString().equals(c.getString("owner"))&&System.currentTimeMillis()-participation.getOrDefault(p.getUniqueId()+":"+e.getEntity().getUniqueId(),0L)<=30000;
        if(!killer.getUniqueId().equals(p.getUniqueId())&&!assisted)continue;
        List<String> kills=new ArrayList<>(c.getStringList("kills"));if(kills.contains(e.getEntity().getUniqueId().toString()))return;kills.add(e.getEntity().getUniqueId().toString());
        try{atomic(()->{c.set("kills",kills);c.set("progress",kills.size());});p.sendMessage("§a结伴讨伐 "+kills.size()+"/"+c.getInt("count")+"；完成后 commission claim 结算。");}catch(IllegalArgumentException failed){p.sendMessage("§c此次讨伐记录写入失败，未增加进度。");}
        }
        String suffix=":"+e.getEntity().getUniqueId();participation.keySet().removeIf(key->key.endsWith(suffix));
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void teleport(PlayerTeleportEvent e){surveys.resetMovement(e.getPlayer());}
    @EventHandler public void death(PlayerDeathEvent e){surveys.resetMovement(e.getEntity());}
    @EventHandler(priority=EventPriority.LOWEST) public void join(PlayerJoinEvent e){recover(e.getPlayer());}
    @EventHandler public void quit(PlayerQuitEvent e){surveys.quit(e.getPlayer());locked.remove(e.getPlayer().getUniqueId());}
    @EventHandler(priority=EventPriority.HIGHEST) public void lockCommands(PlayerCommandPreprocessEvent e){if(locked.contains(e.getPlayer().getUniqueId())){e.setCancelled(true);recover(e.getPlayer());}}
    @EventHandler(priority=EventPriority.HIGHEST) public void lockDrop(PlayerDropItemEvent e){if(locked.contains(e.getPlayer().getUniqueId()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void lockPickup(EntityPickupItemEvent e){if(locked.contains(e.getEntity().getUniqueId()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void lockInteract(PlayerInteractEvent e){if(locked.contains(e.getPlayer().getUniqueId()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void lockSwap(PlayerSwapHandItemsEvent e){if(locked.contains(e.getPlayer().getUniqueId()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void lockConsume(PlayerItemConsumeEvent e){if(locked.contains(e.getPlayer().getUniqueId()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void lockEntity(PlayerInteractEntityEvent e){if(locked.contains(e.getPlayer().getUniqueId()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void lockAttack(EntityDamageByEntityEvent e){if(locked.contains(e.getDamager().getUniqueId()))e.setCancelled(true);}
    private JsonObject info(Player p,String id,ConfigurationSection c) {
        JsonObject j=new JsonObject();for(String key:List.of("title","type","target","dimension","ownerName","runnerName","state"))j.addProperty(key,c.getString(key,""));j.addProperty("id",id);j.addProperty("count",c.getInt("count"));j.addProperty("reward",c.getInt("reward"));j.addProperty("currency","arena_emerald_wallet");j.addProperty("progress",c.getInt("progress"));j.addProperty("surveyReady",c.getBoolean("surveyReady"));j.addProperty("isOwner",own(p,c));j.addProperty("isRunner",taken(p,c));j.addProperty("wallet",balance(p.getUniqueId()));
        for(String key:List.of("createdAt","acceptedAt","closedAt"))if(c.contains(key))j.addProperty(key,c.getLong(key));
        if(Set.of("explore","structure").contains(c.getString("type"))){j.add("exploration",target(c).json());j.addProperty("requiresPublisherWithinBlocks",32);j.addProperty("mustReturnToAcceptedLocation",true);}
        if(c.isString("survey"))try{JsonObject stored=JsonParser.parseString(c.getString("survey")).getAsJsonObject(),evidence=new JsonObject();for(String key:List.of("instance","structure","bounds","distance","movingMs","ready","position"))if(stored.has(key))evidence.add(key,stored.get(key));for(String key:List.of("zones","parts","biomes","trail"))if(stored.has(key))evidence.addProperty(key+"Count",stored.getAsJsonArray(key).size());j.add("evidence",evidence);}catch(RuntimeException ignored){}
        if(c.getString("type").equals("hunt"))j.addProperty("requiresPublisherWithinBlocks",32);
        return j;
    }
    private List<String> visible(Player p,boolean mine) {List<String> rows=new ArrayList<>();if(jobs()!=null)for(String id:jobs().getKeys(false)){var c=job(id);if(c!=null&&(mine?(own(p,c)||taken(p,c)):live(c)))rows.add(id);}Collections.reverse(rows);return rows;}
    private void list(Player p,boolean mine,int page){require(page>=1&&page<=445,"invalid_page");var rows=visible(p,mine);JsonObject j=new JsonObject();j.addProperty("page",page);j.addProperty("pages",Math.max(1,(rows.size()+8)/9));j.addProperty("total",rows.size());JsonArray values=new JsonArray();for(int i=(page-1)*9;i<Math.min(rows.size(),page*9);i++){String id=rows.get(i);values.add(info(p,id,job(id)));}j.add("contracts",values);j.addProperty("wallet",balance(p.getUniqueId()));send(p,"MC_COMMISSION_LIST",j);help(p);}
    private ItemStack icon(Material m,String title,String...lore){ItemStack item=new ItemStack(m);var meta=item.getItemMeta();meta.setDisplayName(title);meta.setLore(Arrays.asList(lore));item.setItemMeta(meta);return item;}
    void open(Player p,int page){var rows=visible(p,false);int pages=Math.max(1,(rows.size()+44)/45);page=Math.max(1,Math.min(page,pages));Inventory inv=Bukkit.createInventory(null,54,"玩家委托 · "+page+"/"+pages);List<String> ids=new ArrayList<>();for(int i=(page-1)*45;i<Math.min(rows.size(),page*45);i++){String id=rows.get(i);var c=job(id);ids.add(id);inv.setItem(ids.size()-1,icon(Material.WRITABLE_BOOK,c.getString("title"),"发布者："+c.getString("ownerName"),"状态："+c.getString("state"),"目标："+c.getString("target")+" × "+c.getInt("count"),"报酬："+c.getInt("reward")+" 绿宝石余额（已托管）","点击阅读约定并确认操作"));}inv.setItem(45,icon(Material.ARROW,"上一页"));inv.setItem(49,icon(Material.CHEST,"个人箱分页","540格，原版箱子界面"));inv.setItem(50,icon(Material.WRITABLE_BOOK,"发布委托","用绿宝石余额托管报酬","余额："+balance(p.getUniqueId())));inv.setItem(53,icon(Material.ARROW,"下一页"));menus.put(inv,new Menu(p.getUniqueId(),"list",ids,page,"","",0,0));p.openInventory(inv);}
    private void detail(Player p,String id){var c=job(id);require(c!=null,"unknown_contract");Inventory inv=Bukkit.createInventory(null,27,"委托约定 · 确认");List<String> lore=new ArrayList<>(List.of(c.getString("title"),"目标："+c.getString("target")+" × "+c.getInt("count"),"报酬："+c.getInt("reward")+" 绿宝石余额","状态："+c.getString("state"),"进度："+c.getInt("progress")));
        if(!c.getString("type").equals("delivery"))lore.add("发布者须32格内同行；探索须走查并返程");else lore.add("只收普通物品；不收附魔、命名或绑定物品");inv.setItem(4,icon(Material.WRITTEN_BOOK,"阅读约定",lore.toArray(String[]::new)));inv.setItem(11,icon(Material.EMERALD,taken(p,c)?"验收交付领取报酬":"确认接取委托"));inv.setItem(15,icon(Material.BARRIER,own(p,c)?"撤回未接委托并退回报酬":"放弃接单（报酬仍托管）"));inv.setItem(22,icon(Material.ARROW,"返回市场"));menus.put(inv,new Menu(p.getUniqueId(),"detail",List.of(id),1,"","",0,0));p.openInventory(inv);send(p,"MC_COMMISSION",info(p,id,c));}
    private void draft(Player p,String type,String target,int count,int reward){if(target.isEmpty()){ItemStack hand=p.getInventory().getItemInMainHand();target=hand.getType().isItem()&&!hand.getType().isAir()?hand.getType().name().toLowerCase(Locale.ROOT):"iron_ingot";}Inventory inv=Bukkit.createInventory(null,27,"发布玩家委托 · 托管确认");inv.setItem(10,icon(Material.CHEST,"物资收购","目标使用当前主手物品种类","数量："+count));inv.setItem(11,icon(Material.IRON_SWORD,"结伴讨伐","点击切换；默认僵尸8只"));inv.setItem(12,icon(Material.COMPASS,"结伴探索","点击切换：下界、末地、主世界"));inv.setItem(13,icon(Material.FILLED_MAP,"遗迹同行","点击切换：林地府邸、下界要塞、末地城"));inv.setItem(14,icon(Material.PAPER,"当前："+type+" / "+target,"数量："+count,"物资可点击切换16/32/64/128"));inv.setItem(15,icon(Material.EMERALD,"报酬："+reward+" 绿宝石余额","点击切换5/10/20/50；从余额托管","你的余额："+balance(p.getUniqueId())));inv.setItem(22,icon(Material.LIME_CONCRETE,"确认发布并托管","每单一位接单者；接单后不能单方撤回","详见物品、数量、报酬；命令可自定义标题"));menus.put(inv,new Menu(p.getUniqueId(),"draft",List.of(),1,type,target,count,reward));p.openInventory(inv);}
    @EventHandler(priority=EventPriority.HIGHEST) public void click(InventoryClickEvent e){if(locked.contains(e.getWhoClicked().getUniqueId()))e.setCancelled(true);Menu m=menus.get(e.getView().getTopInventory());if(m==null)return;e.setCancelled(true);if(!(e.getWhoClicked() instanceof Player p)||!m.owner.equals(p.getUniqueId()))return;int slot=e.getRawSlot();if(slot<0||slot>=e.getView().getTopInventory().getSize())return;menus.remove(e.getView().getTopInventory());p.closeInventory();Bukkit.getScheduler().runTask(plugin,()->{try{if(m.kind.equals("list")){if(slot<m.ids.size())detail(p,m.ids.get(slot));else if(slot==45||slot==53)open(p,m.page+(slot==45?-1:1));else if(slot==49)plugin.dungeon().openStashPages(p);else if(slot==50)draft(p,"delivery","",64,10);}else if(m.kind.equals("detail")){String id=m.ids.get(0);var c=job(id);require(c!=null,"unknown_contract");if(slot==11){if(taken(p,c))claim(p,id);else accept(p,id);}else if(slot==15){if(own(p,c))cancel(p,id);else abandon(p,id);}else open(p,1);}else{String type=m.type,target=m.target;int count=m.count,reward=m.reward;if(slot==22){publish(p,type,target,count,reward,(type.equals("delivery")?"物资收购：":type.equals("hunt")?"结伴讨伐：":"结伴探索：")+target);return;}if(slot==10){type="delivery";target="";count=64;}if(slot==11){type="hunt";target=m.type.equals("hunt")&&m.target.equals("zombie")?"skeleton":"zombie";count=8;}if(slot==12){type="explore";target=m.type.equals("explore")?(m.target.equals("nether")?"end":m.target.equals("end")?"overworld":"nether"):"nether";count=4;}if(slot==13){type="structure";target=m.type.equals("structure")?(m.target.equals("minecraft:mansion")?"minecraft:fortress":m.target.equals("minecraft:fortress")?"minecraft:end_city":"minecraft:mansion"):"minecraft:mansion";count=4;}if(slot==14&&type.equals("delivery"))count=count>=128?16:count*2;if(slot==15)reward=reward==5?10:reward==10?20:reward==20?50:5;draft(p,type,target,count,reward);}}catch(IllegalArgumentException failed){result(p,"menu","",failed.getMessage());}});}
    @EventHandler(priority=EventPriority.HIGHEST) public void drag(InventoryDragEvent e){if(menus.containsKey(e.getView().getTopInventory())||locked.contains(e.getWhoClicked().getUniqueId()))e.setCancelled(true);}
    @EventHandler public void close(InventoryCloseEvent e){menus.remove(e.getInventory());}
}
