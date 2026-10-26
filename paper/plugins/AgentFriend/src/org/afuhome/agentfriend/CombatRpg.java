package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.*;
import java.util.concurrent.*;
import org.bukkit.*;
import org.bukkit.attribute.*;
import org.bukkit.entity.*;
import org.bukkit.event.*;
import org.bukkit.event.entity.*;
import org.bukkit.event.player.*;
import org.bukkit.persistence.PersistentDataType;

/** Combat-earned character levels. Bukkit work stays on the main thread; one
 * bounded I/O worker publishes durable snapshots. No farm/quest-fame conversion. */
final class CombatRpg implements Listener {
    private static final Map<EntityType,Integer> XP=Map.ofEntries(
            Map.entry(EntityType.ZOMBIE,18),Map.entry(EntityType.HUSK,18),Map.entry(EntityType.DROWNED,20),
            Map.entry(EntityType.SKELETON,22),Map.entry(EntityType.STRAY,24),Map.entry(EntityType.SPIDER,16),
            Map.entry(EntityType.CAVE_SPIDER,22),Map.entry(EntityType.CREEPER,20),Map.entry(EntityType.WITCH,35),
            Map.entry(EntityType.ENDERMAN,35),Map.entry(EntityType.WITHER_SKELETON,35),Map.entry(EntityType.PILLAGER,24),
            Map.entry(EntityType.VINDICATOR,40),Map.entry(EntityType.RAVAGER,100),Map.entry(EntityType.EVOKER,65),
            Map.entry(EntityType.BLAZE,30),Map.entry(EntityType.GHAST,45),Map.entry(EntityType.PHANTOM,18),
            Map.entry(EntityType.MAGMA_CUBE,12),Map.entry(EntityType.SLIME,8),Map.entry(EntityType.HOGLIN,30));
    private record Contribution(double damage,double tanking,double healing,long at) {
        Contribution add(double d,double t,double h,long time){return new Contribution(Math.min(1e6,damage+d),Math.min(1e6,tanking+t),Math.min(1e6,healing+h),time);}
    }
    private final AgentFriendPlugin plugin;
    private final CombatRpgLedger ledger;
    private final ExecutorService io=Executors.newSingleThreadExecutor(r->{var t=new Thread(r,"AgentFriend-Combat-Ledger");t.setDaemon(true);return t;});
    private final Map<UUID,Map<UUID,Contribution>> contributions=new HashMap<>();
    private final LinkedHashMap<UUID,CombatRpgLedger.Award> pending=new LinkedHashMap<>();
    private final NamespacedKey origin,healthKey,attackKey;
    private boolean writing,stopping,fault;
    private int ticks;
    private RpgTabBridge tab;
    CombatRpg(AgentFriendPlugin plugin)throws Exception {
        this.plugin=plugin;ledger=new CombatRpgLedger(plugin.getDataFolder().toPath().resolve("combat-rpg-ledger.json"));
        origin=new NamespacedKey(plugin,"combat_origin");healthKey=new NamespacedKey(plugin,"combat_health");attackKey=new NamespacedKey(plugin,"combat_attack");
        Bukkit.getPluginManager().registerEvents(this,plugin);
        Bukkit.getScheduler().runTaskTimer(plugin,this::tick,20,20);
        if(Bukkit.getPluginManager().isPluginEnabled("TAB"))tab=new RpgTabBridge(plugin,this);
    }
    private boolean eligible(Player p){return p.isOnline()&&!p.isDead()&&!plugin.isObserver(p)&&!plugin.pvpParticipant(p)
            &&Set.of(GameMode.SURVIVAL,GameMode.ADVENTURE).contains(p.getGameMode());}
    private Player attacker(Entity e){return e instanceof Player p?p:e instanceof Projectile projectile&&projectile.getShooter() instanceof Player p?p:null;}
    private LivingEntity hostileAttacker(Entity e){return e instanceof Enemy enemy?enemy:e instanceof Projectile projectile&&projectile.getShooter() instanceof Enemy enemy?enemy:null;}
    private boolean eligibleMob(LivingEntity e){
        if(!(e instanceof Enemy)||!XP.containsKey(e.getType())||e.hasMetadata("NPC"))return false;
        String reason=e.getPersistentDataContainer().get(origin,PersistentDataType.STRING);
        return reason==null||!Set.of("SPAWNER","SPAWNER_EGG","DISPENSE_EGG","BREEDING","COMMAND","CUSTOM").contains(reason)
                ||e.getScoreboardTags().contains("afu_site_dungeon")||e.getScoreboardTags().contains("afu_dungeon_mob");
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)
    public void spawn(CreatureSpawnEvent e){if(e.getEntity() instanceof Enemy)e.getEntity().getPersistentDataContainer().set(origin,PersistentDataType.STRING,e.getSpawnReason().name());}
    private void record(LivingEntity enemy,Player p,double damage,double tanking,double healing){
        if(!eligible(p)||!eligibleMob(enemy)||fault||stopping)return;
        if(contributions.size()>=2048&&!contributions.containsKey(enemy.getUniqueId()))return;
        var rows=contributions.computeIfAbsent(enemy.getUniqueId(),id->new HashMap<>());
        if(rows.size()>=40&&!rows.containsKey(p.getUniqueId()))return;
        long now=System.currentTimeMillis();var prior=rows.getOrDefault(p.getUniqueId(),new Contribution(0,0,0,now));
        rows.put(p.getUniqueId(),prior.add(damage,tanking,healing,now));
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)
    public void damage(EntityDamageByEntityEvent e){
        if(e.getEntity() instanceof LivingEntity enemy){var p=attacker(e.getDamager());
            if(p!=null&&e.getFinalDamage()>0)record(enemy,p,Math.min(e.getFinalDamage(),enemy.getHealth()+enemy.getAbsorptionAmount()),0,0);}
        if(e.getEntity() instanceof Player p){var enemy=hostileAttacker(e.getDamager());
            if(enemy!=null)record(enemy,p,0,Math.min(20,Math.max(0,e.getOriginalDamage(EntityDamageEvent.DamageModifier.BASE))),0);}
    }
    /** Only call with effective healing measured by the native skill executor. */
    void healed(Player healer,Player recipient,double amount){
        if(amount<=0||!Double.isFinite(amount)||amount>100||healer==recipient)return;
        long now=System.currentTimeMillis();
        for(var row:new ArrayList<>(contributions.entrySet())){
            var wounded=row.getValue().get(recipient.getUniqueId());if(wounded==null||wounded.tanking<=0||now-wounded.at>30_000)continue;
            var entity=Bukkit.getEntity(row.getKey());if(entity instanceof LivingEntity enemy&&enemy.isValid()&&!enemy.isDead()
                    &&enemy.getWorld()==healer.getWorld()&&enemy.getLocation().distanceSquared(healer.getLocation())<=32*32)
                record(enemy,healer,0,0,amount);
        }
    }
    @EventHandler(priority=EventPriority.MONITOR)
    public void died(EntityDeathEvent e){
        var enemy=e.getEntity();var rows=contributions.remove(enemy.getUniqueId());if(rows==null||!eligibleMob(enemy))return;
        long now=System.currentTimeMillis();var fighters=new ArrayList<CombatRpgRules.Fighter>();
        for(var row:rows.entrySet()){
            Player p=Bukkit.getPlayer(row.getKey());if(p==null||p.getWorld()!=enemy.getWorld())continue;var c=row.getValue();
            fighters.add(new CombatRpgRules.Fighter(p.getUniqueId(),p.getName(),c.damage,c.tanking,c.healing,
                    now-c.at<=60_000&&p.getLocation().distanceSquared(enemy.getLocation())<=32*32,eligible(p)));
        }
        boolean practice=enemy.getScoreboardTags().contains("afu_dungeon_mob")||enemy.getPersistentDataContainer().has(new NamespacedKey(plugin,"arena_mob"));
        var credits=CombatRpgRules.split(XP.get(enemy.getType()),fighters,practice);
        if(!credits.isEmpty())enqueue(new CombatRpgLedger.Award(enemy.getUniqueId(),credits));
    }
    /** Called only after the dungeon's authoritative settlement is committed. */
    void formalClear(String run,Player p,int floor){
        if(floor<1||floor>100)throw new IllegalArgumentException("formal_floor");
        UUID receipt=UUID.nameUUIDFromBytes(("conquest:"+run+":"+p.getUniqueId()).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        enqueue(new CombatRpgLedger.Award(receipt,List.of(new CombatRpgRules.Credit(p.getUniqueId(),p.getName(),100+floor*40,0,floor))));
    }
    private void enqueue(CombatRpgLedger.Award event){
        if(stopping||fault||ledger.snapshot().receipts().contains(event.event())||pending.containsKey(event.event()))return;
        if(pending.size()>=512){fault=true;plugin.getLogger().severe("Combat progression paused: write queue full; no success acknowledged.");return;}
        pending.put(event.event(),event);
    }
    private void flush(){
        if(writing||fault||pending.isEmpty())return;writing=true;var batch=List.copyOf(pending.values());
        var before=ledger.snapshot();
        io.execute(()->{
            Exception failed=null;try{ledger.apply(batch);}catch(Exception e){failed=e;}
            final Exception error=failed;
            if(!plugin.isEnabled()||stopping)return;
            Bukkit.getScheduler().runTask(plugin,()->{
                writing=false;if(error!=null){fault=true;plugin.getLogger().log(java.util.logging.Level.SEVERE,"Combat progression save failed; retained pending evidence, no XP success sent",error);return;}
                batch.forEach(e->pending.remove(e.event()));
                for(Player p:Bukkit.getOnlinePlayers()){
                    int old=before.player(p.getUniqueId(),p.getName()).progress().level(),level=level(p);
                    if(level>old&&eligible(p)){p.sendMessage("§a[战斗成长] Lv."+old+" → Lv."+level+"。下一步：/mycli status");p.playSound(p.getLocation(),Sound.ENTITY_PLAYER_LEVELUP,.6f,1f);}
                }
            });
        });
    }
    int level(Player p){return ledger.snapshot().player(p.getUniqueId(),p.getName()).progress().level();}
    int floor(Player p){return ledger.snapshot().player(p.getUniqueId(),p.getName()).highestFloor();}
    List<CombatRpgLedger.PlayerRecord> ranking(){return ledger.snapshot().ranking();}
    String profession(Player p){return plugin.professions().ledger.profile(p.getUniqueId()).get("combat").getAsString();}
    String next(Player p,boolean retiredTask){
        String role=profession(p);
        boolean armed=Arrays.stream(p.getInventory().getContents()).filter(Objects::nonNull).anyMatch(i->
                i.getType().name().endsWith("_SWORD")||i.getType().name().endsWith("_AXE")||i.getType()==Material.BOW||i.getType()==Material.CROSSBOW);
        boolean learned=plugin.professions().skills().stream().anyMatch(s->s.role().equals(role)&&plugin.professions().level(p,s.id())>0);
        String running=plugin.siteDungeons().isParticipant(p)?"/mycli dungeon status":plugin.dungeonParticipant(p)?"/mycli arena status":"";
        return CombatRpgRules.next(role,level(p),armed,learned,retiredTask,running,floor(p),
                plugin.siteDungeons().ids().contains("aincrad_"+String.format(java.util.Locale.ROOT,"%02d",floor(p)+1)));
    }
    JsonObject state(Player p){
        var row=ledger.snapshot().player(p.getUniqueId(),p.getName());var progress=row.progress();var out=new JsonObject();
        out.addProperty("level",progress.level());out.addProperty("xp",row.xp());out.addProperty("xpToNext",progress.toNext());
        out.addProperty("kills",row.kills());out.addProperty("conquestFloor",row.highestFloor());out.addProperty("practiceSeparate",true);
        out.addProperty("saveState",fault?"unavailable":pending.values().stream().anyMatch(e->e.credits().stream().anyMatch(c->c.id().equals(p.getUniqueId())))?"pending":"saved");
        out.addProperty("rankingCommand","/mycli world story list ranking");return out;
    }
    void rankings(Player p){
        p.sendMessage("§6攻略榜 · 正式层数优先，再按战斗经验；练习塔另计");var rows=ranking();
        if(rows.isEmpty()){p.sendMessage("§7尚无已保存的战斗记录；未开始不等于通关。");return;}
        for(int i=0;i<rows.size();i++){var row=rows.get(i);p.sendMessage("§f"+(i+1)+". "+row.name()+" · 攻略"+row.highestFloor()+"层 · Lv."+row.progress().level());}
    }
    private void modifier(Player p,Attribute type,NamespacedKey key,double value){
        var attr=p.getAttribute(type);if(attr==null)return;
        var own=attr.getModifiers().stream().filter(m->m.getKey().equals(key)).findFirst().orElse(null);
        if(own!=null&&Math.abs(own.getAmount()-value)<.00001)return;
        if(own!=null)attr.removeModifier(own);
        if(value>0)attr.addModifier(new AttributeModifier(key,value,AttributeModifier.Operation.ADD_NUMBER));
        if(type==Attribute.GENERIC_MAX_HEALTH&&p.getHealth()>attr.getValue())p.setHealth(attr.getValue());
    }
    private void tick(){
        if(stopping)return;long now=System.currentTimeMillis();
        // Durable outbox written with the actual dungeon reward receipt. Recover
        // across a crash between dungeon settlement and this ledger's disk write.
        if(++ticks%5==0)for(Player p:Bukkit.getOnlinePlayers()){
            var proof=plugin.getConfig().getConfigurationSection("site-dungeons.conquest-proofs."+p.getUniqueId());
            if(proof!=null)for(String floor:proof.getKeys(false))try{
                int number=Integer.parseInt(floor);UUID run=UUID.fromString(proof.getString(floor,""));
                if(!ledger.snapshot().player(p.getUniqueId(),p.getName()).cleared().contains(number))formalClear(run.toString(),p,number);
            }catch(IllegalArgumentException invalid){plugin.getLogger().warning("Invalid conquest proof retained; no progression granted");}
        }
        contributions.entrySet().removeIf(e->{e.getValue().values().removeIf(c->now-c.at>60_000);return e.getValue().isEmpty();});
        flush();
        for(Player p:Bukkit.getOnlinePlayers()){
            boolean eligible=eligible(p);int level=level(p);
            modifier(p,Attribute.GENERIC_MAX_HEALTH,healthKey,eligible?CombatRpgRules.healthBonus(level):0);
            modifier(p,Attribute.GENERIC_ATTACK_DAMAGE,attackKey,eligible?CombatRpgRules.attackBonus(level):0);
        }
        if(tab!=null)tab.refresh();
    }
    @EventHandler public void quit(PlayerQuitEvent e){
        modifier(e.getPlayer(),Attribute.GENERIC_MAX_HEALTH,healthKey,0);
        modifier(e.getPlayer(),Attribute.GENERIC_ATTACK_DAMAGE,attackKey,0);
    }
    void close(){
        stopping=true;var remaining=List.copyOf(pending.values());
        io.execute(()->{try{ledger.apply(remaining);}catch(Exception e){plugin.getLogger().log(java.util.logging.Level.SEVERE,"Combat XP shutdown save failed",e);}});
        io.shutdown();try{if(!io.awaitTermination(5,TimeUnit.SECONDS))plugin.getLogger().severe("Combat XP worker still writing on shutdown");}catch(InterruptedException e){Thread.currentThread().interrupt();}
        for(Player p:Bukkit.getOnlinePlayers()){modifier(p,Attribute.GENERIC_MAX_HEALTH,healthKey,0);modifier(p,Attribute.GENERIC_ATTACK_DAMAGE,attackKey,0);}
        if(tab!=null)tab.close();
    }
}
