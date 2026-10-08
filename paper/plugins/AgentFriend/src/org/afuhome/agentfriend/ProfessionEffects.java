package org.afuhome.agentfriend;

import com.google.gson.*;
import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldguard.WorldGuard;
import com.sk89q.worldguard.bukkit.WorldGuardPlugin;
import com.sk89q.worldguard.protection.flags.Flags;
import java.util.*;
import org.bukkit.*;
import org.bukkit.block.Block;
import org.bukkit.block.data.Ageable;
import org.bukkit.entity.*;
import org.bukkit.event.*;
import org.bukkit.event.block.BlockGrowEvent;
import org.bukkit.event.entity.*;
import org.bukkit.event.player.*;
import org.bukkit.event.raid.RaidFinishEvent;
import org.bukkit.event.raid.RaidStopEvent;
import org.bukkit.potion.*;
import org.bukkit.scheduler.BukkitRunnable;
import org.bukkit.util.Vector;

/** Fixed, bounded effect primitives. No world scans, client changes or block destruction. */
final class ProfessionEffects implements Listener {
    private final AgentFriendPlugin plugin;
    private final ProfessionManager manager;
    private final Map<UUID, Guard> guards = new HashMap<>();
    private final Map<UUID, Immunity> immunities = new HashMap<>();
    private final Map<EntityDamageByEntityEvent, Reduction> reductions = new IdentityHashMap<>();
    private final Map<UUID, Hit> melee = new HashMap<>();
    private final Map<UUID, Wound> wounds = new HashMap<>();
    private final Set<UUID> ownHealing = new HashSet<>();
    private final Map<UUID, Map<UUID, Mark>> marks = new HashMap<>();
    private final Map<UUID, UUID> combos = new HashMap<>();
    private JsonObject raids;
    private boolean dirty;
    private record Guard(UUID caster, String skill, World world, Vector facing, long until, double cap, boolean frontal) { }
    private record Immunity(UUID caster, String skill, World world, long until) { }
    private record Reduction(Guard guard, double before, double ownReduction) { }
    private record Hit(UUID player, long until) { }
    private record Wound(long until, double amount, String raid) { }
    private record Mark(long until, World world) { }

    ProfessionEffects(AgentFriendPlugin plugin, ProfessionManager manager) {
        this.plugin = plugin; this.manager = manager;
        raids = manager.ledger.ready() ? manager.ledger.data().getAsJsonObject("raids").deepCopy() : new JsonObject();
        Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 10L, 10L);
    }
    void cast(Player p, ProfessionCatalog.Skill skill, String target) {
        switch (skill.effect()) {
            case "sword_thrust", "sword_cone", "sword_beam", "sword_combo", "arcane_bolt", "frost_cone", "flame_cone" -> strike(p, skill);
            case "sword_parry", "ward" -> guard(p, skill);
            case "sword_step" -> step(p, skill);
            case "mark" -> mark(p, skill);
            case "mend" -> mend(p, skill, target);
            case "cleanse" -> cleanse(p, skill);
            case "haste", "warmth" -> buff(p, skill);
            case "growth" -> growth(p, skill);
            default -> manager.result(p, "cast", "unknown_effect", skill.id());
        }
    }
    private boolean hostile(Entity entity) {
        return entity instanceof Enemy && entity.isValid() && !entity.isDead() && !entity.isInvulnerable();
    }
    private boolean visible(Player p, LivingEntity target, double range) {
        if (p.getWorld() != target.getWorld() || p.getEyeLocation().distanceSquared(target.getEyeLocation()) > range * range || !p.hasLineOfSight(target)) return false;
        Vector to = target.getEyeLocation().toVector().subtract(p.getEyeLocation().toVector());
        double distance = to.length(); if (distance < .01) return true;
        var hit = p.getWorld().rayTraceBlocks(p.getEyeLocation(), to.normalize(), distance, FluidCollisionMode.NEVER, true);
        return hit == null || hit.getHitPosition().distance(p.getEyeLocation().toVector()) >= distance - .2;
    }
    private List<Enemy> targets(Player p, double range, int count, double facing) {
        Vector forward = p.getEyeLocation().getDirection();
        List<Enemy> targets = new ArrayList<>();
        for (Entity entity : p.getNearbyEntities(range, range, range)) {
            if (!hostile(entity) || !(entity instanceof Enemy enemy) || !visible(p, enemy, range)) continue;
            Vector toward = enemy.getEyeLocation().toVector().subtract(p.getEyeLocation().toVector());
            if (toward.lengthSquared() > .001 && forward.dot(toward.normalize()) < facing) continue;
            targets.add(enemy);
        }
        targets.sort(Comparator.comparingDouble(e -> e.getLocation().distanceSquared(p.getLocation())));
        return targets.stream().limit(count).toList();
    }
    private boolean damage(Player p, Enemy target, double amount) {
        if (!hostile(target)) return false;
        double before = target.getHealth() + target.getAbsorptionAmount();
        target.damage(amount, p);
        return target.getHealth() + target.getAbsorptionAmount() < before || target.isDead();
    }
    private void trail(Player p, Location target) {
        trail(p, target, "sword");
    }
    private void trail(Player p, Location target, String effect) {
        Location start = p.getEyeLocation(); Vector delta = target.toVector().subtract(start.toVector());
        int steps = Math.min(12, Math.max(2, (int) Math.ceil(delta.length() * 2)));
        Particle particle = switch (effect) { case "arcane_bolt" -> Particle.END_ROD; case "frost_cone" -> Particle.SNOWFLAKE;
            case "flame_cone" -> Particle.FLAME; default -> Particle.CRIT; };
        for (int i = 1; i <= steps; i++) p.getWorld().spawnParticle(particle,
                start.clone().add(delta.clone().multiply(i / (double) steps)), 1, 0, 0, 0, .01);
        p.getWorld().playSound(p.getLocation(), Sound.ENTITY_PLAYER_ATTACK_SWEEP, .65f, 1.15f);
    }
    private void strike(Player p, ProfessionCatalog.Skill skill) {
        double facing = switch (skill.effect()) { case "sword_cone", "frost_cone", "flame_cone" -> .5; case "arcane_bolt" -> .98; default -> .85; };
        List<Enemy> targets = targets(p, skill.range(), skill.targets(), facing);
        if (targets.isEmpty()) { manager.result(p, "cast", "no_target", skill.id()); return; }
        if (!manager.begin(p, skill)) return;
        double firstDamage = skill.effect().equals("sword_combo") ? skill.power() / 4 : skill.power(); int hit = 0;
        for (Enemy target : targets) if (damage(p, target, firstDamage)) {
            trail(p, target.getEyeLocation(), skill.effect()); hit++;
            if (skill.effect().equals("frost_cone") && !target.isDead())
                target.addPotionEffect(new PotionEffect(PotionEffectType.SLOWNESS, skill.ticks(), 0, false, true));
        }
        if (hit == 0) { manager.refund(p, skill, "protected_target"); return; }
        manager.succeeded(p, skill, "命中 " + hit + " 个敌人");
        if (!skill.effect().equals("sword_combo")) return;
        UUID targetId = targets.getFirst().getUniqueId(), caster = p.getUniqueId(), token = UUID.randomUUID(); World world = p.getWorld();
        combos.put(caster, token);
        // Four strikes, total base damage <=16; no invulnerability reset. Later interruptions never recharge.
        for (int phase = 1; phase <= 3; phase++) Bukkit.getScheduler().runTaskLater(plugin, () -> {
            Player current = Bukkit.getPlayer(caster); Entity entity = Bukkit.getEntity(targetId);
            if (!token.equals(combos.get(caster)) || current == null || !current.isOnline() || current.getWorld() != world || !(entity instanceof Enemy enemy)
                    || !manager.denial(current, skill, false).equals("ready") || !ProfessionManager.equipment(current, skill.equipment())
                    || !visible(current, enemy, skill.range())) return;
            if (damage(current, enemy, skill.power() / 4)) trail(current, enemy.getEyeLocation());
        }, phase * 12L);
        Bukkit.getScheduler().runTaskLater(plugin, () -> combos.remove(caster, token), 40L);
    }
    private void guard(Player p, ProfessionCatalog.Skill skill) {
        if (guards.containsKey(p.getUniqueId()) && guards.get(p.getUniqueId()).until > System.currentTimeMillis()) {
            manager.result(p, "cast", "already_effective", skill.id()); return;
        }
        List<Player> allies = skill.effect().equals("ward") ? allies(p, skill.range(), skill.targets(), false, "") : List.of(p);
        allies = allies.stream().filter(ally -> !guards.containsKey(ally.getUniqueId()) || guards.get(ally.getUniqueId()).until <= System.currentTimeMillis()).toList();
        if (allies.isEmpty()) { manager.result(p, "cast", "already_effective", skill.id()); return; }
        if (!manager.begin(p, skill)) return;
        Guard guard = new Guard(p.getUniqueId(), skill.id(), p.getWorld(), p.getEyeLocation().getDirection(),
                System.currentTimeMillis() + skill.ticks() * 50L, skill.power(), skill.effect().equals("sword_parry"));
        for (Player ally : allies) guards.put(ally.getUniqueId(), guard);
        manager.succeeded(p, skill, "架势已准备，持续 " + skill.ticks() / 20 + " 秒；每人抵挡一次怪物攻击");
    }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void reduce(EntityDamageByEntityEvent event) {
        if (!(event.getEntity() instanceof Player target)) return;
        Immunity immunity = immunities.get(target.getUniqueId());
        if (immunity != null && immunity.until > System.currentTimeMillis() && immunity.world == target.getWorld()
                && target.getGameMode() == GameMode.SURVIVAL && !plugin.pvpParticipant(target) && attacker(event.getDamager()) instanceof Enemy) {
            Player source = Bukkit.getPlayer(immunity.caster); var definition = manager.skill(immunity.skill);
            if (source != null && definition != null && manager.denial(source,definition,false).equals("ready")) {
                event.setCancelled(true); return;
            }
        }
        Guard guard = guards.get(target.getUniqueId()); if (guard == null || guard.until <= System.currentTimeMillis() || guard.world != target.getWorld()) return;
        Player caster = Bukkit.getPlayer(guard.caster); ProfessionCatalog.Skill skill = manager.skill(guard.skill);
        LivingEntity attacker = attacker(event.getDamager());
        if (caster == null || skill == null || !manager.denial(caster, skill, false).equals("ready")
                || !ProfessionManager.equipment(caster, skill.equipment()) || !(attacker instanceof Enemy)
                || target.getGameMode() != GameMode.SURVIVAL || plugin.pvpParticipant(target) || event.getFinalDamage() <= 0) return;
        if (guard.frontal) {
            if (event.getDamager() != attacker || event.getCause() != EntityDamageEvent.DamageCause.ENTITY_ATTACK
                    || attacker.getLocation().distanceSquared(target.getLocation()) > 16) return;
            Vector toward = attacker.getLocation().toVector().subtract(target.getLocation().toVector()).setY(0);
            Vector facing = guard.facing.clone().setY(0);
            if (toward.lengthSquared() < .001 || facing.lengthSquared() < .001 || toward.normalize().dot(facing.normalize()) < .25) return;
        }
        double before = event.getFinalDamage(), desired = before - Math.min(guard.cap, before * .5);
        double low = 0, high = event.getDamage();
        // Armor modifiers are nonlinear; solve the base damage that yields the bounded final reduction.
        for (int i = 0; i < 14; i++) { double mid = (low + high) / 2; event.setDamage(mid);
            if (event.getFinalDamage() < desired) low = mid; else high = mid; }
        event.setDamage(high); reductions.put(event, new Reduction(guard, before, Math.max(0, before - event.getFinalDamage())));
    }
    @EventHandler(priority = EventPriority.MONITOR)
    public void recordReduction(EntityDamageByEntityEvent event) {
        Reduction reduction = reductions.remove(event); if (reduction == null || event.isCancelled()) return;
        double effective = Math.min(reduction.ownReduction, reduction.before - event.getFinalDamage()); if (effective <= .001) return;
        guards.remove(event.getEntity().getUniqueId(), reduction.guard); Player caster = Bukkit.getPlayer(reduction.guard.caster);
        if (caster == null) return;
        manager.metric(caster, "mitigatedDamage", effective);
        plugin.taskMarket().professionAction(caster, GuildManager.Goal.PARRY, 1, event.getDamager().getUniqueId() + ":" + System.nanoTime());
        LivingEntity attacker = attacker(event.getDamager());
        if (attacker instanceof Raider raider) contribute(raider, caster, "mitigation", effective);
        caster.sendMessage("§b有效格挡，减免 " + Math.round(effective * 10) / 10.0 + " 点伤害。");
    }
    private LivingEntity attacker(Entity source) {
        if (source instanceof LivingEntity living) return living;
        if (source instanceof Projectile projectile && projectile.getShooter() instanceof LivingEntity living) return living; return null;
    }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void observeDamage(EntityDamageByEntityEvent event) {
        if (event.getFinalDamage() <= 0) return;
        LivingEntity source = attacker(event.getDamager());
        if (event.getEntity() instanceof Enemy enemy && source instanceof Player p && p.getGameMode() == GameMode.SURVIVAL && !plugin.pvpParticipant(p)) {
            double actual = Math.min(enemy.getHealth() + enemy.getAbsorptionAmount(), event.getFinalDamage()); manager.metric(p, "damage", actual);
            if (event.getDamager() == p && ProfessionManager.equipment(p, "sword") && p.getLocation().distanceSquared(enemy.getLocation()) <= 16)
                melee.put(enemy.getUniqueId(), new Hit(p.getUniqueId(), System.currentTimeMillis() + 10_000));
            else melee.remove(enemy.getUniqueId());
            if (enemy instanceof Raider raider) contribute(raider, p, "damage", actual);
        }
        if (event.getEntity() instanceof Player p && source instanceof Enemy && p.getGameMode() == GameMode.SURVIVAL && !plugin.pvpParticipant(p)) {
            Wound old = wounds.get(p.getUniqueId()); double amount = Math.min(p.getHealth(), event.getFinalDamage());
            String raid = source instanceof Raider raider ? raidKey(raider) : "";
            wounds.put(p.getUniqueId(), new Wound(System.currentTimeMillis() + 120_000,
                    Math.min(40, amount + (old != null && old.until > System.currentTimeMillis() && old.raid.equals(raid) ? old.amount : 0)), raid));
        }
    }
    @EventHandler(priority = EventPriority.MONITOR)
    public void death(EntityDeathEvent event) {
        if (!(event.getEntity() instanceof Enemy enemy)) return;
        Hit last = melee.remove(enemy.getUniqueId()); Player killer = enemy.getKiller();
        if (last != null && last.until > System.currentTimeMillis() && killer != null && killer.getUniqueId().equals(last.player)
                && enemy.getLastDamageCause() instanceof EntityDamageByEntityEvent lethal && lethal.getDamager() == killer
                && killer.getGameMode() == GameMode.SURVIVAL) {
            manager.metric(killer, "meleeKills", 1);
            plugin.taskMarket().professionAction(killer, GuildManager.Goal.MELEE_KILLS, 1, enemy.getUniqueId().toString());
        }
        Map<UUID, Mark> marked = marks.remove(enemy.getUniqueId());
        if (marked != null && killer != null && killer.getGameMode() == GameMode.SURVIVAL) marked.forEach((id, mark) -> {
            Player marker = Bukkit.getPlayer(id);
            if (marker != null && mark.until > System.currentTimeMillis() && marker.getWorld() == mark.world
                    && marker.getLocation().distanceSquared(enemy.getLocation()) <= 32 * 32 && manager.learnedEffect(id, "mark")) {
                manager.metric(marker, "markedKills", 1);
                plugin.taskMarket().professionAction(marker, GuildManager.Goal.MARK_KILLS, 1, enemy.getUniqueId().toString());
            }
        });
    }
    private void step(Player p, ProfessionCatalog.Skill skill) {
        Vector forward = p.getLocation().getDirection().setY(0);
        if (forward.lengthSquared() < .001 || !p.isOnGround()) { manager.result(p, "cast", "unsafe_path", skill.id()); return; }
        forward.normalize(); Location origin = p.getLocation(), destination = origin.clone().add(forward.clone().multiply(skill.range()));
        try {
            var query = WorldGuard.getInstance().getPlatform().getRegionContainer().createQuery(); var local = WorldGuardPlugin.inst().wrapPlayer(p);
            if (!query.testState(BukkitAdapter.adapt(origin), local, Flags.EXIT)) throw new IllegalArgumentException();
            for (double distance = .25; distance <= skill.range() + .01; distance += .25) {
                Location at = origin.clone().add(forward.clone().multiply(distance));
                if (!at.getWorld().isChunkLoaded(at.getBlockX() >> 4, at.getBlockZ() >> 4)
                        || !at.getWorld().getWorldBorder().isInside(at) || !AgentFriendPlugin.safeLanding(at.getBlock())
                        || !query.testState(BukkitAdapter.adapt(at), local, Flags.ENTRY)) throw new IllegalArgumentException();
                // Check the player's width as well as its center. Do not slip through corners.
                for (double x : new double[]{-.31, .31}) for (double z : new double[]{-.31, .31})
                    if (!AgentFriendPlugin.safeLanding(at.clone().add(x, 0, z).getBlock())) throw new IllegalArgumentException();
            }
        } catch (RuntimeException | LinkageError invalid) { manager.result(p, "cast", "unsafe_path", skill.id()); return; }
        if (targets(p, skill.range() + 3, 1, .5).isEmpty()) { manager.result(p, "cast", "no_target", skill.id()); return; }
        if (!manager.begin(p, skill)) return;
        plugin.travelMagic().exemptBlink(p);
        if (!p.teleport(destination)) { manager.refund(p, skill, "unsafe_path"); return; }
        // Movement itself is the successful paid effect, even if a target has moved out of reach.
        for (Enemy target : targets(p, 3.1, 1, .5)) if (damage(p, target, skill.power())) trail(p, target.getEyeLocation());
        manager.succeeded(p, skill, "安全前进 " + skill.range() + " 格；落点附近挥斩");
    }
    private List<Player> allies(Player p, double range, int count, boolean wounded, String name) {
        List<Player> targets = new ArrayList<>();
        for (Player target : p.getWorld().getPlayers()) {
            if (target.getGameMode() != GameMode.SURVIVAL || target.isDead() || plugin.pvpParticipant(target)
                    || !name.isBlank() && !target.getName().equalsIgnoreCase(name) || !visible(p, target, range)) continue;
            if (wounded && target.getHealth() >= target.getMaxHealth() - .001) continue;
            targets.add(target);
        }
        targets.sort(Comparator.comparingDouble(target -> target.getLocation().distanceSquared(p.getLocation())));
        return targets.stream().limit(count).toList();
    }
    private void mend(Player p, ProfessionCatalog.Skill skill, String name) {
        List<Player> targets = allies(p, skill.range(), skill.targets(), true, name);
        if (targets.isEmpty()) { manager.result(p, "cast", "no_target", skill.id()); return; }
        if (!manager.begin(p, skill)) return;
        double restored = 0;
        for (Player target : targets) {
            double amount = Math.min(skill.power(), target.getMaxHealth() - target.getHealth());
            EntityRegainHealthEvent event = new EntityRegainHealthEvent(target, amount, EntityRegainHealthEvent.RegainReason.MAGIC);
            ownHealing.add(target.getUniqueId());
            try { Bukkit.getPluginManager().callEvent(event); } finally { ownHealing.remove(target.getUniqueId()); }
            if (event.isCancelled()) continue;
            amount = Math.min(amount, Math.max(0, event.getAmount())); if (amount <= 0) continue;
            target.setHealth(Math.min(target.getMaxHealth(), target.getHealth() + amount)); restored += amount;
            target.getWorld().spawnParticle(Particle.HEART, target.getLocation().add(0, 1.3, 0), 4, .2, .3, .2, 0);
            recordHealing(p, target, amount);
            var rank = manager.rank(p,skill.id());
            if (rank.wardTicks() > 0) {
                Guard old = guards.get(target.getUniqueId());
                if (old == null || old.until <= System.currentTimeMillis() || old.cap <= rank.wardCap())
                    guards.put(target.getUniqueId(),new Guard(p.getUniqueId(),skill.id(),p.getWorld(),p.getEyeLocation().getDirection(),
                            System.currentTimeMillis()+rank.wardTicks()*50L,rank.wardCap(),false));
            }
            if (rank.immuneTicks() > 0) immunities.put(target.getUniqueId(),new Immunity(p.getUniqueId(),skill.id(),p.getWorld(),System.currentTimeMillis()+rank.immuneTicks()*50L));
            if (rank.wardTicks() > 0 || rank.immuneTicks() > 0) target.sendMessage("§d圣愈护佑：怪物攻击减伤 " + rank.wardTicks()/20
                    + " 秒（一次），护佑 " + rank.immuneTicks()/20.0 + " 秒。");
        }
        if (restored <= 0) { manager.refund(p, skill, "protected_target"); return; }
        manager.succeeded(p, skill, "实际恢复 " + Math.round(restored * 10) / 10.0 + " 点生命；队友怪物伤量才计入治疗试炼");
    }
    void recordHealing(Player caster, Player target, double amount) {
        if (amount <= 0) return;
        Wound wound = wounds.get(target.getUniqueId());
        if (caster != null) manager.metric(caster, "healedDamage", amount);
        if (wound == null || wound.until <= System.currentTimeMillis()) return;
        double effective = Math.min(wound.amount, amount);
        wounds.put(target.getUniqueId(), new Wound(wound.until, Math.max(0, wound.amount - effective), wound.raid));
        if (caster == null || caster == target || !manager.learnedEffect(caster.getUniqueId(), "mend") || effective <= 0) return;
        plugin.taskMarket().professionAction(caster, GuildManager.Goal.HEALING, effective, "");
        manager.metric(caster, "combatHealing", effective); contribute(wound.raid, caster, "healing", effective);
    }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void recovered(EntityRegainHealthEvent event) {
        if (event.getEntity() instanceof Player p && !ownHealing.contains(p.getUniqueId()))
            recordHealing(null, p, Math.min(event.getAmount(), p.getMaxHealth() - p.getHealth()));
    }
    private void mark(Player p, ProfessionCatalog.Skill skill) {
        List<Enemy> targets = targets(p, skill.range(), skill.targets(), .3);
        long now = System.currentTimeMillis();
        targets = targets.stream().filter(target -> !marks.containsKey(target.getUniqueId())
                || !marks.get(target.getUniqueId()).containsKey(p.getUniqueId())
                || marks.get(target.getUniqueId()).get(p.getUniqueId()).until <= now).toList();
        if (targets.isEmpty()) { manager.result(p, "cast", "no_target", skill.id()); return; }
        if (!manager.begin(p, skill)) return;
        for (Enemy target : targets) {
            marks.computeIfAbsent(target.getUniqueId(), ignored -> new HashMap<>()).put(p.getUniqueId(), new Mark(now + skill.ticks() * 50L, p.getWorld()));
            p.sendMessage("MC_HOSTILE type=" + target.getType().getKey() + " " + LocationOutput.fields(target.getLocation()));
        }
        manager.succeeded(p, skill, "标记 " + targets.size() + " 个敌人，持续 " + skill.ticks() / 20 + " 秒；击败标记者计入侦察试炼");
    }
    private void cleanse(Player p, ProfessionCatalog.Skill skill) {
        List<PotionEffectType> removable = List.of(PotionEffectType.POISON, PotionEffectType.WITHER);
        if (removable.stream().noneMatch(p::hasPotionEffect)) { manager.result(p, "cast", "no_target", skill.id()); return; }
        if (!manager.begin(p, skill)) return; int count = 0;
        for (PotionEffectType type : removable) if (p.hasPotionEffect(type)) { p.removePotionEffect(type); if (!p.hasPotionEffect(type)) count++; }
        if (count == 0) { manager.refund(p, skill, "protected_target"); return; } manager.succeeded(p, skill, "解除毒素与凋零");
    }
    private void buff(Player p, ProfessionCatalog.Skill skill) {
        PotionEffectType type = skill.effect().equals("haste") ? PotionEffectType.HASTE : PotionEffectType.FIRE_RESISTANCE;
        PotionEffect old = p.getPotionEffect(type);
        if (old != null && (old.getAmplifier() > 0 || old.getDuration() >= skill.ticks() - 20)) { manager.result(p, "cast", "already_effective", skill.id()); return; }
        if (!manager.begin(p, skill)) return;
        if (!p.addPotionEffect(new PotionEffect(type, skill.ticks(), 0, false, true))) { manager.refund(p, skill, "protected_target"); return; }
        manager.succeeded(p, skill, "获得 " + skill.ticks() / 20 + " 秒状态；原版挖掘和领地保护照常生效");
    }
    private boolean growable(Player p, Block block) {
        if (!(block.getBlockData() instanceof Ageable age) || age.getAge() >= age.getMaximumAge()
                || !Set.of(Material.WHEAT, Material.CARROTS, Material.POTATOES, Material.BEETROOTS).contains(block.getType())
                || !plugin.lands().allows(p, "place", block.getLocation()) || plugin.dungeon().deniesEdit(block.getLocation())) return false;
        try { return WorldGuard.getInstance().getPlatform().getRegionContainer().createQuery()
                .testBuild(BukkitAdapter.adapt(block.getLocation()), WorldGuardPlugin.inst().wrapPlayer(p)); }
        catch (RuntimeException | LinkageError missing) { return false; }
    }
    private void growth(Player p, ProfessionCatalog.Skill skill) {
        List<Block> blocks = new ArrayList<>(); Location at = p.getLocation(); int radius = (int) skill.range();
        for (int x = -radius; x <= radius; x++) for (int z = -radius; z <= radius; z++) for (int y = -1; y <= 1; y++) {
            Location target = at.clone().add(x, y, z);
            if (target.getWorld().isChunkLoaded(target.getBlockX() >> 4, target.getBlockZ() >> 4)
                    && target.distanceSquared(at) <= skill.range() * skill.range() && growable(p, target.getBlock())) blocks.add(target.getBlock());
        }
        blocks.sort(Comparator.comparingDouble(block -> block.getLocation().distanceSquared(at)));
        if (blocks.isEmpty()) { manager.result(p, "cast", "no_target", skill.id()); return; }
        if (!manager.begin(p, skill)) return; int changed = 0;
        for (Block block : blocks.stream().limit(skill.targets()).toList()) {
            if (!growable(p, block)) continue;
            var state = block.getState(); Ageable data = (Ageable) block.getBlockData(); data.setAge(Math.min(data.getMaximumAge(), data.getAge() + (int) skill.power()));
            state.setBlockData(data); BlockGrowEvent event = new BlockGrowEvent(block, state); Bukkit.getPluginManager().callEvent(event);
            if (!event.isCancelled()) { state.update(true, false); changed++; block.getWorld().spawnParticle(Particle.HAPPY_VILLAGER, block.getLocation().add(.5, .7, .5), 4, .2, .2, .2, 0); }
        }
        if (changed == 0) { manager.refund(p, skill, "protected_target"); return; }
        manager.succeeded(p, skill, "促进 " + changed + " 株庄稼生长；不会生成物品或收割他人作物");
    }
    private void tick() {
        long now = System.currentTimeMillis();
        guards.entrySet().removeIf(entry -> entry.getValue().until <= now);
        immunities.entrySet().removeIf(entry -> entry.getValue().until <= now);
        wounds.entrySet().removeIf(entry -> { Player p = Bukkit.getPlayer(entry.getKey());
            return entry.getValue().until <= now || p == null || p.getHealth() >= p.getMaxHealth(); });
        melee.entrySet().removeIf(entry -> entry.getValue().until <= now);
        Iterator<Map.Entry<UUID, Map<UUID, Mark>>> iterator = marks.entrySet().iterator();
        while (iterator.hasNext()) {
            var entry = iterator.next(); Entity target = Bukkit.getEntity(entry.getKey());
            entry.getValue().entrySet().removeIf(mark -> mark.getValue().until <= now);
            if (target == null || !target.isValid() || target.isDead() || entry.getValue().isEmpty()) { iterator.remove(); continue; }
            for (var mark : entry.getValue().entrySet()) {
                Player p = Bukkit.getPlayer(mark.getKey());
                if (p == null || p.getWorld() != target.getWorld() || p.getLocation().distanceSquared(target.getLocation()) > 32 * 32) continue;
                Location at = target.getLocation().add(0, 2.3, 0);
                p.spawnParticle(Particle.END_ROD, at, 3, .15, .15, .15, 0);
                Player eye = plugin.attachedEye(p); if (eye != null) eye.spawnParticle(Particle.END_ROD, at, 3, .15, .15, .15, 0);
            }
        }
    }
    private String raidKey(Raider raider) { return raider.getRaid() == null ? "" : raider.getWorld().getUID() + "_" + raider.getRaid().getId(); }
    private void contribute(Raider target, Player p, String metric, double value) {
        if (target.getRaid() == null || target.getRaid().getStatus() != Raid.RaidStatus.ONGOING) return;
        contribute(raidKey(target), p, metric, value);
    }
    private void contribute(String id, Player p, String metric, double value) {
        if (id.isEmpty() || value <= 0 || p.getGameMode() != GameMode.SURVIVAL || plugin.pvpParticipant(p)) return;
        if (!raids.has(id)) {
            if (raids.size() >= 32) return;
            JsonObject row = new JsonObject(); row.add("participants", new JsonObject());
            ProfessionLedger.strings(row, "rewards", manager.rewards("raid_victory", "village_defense")); raids.add(id, row);
        }
        JsonObject participants = raids.getAsJsonObject(id).getAsJsonObject("participants");
        if (!participants.has(p.getUniqueId().toString())) { if (participants.size() >= 64) return; participants.add(p.getUniqueId().toString(), new JsonObject()); }
        JsonObject totals = participants.getAsJsonObject(p.getUniqueId().toString());
        totals.addProperty(metric, (totals.has(metric) ? totals.get(metric).getAsDouble() : 0) + value); dirty = true;
    }
    @EventHandler public void raidFinished(RaidFinishEvent event) {
        if (event.getRaid().getStatus() != Raid.RaidStatus.VICTORY) return;
        String id = event.getWorld().getUID() + "_" + event.getRaid().getId(); if (!raids.has(id)) return;
        // Contribution, rather than last hit or mere presence. UUID ordering makes limited-title ties stable.
        JsonObject participants = raids.getAsJsonObject(id).getAsJsonObject("participants");
        for (String player : participants.keySet().stream().sorted().toList()) {
            JsonObject totals = participants.getAsJsonObject(player);
            if (amount(totals, "damage") < 10 && amount(totals, "healing") < 8 && amount(totals, "mitigation") < 4) continue;
            UUID uuid = UUID.fromString(player);
            List<String> grants = ProfessionLedger.strings(raids.getAsJsonObject(id), "rewards").stream()
                    .filter(skill -> manager.skill(skill) != null && manager.selected(uuid, manager.skill(skill).role())).toList();
            manager.queue(uuid, "raid_victory:" + id, id, grants);
        }
        plugin.saveConfig(); manager.recover(); raids.remove(id); dirty = true; manager.flushMetrics();
    }
    private double amount(JsonObject object, String key) { return object.has(key) ? object.get(key).getAsDouble() : 0; }
    @EventHandler public void raidStopped(RaidStopEvent event) {
        String id = event.getWorld().getUID() + "_" + event.getRaid().getId();
        if (raids.remove(id) != null) dirty = true;
    }
    boolean dirty() { return dirty; }
    void save(JsonObject data) { data.add("raids", raids.deepCopy()); }
    void saved() { dirty = false; }
    void clear(UUID player) {
        combos.remove(player);
        guards.entrySet().removeIf(entry -> entry.getKey().equals(player) || entry.getValue().caster.equals(player)); wounds.remove(player);
        immunities.entrySet().removeIf(entry -> entry.getKey().equals(player) || entry.getValue().caster.equals(player));
        marks.values().forEach(value -> value.remove(player));
    }
    @EventHandler public void quit(PlayerQuitEvent event) { clear(event.getPlayer().getUniqueId()); }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true) public void teleport(PlayerTeleportEvent event) { clear(event.getPlayer().getUniqueId()); }
    @EventHandler public void death(PlayerDeathEvent event) { clear(event.getEntity().getUniqueId()); }
    @EventHandler(ignoreCancelled = true) public void mode(PlayerGameModeChangeEvent event) { clear(event.getPlayer().getUniqueId()); }
    void shutdown() { guards.clear(); immunities.clear(); reductions.clear(); marks.clear(); wounds.clear(); melee.clear(); combos.clear(); }
}
