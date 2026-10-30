package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.*;
import java.util.function.*;
import org.bukkit.*;
import org.bukkit.boss.*;
import org.bukkit.entity.*;
import org.bukkit.event.*;
import org.bukkit.event.block.*;
import org.bukkit.event.entity.*;
import org.bukkit.event.inventory.*;
import org.bukkit.event.player.*;
import org.bukkit.util.Vector;

/** Server-side trial rule: a teammate can wait nearby, or clear the room, to revive. */
final class TrialRescueManager implements Listener {
    static final double RADIUS = 4;
    static final long RESCUE_MS = 10_000;
    private static final String ROOT = "trial-rescue";
    record Team(String id, Set<UUID> members, Predicate<Location> contains, boolean paused,
                BooleanSupplier roomCleared, Runnable wipe, Location exit) {}
    private record Recovery(Location exit, String team, boolean relocate) {}
    private static final class Down {
        final UUID player;
        final String team;
        final Location anchor, exit;
        UUID rescuer;
        long since, lastTick;
        BossBar bar;
        Down(UUID player, String team, Location anchor, Location exit) {
            this.player = player;
            this.team = team; this.anchor = anchor.clone(); this.exit = exit.clone();
        }
    }
    private final AgentFriendPlugin plugin;
    private final Map<UUID, Down> downs = new LinkedHashMap<>();
    private final Map<UUID, Recovery> recoveries = new LinkedHashMap<>();
    private final Set<UUID> internalTeleports = new HashSet<>();
    private final Map<UUID, Long> lastNotice = new HashMap<>();
    private final TrialRescueVisuals visuals = new TrialRescueVisuals();
    private int ticks;

    TrialRescueManager(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        restore();
        // Register after combat damage/ward listeners: final damage already includes their effects.
        Bukkit.getPluginManager().registerEvents(this, plugin);
        Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 5, 5);
    }
    Team team(UUID id) {
        Team team = plugin.dungeon().rescueTeam(id);
        return team != null ? team : plugin.siteDungeons().rescueTeam(id);
    }
    boolean downed(Player p) { return p != null && downs.containsKey(p.getUniqueId()); }
    boolean downed(UUID id) { return downs.containsKey(id); }
    boolean hasDowned(String team) { return downs.values().stream().anyMatch(d -> d.team.equals(team)); }
    private boolean standing(Player p) {
        return p != null && p.isOnline() && !p.isDead() && !downed(p)
                && (p.getGameMode() == GameMode.SURVIVAL || p.getGameMode() == GameMode.ADVENTURE);
    }
    private boolean same(Team team, Down d) { return team != null && team.id.equals(d.team); }
    private boolean covers(Team team, Player p) {
        return team != null && (team.members.size() >= 2 || team.id.startsWith("site:"))
                && team.contains.test(p.getLocation());
    }
    boolean rescueActive(Player p) {
        return p != null && rescueActive(team(p.getUniqueId()),p);
    }
    private boolean rescueActive(Team team,Player p) {
        return p.isOnline() && !p.isDead()
                && (p.getGameMode() == GameMode.SURVIVAL || p.getGameMode() == GameMode.ADVENTURE)
                && covers(team, p);
    }
    private void notice(Player p) {
        long now = System.currentTimeMillis();
        if (now - lastNotice.getOrDefault(p.getUniqueId(), 0L) < 1500) return;
        lastNotice.put(p.getUniqueId(), now);
        p.sendMessage("§e你是倒地、尚未死亡，背包装备没有掉落；不能移动、攻击或施法。队友在4格内停留10秒，或清完本层/本室即可复活；全队倒下才撤离。");
        p.sendMessage("MC_TRIAL_RESCUE status=denied reason=downed radius=4 seconds=10");
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void damage(EntityDamageEvent e) {
        if (e instanceof EntityDamageByEntityEvent hit) {
            Entity source = hit.getDamager();
            if (source instanceof Projectile shot && shot.getShooter() instanceof Entity actor) source = actor;
            if (source instanceof Player attacker && downed(attacker)) { e.setCancelled(true); return; }
        }
        if (!(e.getEntity() instanceof Player p)) return;
        if (downed(p)) { e.setCancelled(true); return; }
        if (e.getFinalDamage() < p.getHealth() || !standing(p)) return;
        Team team = team(p.getUniqueId());
        if (!covers(team, p)) return;
        // Let vanilla consume a real totem before using the trial rescue rule.
        if (p.getInventory().getItemInMainHand().getType() == Material.TOTEM_OF_UNDYING
                || p.getInventory().getItemInOffHand().getType() == Material.TOTEM_OF_UNDYING) return;
        e.setCancelled(true);
        Down d = new Down(p.getUniqueId(), team.id, p.getLocation(), team.exit);
        downs.put(p.getUniqueId(), d);
        p.closeInventory(); p.setHealth(1); p.setFireTicks(0); p.setVelocity(new Vector());
        p.setFallDistance(0);
        persist();
        audit(d, "downed", "lethal_damage");
        tell(team, team.members.size()==1?"§c本次遭到致命伤害，正在返回遗迹存档点；背包装备保留，整场第三次战败才结束。":"§c" + p.getName() + " 已倒地！队友靠近4格并停留10秒可自动救起；清完本层/本室也会自动复活。");
        for (UUID id : team.members) {
            Player member = Bukkit.getPlayer(id);
            if (member != null) member.sendMessage("MC_TRIAL_RESCUE status=downed player=" + p.getUniqueId()
                    + " " + LocationOutput.fields(d.anchor) + " radius=4 seconds=10");
            if (member != null && !member.getUniqueId().equals(p.getUniqueId()))
                member.sendMessage("§e[系统·队友救援] 用现有移动能力走到倒地队友4格内并连续停留10秒，无需点击或施法。"
                        + "救援离开范围会重新计时；也可清完本层/本室自动复活队友。arena status / dungeon status 可重新查询倒地坐标。");
        }
        p.sendTitle(team.members.size()==1?"§e返回存档点":"§c倒地等待救援",team.members.size()==1?"§e正在恢复，背包装备保留":"§e队友靠近10秒，或清场后自动复活", 5, 80, 10);
        display(p, d, team, System.currentTimeMillis());
    }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void attack(EntityDamageByEntityEvent e) {
        Entity source = e.getDamager();
        if (source instanceof Projectile projectile && projectile.getShooter() instanceof Entity entity) source = entity;
        if (source instanceof Player p && downed(p)) { e.setCancelled(true); notice(p); }
    }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void target(EntityTargetLivingEntityEvent e) {
        if (e.getTarget() instanceof Player p && downed(p)) e.setCancelled(true);
    }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void heal(EntityRegainHealthEvent e) {
        if (e.getEntity() instanceof Player p && downed(p)) e.setCancelled(true);
    }
    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void move(PlayerMoveEvent e) {
        if (e instanceof PlayerTeleportEvent || e.getTo() == null) return;
        Down d = downs.get(e.getPlayer().getUniqueId());
        if (d != null) {
            // Cancelling translation also sends a corrective position packet to vanilla clients.
            // Keep pure look packets so a downed player can still watch the fight.
            if (e.getFrom().getX() != e.getTo().getX() || e.getFrom().getY() != e.getTo().getY()
                    || e.getFrom().getZ() != e.getTo().getZ()) e.setCancelled(true);
        }
        for (Down other : downs.values()) if (e.getPlayer().getUniqueId().equals(other.rescuer)
                && !near(e.getTo(), other.anchor)) reset(other, "left_range");
    }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void teleport(PlayerTeleportEvent e) {
        if (downed(e.getPlayer()) && !internalTeleports.contains(e.getPlayer().getUniqueId())) {
            e.setCancelled(true); notice(e.getPlayer());
        }
    }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void mode(PlayerGameModeChangeEvent e) {
        if (downed(e.getPlayer())) { e.setCancelled(true); notice(e.getPlayer()); }
    }
    boolean readCommand(String[] args) {
        if(Arrays.stream(args).anyMatch(s->s.equals("--help")||s.equals("-h")))return true;
        args=Arrays.stream(args).filter(s->!s.equals("--json")).toArray(String[]::new);
        if (args.length == 0) return true;
        String root = args[0].toLowerCase(Locale.ROOT);
        if (Set.of("help", "status", "list", "explain", "rules", "progress", "capabilities").contains(root)) return true;
        if(root.equals("challenge")){try{return ChallengeCli.parse(args).readOnly();}catch(IllegalArgumentException invalid){return false;}}
        if(root.equals("protect")||root.equals("保护")){try{ProtectionQuery.parse(args);return true;}catch(IllegalArgumentException invalid){return false;}}
        return Set.of("arena", "dungeon").contains(root)
                && (args.length == 1 || Set.of("status", "layout", "info", "list", "loot").contains(args[1].toLowerCase(Locale.ROOT)));
    }
    boolean blockCommand(Player p, String[] args) {
        if (!downed(p) || readCommand(args)) return false;
        notice(p); return true;
    }
    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void command(PlayerCommandPreprocessEvent e) {
        if (!downed(e.getPlayer())) return;
        String[] parts = e.getMessage().substring(1).trim().split("\\s+");
        String root = parts[0].toLowerCase(Locale.ROOT).replaceFirst("^.*:", "");
        if(Set.of("msg","tell","w").contains(root))return;
        if (root.equals("mycli") && readCommand(Arrays.copyOfRange(parts, 1, parts.length))) return;
        // Chat is still usable to call for help; world-changing commands are disabled while downed.
        e.setCancelled(true); notice(e.getPlayer());
    }
    @EventHandler(priority = EventPriority.LOWEST)
    public void interact(PlayerInteractEvent e) { if (downed(e.getPlayer())) { e.setCancelled(true); notice(e.getPlayer()); } }
    @EventHandler(priority = EventPriority.LOWEST)
    public void interactEntity(PlayerInteractEntityEvent e) { if (downed(e.getPlayer())) { e.setCancelled(true); notice(e.getPlayer()); } }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void inventory(InventoryClickEvent e) { if (e.getWhoClicked() instanceof Player p && downed(p)) e.setCancelled(true); }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void drag(InventoryDragEvent e) { if (e.getWhoClicked() instanceof Player p && downed(p)) e.setCancelled(true); }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void drop(PlayerDropItemEvent e) { if (downed(e.getPlayer())) e.setCancelled(true); }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void pickup(EntityPickupItemEvent e) { if (e.getEntity() instanceof Player p && downed(p)) e.setCancelled(true); }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void consume(PlayerItemConsumeEvent e) { if (downed(e.getPlayer())) e.setCancelled(true); }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void launch(ProjectileLaunchEvent e) { if (e.getEntity().getShooter() instanceof Player p && downed(p)) e.setCancelled(true); }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void breakBlock(BlockBreakEvent e) { if (downed(e.getPlayer())) e.setCancelled(true); }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void place(BlockPlaceEvent e) { if (downed(e.getPlayer())) e.setCancelled(true); }
    @EventHandler public void quit(PlayerQuitEvent e) {
        Down d = downs.get(e.getPlayer().getUniqueId());
        if (d != null) { reset(d, "target_offline"); if (d.bar != null) d.bar.removeAll(); }
        for (Down other : downs.values()) if (e.getPlayer().getUniqueId().equals(other.rescuer)) reset(other, "rescuer_offline");
        lastNotice.remove(e.getPlayer().getUniqueId());
    }
    @EventHandler public void join(PlayerJoinEvent e) {
        Bukkit.getScheduler().runTaskLater(plugin, () -> reconnect(e.getPlayer()), 12);
    }
    @EventHandler public void respawn(PlayerRespawnEvent e) {
        Bukkit.getScheduler().runTaskLater(plugin, () -> reconnect(e.getPlayer()), 12);
    }
    private void reconnect(Player p) {
        if (!p.isOnline() || p.isDead()) return;
        Down d = downs.get(p.getUniqueId());
        if (d != null) {
            if (!same(team(p.getUniqueId()), d)) { recoveries.put(p.getUniqueId(), new Recovery(d.exit, d.team, true)); remove(p.getUniqueId()); persist(); }
            else { teleport(p, d.anchor); p.setHealth(1); p.setFireTicks(0); reset(d, "rejoined"); notice(p); }
        }
        recover(p);
    }
    private boolean near(Location a, Location b) { return a != null && a.getWorld() == b.getWorld() && a.distanceSquared(b) <= RADIUS * RADIUS; }
    private void reset(Down d, String reason) {
        if (d.rescuer != null) {
            audit(d, "interrupted", reason);
            for (UUID id : Set.of(d.player, d.rescuer)) {
                Player p = Bukkit.getPlayer(id);
                if (p != null && p.isOnline()) {
                    p.sendMessage("§e[队友救援] 救援已中断、进度归零。恢复后请同一位队友在4格内连续停留10秒；清场仍可自动复活。");
                    p.sendMessage("MC_TRIAL_RESCUE status=interrupted target=" + d.player + " reason=" + reason + " progressMs=0 radius=4 seconds=10");
                }
            }
        }
        d.rescuer = null; d.since = 0;
    }
    private static long elapsed(Down d, long now) {
        return d.since == 0 ? 0 : Math.max(0, Math.min(RESCUE_MS, now - d.since));
    }
    private void audit(Down d, String status, String reason) {
        plugin.getLogger().info("Trial rescue: team=" + d.team + ", player=" + d.player
                + ", status=" + status + ", rescuer=" + d.rescuer + ", reason=" + reason);
    }
    private void tick() {
        ticks++;
        if (ticks % 4 == 0) for (UUID id : new ArrayList<>(recoveries.keySet())) {
            Player p = Bukkit.getPlayer(id); if (p != null) recover(p);
        }
        if (downs.isEmpty()) return;
        long now = System.currentTimeMillis(); Set<String> handled = new HashSet<>();
        for (var entry : new ArrayList<>(downs.entrySet())) {
            UUID id = entry.getKey(); Down d = entry.getValue(); Team team = team(id);
            if (!same(team, d)) { recoveries.put(id, new Recovery(d.exit, d.team, true)); remove(id); persist(); continue; }
            if (handled.add(team.id)) {
                if (team.roomCleared.getAsBoolean()) { reviveTeam(team.id, "room_cleared"); continue; }
                boolean survivor = team.members.stream().anyMatch(uuid -> standing(Bukkit.getPlayer(uuid))
                        || Bukkit.getPlayer(uuid) == null && !downs.containsKey(uuid));
                if (!survivor) { team.wipe.run(); continue; }
            }
            if (!downs.containsKey(id)) continue;
            Player p = Bukkit.getPlayer(id);
            if (p == null || !p.isOnline() || p.isDead()) { reset(d, "target_unavailable"); continue; }
            p.setVelocity(new Vector()); p.setFallDistance(0); p.setFireTicks(0);
            if (p.getWorld() != d.anchor.getWorld() || p.getLocation().distanceSquared(d.anchor) > .01) teleport(p, d.anchor);
            if (team.paused) reset(d, "paused");
            else {
                Player rescuer = d.rescuer == null ? null : Bukkit.getPlayer(d.rescuer);
                if (now - d.lastTick > 1000 || !standing(rescuer) || !team.members.contains(d.rescuer)
                        || !team.contains.test(rescuer.getLocation()) || !near(rescuer.getLocation(), d.anchor)) reset(d, "rescuer_unavailable");
                if (d.rescuer == null) {
                    rescuer = team.members.stream().map(Bukkit::getPlayer).filter(this::standing)
                            .filter(member -> team.contains.test(member.getLocation()) && near(member.getLocation(), d.anchor))
                            .min(Comparator.comparing(member -> member.getUniqueId().toString())).orElse(null);
                    if (rescuer != null) {
                        d.rescuer = rescuer.getUniqueId(); d.since = now;
                        audit(d, "rescuing", "nearby_teammate");
                        rescuer.sendMessage("§e[系统·队友救援] 正在救援 " + p.getName() + "，保持4格内10秒即可复活队友。");
                        rescuer.sendMessage("MC_TRIAL_RESCUE status=rescuing target=" + id + " radius=4 seconds=10");
                        p.sendMessage("§a[队友救援] " + rescuer.getName() + " 正在救你，请看上方绿色救援进度条。");
                    }
                }
                if (d.rescuer != null && now - d.since >= RESCUE_MS) { revive(id, "nearby_teammate"); continue; }
            }
            d.lastTick = now;
            display(p, d, team, now);
        }
        visuals.flush(this::downed);
    }
    private void display(Player p, Down d, Team team, long now) {
        if (d.bar == null) d.bar = Bukkit.createBossBar("倒地等待救援", BarColor.YELLOW, BarStyle.SEGMENTED_10);
        long elapsed = elapsed(d, now);
        int percent = (int) (elapsed * 100 / RESCUE_MS);
        String remaining = String.format(Locale.ROOT, "%.1f", (RESCUE_MS - elapsed) / 1000.0);
        Player rescuer = d.rescuer == null ? null : Bukkit.getPlayer(d.rescuer);
        BarColor colour = team.paused ? BarColor.PURPLE : rescuer == null ? BarColor.YELLOW : BarColor.GREEN;
        String title = team.paused ? "§d" + p.getName() + " 倒地 · 副本暂停，恢复后重新救援"
                : rescuer == null ? "§e" + p.getName() + " 倒地 · 靠近金色圈内4格停留10秒 / 清场复活"
                : "§a救援 " + p.getName() + " · " + percent + "% · 剩余 " + remaining + "秒 · " + rescuer.getName();
        if (d.bar.getColor() != colour) d.bar.setColor(colour);
        if (!d.bar.getTitle().equals(title)) d.bar.setTitle(title);
        double progress = elapsed / (double) RESCUE_MS;
        if (d.bar.getProgress() != progress) d.bar.setProgress(progress);
        Set<Player> viewers = new HashSet<>();
        for (UUID id : team.members) {
            Player viewer = Bukkit.getPlayer(id);
            if (viewer != null && viewer.isOnline() && viewer.getWorld() == p.getWorld() && viewer.canSee(p)) viewers.add(viewer);
        }
        // Keep the native bar and audience; REMOVE+ADD used to recreate the UI every second.
        Set<Player> current = new HashSet<>(d.bar.getPlayers());
        for (Player old : current) if (!viewers.contains(old)) d.bar.removePlayer(old);
        for (Player viewer : viewers) if (!current.contains(viewer)) d.bar.addPlayer(viewer);
        if (ticks % 4 == 0) visuals.marker(p, team.members, elapsed / (double) RESCUE_MS, team.paused);
    }
    private void remove(UUID id) { Down d = downs.remove(id); if (d != null && d.bar != null) d.bar.removeAll(); }
    private void revive(UUID id, String reason) {
        Down d = downs.get(id); if (d == null) return;
        Player p = Bukkit.getPlayer(id);
        if (p == null || !p.isOnline() || p.isDead()) {
            // Clear reward/team checkpoint can advance while the player is disconnected.
            recoveries.put(id, new Recovery(d.exit, d.team, false)); remove(id); persist(); return;
        }
        remove(id); restoreHealth(p); persist();
        audit(d, "revived", reason);
        if(reason.equals("nearby_teammate")&&d.rescuer!=null&&plugin.lifeChallenges()!=null)plugin.lifeChallenges().rescued(d.rescuer,id);
        if(reason.equals("nearby_teammate")&&d.rescuer!=null&&plugin.siteDungeons()!=null)
            plugin.siteDungeons().support(Bukkit.getPlayer(d.rescuer),p);
        if(reason.equals("nearby_teammate")&&d.rescuer!=null&&plugin.skillAssessments()!=null) {
            Player rescuer=Bukkit.getPlayer(d.rescuer);if(rescuer!=null)plugin.skillAssessments().proof(rescuer,"rescue","revived:"+id+":"+System.currentTimeMillis());
        }
        p.sendTitle("§a已复活", reason.equals("room_cleared") ? "§e队友已清场" : "§e队友救援完成", 5, 45, 10);
        p.sendMessage("MC_TRIAL_RESCUE status=revived reason=" + reason + " health=" + p.getHealth());
        Team team = team(id);
        if (team != null) {
            visuals.revived(p, team.members);
            tell(team, "§a" + p.getName() + " 已复活（" + (reason.equals("room_cleared") ? "清场复活" : "队友救援完成") + "），可继续并肩战斗。");
        }
    }
    void reviveTeam(String team, String reason) {
        for (var entry : new ArrayList<>(downs.entrySet())) if (entry.getValue().team.equals(team)) revive(entry.getKey(), reason);
    }
    void releaseTeam(String team, Location exit) {
        for (var entry : new ArrayList<>(downs.entrySet())) if (entry.getValue().team.equals(team)) {
            recoveries.put(entry.getKey(), new Recovery(exit.clone(), team, true)); remove(entry.getKey());
        }
        persist();
        for (UUID id : new ArrayList<>(recoveries.keySet())) { Player p = Bukkit.getPlayer(id); if (p != null) recover(p); }
    }
    private void restoreHealth(Player p) {
        p.setHealth(Math.min(10, p.getMaxHealth())); p.setFireTicks(0); p.setFallDistance(0); p.setNoDamageTicks(40);
    }
    private boolean teleport(Player p, Location target) {
        internalTeleports.add(p.getUniqueId());
        try { return p.teleport(target); } finally { internalTeleports.remove(p.getUniqueId()); }
    }
    private void recover(Player p) {
        Recovery recovery = recoveries.get(p.getUniqueId());
        if (recovery == null || !p.isOnline() || p.isDead()) return;
        Team current = team(p.getUniqueId());
        boolean stay = !recovery.relocate && current != null && current.id.equals(recovery.team);
        if (!stay && (!AgentFriendPlugin.safeLanding(recovery.exit.getBlock()) || !teleport(p, recovery.exit))) return;
        recoveries.remove(p.getUniqueId()); restoreHealth(p); persist();
        p.sendMessage("§e已结束倒地状态并安全恢复；已赢得的奖励保留在个人箱。");
        p.sendMessage("MC_TRIAL_RESCUE status=recovered health=" + p.getHealth());
    }
    private void tell(Team team, String message) {
        for (UUID id : team.members) { Player p = Bukkit.getPlayer(id); if (p != null) p.sendMessage(message); }
    }
    JsonObject state(Player p) {
        JsonObject state = new JsonObject(); state.addProperty("schema", 1); state.addProperty("downed", downed(p));
        state.addProperty("radius", RADIUS); state.addProperty("seconds", RESCUE_MS / 1000);
        state.addProperty("instruction", "试炼塔/遗迹地下城组队挑战倒地不退出。存活队友走到倒地坐标4格内，连续停留10秒自动救起，无需点击/命令；上方显示进度与剩余秒数，离开范围重计。金色圈标记救援范围，绿色表示救援进度。清完本层/本室自动复活队友；全队倒下才失败撤离。");
        Team team = team(p.getUniqueId()); JsonArray teammates = new JsonArray();
        boolean rescueHere=rescueActive(team,p);
        int count=team==null?0:team.members.size();
        state.addProperty("active",team!=null);state.addProperty("team",team==null?"":team.id);
        state.addProperty("rescueActive",rescueHere);
        state.addProperty("participants",count);state.addProperty("rescueEnabled",count>=2);
        state.addProperty("lifeState",downed(p)?"downed":p.isDead()?"dead":"alive");
        state.addProperty("keepInventory",Boolean.TRUE.equals(p.getWorld().getGameRuleValue(GameRule.KEEP_INVENTORY)));
        if(count<2)state.addProperty("instruction",count==1?"当前本场仅登记1人，不启用队友救援；死亡是否掉物以实际死亡回执为准。想组队：先原生邀请并接受，全员到首室由队长开场。":"尚未参加试炼/遗迹场次。原生组队后全员到首室，由队长开场；本场登记2人以上才启用倒地救援。");
        Map<String,Object> checkpoint=plugin.siteDungeons().checkpointState(p.getUniqueId());
        if(!checkpoint.isEmpty()){
            state.add("checkpoint",new Gson().toJsonTree(checkpoint));
            state.addProperty("instruction",(count>1?"致命伤害先倒地，队友4格内停留10秒或清室可复活；救援成功不扣次数。":"单人致命伤害自动返回存档点，背包装备保留。")+"单人或全队战败回上个存档点，整场第3次战败才结束；断线和服务器故障不扣次数。剩余机会 "+checkpoint.get("attemptsRemaining")+"/3。");
        }
        if(team==null)state.addProperty("instruction","当前没有有效试炼/遗迹参战身份，存档点与倒地救援未生效；历史场次和旧坐标不能作为救援保证。查询：/mycli dungeon status。");
        else if(!rescueHere)state.addProperty("instruction","当前不满足本场救援条件（登记人数、范围或生存状态）；此处不保证倒地或返回存档点。先查本场状态并核对维度、位置：/mycli dungeon status。");
        else state.addProperty("instruction",state.get("instruction").getAsString()+"仅在本场有效且身处挑战范围时适用；超时、结束或退出后失效。");
        if (team != null) for (UUID id : team.members) {
            Down d = downs.get(id); if (d == null) continue;
            JsonObject target = new JsonObject(); target.addProperty("uuid", id.toString());
            Player member = Bukkit.getPlayer(id); target.addProperty("name", member == null ? "offline" : member.getName());
            target.addProperty("x", d.anchor.getX()); target.addProperty("y", d.anchor.getY()); target.addProperty("z", d.anchor.getZ());
            target.addProperty("world", d.anchor.getWorld().getName());
            long progress = team.paused ? 0 : elapsed(d, System.currentTimeMillis());
            target.addProperty("progressMs", progress);
            target.addProperty("progress", progress / (double) RESCUE_MS);
            target.addProperty("remainingMs", RESCUE_MS - progress);
            target.addProperty("phase", team.paused ? "paused" : d.rescuer == null ? "waiting" : "rescuing");
            target.addProperty("rescuerUuid", d.rescuer == null ? "" : d.rescuer.toString());
            Player rescuer = d.rescuer == null ? null : Bukkit.getPlayer(d.rescuer);
            target.addProperty("rescuerName", rescuer == null ? "" : rescuer.getName());
            teammates.add(target);
        }
        state.add("downedTeammates", teammates); return state;
    }
    void report(Player p) { p.sendMessage("MC_TRIAL_RESCUE_STATE " + state(p)); }
    private void persist() {
        plugin.getConfig().set(ROOT + ".downed", null);
        downs.forEach((id, d) -> {
            String path = ROOT + ".downed." + id;
            plugin.getConfig().set(path + ".team", d.team);
            plugin.getConfig().set(path + ".anchor", d.anchor); plugin.getConfig().set(path + ".exit", d.exit);
        });
        plugin.getConfig().set(ROOT + ".recoveries", null);
        recoveries.forEach((id, recovery) -> {
            String path = ROOT + ".recoveries." + id;
            plugin.getConfig().set(path + ".exit", recovery.exit);
            plugin.getConfig().set(path + ".team", recovery.team);
            plugin.getConfig().set(path + ".relocate", recovery.relocate);
        });
        plugin.saveConfig();
    }
    private void restore() {
        var saved = plugin.getConfig().getConfigurationSection(ROOT + ".downed");
        if (saved != null) for (String raw : saved.getKeys(false)) try {
            UUID id = UUID.fromString(raw); Location anchor = saved.getLocation(raw + ".anchor"), exit = saved.getLocation(raw + ".exit");
            if (anchor == null || exit == null) throw new IllegalArgumentException("missing_location");
            Down d = new Down(id, saved.getString(raw + ".team", ""), anchor, exit);
            if (same(team(id), d)) downs.put(id, d); else recoveries.put(id, new Recovery(exit, d.team, true));
        } catch (RuntimeException e) { plugin.getLogger().warning("Invalid rescue checkpoint: " + raw); }
        var pending = plugin.getConfig().getConfigurationSection(ROOT + ".recoveries");
        if (pending != null) for (String raw : pending.getKeys(false)) try {
            Location exit = pending.getLocation(raw + ".exit");
            if (exit != null) recoveries.put(UUID.fromString(raw), new Recovery(exit,
                    pending.getString(raw + ".team", ""), pending.getBoolean(raw + ".relocate", true)));
        } catch (RuntimeException e) { plugin.getLogger().warning("Invalid recovery checkpoint: " + raw); }
    }
    void shutdown() { persist(); for (Down d : downs.values()) if (d.bar != null) d.bar.removeAll(); }
}
