package org.afuhome.agentfriend;

import java.util.UUID;
import java.util.Set;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.data.Ageable;
import org.bukkit.entity.ItemFrame;
import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.inventory.meta.MapMeta;
import org.bukkit.plugin.Plugin;

/** Observes completed native actions; never trusts commands, chat or model responses as evidence. */
final class WorldLifeActions implements Listener {
    private static final Set<Material> CROPS = Set.of(Material.WHEAT, Material.CARROTS,
            Material.POTATOES, Material.BEETROOTS, Material.NETHER_WART);
    private final AgentFriendPlugin plugin;
    WorldLifeActions(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        Bukkit.getPluginManager().registerEvents(this, plugin);
        hook("Shopkeepers", "com.nisovin.shopkeepers.api.events.ShopkeeperTradeCompletedEvent", this::trade);
        hook("ImageFrame", "com.loohp.imageframe.api.events.ImageMapAddedEvent", this::photo);
    }
    @FunctionalInterface private interface NativeAction { void accept(Event event) throws ReflectiveOperationException; }
    @SuppressWarnings("unchecked")
    private void hook(String name, String eventClass, NativeAction action) {
        Plugin dependency = Bukkit.getPluginManager().getPlugin(name);
        if (dependency == null || !dependency.isEnabled()) return;
        try {
            Class<? extends Event> type = (Class<? extends Event>) Class.forName(eventClass, true, dependency.getClass().getClassLoader());
            Bukkit.getPluginManager().registerEvent(type, this, EventPriority.MONITOR, (listener, event) -> {
                if (!type.isInstance(event)) return;
                try { action.accept(event); }
                catch (ReflectiveOperationException | RuntimeException e) {
                    plugin.getLogger().warning("World action unavailable: " + name + " " + e.getClass().getSimpleName());
                }
            }, plugin, true);
        } catch (ReflectiveOperationException e) {
            plugin.getLogger().warning("World action hook unavailable: " + name);
        }
    }
    private Object get(Object object, String name) throws ReflectiveOperationException {
        return object.getClass().getMethod(name).invoke(object);
    }
    private void trade(Event event) throws ReflectiveOperationException {
        Object trade = get(event, "getCompletedTrade");
        if ((Boolean) get(trade, "isCancelled")) return;
        Player player = (Player) get(trade, "getPlayer");
        Object shop = get(event, "getShopkeeper");
        // CompletedEvent is emitted only after Shopkeepers consumes costs and delivers the result.
        String subject = get(shop, "getUniqueId").toString();
        long now = System.currentTimeMillis();
        Runnable record = () -> plugin.taskMarket().worldAction(player, GuildManager.Goal.TRADE,
                subject, "trade:" + UUID.randomUUID(), now);
        if (Bukkit.isPrimaryThread()) record.run(); else Bukkit.getScheduler().runTask(plugin, record);
    }
    private void photo(Event event) throws ReflectiveOperationException {
        Object map = get(event, "getImageMap");
        UUID creator = (UUID) get(map, "getCreator");
        long created = ((Number) get(map, "getCreationTime")).longValue();
        String evidence = "image:" + get(map, "getImageIndex");
        Bukkit.getScheduler().runTask(plugin, () -> {
            Player player = Bukkit.getPlayer(creator);
            if (player == null) return;
            try {
                if ((Boolean) get(map, "isValid")) plugin.taskMarket().worldAction(player,
                        GuildManager.Goal.PHOTO, "", evidence, created);
            } catch (ReflectiveOperationException e) { plugin.getLogger().warning("Photo proof unavailable"); }
        });
    }
    private boolean eligible(Player player) { return player.isOnline() && !player.isDead() && player.getGameMode() == GameMode.SURVIVAL; }
    private String key(Block block) { return block.getWorld().getUID() + ":" + block.getX() + ":" + block.getY() + ":" + block.getZ(); }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void harvest(BlockBreakEvent event) {
        Player player = event.getPlayer(); Block block = event.getBlock();
        if (!eligible(player) || !event.isDropItems() || !CROPS.contains(block.getType())
                || !(block.getBlockData() instanceof Ageable age) || age.getAge() != age.getMaximumAge()) return;
        String crop = block.getType().name(), location = key(block), token = plugin.taskMarket().stepToken(player);
        Bukkit.getScheduler().runTask(plugin, () -> {
            if (eligible(player) && token.equals(plugin.taskMarket().stepToken(player))
                    && block.getType().isAir()) plugin.taskMarket().harvest(player, crop, location);
        });
    }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void plant(BlockPlaceEvent event) {
        Player player = event.getPlayer(); Block block = event.getBlockPlaced();
        if (!eligible(player) || !CROPS.contains(block.getType()) || !(block.getBlockData() instanceof Ageable age) || age.getAge() != 0) return;
        Material crop = block.getType(); String location = key(block), token = plugin.taskMarket().stepToken(player);
        Bukkit.getScheduler().runTask(plugin, () -> {
            if (eligible(player) && token.equals(plugin.taskMarket().stepToken(player)) && block.getType() == crop
                    && block.getBlockData() instanceof Ageable data && data.getAge() == 0
                    && plugin.taskMarket().harvested(player, crop.name(), location))
                plugin.taskMarket().worldAction(player, GuildManager.Goal.REPLANT, crop.name(), location, System.currentTimeMillis());
        });
    }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void hang(PlayerInteractEntityEvent event) {
        Player player = event.getPlayer();
        if (!eligible(player) || !(event.getRightClicked() instanceof ItemFrame frame) || !frame.getItem().getType().isAir()) return;
        var held = player.getInventory().getItem(event.getHand());
        if (!(held.getItemMeta() instanceof MapMeta meta) || !meta.hasMapView()) return;
        int mapId = meta.getMapView().getId(); long now = System.currentTimeMillis();
        Bukkit.getScheduler().runTask(plugin, () -> {
            if (!eligible(player) || !frame.isValid() || !(frame.getItem().getItemMeta() instanceof MapMeta installed)
                    || !installed.hasMapView() || installed.getMapView().getId() != mapId) return;
            Plugin dependency = Bukkit.getPluginManager().getPlugin("ImageFrame");
            if (dependency == null || !dependency.isEnabled()) return;
            try {
                Object manager = dependency.getClass().getField("imageMapManager").get(null);
                Object map = manager.getClass().getMethod("getFromMapId", int.class).invoke(manager, mapId);
                if (map == null || !(Boolean) get(map, "isValid") || !player.getUniqueId().equals(get(map, "getCreator"))) return;
                // Only the image created during this run may satisfy its following hang stage.
                String evidence = "image:" + get(map, "getImageIndex");
                if (plugin.taskMarket().createdPhoto(player, evidence)) plugin.taskMarket().worldAction(player,
                        GuildManager.Goal.PHOTO_HANG, "", evidence, now);
            } catch (ReflectiveOperationException e) { plugin.getLogger().warning("Photo hanging proof unavailable"); }
        });
    }
}
