package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldedit.math.BlockVector3;
import com.sk89q.worldguard.WorldGuard;
import com.sk89q.worldguard.bukkit.WorldGuardPlugin;
import com.sk89q.worldguard.domains.DefaultDomain;
import com.sk89q.worldguard.protection.ApplicableRegionSet;
import com.sk89q.worldguard.protection.flags.Flags;
import com.sk89q.worldguard.protection.flags.RegionGroup;
import com.sk89q.worldguard.protection.flags.StateFlag;
import com.sk89q.worldguard.protection.managers.RegionManager;
import com.sk89q.worldguard.protection.regions.ProtectedCuboidRegion;
import com.sk89q.worldguard.protection.regions.ProtectedRegion;
import java.io.File;
import java.util.*;
import org.bukkit.*;
import org.bukkit.block.Block;
import org.bukkit.block.BlockState;
import org.bukkit.block.DoubleChest;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.*;
import org.bukkit.entity.minecart.StorageMinecart;
import org.bukkit.entity.minecart.HopperMinecart;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.*;
import org.bukkit.event.entity.*;
import org.bukkit.event.hanging.*;
import org.bukkit.event.inventory.*;
import org.bukkit.event.player.*;
import org.bukkit.event.vehicle.VehicleMoveEvent;
import org.bukkit.event.world.EntitiesLoadEvent;
import org.bukkit.inventory.*;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;

/** Configured ownership backed by persistent WorldGuard regions, without OP bypass. */
final class LandManager implements Listener {
    static final String PREFIX = "qd_land_";
    static final String GUILD = "adventurers_guild";
    static final String CHANNEL = "mcagent:land";
    private final AgentFriendPlugin plugin;
    private final File file;
    private final NamespacedKey property;
    private Map<String, Land> lands = Map.of();
    private boolean ready;
    private final Map<UUID, Notice> notices = new HashMap<>();
    private final Map<Inventory, Menu> menus = new IdentityHashMap<>();
    private record Notice(String key, long time) { }
    private record Menu(UUID viewer, int page, List<String> ids) { }
    private record Denial(Location at, Land land) { }
    private record Land(String id, String title, World world, BlockVector3 min, BlockVector3 max,
                        UUID owner, Set<UUID> members, boolean visitorUse, boolean guild) { }

    LandManager(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        file = new File(plugin.getDataFolder(), "lands.yml");
        property = new NamespacedKey(plugin, "land_property");
        if (!file.exists()) plugin.saveResource("lands.yml", false);
        reload(Bukkit.getConsoleSender());
        Bukkit.getMessenger().registerOutgoingPluginChannel(plugin, CHANNEL);
        Bukkit.getPluginManager().registerEvents(this, plugin);
    }

    private RegionManager manager(World world) {
        return WorldGuard.getInstance().getPlatform().getRegionContainer().get(BukkitAdapter.adapt(world));
    }

    private static UUID uuid(Object value) {
        String text = String.valueOf(value);
        UUID id = UUID.fromString(text);
        if (!id.toString().equalsIgnoreCase(text) || id.equals(new UUID(0, 0)))
            throw new IllegalArgumentException("需要完整、非零的玩家 UUID：" + text);
        return id;
    }

    private static BlockVector3 point(ConfigurationSection section, String key) {
        List<?> xyz = section.getList(key);
        if (xyz == null || xyz.size() != 3 || xyz.stream().anyMatch(n -> !(n instanceof Integer)))
            throw new IllegalArgumentException(key + " 必须是三个整数 [x, y, z]");
        return BlockVector3.at((int) xyz.get(0), (int) xyz.get(1), (int) xyz.get(2));
    }

    private static boolean bool(ConfigurationSection section, String key, boolean fallback) {
        if (section.contains(key) && !section.isBoolean(key)) throw new IllegalArgumentException(key + " 必须是 true/false");
        return section.getBoolean(key, fallback);
    }

    private static boolean intersects(Land a, Land b) {
        return a.world().equals(b.world()) && a.min().x() <= b.max().x() && a.max().x() >= b.min().x()
                && a.min().y() <= b.max().y() && a.max().y() >= b.min().y()
                && a.min().z() <= b.max().z() && a.max().z() >= b.min().z();
    }

    void reload(CommandSender sender) {
        Map<RegionManager, Map<String, ProtectedRegion>> originals = new LinkedHashMap<>();
        Map<String, Land> previousLands = lands;
        boolean previouslyReady = ready;
        try {
            YamlConfiguration yaml = new YamlConfiguration();
            yaml.load(file);
            if (yaml.getInt("schema-version", 0) != 1) throw new IllegalArgumentException("schema-version 必须为 1");
            ConfigurationSection definitions = yaml.getConfigurationSection("lands");
            if (definitions == null || definitions.getKeys(false).isEmpty() || definitions.getKeys(false).size() > 128)
                throw new IllegalArgumentException("lands 需要 1..128 项；删除领地请显式设置 enabled: false");
            Map<String, Land> proposed = new LinkedHashMap<>();
            Set<String> disabled = new HashSet<>();
            for (String id : definitions.getKeys(false)) {
                if (!id.matches("[a-z0-9][a-z0-9_-]{0,39}")) throw new IllegalArgumentException("无效的领地 ID：" + id);
                ConfigurationSection s = definitions.getConfigurationSection(id);
                if (s == null) throw new IllegalArgumentException(id + " 需要配置对象");
                if (!bool(s, "enabled", true)) { disabled.add(id); continue; }
                World world = Bukkit.getWorld(s.getString("world", "world"));
                if (world == null) throw new IllegalArgumentException(id + " 的世界不存在");
                boolean guild = "guild-hall".equals(s.getString("source", "bounds"));
                if (!guild && !"bounds".equals(s.getString("source", "bounds"))) throw new IllegalArgumentException(id + " 的 source 无效");
                if (guild && (!id.equals(GUILD) || !world.getName().equals("world")))
                    throw new IllegalArgumentException("guild-hall 仅供 world 的 adventurers_guild 使用");
                BlockVector3 min, max;
                if (guild) {
                    int x = plugin.getConfig().getInt("guild-hall.x", -489);
                    int y = plugin.getConfig().getInt("guild-hall.y", 66);
                    int z = plugin.getConfig().getInt("guild-hall.z", -502);
                    min = BlockVector3.at(x - 9, y - 2, z - 7); max = BlockVector3.at(x + 9, y + 10, z + 7);
                } else { min = point(s, "min"); max = point(s, "max"); }
                if (min.x() > max.x() || min.y() > max.y() || min.z() > max.z()
                        || min.y() < world.getMinHeight() || max.y() >= world.getMaxHeight()
                        || Math.abs((long) min.x()) > 29999984 || Math.abs((long) max.x()) > 29999984
                        || Math.abs((long) min.z()) > 29999984 || Math.abs((long) max.z()) > 29999984)
                    throw new IllegalArgumentException(id + " 的边界倒置或超出世界范围");
                UUID owner = uuid(s.get("owner-uuid"));
                Set<UUID> members = new LinkedHashSet<>();
                if (s.contains("members") && !s.isList("members")) throw new IllegalArgumentException(id + ".members 需要 UUID 列表");
                for (Object value : s.getList("members", List.of())) members.add(uuid(value));
                if (members.size() > 64) throw new IllegalArgumentException(id + " 最多 64 位受信任玩家");
                members.remove(owner);
                String title = s.getString("title", id);
                if (title == null || title.isBlank() || title.length() > 60 || title.chars().anyMatch(c -> c < 32 || c == 167))
                    throw new IllegalArgumentException(id + " 的名称无效");
                Land land = new Land(id, title, world, min, max, owner, Set.copyOf(members), bool(s, "visitor-use", false), guild);
                for (Land other : proposed.values()) if (intersects(land, other))
                    throw new IllegalArgumentException(id + " 与 " + other.id() + " 重叠，需先划清边界");
                proposed.put(id, land);
            }
            if (!proposed.containsKey(GUILD) || !proposed.get(GUILD).guild())
                throw new IllegalArgumentException("必须保留 adventurers_guild / guild-hall，不能误删公会私产保护");
            for (World world : Bukkit.getWorlds()) {
                RegionManager manager = manager(world);
                if (manager == null) throw new IllegalStateException(world.getName() + " 的 WorldGuard 不可用");
                for (String region : manager.getRegions().keySet()) {
                    if (!region.startsWith(PREFIX)) continue;
                    String id = region.substring(PREFIX.length());
                    if (!proposed.containsKey(id) && !disabled.contains(id))
                        throw new IllegalArgumentException("现有领地 " + id + " 缺失；删除须保留 enabled: false 项");
                }
                originals.put(manager, new HashMap<>(manager.getRegions()));
            }
            // Build and validate every definition before replacing any live region.
            Map<RegionManager, Map<String, ProtectedRegion>> replacements = new LinkedHashMap<>();
            originals.forEach((manager, regions) -> {
                Map<String, ProtectedRegion> next = new HashMap<>(regions);
                next.keySet().removeIf(id -> id.startsWith(PREFIX));
                replacements.put(manager, next);
            });
            for (Land land : proposed.values()) {
                ProtectedCuboidRegion region = new ProtectedCuboidRegion(PREFIX + land.id(), land.min(), land.max());
                region.setPriority(50);
                DefaultDomain owners = new DefaultDomain(); owners.addPlayer(land.owner()); region.setOwners(owners);
                DefaultDomain members = new DefaultDomain(); land.members().forEach(members::addPlayer); region.setMembers(members);
                for (StateFlag flag : List.of(Flags.BLOCK_BREAK, Flags.BLOCK_PLACE, Flags.CHEST_ACCESS, Flags.ITEM_DROP, Flags.ITEM_PICKUP)) {
                    region.setFlag(flag, StateFlag.State.DENY);
                    region.setFlag(flag.getRegionGroupFlag(), RegionGroup.NON_MEMBERS);
                }
                for (StateFlag flag : List.of(Flags.USE, Flags.INTERACT)) {
                    region.setFlag(flag, land.visitorUse() ? StateFlag.State.ALLOW : StateFlag.State.DENY);
                    region.setFlag(flag.getRegionGroupFlag(), land.visitorUse() ? RegionGroup.ALL : RegionGroup.NON_MEMBERS);
                }
                for (StateFlag flag : List.of(Flags.TNT, Flags.CREEPER_EXPLOSION, Flags.OTHER_EXPLOSION, Flags.FIRE_SPREAD,
                        Flags.LAVA_FIRE, Flags.ENDER_BUILD, Flags.GHAST_FIREBALL, Flags.WITHER_DAMAGE))
                    region.setFlag(flag, StateFlag.State.DENY);
                region.setFlag(Flags.DENY_MESSAGE, "这里是「" + land.title() + "」，物资与建造权限归领地主人；/mycli land here 查看归属。");
                replacements.get(manager(land.world())).put(region.getId(), region);
            }
            for (var entry : replacements.entrySet()) entry.getKey().setRegions(entry.getValue());
            for (RegionManager manager : replacements.keySet()) manager.save();
            lands = Map.copyOf(proposed); ready = true;
            // Only already loaded entities are visited; no land query loads world chunks.
            for (World world : Bukkit.getWorlds()) world.getEntities().forEach(this::mark);
            // An already open inventory must not retain permissions after a transfer.
            for (Player player : Bukkit.getOnlinePlayers()) {
                Denial denial = deniedInventory(player, player.getOpenInventory().getTopInventory());
                if (denial != null) { player.closeInventory(); deny(player, "container", denial.at(), denial.land()); }
            }
            JsonObject result = new JsonObject(); result.addProperty("status", "success"); result.addProperty("count", lands.size());
            sender.sendMessage("MC_LAND_RELOAD " + result);
        } catch (Exception | LinkageError error) {
            lands = previousLands; ready = previouslyReady;
            if (!originals.isEmpty()) for (var entry : originals.entrySet()) {
                try { entry.getKey().setRegions(entry.getValue()); entry.getKey().save(); }
                catch (Exception rollback) { plugin.getLogger().severe("Land rollback persistence failed: " + rollback.getMessage()); }
            }
            JsonObject result = new JsonObject(); result.addProperty("status", "denied"); result.addProperty("reason", "invalid_land_configuration");
            result.addProperty("detail", error.getMessage()); result.addProperty("retainedPrevious", ready);
            sender.sendMessage("MC_LAND_RELOAD " + result);
            plugin.getLogger().warning("Land configuration rejected; previous protections retained: " + error.getMessage());
        }
    }

    private Land find(Location at) {
        if (at == null || at.getWorld() == null) return null;
        RegionManager manager = manager(at.getWorld());
        if (manager == null) return null;
        for (ProtectedRegion region : manager.getApplicableRegions(BlockVector3.at(at.getBlockX(), at.getBlockY(), at.getBlockZ()))) {
            if (!region.getId().startsWith(PREFIX)) continue;
            String id = region.getId().substring(PREFIX.length());
            Land land = lands.get(id);
            if (land != null) return land;
            UUID owner = region.getOwners().getUniqueIds().stream().findFirst().orElse(null);
            return new Land(id, id, at.getWorld(), region.getMinimumPoint(), region.getMaximumPoint(), owner,
                    Set.copyOf(region.getMembers().getUniqueIds()), false, id.equals(GUILD));
        }
        return null;
    }

    boolean contains(Location at) { return find(at) != null; }
    List<String> ids() { return lands.keySet().stream().sorted().toList(); }
    UUID guildOwner() { Land land = lands.get(GUILD); return ready && land != null ? land.owner() : null; }
    boolean guildMember(Player player) { Land land = lands.get(GUILD); return ready && land != null && member(player, land); }
    private boolean member(Player player, Land land) {
        ProtectedRegion region = manager(land.world()).getRegion(PREFIX + land.id());
        return region != null && (region.getOwners().contains(player.getUniqueId()) || region.getMembers().contains(player.getUniqueId()));
    }

    boolean allows(Player player, String action, Location at) {
        Land land = find(at);
        if (land == null) return true;
        if (!ready || player.getGameMode() == GameMode.SPECTATOR) return false;
        return stateAllows(player, action, at);
    }

    boolean stateAllows(Player player, String action, Location at) {
        ApplicableRegionSet set = manager(at.getWorld()).getApplicableRegions(BlockVector3.at(at.getBlockX(), at.getBlockY(), at.getBlockZ()));
        var local = WorldGuardPlugin.inst().wrapPlayer(player);
        StateFlag flag = switch (action) {
            case "break", "harvest", "damage", "display" -> Flags.BLOCK_BREAK;
            case "place", "bucket", "fertilize" -> Flags.BLOCK_PLACE;
            case "container", "inventory" -> Flags.CHEST_ACCESS;
            case "drop" -> Flags.ITEM_DROP;
            case "pickup" -> Flags.ITEM_PICKUP;
            case "interact" -> Flags.INTERACT;
            default -> Flags.USE;
        };
        boolean edit = List.of("break", "harvest", "damage", "display", "place", "bucket", "fertilize").contains(action);
        boolean build = set.testState(local, Flags.BUILD);
        StateFlag.State state = set.queryState(local, flag);
        // Protection flags without an applicable value inherit BUILD membership;
        // testState(flag) alone returns false for that null value, including owners.
        return (!edit || build) && (state == null ? build : state == StateFlag.State.ALLOW);
    }

    boolean fabricAllowed(Player player, Block block) {
        Land land = find(block.getLocation());
        return ready && land != null && member(player, land) && allows(player, "break", block.getLocation());
    }

    String ownerName(UUID id) {
        if (id == null) return "未知主人";
        if (id.equals(SoulboundGear.MENGMENG)) return "萌萌（.MicroKQ）";
        String name = Bukkit.getOfflinePlayer(id).getName();
        return name == null ? id.toString() : name;
    }

    void fields(JsonObject data, Location at) {
        Land land = find(at);
        if (land == null) return;
        data.addProperty("landId", land.id()); data.addProperty("landTitle", land.title());
        data.addProperty("owner", ownerName(land.owner())); data.addProperty("ownerUuid", land.owner() == null ? null : land.owner().toString());
        data.addProperty("landCommand", "/mycli land info " + land.id());
        if (land.guild()) data.addProperty("publicCommand", "/mycli guild shared");
    }

    boolean denyIfNeeded(Player player, String action, Location at) {
        if (allows(player, action, at)) return false;
        deny(player, action, at); return true;
    }

    private void deny(Player player, String action, Location at) {
        Land land = find(at);
        if (land == null) return;
        deny(player, action, at, land);
    }

    private void deny(Player player, String action, Location at, Land land) {
        String key = land.id() + ":" + action + ":" + at.getBlockX() + ":" + at.getBlockY() + ":" + at.getBlockZ();
        Notice previous = notices.get(player.getUniqueId()); long now = System.currentTimeMillis();
        if (previous != null && previous.key().equals(key) && now - previous.time() < 1000) return;
        notices.put(player.getUniqueId(), new Notice(key, now));
        player.sendMessage("§c【无权操作】「" + land.title() + "」归 " + ownerName(land.owner())
                + " 所有，你没有这项权限。§e" + (land.guild() ? "物资装备请用门口公共箱；/mycli guild shared。" : "/mycli land here 查看归属与权限。"));
        JsonObject data = new JsonObject(); data.addProperty("schemaVersion", 1); data.addProperty("kind", "land");
        data.addProperty("status", "deny"); data.addProperty("allowed", false); data.addProperty("reason", ready ? "land_permission_denied" : "land_unavailable");
        data.addProperty("action", action); data.addProperty("world", at.getWorld().getKey().toString());
        data.addProperty("x", at.getBlockX()); data.addProperty("y", at.getBlockY()); data.addProperty("z", at.getBlockZ());
        data.addProperty("landId", land.id()); data.addProperty("landTitle", land.title());
        data.addProperty("owner", ownerName(land.owner())); data.addProperty("ownerUuid", land.owner()==null?null:land.owner().toString());
        data.addProperty("landCommand", "/mycli land info " + land.id());
        if(land.guild())data.addProperty("publicCommand", "/mycli guild shared");
        plugin.protectionAdvisor().send(player, data); machine(player, "MC_LAND_ACCESS", data);
    }

    private List<Location> inventoryLocations(InventoryHolder holder) {
        if (holder instanceof DoubleChest chest) {
            List<Location> all = new ArrayList<>(inventoryLocations(chest.getLeftSide()));
            all.addAll(inventoryLocations(chest.getRightSide())); return all;
        }
        if (holder instanceof BlockInventoryHolder block) return List.of(block.getBlock().getLocation());
        if (holder instanceof StorageMinecart || holder instanceof HopperMinecart) return List.of(((Entity) holder).getLocation());
        return List.of(); // Personal inventory, ender inventory and virtual quest/trade menus.
    }

    private Denial deniedInventory(Player player, Inventory inventory) {
        for (Location at : inventoryLocations(inventory.getHolder())) if (!allows(player, "container", at)) return new Denial(at,find(at));
        if (inventory.getHolder() instanceof Entity entity && taggedLand(entity) != null && !tagMember(player, entity))
            return new Denial(entity.getLocation(),taggedLand(entity));
        return null;
    }

    private Land taggedLand(Entity entity) {
        String id = entity.getPersistentDataContainer().get(property, PersistentDataType.STRING);
        return id == null ? null : lands.get(id);
    }
    private boolean tagMember(Player player, Entity entity) { Land land = taggedLand(entity); return ready && land != null && member(player, land); }
    private boolean display(Entity entity) { return entity instanceof ItemFrame || entity instanceof ArmorStand
            || entity instanceof StorageMinecart || entity instanceof HopperMinecart; }
    private void mark(Entity entity) {
        Land land = find(entity.getLocation());
        if (land != null && (display(entity) || entity instanceof Item))
            entity.getPersistentDataContainer().set(property, PersistentDataType.STRING, land.id());
    }

    @EventHandler(priority = EventPriority.HIGHEST) public void onBreak(BlockBreakEvent e) {
        if (denyIfNeeded(e.getPlayer(), "break", e.getBlock().getLocation())) e.setCancelled(true);
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onDamageBlock(BlockDamageEvent e) {
        if (denyIfNeeded(e.getPlayer(), "break", e.getBlock().getLocation())) e.setCancelled(true);
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onPlace(BlockPlaceEvent e) {
        if (denyIfNeeded(e.getPlayer(), "place", e.getBlock().getLocation())) e.setCancelled(true);
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onMultiPlace(BlockMultiPlaceEvent e) {
        for (BlockState b : e.getReplacedBlockStates()) if (denyIfNeeded(e.getPlayer(), "place", b.getLocation())) { e.setCancelled(true); break; }
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onUse(PlayerInteractEvent e) {
        Block b = e.getClickedBlock();
        if (b == null || e.getAction() == Action.LEFT_CLICK_BLOCK) return;
        if (b.getState() instanceof BlockInventoryHolder holder) {
            Denial denied = deniedInventory(e.getPlayer(), holder.getInventory());
            if (denied != null) { e.setCancelled(true); deny(e.getPlayer(), "container", denied.at(), denied.land()); return; }
        }
        String action = e.getAction() == Action.PHYSICAL ? "place" : b.getState() instanceof BlockInventoryHolder ? "container" : "use";
        if (e.getItem() != null) {
            String type = e.getItem().getType().name();
            if (type.endsWith("_AXE") || type.endsWith("_HOE") || type.endsWith("_SHOVEL")
                    || List.of("BONE_MEAL", "HONEYCOMB", "FLINT_AND_STEEL", "FIRE_CHARGE", "SHEARS", "BRUSH").contains(type)) action = "place";
        }
        if (denyIfNeeded(e.getPlayer(), action, b.getLocation())) e.setCancelled(true);
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onOpen(InventoryOpenEvent e) {
        if (e.getPlayer() instanceof Player p) { Denial d = deniedInventory(p, e.getInventory()); if (d != null) { e.setCancelled(true); deny(p,"container",d.at(),d.land()); } }
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onClick(InventoryClickEvent e) {
        if (e.getWhoClicked() instanceof Player p) { Denial d = deniedInventory(p,e.getView().getTopInventory()); if(d!=null){e.setCancelled(true);deny(p,"inventory",d.at(),d.land());} }
        Menu menu = menus.get(e.getView().getTopInventory());
        if (menu == null) return;
        e.setCancelled(true);
        if (!(e.getWhoClicked() instanceof Player p) || !p.getUniqueId().equals(menu.viewer()) || e.getRawSlot()<0
                || e.getRawSlot()>=27 || e.getClick().isShiftClick()) return;
        int slot=e.getRawSlot(); menus.remove(e.getView().getTopInventory()); p.closeInventory();
        Bukkit.getScheduler().runTask(plugin,()->{
            if(!p.isOnline())return;
            if(slot==18)open(p,Math.max(1,menu.page()-1));
            else if(slot==25)open(p,menu.page()+1);
            else if(slot==4)command(p,new String[]{"land","here"});
            else if(slot>=9 && slot<9+menu.ids().size())command(p,new String[]{"land","info",menu.ids().get(slot-9)});
        });
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onDrag(InventoryDragEvent e) {
        if(menus.containsKey(e.getView().getTopInventory()))e.setCancelled(true);
        if(e.getWhoClicked() instanceof Player p){Denial d=deniedInventory(p,e.getView().getTopInventory());if(d!=null){e.setCancelled(true);deny(p,"inventory",d.at(),d.land());}}
    }
    @EventHandler public void onClose(InventoryCloseEvent e){menus.remove(e.getInventory());}
    @EventHandler(priority=EventPriority.HIGHEST) public void onBucket(PlayerBucketEmptyEvent e){if(denyIfNeeded(e.getPlayer(),"bucket",e.getBlock().getLocation()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void onBucketFill(PlayerBucketFillEvent e){if(denyIfNeeded(e.getPlayer(),"bucket",e.getBlock().getLocation()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void onFertilize(BlockFertilizeEvent e){if(e.getPlayer()!=null)for(BlockState b:e.getBlocks())if(denyIfNeeded(e.getPlayer(),"fertilize",b.getLocation())){e.setCancelled(true);break;}}
    @EventHandler(priority=EventPriority.HIGHEST) public void onHarvest(PlayerHarvestBlockEvent e){if(denyIfNeeded(e.getPlayer(),"harvest",e.getHarvestedBlock().getLocation()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void onInteract(PlayerInteractEntityEvent e){
        Entity entity=e.getRightClicked();
        boolean denied=taggedLand(entity)!=null && display(entity) && !tagMember(e.getPlayer(),entity);
        if(denied || denyIfNeeded(e.getPlayer(),display(entity)?"display":"interact",entity.getLocation())){e.setCancelled(true);if(denied)denyTag(e.getPlayer(),"display",entity);}
    }
    @EventHandler(priority=EventPriority.HIGHEST) public void onArmorStand(PlayerArmorStandManipulateEvent e){
        if(taggedLand(e.getRightClicked())!=null && !tagMember(e.getPlayer(),e.getRightClicked())){e.setCancelled(true);denyTag(e.getPlayer(),"display",e.getRightClicked());}
    }
    private Player responsible(Entity entity){if(entity instanceof Player p)return p;return entity instanceof Projectile p && p.getShooter() instanceof Player player?player:null;}
    @EventHandler(priority=EventPriority.HIGHEST) public void onDamage(EntityDamageByEntityEvent e){
        Player p=responsible(e.getDamager());if(p==null || e.getEntity() instanceof Player || e.getEntity() instanceof Enemy)return;
        boolean tagged=display(e.getEntity()) && taggedLand(e.getEntity())!=null && !tagMember(p,e.getEntity());
        if(tagged || denyIfNeeded(p,"damage",e.getEntity().getLocation())){e.setCancelled(true);if(tagged)denyTag(p,"display",e.getEntity());}
    }
    @EventHandler(priority=EventPriority.HIGHEST) public void onHanging(HangingBreakByEntityEvent e){
        Player p=responsible(e.getRemover());if(p==null)return;
        if(taggedLand(e.getEntity())!=null && !tagMember(p,e.getEntity())){e.setCancelled(true);denyTag(p,"display",e.getEntity());}
        else if(denyIfNeeded(p,"display",e.getEntity().getLocation()))e.setCancelled(true);
    }
    private void denyTag(Player p,String action,Entity entity){Land land=taggedLand(entity);if(land!=null)deny(p,action,entity.getLocation(),land);}
    @EventHandler public void onEntitySpawn(EntitySpawnEvent e){mark(e.getEntity());}
    @EventHandler public void onLoad(EntitiesLoadEvent e){e.getEntities().forEach(this::mark);}
    @EventHandler public void onVehicle(VehicleMoveEvent e){mark(e.getVehicle());}
    @EventHandler(priority=EventPriority.HIGHEST) public void onDrop(PlayerDropItemEvent e){if(denyIfNeeded(e.getPlayer(),"drop",e.getPlayer().getLocation()))e.setCancelled(true);else mark(e.getItemDrop());}
    @EventHandler(priority=EventPriority.HIGHEST) public void onPickup(EntityPickupItemEvent e){
        Land tag=taggedLand(e.getItem());
        if(tag!=null){if(e.getEntity() instanceof Player p && tagMember(p,e.getItem()))return;e.setCancelled(true);if(e.getEntity() instanceof Player p)denyTag(p,"pickup",e.getItem());}
        else if(e.getEntity() instanceof Player p && denyIfNeeded(p,"pickup",e.getItem().getLocation()))e.setCancelled(true);
    }
    @EventHandler public void onMerge(ItemMergeEvent e){if(!Objects.equals(e.getEntity().getPersistentDataContainer().get(property,PersistentDataType.STRING),e.getTarget().getPersistentDataContainer().get(property,PersistentDataType.STRING)))e.setCancelled(true);}
    private Set<String> inventoryLands(Inventory inventory){Set<String> ids=new HashSet<>();for(Location at:inventoryLocations(inventory.getHolder())){Land land=find(at);if(land!=null)ids.add(land.id());}if(inventory.getHolder() instanceof Entity entity && taggedLand(entity)!=null)ids.add(taggedLand(entity).id());return ids;}
    // Cancel before WorldGuard: its default denied-move handler breaks the hopper.
    @EventHandler(priority=EventPriority.LOWEST) public void onHopper(InventoryMoveItemEvent e){if(!inventoryLands(e.getSource()).equals(inventoryLands(e.getDestination())))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.LOWEST) public void onHopperPickup(InventoryPickupItemEvent e){Land tag=taggedLand(e.getItem());Land current=find(e.getItem().getLocation());Set<String> ids=tag!=null?Set.of(tag.id()):current!=null?Set.of(current.id()):Set.of();if(!ids.equals(inventoryLands(e.getInventory())))e.setCancelled(true);}
    @EventHandler public void onQuit(PlayerQuitEvent e){notices.remove(e.getPlayer().getUniqueId());}
    void stop(){menus.clear();notices.clear();Bukkit.getMessenger().unregisterOutgoingPluginChannel(plugin,CHANNEL);}
    private void machine(Player player,String prefix,JsonObject data){
        JsonObject wire=data.deepCopy();wire.addProperty("type",prefix);plugin.protectionAdvisor().send(player,wire,CHANNEL);
        // Queries are split into short lines for Agents whose chat history truncates long messages.
        JsonObject chat=data;
        if(prefix.equals("MC_LAND_ACCESS")){
            chat=new JsonObject();
            for(String key:List.of("status","allowed","reason","action","landId","ownerUuid","world","x","y","z"))
                if(data.has(key))chat.add(key,data.get(key));
        }
        player.sendMessage(prefix+" "+chat);
    }

    private JsonObject info(Land land, Player viewer) {
        JsonObject data=new JsonObject();data.addProperty("id",land.id());data.addProperty("title",land.title());data.addProperty("world",land.world().getKey().toString());
        data.addProperty("owner",ownerName(land.owner()));data.addProperty("ownerUuid",land.owner()==null?null:land.owner().toString());
        JsonArray min=new JsonArray();min.add(land.min().x());min.add(land.min().y());min.add(land.min().z());data.add("min",min);
        JsonArray max=new JsonArray();max.add(land.max().x());max.add(land.max().y());max.add(land.max().z());data.add("max",max);
        data.addProperty("visitorUse",land.visitorUse());data.addProperty("opBypass",false);
        if(viewer!=null){Location at=new Location(land.world(),land.min().x(),land.min().y(),land.min().z());JsonObject permissions=new JsonObject();for(String action:List.of("break","place","container","use","interact","drop","pickup"))permissions.addProperty(action,allows(viewer,action,at));data.add("permissions",permissions);data.addProperty("role",viewer.getUniqueId().equals(land.owner())?"owner":member(viewer,land)?"member":"visitor");}
        return data;
    }
    void audit(CommandSender sender){JsonObject data=new JsonObject();data.addProperty("schemaVersion",1);data.addProperty("ready",ready);data.addProperty("count",lands.size());JsonArray entries=new JsonArray();lands.values().stream().sorted(Comparator.comparing(Land::id)).forEach(l->entries.add(info(l,null)));data.add("lands",entries);sender.sendMessage("MC_LAND_AUDIT "+data);}
    void command(Player player,String[] args){
        String action=args.length>1?args[1].toLowerCase(Locale.ROOT):"here";
        if(action.equals("menu")){open(player,1);return;}
        JsonObject data=new JsonObject();data.addProperty("schemaVersion",1);data.addProperty("ready",ready);
        if(action.equals("list")){int page=1;try{if(args.length>2)page=Integer.parseInt(args[2]);}catch(NumberFormatException ignored){}List<Land> sorted=lands.values().stream().sorted(Comparator.comparing(Land::id)).toList();page=Math.max(1,Math.min(page,Math.max(1,(sorted.size()+8)/9)));JsonArray entries=new JsonArray();for(int i=(page-1)*9;i<Math.min(page*9,sorted.size());i++)entries.add(info(sorted.get(i),null));data.addProperty("page",page);data.addProperty("pages",Math.max(1,(sorted.size()+8)/9));data.add("lands",entries);JsonObject header=new JsonObject();header.addProperty("schemaVersion",1);header.addProperty("ready",ready);header.addProperty("page",page);header.addProperty("pages",Math.max(1,(sorted.size()+8)/9));header.addProperty("count",sorted.size());player.sendMessage("§6领地列表："+sorted.size()+" 处；/mycli land info <ID> 查看主人和权限。");machine(player,"MC_LAND_LIST",header);for(var entry:entries){JsonObject item=entry.getAsJsonObject();JsonObject summary=new JsonObject();for(String key:List.of("id","title","world","owner","ownerUuid"))summary.add(key,item.get(key));machine(player,"MC_LAND_ITEM",summary);}return;}
        Land land=action.equals("here")?find(player.getLocation()):action.equals("info") && args.length==3?lands.get(args[2]):null;
        if(!action.equals("here") && !action.equals("info")){player.sendMessage("/mycli land here|list [页码]|info <ID>|menu");return;}
        data.addProperty("status",land==null?(action.equals("info")?"not_found":"unclaimed"):"claimed");
        if(land!=null){data.add("land",info(land,player));player.sendMessage("§6「"+land.title()+"」主人："+ownerName(land.owner())+"；你的身份："+(player.getUniqueId().equals(land.owner())?"主人":member(player,land)?"受信任玩家":"访客")+"。"+(land.guild()?"公共物资：/mycli guild shared":""));}else player.sendMessage("§7这里未登记私人领地；原有公共建筑和活动保护仍适用。");
        if(land==null){machine(player,"MC_LAND_INFO",data);return;}
        JsonObject details=data.getAsJsonObject("land");JsonObject header=new JsonObject();header.addProperty("schemaVersion",1);header.addProperty("ready",ready);header.addProperty("status","claimed");for(String key:List.of("id","title","owner","ownerUuid","role"))header.add(key,details.get(key));machine(player,"MC_LAND_INFO",header);
        JsonObject permissions=details.getAsJsonObject("permissions").deepCopy();for(String key:List.of("id","world","min","max"))permissions.add(key,details.get(key));machine(player,"MC_LAND_PERMISSIONS",permissions);
    }
    private ItemStack icon(Material material,String title,String... lore){ItemStack item=new ItemStack(material);ItemMeta meta=item.getItemMeta();meta.setDisplayName(title);meta.setLore(Arrays.asList(lore));item.setItemMeta(meta);return item;}
    void open(Player player,int page){List<Land> sorted=lands.values().stream().sorted(Comparator.comparing(Land::id)).toList();page=Math.max(1,Math.min(page,Math.max(1,(sorted.size()+8)/9)));Inventory inventory=Bukkit.createInventory(null,27,"领地归属 · 第 "+page+" 页");inventory.setItem(4,icon(Material.OAK_SIGN,"§6我所在的领地","§7查看主人和我的权限"));List<String> ids=new ArrayList<>();for(int i=(page-1)*9;i<Math.min(page*9,sorted.size());i++){Land land=sorted.get(i);ids.add(land.id());inventory.setItem(9+ids.size()-1,icon(Material.GRASS_BLOCK,"§a"+land.title(),"§7主人："+ownerName(land.owner()),"§7点击查看权限；不会传送"));}if(page>1)inventory.setItem(18,icon(Material.ARROW,"上一页"));if(page*9<sorted.size())inventory.setItem(25,icon(Material.ARROW,"下一页"));inventory.setItem(26,icon(Material.BARRIER,"关闭"));menus.put(inventory,new Menu(player.getUniqueId(),page,List.copyOf(ids)));player.openInventory(inventory);}
}
