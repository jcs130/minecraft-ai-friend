package org.afuhome.agentfriend;

import java.util.List;
import java.util.Objects;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.BlockState;
import org.bukkit.block.Container;
import org.bukkit.block.TileState;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.*;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.entity.EntityPlaceEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.hanging.HangingPlaceEvent;
import org.bukkit.event.hanging.HangingBreakEvent;
import org.bukkit.event.player.PlayerArmorStandManipulateEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.inventory.InventoryMoveItemEvent;
import org.bukkit.event.inventory.InventoryOpenEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.player.PlayerBucketEmptyEvent;
import org.bukkit.event.player.PlayerBucketFillEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.DoubleChestInventory;

/** Authorizes and journals the same physical cells. Never uncancels another region's event. */
final class DungeonBuildPolicy implements Listener {
    private static final List<BlockFace> FACES = List.of(BlockFace.UP, BlockFace.DOWN, BlockFace.NORTH,
            BlockFace.SOUTH, BlockFace.EAST, BlockFace.WEST);
    private final AgentFriendPlugin plugin;
    private final boolean reservedCrypt;
    private final CryptBuildingRules cryptRules;

    DungeonBuildPolicy(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        var settings = plugin.getConfig().getConfigurationSection("crypt-temporary");
        reservedCrypt = settings != null && settings.getBoolean("enabled");
        CryptBuildingRules rules = null;
        if (reservedCrypt) {
            try { rules = CryptBuildingRules.load(settings); }
            catch (IllegalArgumentException bad) { plugin.getLogger().warning("Crypt building disabled: " + bad.getMessage()); }
        }
        cryptRules = rules;
    }

    private boolean scopedCrypt(String domain) { return reservedCrypt && CryptBuildingRules.DOMAIN.equals(domain); }

    private boolean allowedCryptPlacement(Player player, Location at, Material original, Material placed) {
        return cryptRules != null && cryptRules.permits(at, original, placed)
                && plugin.siteDungeons().activeBuilder(CryptBuildingRules.SITE, player)
                && plugin.dungeonEdits().hasRoom(CryptBuildingRules.DOMAIN, at, cryptRules.limit());
    }

    static boolean insidePieces(List<ProtectionArea> pieces, Location at) {
        int x = at.getBlockX(), y = at.getBlockY(), z = at.getBlockZ();
        if (!covered(pieces, x, y, z)) return false;
        for (BlockFace side : FACES) {
            if (!covered(pieces, x + side.getModX(), y + side.getModY(), z + side.getModZ())) return false;
        }
        return true;
    }
    private static boolean covered(List<ProtectionArea> sameWorldPieces, int x, int y, int z) {
        for (ProtectionArea piece : sameWorldPieces) if (piece.containsBlock(x, y, z)) return true;
        return false;
    }

    String domain(Location at) {
        if (at == null || at.getWorld() == null) return null;
        if (plugin.dungeon() != null && plugin.dungeon().deniesEdit(at)) return "tower";
        String site = plugin.siteDungeons() == null ? null : plugin.siteDungeons().editDomain(at);
        if (site != null) return site;
        return plugin.wildResets() == null ? null : plugin.wildResets().domain(at);
    }
    boolean editable(Player player, Location at) {
        String domain = domain(at);
        return domain != null && editable(player, domain, at);
    }
    private boolean editable(Player player, String domain, Location at) {
        if (plugin.dungeonEdits() == null || !plugin.dungeonEdits().ready(domain)) return false;
        if (plugin.lands() == null || !plugin.lands().readyForDungeonEdits(at.getWorld()) || plugin.lands().contains(at)) return false;
        if (domain.equals("tower")) return plugin.dungeon().editableInterior(player, at);
        if (domain.startsWith("site-")) return plugin.siteDungeons().editableInterior(domain.substring(5), player, at);
        return plugin.wildResets() != null && plugin.wildResets().editable(at);
    }
    String denial(Player player, String action, Location at) {
        String domain = domain(at);
        if (domain == null) return null;
        if (action.equals("container") && (plugin.lands().contains(at) || plugin.dungeon().stashAnchor(at)
                || containerAllowed(player, domain, at))) return null;
        if (scopedCrypt(domain) && !maintenance(player, domain)) {
            boolean place = action.equals("place") && editable(player, domain, at)
                    && allowedCryptPlacement(player, at, at.getBlock().getType(), player.getInventory().getItemInMainHand().getType());
            return place ? null : "site_dungeon";
        }
        if ((action.equals("break") || action.equals("place") || action.equals("damage"))
                && (editable(player, domain, at) || maintenance(player, domain))) return null;
        return domain.equals("tower") ? "dungeon" : "site_dungeon";
    }
    private boolean containerAllowed(Player player, String domain, Location at) {
        if (plugin.dungeonEdits() == null || !plugin.dungeonEdits().ready(domain)
                || !plugin.lands().readyForDungeonEdits(at.getWorld())) return false;
        return domain.startsWith("site-") ? plugin.siteDungeons().canUseSite(domain.substring(5), player)
                : editable(player, domain, at);
    }
    private boolean before(Player p, String domain, BlockState state) {
        if (!editable(p, domain, state.getLocation())) return false;
        return scopedCrypt(domain) && cryptRules != null
                ? plugin.dungeonEdits().capture(domain, state, cryptRules.limit())
                : plugin.dungeonEdits().capture(domain, state);
    }
    private boolean maintenance(Player p, String domain) {
        return p.getGameMode() == org.bukkit.GameMode.CREATIVE && plugin.trustedBlockEditor(p)
                && plugin.lands() != null && plugin.lands().readyForDungeonEdits(p.getWorld())
                && !plugin.dungeonParticipant(p) && plugin.dungeonEdits() != null
                && plugin.dungeonEdits().ready(domain) && !plugin.dungeonEdits().dirty(domain);
    }
    private void denied(Player p, String action, Block b, String domain) {
        var area = domain.equals("tower") ? plugin.dungeon().protectionArea(b.getLocation())
                : domain.startsWith("site-") ? plugin.siteDungeons().protectionArea(b.getLocation())
                : plugin.wildResets().area(b.getLocation());
        plugin.protectionAdvisor().denied(p, action, b.getLocation(), domain.equals("tower") ? "dungeon" : "site_dungeon", area);
    }
    @EventHandler(priority=EventPriority.HIGHEST, ignoreCancelled=true)
    public void damage(BlockDamageEvent e) {
        String domain = domain(e.getBlock().getLocation());
        if (domain != null && (scopedCrypt(domain) || !editable(e.getPlayer(), domain, e.getBlock().getLocation()))
                && !maintenance(e.getPlayer(), domain)) {
            e.setCancelled(true); denied(e.getPlayer(), "break", e.getBlock(), domain);
        }
    }
    @EventHandler(priority=EventPriority.HIGHEST, ignoreCancelled=true)
    public void breaking(BlockBreakEvent e) {
        Block block = e.getBlock();
        String domain = domain(block.getLocation());
        if (domain == null || maintenance(e.getPlayer(), domain)) return;
        if (scopedCrypt(domain) || !before(e.getPlayer(), domain, block.getState()) || !captureNeighbors(e.getPlayer(), domain, block)) {
            e.setCancelled(true); denied(e.getPlayer(), "break", block, domain);
        }
    }
    // Vanilla may remove the other half of furniture or a supported block without a second break event.
    private boolean captureNeighbors(Player player, String domain, Block center) {
        for (BlockFace face : FACES) {
            Block neighbor = center.getRelative(face);
            var data = neighbor.getBlockData();
            if (neighbor.isEmpty() || neighbor.isLiquid() || neighbor.getType().isOccluding() && !neighbor.getType().hasGravity()) continue;
            boolean attached = data instanceof org.bukkit.block.data.Bisected || data instanceof org.bukkit.block.data.type.Bed
                    || data instanceof org.bukkit.block.data.FaceAttachable || data instanceof org.bukkit.block.data.Attachable
                    || data instanceof org.bukkit.block.data.type.Chest || face == BlockFace.UP
                    || data instanceof org.bukkit.block.data.MultipleFacing || data instanceof org.bukkit.block.data.Directional;
            if (attached && (!Objects.equals(domain, domain(neighbor.getLocation())) || !before(player, domain, neighbor.getState()))) return false;
        }
        return true;
    }
    @EventHandler(priority=EventPriority.HIGHEST, ignoreCancelled=true)
    public void placing(BlockPlaceEvent e) {
        List<BlockState> old = e instanceof BlockMultiPlaceEvent multi ? multi.getReplacedBlockStates() : List.of(e.getBlockReplacedState());
        String target = null;
        for (BlockState state : old) {
            String d = domain(state.getLocation());
            if (d != null) { target = d; break; }
        }
        if (target == null || maintenance(e.getPlayer(), target)) return;
        if (scopedCrypt(target) && (e instanceof BlockMultiPlaceEvent || !allowedCryptPlacement(e.getPlayer(),
                e.getBlockPlaced().getLocation(), e.getBlockReplacedState().getType(), e.getBlockPlaced().getType()))) {
            e.setCancelled(true); denied(e.getPlayer(), "place", e.getBlockPlaced(), target); return;
        }
        for (BlockState state : old) {
            if (!target.equals(domain(state.getLocation())) || state instanceof TileState || !before(e.getPlayer(), target, state)) {
                e.setCancelled(true); denied(e.getPlayer(), "place", state.getBlock(), target); return;
            }
        }
        for (BlockState state : old) {
            if (!captureNeighbors(e.getPlayer(), target, state.getBlock())) {
                e.setCancelled(true); denied(e.getPlayer(), "place", state.getBlock(), target); return;
            }
        }
    }
    private static List<Block> containers(Inventory inventory) {
        if (inventory instanceof DoubleChestInventory both) {
            return List.of(both.getLeftSide().getLocation().getBlock(), both.getRightSide().getLocation().getBlock());
        }
        InventoryHolder holder = inventory.getHolder(false);
        if (holder instanceof Container container) return List.of(container.getBlock());
        return List.of();
    }
    private boolean accessInventory(Player p, Inventory inventory, boolean snapshot) {
        String affected = null;
        List<Block> physical = containers(inventory);
        for (Block block : physical) {
            String domain = domain(block.getLocation());
            if (domain != null && !plugin.lands().readyForDungeonEdits(block.getWorld())) return false;
            // Existing private inventories and declared public supplies have their own policies.
            // The tower's personal stash opens a virtual inventory with no physical holder.
            if (domain == null || plugin.lands().contains(block.getLocation())) continue;
            if (affected != null && !affected.equals(domain)) return false;
            affected = domain;
        }
        if (affected == null) return true;
        for (Block block : physical) {
            Location at = block.getLocation();
            if (plugin.lands().contains(at) || !affected.equals(domain(at)) || !containerAllowed(p, affected, at)
                    || snapshot && !plugin.dungeonEdits().capture(affected, block.getState())) return false;
        }
        return true;
    }
    @EventHandler(priority=EventPriority.HIGHEST, ignoreCancelled=true)
    public void open(InventoryOpenEvent e) {
        if (e.getPlayer() instanceof Player p && !accessInventory(p, e.getInventory(), true)) e.setCancelled(true);
    }
    @EventHandler(priority=EventPriority.HIGHEST, ignoreCancelled=true)
    public void click(InventoryClickEvent e) {
        if (e.getWhoClicked() instanceof Player p && !accessInventory(p, e.getView().getTopInventory(), false)) e.setCancelled(true);
    }
    @EventHandler(priority=EventPriority.HIGHEST, ignoreCancelled=true)
    public void drag(InventoryDragEvent e) {
        if (e.getWhoClicked() instanceof Player p && !accessInventory(p, e.getView().getTopInventory(), false)) e.setCancelled(true);
    }
    @EventHandler(priority=EventPriority.HIGHEST, ignoreCancelled=true)
    public void hopper(InventoryMoveItemEvent e) {
        if (managed(e.getSource().getLocation()) || managed(e.getDestination().getLocation())) e.setCancelled(true);
    }
    private boolean managed(Location at) { return domain(at) != null; }
    private boolean managed(Block block) { return managed(block.getLocation()); }
    private boolean decoration(org.bukkit.entity.Entity entity) {
        return (entity instanceof org.bukkit.entity.Hanging || entity instanceof org.bukkit.entity.ArmorStand)
                && managed(entity.getLocation());
    }
    @EventHandler(ignoreCancelled=true) public void hang(HangingPlaceEvent e) {
        if (managed(e.getBlock()) || decoration(e.getEntity())) e.setCancelled(true);
    }
    @EventHandler(ignoreCancelled=true) public void unhang(HangingBreakEvent e) {
        if (decoration(e.getEntity())) e.setCancelled(true);
    }
    @EventHandler(ignoreCancelled=true) public void placeEntity(EntityPlaceEvent e) {
        if (decoration(e.getEntity())) e.setCancelled(true);
    }
    @EventHandler(ignoreCancelled=true) public void hitEntity(EntityDamageEvent e) {
        if (decoration(e.getEntity())) e.setCancelled(true);
    }
    @EventHandler(ignoreCancelled=true) public void interactEntity(PlayerInteractEntityEvent e) {
        if (decoration(e.getRightClicked())) e.setCancelled(true);
    }
    @EventHandler(ignoreCancelled=true) public void stand(PlayerArmorStandManipulateEvent e) {
        if (decoration(e.getRightClicked())) e.setCancelled(true);
    }
    @EventHandler(ignoreCancelled=true) public void bucket(PlayerBucketFillEvent e) { if (managed(e.getBlock())) e.setCancelled(true); }
    @EventHandler(ignoreCancelled=true) public void bucket(PlayerBucketEmptyEvent e) {
        if (managed(e.getBlock()) || managed(e.getBlockClicked().getRelative(e.getBlockFace()))) e.setCancelled(true);
    }
    @EventHandler(priority=EventPriority.HIGHEST, ignoreCancelled=true)
    public void tools(org.bukkit.event.player.PlayerInteractEvent e) {
        Block b = e.getClickedBlock();
        if (b == null || e.getAction() != Action.RIGHT_CLICK_BLOCK || e.getItem() == null) return;
        String tool = e.getItem().getType().name();
        if (!(tool.endsWith("_AXE") || tool.endsWith("_HOE") || tool.endsWith("_SHOVEL") || tool.equals("SHEARS")
                || tool.equals("BONE_MEAL") || tool.equals("HONEYCOMB") || tool.equals("BRUSH"))) return;
        // Opening a workbench, door or container while holding a tool is a regular use.
        if (b.getType().isInteractable() && !e.getPlayer().isSneaking()) return;
        String domain = domain(b.getLocation());
        if (domain != null && (scopedCrypt(domain) && !maintenance(e.getPlayer(), domain)
                || !before(e.getPlayer(), domain, b.getState()))) e.setUseItemInHand(org.bukkit.event.Event.Result.DENY);
    }
    @EventHandler(ignoreCancelled=true) public void fertilize(BlockFertilizeEvent e) {
        if (e.getBlocks().stream().anyMatch(s -> managed(s.getLocation()))) e.setCancelled(true);
    }
    @EventHandler(ignoreCancelled=true) public void tree(org.bukkit.event.world.StructureGrowEvent e) {
        if (e.getBlocks().stream().anyMatch(s -> managed(s.getLocation()))) e.setCancelled(true);
    }
    @EventHandler(ignoreCancelled=true) public void sponge(SpongeAbsorbEvent e) {
        if (managed(e.getBlock()) || e.getBlocks().stream().anyMatch(s -> managed(s.getLocation()))) e.setCancelled(true);
    }
    @EventHandler(ignoreCancelled=true) public void dispense(BlockDispenseEvent e) {
        if (managed(e.getBlock()) || e.getBlock().getBlockData() instanceof org.bukkit.block.data.Directional dir
                && managed(e.getBlock().getRelative(dir.getFacing()))) e.setCancelled(true);
    }
    @EventHandler(ignoreCancelled=true) public void grow(BlockGrowEvent e) { if (managed(e.getBlock())) e.setCancelled(true); }
    @EventHandler(ignoreCancelled=true) public void flow(BlockFromToEvent e) {
        if (managed(e.getBlock()) || managed(e.getToBlock())) e.setCancelled(true);
    }
    @EventHandler(ignoreCancelled=true) public void spread(BlockSpreadEvent e) { if (managed(e.getBlock())) e.setCancelled(true); }
    @EventHandler(ignoreCancelled=true) public void burn(BlockBurnEvent e) { if (managed(e.getBlock())) e.setCancelled(true); }
    @EventHandler(ignoreCancelled=true) public void ignite(BlockIgniteEvent e) { if (managed(e.getBlock())) e.setCancelled(true); }
    @EventHandler(ignoreCancelled=true) public void mob(EntityChangeBlockEvent e) { if (managed(e.getBlock())) e.setCancelled(true); }
    @EventHandler(ignoreCancelled=true) public void explode(EntityExplodeEvent e) { e.blockList().removeIf(this::managed); }
    @EventHandler(ignoreCancelled=true) public void explode(BlockExplodeEvent e) { e.blockList().removeIf(this::managed); }
    private boolean piston(Block piston, BlockFace direction, List<Block> moving) {
        return managed(piston) || managed(piston.getRelative(direction))
                || moving.stream().anyMatch(b -> managed(b) || managed(b.getRelative(direction)) || managed(b.getRelative(direction.getOppositeFace())));
    }
    @EventHandler(ignoreCancelled=true) public void extend(BlockPistonExtendEvent e) {
        if (piston(e.getBlock(), e.getDirection(), e.getBlocks())) e.setCancelled(true);
    }
    @EventHandler(ignoreCancelled=true) public void retract(BlockPistonRetractEvent e) {
        if (piston(e.getBlock(), e.getDirection(), e.getBlocks())) e.setCancelled(true);
    }
}
