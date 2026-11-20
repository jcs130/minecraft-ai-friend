package org.qiandengji.villagerquests;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Bukkit;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.entity.Tameable;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.bukkit.projectiles.ProjectileSource;
import org.qiandengji.villagerquests.core.Board;
import org.qiandengji.villagerquests.core.QuestType;
import org.qiandengji.villagerquests.core.Templates;

/** Turns server events into evidence. Every handler runs on the main thread. */
final class Listeners implements Listener {
    private static final long DAMAGE_WINDOW_MS = 15_000;
    private static final int DAMAGE_TRACK_LIMIT = 4096;

    private final VillagerQuestsPlugin plugin;
    /** Last attacker per victim, for kills where {@code getKiller()} is null (e.g. a body that is not a Player). */
    private final Map<UUID, Map.Entry<UUID, Long>> lastHit = new LinkedHashMap<>(256, 0.75f, true) {
        @Override protected boolean removeEldestEntry(Map.Entry<UUID, Map.Entry<UUID, Long>> e) { return size() > DAMAGE_TRACK_LIMIT; }
    };

    Listeners(VillagerQuestsPlugin plugin) { this.plugin = plugin; }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onDamage(EntityDamageByEntityEvent event) {
        if (!(event.getEntity() instanceof LivingEntity victim) || victim instanceof Player) return;
        UUID attacker = attacker(event.getDamager());
        if (attacker != null) lastHit.put(victim.getUniqueId(), Map.entry(attacker, System.currentTimeMillis()));
    }

    private static UUID attacker(Entity damager) {
        if (damager instanceof Projectile p) {
            ProjectileSource src = p.getShooter();
            return src instanceof Entity e ? e.getUniqueId() : null;
        }
        if (damager instanceof Tameable t && t.getOwner() != null) return t.getOwner().getUniqueId();
        return damager.getUniqueId();
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onDeath(EntityDeathEvent event) {
        LivingEntity dead = event.getEntity();
        if (dead instanceof Player) return;
        Map.Entry<UUID, Long> hit = lastHit.remove(dead.getUniqueId());
        String actor = null;
        if (dead.getKiller() != null) actor = dead.getKiller().getUniqueId().toString();
        else if (hit != null && System.currentTimeMillis() - hit.getValue() <= DAMAGE_WINDOW_MS) actor = hit.getKey().toString();
        if (actor == null) return;
        Location l = dead.getLocation();
        Board.Evidence e = new Board.Evidence("vqk-" + dead.getUniqueId(), Board.EvidenceKind.KILL, actor, dead.getType().getKey().toString(),
                l.getWorld() == null ? null : l.getWorld().getName(), l.getX(), l.getY(), l.getZ(), 1, System.currentTimeMillis(), null);
        apply(e);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onMove(PlayerMoveEvent event) {
        Location to = event.getTo();
        if (to == null || (event.getFrom().getBlockX() == to.getBlockX() && event.getFrom().getBlockY() == to.getBlockY()
                && event.getFrom().getBlockZ() == to.getBlockZ())) return;
        Player p = event.getPlayer();
        String id = p.getUniqueId().toString();
        for (Board.Quest q : plugin.board.activeFor(id)) {
            if (q.commission.type() != QuestType.REACH) continue;
            apply(new Board.Evidence("vqr-" + q.id + "-" + id, Board.EvidenceKind.REACH, id, q.commission.target(),
                    to.getWorld() == null ? null : to.getWorld().getName(), to.getX(), to.getY(), to.getZ(), 1, System.currentTimeMillis(), null));
        }
    }

    /** Sneak-use a registered native villager for commissions. Normal use continues to open vanilla trade. */
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onInteract(PlayerInteractEntityEvent event) {
        if (event.getHand() != EquipmentSlot.HAND) return;
        String villager = plugin.villagers.villagerOf(event.getRightClicked());
        if (villager == null) return;
        Player p = event.getPlayer();
        if (!p.hasPermission("villagerquests.use")
                || (plugin.villagers.spot(villager).entityUuid() != null && !p.isSneaking())) return;
        ItemStack hand = p.getInventory().getItemInMainHand();
        if (hand.getType() != Material.AIR && hand.getAmount() > 0 && deliver(p, villager, hand)) {
            event.setCancelled(true);
            p.getInventory().setItemInMainHand(hand.getAmount() > 0 ? hand : null);
            return;
        }
        if (!plugin.board.isHero(p.getUniqueId().toString())) {
            event.setCancelled(true);
            QuestCommand.openMenu(plugin, p, villager);
        }
    }

    /** Delivers from the given stack. Items are removed only for the amount the board actually counted. */
    boolean deliver(Player p, String villager, ItemStack stack) {
        String target = stack.getType().getKey().toString();
        String id = p.getUniqueId().toString();
        Board.Evidence e = new Board.Evidence("vqd-" + UUID.randomUUID(), Board.EvidenceKind.DELIVER, id, target, p.getWorld().getName(),
                p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ(), Math.min(64, stack.getAmount()), System.currentTimeMillis(), villager);
        Board.Outcome o = plugin.board.evidence(e);
        if (o.quest() == null || o.counted() <= 0) return false;
        stack.setAmount(stack.getAmount() - o.counted());
        report(e, o);
        return true;
    }

    private void apply(Board.Evidence e) {
        Board.Outcome o = plugin.board.evidence(e);
        if (o.quest() == null) return;
        report(e, o);
    }

    private void report(Board.Evidence e, Board.Outcome o) {
        plugin.markDirty();
        Board.Quest q = o.quest();
        String villager = plugin.name(q.commission.issuer());
        if (o.forward()) { plugin.writeSignal(e, o.counted()); return; }
        Player p = plugin.getServer().getPlayer(UUID.fromString(e.actor()));
        if (o.completed()) {
            plugin.say(q.commission.issuer(), Templates.completed(villager, q.assigneeName == null ? "旅人" : q.assigneeName));
            plugin.taskCards.closed(q);
            if (p != null) plugin.payOwed(p);
        } else if (p != null) {
            plugin.tell(p, Templates.progress(villager, q.progress, q.commission.quantity()));
        }
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        plugin.payOwed(event.getPlayer());
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onMenuClick(InventoryClickEvent event) {
        if (!(event.getInventory().getHolder() instanceof QuestCommand.Menu menu)) return;
        event.setCancelled(true);
        if (!(event.getWhoClicked() instanceof Player p) || event.getClickedInventory() != event.getView().getTopInventory()) return;
        if (menu.guildPage > 0) {
            if (event.getClick() != ClickType.LEFT && event.getClick() != ClickType.RIGHT) return;
            boolean info = event.getClick() == ClickType.RIGHT;
            int slot = event.getRawSlot();
            String id = menu.slots.get(slot);
            int page = slot == 24 && menu.guildPage > 1 ? menu.guildPage - 1
                    : slot == 25 && menu.guildPage < menu.guildPages ? menu.guildPage + 1 : 0;
            if (id == null && slot != 26 && page == 0) return;
            Bukkit.getScheduler().runTask(plugin, () -> {
                if (!p.isOnline() || p.getOpenInventory().getTopInventory() != menu.inventory) return;
                if (slot == 26) {
                    p.closeInventory();
                    p.performCommand("mycli guild menu");
                    return;
                }
                if (page > 0) {
                    GuildBoard.request(plugin, p, "menu", Integer.toString(page));
                    return;
                }
                var response = GuildBoard.request(plugin, p, info ? "info" : "accept", id);
                String result = response.get("status").getAsString();
                if (info && response.has("card")) {
                    var card = response.getAsJsonObject("card");
                    plugin.tell(p, card.get("issuer").getAsString() + " · " + card.get("title").getAsString()
                            + " · " + card.get("objective").getAsString());
                    if (!card.get("story").getAsString().isEmpty()) plugin.tell(p, card.get("story").getAsString());
                } else if ("accepted".equals(result) || "already_accepted".equals(result)) {
                    p.closeInventory();
                } else if ("offer_unavailable".equals(result) || "missing".equals(result)) {
                    plugin.tell(p, "这张委托已不可接，重新打开公会看板刷新。");
                }
            });
            return;
        }
        String questId = menu.slots.get(event.getRawSlot());
        if (questId == null) return;
        p.closeInventory();
        QuestCommand.accept(plugin, p, questId);
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onMenuDrag(InventoryDragEvent event) {
        if (event.getInventory().getHolder() instanceof QuestCommand.Menu) event.setCancelled(true);
    }
}
