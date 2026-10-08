package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.block.Block;
import org.bukkit.block.DoubleChest;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.ArmorStand;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Item;
import org.bukkit.entity.ItemFrame;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.entity.minecart.StorageMinecart;
import org.bukkit.entity.minecart.HopperMinecart;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockBurnEvent;
import org.bukkit.event.block.BlockDispenseEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockFromToEvent;
import org.bukkit.event.block.BlockPistonExtendEvent;
import org.bukkit.event.block.BlockPistonRetractEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.event.entity.EntitySpawnEvent;
import org.bukkit.event.entity.ItemMergeEvent;
import org.bukkit.event.entity.ItemSpawnEvent;
import org.bukkit.event.hanging.HangingBreakByEntityEvent;
import org.bukkit.event.hanging.HangingBreakEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.inventory.InventoryMoveItemEvent;
import org.bukkit.event.inventory.InventoryOpenEvent;
import org.bukkit.event.inventory.InventoryPickupItemEvent;
import org.bukkit.event.player.PlayerArmorStandManipulateEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerHarvestBlockEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.vehicle.VehicleMoveEvent;
import org.bukkit.event.world.EntitiesLoadEvent;
import org.bukkit.inventory.BlockInventoryHolder;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.persistence.PersistentDataType;

/** Physical hall property belongs to an exact player UUID; public services stay outside its bounds. */
final class GuildStorageOwnership implements Listener {
    private final AgentFriendPlugin plugin;
    private final UUID fallbackOwner;
    private final NamespacedKey droppedOwner;
    private final NamespacedKey displayOwner;
    private final Map<UUID, Notice> notices = new HashMap<>();
    private record Notice(String key, long time) { }

    GuildStorageOwnership(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        UUID configured;
        try { configured = UUID.fromString(plugin.getConfig().getString("guild-storage.owner-uuid", SoulboundGear.MENGMENG.toString())); }
        catch (IllegalArgumentException error) {
            configured = null;
            plugin.getLogger().severe("Invalid guild storage owner UUID: hall storage remains locked.");
        }
        fallbackOwner = configured;
        droppedOwner = new NamespacedKey(plugin, "guild_storage_drop_owner");
        displayOwner = new NamespacedKey(plugin, "guild_property_owner");
        plugin.getServer().getPluginManager().registerEvents(this, plugin);
        plugin.getServer().getScheduler().runTaskLater(plugin, () -> {
            org.bukkit.World world = plugin.getServer().getWorld("world");
            if (world == null || !plugin.guildHall().isBuilt()) return;
            Location center = new Location(world, plugin.getConfig().getInt("guild-hall.x") + .5,
                    plugin.getConfig().getInt("guild-hall.y") + 4, plugin.getConfig().getInt("guild-hall.z") + .5);
            world.getNearbyEntities(center, 10, 8, 8).forEach(this::markProperty);
        }, 40L);
    }

    private UUID owner() { return plugin.lands().guildOwner() != null ? plugin.lands().guildOwner() : fallbackOwner; }
    String ownerLabel() { UUID id = owner(); return SoulboundGear.MENGMENG.equals(id) ? "萌萌" : plugin.lands().ownerName(id); }
    boolean owns(Player player) { return plugin.lands().guildOwner() != null ? plugin.lands().guildMember(player)
            : owner() != null && owner().equals(player.getUniqueId()); }
    private boolean inside(Location at) { return plugin.guildHall().containsProperty(at); }
    boolean deniesEdit(Player player, Block block) { return inside(block.getLocation()) && !owns(player); }

    private Location protectedHolder(InventoryHolder holder) {
        if (holder instanceof DoubleChest chest) {
            Location left = protectedHolder(chest.getLeftSide());
            return left != null ? left : protectedHolder(chest.getRightSide());
        }
        if (holder instanceof BlockInventoryHolder block) {
            Location at = block.getBlock().getLocation();
            return inside(at) ? at : null;
        }
        if (holder instanceof StorageMinecart || holder instanceof HopperMinecart) {
            Location at = ((Entity) holder).getLocation();
            return propertyDisplay((Entity) holder) ? at : null;
        }
        // Personal player/ender inventories and virtual quest/shop menus are not hall stock.
        return null;
    }

    private Location protectedInventory(Inventory inventory) { return protectedHolder(inventory.getHolder()); }
    boolean physicalContainer(Block block) { return block.getState() instanceof BlockInventoryHolder; }
    private Location protectedContainer(Block block) {
        return block.getState() instanceof BlockInventoryHolder holder ? protectedInventory(holder.getInventory()) : null;
    }
    boolean deniesContainer(Player player, Block block) { return !owns(player) && protectedContainer(block) != null; }

    void ownershipFields(JsonObject data) {
        data.addProperty("owner", ownerLabel());
        data.addProperty("ownerUuid", owner() == null ? null : owner().toString());
        data.addProperty("publicCommand", "/mycli guild shared");
    }

    void denied(Player player, String action, Location at) {
        String key = action + ":" + at.getBlockX() + ":" + at.getBlockY() + ":" + at.getBlockZ();
        long now = System.currentTimeMillis();
        Notice last = notices.get(player.getUniqueId());
        if (last != null && last.key().equals(key) && now - last.time() < 1000) return;
        notices.put(player.getUniqueId(), new Notice(key, now));
        player.sendMessage("§c【无权操作】公会内物品归" + ownerLabel() + "所有，禁止未授权的人取放或破坏。§e物资装备请用门口东南侧公共箱（-473,67,-495）；/mycli guild shared 查看全部位置。");
        JsonObject data = new JsonObject();
        data.addProperty("schemaVersion", 1);
        data.addProperty("kind", "guild_storage");
        data.addProperty("action", action);
        data.addProperty("status", "deny");
        data.addProperty("allowed", false);
        data.addProperty("reason", owner() == null ? "guild_owner_unavailable" : "guild_owner_only");
        data.addProperty("world", at.getWorld().getKey().toString());
        data.addProperty("x", at.getBlockX()); data.addProperty("y", at.getBlockY()); data.addProperty("z", at.getBlockZ());
        ownershipFields(data);
        plugin.protectionAdvisor().send(player, data);
        player.sendMessage("MC_GUILD_ACCESS " + data);
    }

    boolean handleInteract(PlayerInteractEvent event) {
        Block block = event.getClickedBlock();
        if (block == null || !deniesContainer(event.getPlayer(), block)) return false;
        event.setCancelled(true);
        denied(event.getPlayer(), "container", block.getLocation());
        return true;
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onInteract(PlayerInteractEvent event) { handleInteract(event); }
    @EventHandler(priority = EventPriority.HIGHEST) public void onOpen(InventoryOpenEvent event) {
        Location at = protectedInventory(event.getInventory());
        if (at != null && event.getPlayer() instanceof Player player && !owns(player)) {
            event.setCancelled(true); denied(player, "container", at);
        }
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onClick(InventoryClickEvent event) {
        Location at = protectedInventory(event.getView().getTopInventory());
        if (at != null && event.getWhoClicked() instanceof Player player && !owns(player)) {
            event.setCancelled(true); denied(player, "inventory", at);
        }
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onDrag(InventoryDragEvent event) {
        Location at = protectedInventory(event.getView().getTopInventory());
        if (at != null && event.getWhoClicked() instanceof Player player && !owns(player)) {
            event.setCancelled(true); denied(player, "inventory", at);
        }
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onBreak(BlockBreakEvent event) {
        if (deniesEdit(event.getPlayer(), event.getBlock())) {
            event.setCancelled(true); denied(event.getPlayer(), "break", event.getBlock().getLocation());
        }
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onPlace(BlockPlaceEvent event) {
        if (deniesEdit(event.getPlayer(), event.getBlock())) {
            event.setCancelled(true); denied(event.getPlayer(), "place", event.getBlock().getLocation());
        }
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onHarvest(PlayerHarvestBlockEvent event) {
        if (deniesEdit(event.getPlayer(), event.getHarvestedBlock())) {
            event.setCancelled(true); denied(event.getPlayer(), "harvest", event.getHarvestedBlock().getLocation());
        }
    }

    private boolean display(Entity entity) { return entity instanceof ItemFrame || entity instanceof ArmorStand
            || entity instanceof StorageMinecart || entity instanceof HopperMinecart; }
    private boolean propertyDisplay(Entity entity) { return display(entity) && (inside(entity.getLocation())
            || entity.getPersistentDataContainer().has(displayOwner, PersistentDataType.STRING)); }
    private void markProperty(Entity entity) {
        if (owner() == null || !inside(entity.getLocation())) return;
        if (display(entity)) entity.getPersistentDataContainer().set(displayOwner, PersistentDataType.STRING, owner().toString());
        if (entity instanceof Item item) item.getPersistentDataContainer().set(droppedOwner, PersistentDataType.STRING, owner().toString());
    }
    @EventHandler public void onEntitySpawn(EntitySpawnEvent event) { markProperty(event.getEntity()); }
    @EventHandler public void onEntitiesLoad(EntitiesLoadEvent event) {
        if (!plugin.guildHall().isBuilt() || !event.getWorld().getName().equals("world")) return;
        int x = plugin.getConfig().getInt("guild-hall.x"), z = plugin.getConfig().getInt("guild-hall.z");
        if (event.getChunk().getX() < ((x - 9) >> 4) || event.getChunk().getX() > ((x + 9) >> 4)
                || event.getChunk().getZ() < ((z - 7) >> 4) || event.getChunk().getZ() > ((z + 7) >> 4)) return;
        event.getEntities().forEach(this::markProperty);
    }
    @EventHandler public void onVehicleMove(VehicleMoveEvent event) {
        if (owner() != null && display(event.getVehicle()) && (inside(event.getFrom()) || inside(event.getTo())))
            event.getVehicle().getPersistentDataContainer().set(displayOwner, PersistentDataType.STRING, owner().toString());
    }
    private Player responsible(Entity source) {
        if (source instanceof Player player) return player;
        return source instanceof Projectile projectile && projectile.getShooter() instanceof Player player ? player : null;
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onEntityInteract(PlayerInteractEntityEvent event) {
        if (propertyDisplay(event.getRightClicked()) && !owns(event.getPlayer())) {
            event.setCancelled(true); denied(event.getPlayer(), "display", event.getRightClicked().getLocation());
        }
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onArmorStand(PlayerArmorStandManipulateEvent event) {
        if (propertyDisplay(event.getRightClicked()) && !owns(event.getPlayer())) {
            event.setCancelled(true); denied(event.getPlayer(), "display", event.getRightClicked().getLocation());
        }
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onDamage(EntityDamageEvent event) {
        if (!propertyDisplay(event.getEntity())) return;
        Player player = event instanceof EntityDamageByEntityEvent by ? responsible(by.getDamager()) : null;
        if (player != null && owns(player)) return;
        event.setCancelled(true);
        if (player != null) denied(player, "display", event.getEntity().getLocation());
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onHanging(HangingBreakEvent event) {
        if (!propertyDisplay(event.getEntity())) return;
        Player player = event instanceof HangingBreakByEntityEvent by ? responsible(by.getRemover()) : null;
        if (player != null && owns(player)) return;
        event.setCancelled(true);
        if (player != null) denied(player, "display", event.getEntity().getLocation());
    }

    private boolean privateDrop(Item item) {
        return inside(item.getLocation()) || item.getPersistentDataContainer().has(droppedOwner, PersistentDataType.STRING);
    }
    @EventHandler public void onSpawn(ItemSpawnEvent event) {
        if (inside(event.getLocation()) && owner() != null)
            event.getEntity().getPersistentDataContainer().set(droppedOwner, PersistentDataType.STRING, owner().toString());
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onDrop(PlayerDropItemEvent event) {
        if (inside(event.getPlayer().getLocation()) && !owns(event.getPlayer())) {
            event.setCancelled(true); denied(event.getPlayer(), "drop", event.getPlayer().getLocation());
        }
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onPickup(EntityPickupItemEvent event) {
        if (!privateDrop(event.getItem())) return;
        // Legacy UUID tags identify guild property; current land roles govern access after transfer.
        if (event.getEntity() instanceof Player player && owns(player)) return;
        event.setCancelled(true);
        if (event.getEntity() instanceof Player player) denied(player, "pickup", event.getItem().getLocation());
    }
    @EventHandler public void onMerge(ItemMergeEvent event) {
        if (privateDrop(event.getEntity()) != privateDrop(event.getTarget()) || !java.util.Objects.equals(
                event.getEntity().getPersistentDataContainer().get(droppedOwner, PersistentDataType.STRING),
                event.getTarget().getPersistentDataContainer().get(droppedOwner, PersistentDataType.STRING))) event.setCancelled(true);
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onHopper(InventoryMoveItemEvent event) {
        boolean source = protectedInventory(event.getSource()) != null, destination = protectedInventory(event.getDestination()) != null;
        if (source != destination) event.setCancelled(true);
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onHopperPickup(InventoryPickupItemEvent event) {
        if (privateDrop(event.getItem()) != (protectedInventory(event.getInventory()) != null)) event.setCancelled(true);
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onDispense(BlockDispenseEvent event) {
        if (inside(event.getBlock().getLocation())) event.setCancelled(true);
    }
    @EventHandler public void onExplosion(EntityExplodeEvent event) { event.blockList().removeIf(b -> inside(b.getLocation())); }
    @EventHandler public void onBlockExplosion(BlockExplodeEvent event) { event.blockList().removeIf(b -> inside(b.getLocation())); }
    @EventHandler public void onBurn(BlockBurnEvent event) { if (inside(event.getBlock().getLocation())) event.setCancelled(true); }
    @EventHandler public void onFlow(BlockFromToEvent event) { if (inside(event.getToBlock().getLocation())) event.setCancelled(true); }
    @EventHandler public void onExtend(BlockPistonExtendEvent event) {
        if (event.getBlocks().stream().anyMatch(b -> inside(b.getLocation()) || inside(b.getRelative(event.getDirection()).getLocation()))) event.setCancelled(true);
    }
    @EventHandler public void onRetract(BlockPistonRetractEvent event) {
        if (event.getBlocks().stream().anyMatch(b -> inside(b.getLocation()) || inside(b.getRelative(event.getDirection()).getLocation()))) event.setCancelled(true);
    }
    @EventHandler public void onQuit(PlayerQuitEvent event) { notices.remove(event.getPlayer().getUniqueId()); }

    void audit(CommandSender sender) {
        JsonObject data = new JsonObject();
        data.addProperty("schemaVersion", 1);
        data.addProperty("hallBuilt", plugin.guildHall().isBuilt());
        data.addProperty("ownerReady", owner() != null);
        ownershipFields(data);
        data.addProperty("opBypass", false);
        data.addProperty("loadedOnly", true);
        JsonArray containers = new JsonArray();
        org.bukkit.World world = plugin.getServer().getWorld("world");
        int x = plugin.getConfig().getInt("guild-hall.x"), z = plugin.getConfig().getInt("guild-hall.z");
        if (world != null && plugin.guildHall().isBuilt()) {
            for (int cx = (x - 9) >> 4; cx <= (x + 18) >> 4; cx++) for (int cz = (z - 7) >> 4; cz <= (z + 13) >> 4; cz++) {
                if (!world.isChunkLoaded(cx, cz)) continue;
                for (org.bukkit.block.BlockState state : world.getChunkAt(cx, cz).getTileEntities()) {
                    if (!(state instanceof BlockInventoryHolder) || !(inside(state.getLocation()) || plugin.guildHall().isSharedChest(state.getBlock()))) continue;
                    JsonObject box = new JsonObject();
                    box.addProperty("x", state.getX()); box.addProperty("y", state.getY()); box.addProperty("z", state.getZ());
                    box.addProperty("type", state.getType().getKey().toString());
                    box.addProperty("scope", inside(state.getLocation()) ? "private" : "public");
                    containers.add(box);
                }
            }
        }
        data.add("containers", containers);
        sender.sendMessage("MC_GUILD_STORAGE_AUDIT " + data);
    }
}
