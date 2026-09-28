package org.afuhome.agentfriend;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.Sign;
import org.bukkit.block.TileState;
import org.bukkit.block.data.type.Switch;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.MagmaCube;
import org.bukkit.entity.Monster;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockBurnEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockFromToEvent;
import org.bukkit.event.block.BlockIgniteEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.CreatureSpawnEvent;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;

/** Six enclosed vanilla-block floors below the existing village trial lobby. */
final class DungeonManager implements Listener {
    private static final int X = -590, Z = -305, LOBBY_Y = 90, RADIUS = 12;
    private static final int[] Y = {68, 56, 44, 32, 20, 8};
    private static final long COOLDOWN_MS = 180_000L;
    private static final long RUN_TIMEOUT_MS = 1_800_000L;
    private static final long FLOOR_TIMEOUT_MS = 480_000L;
    private static final String MOB_TAG = "afu_dungeon_mob";
    private static final String REWARDS = "dungeon-rewards.";
    private static final Material[] REWARD_TYPES = {
            Material.EMERALD, Material.IRON_INGOT, Material.BREAD,
            Material.EXPERIENCE_BOTTLE, Material.GOLDEN_APPLE,
            Material.LAPIS_LAZULI, Material.ARROW, Material.DIAMOND};
    private record Loot(Material material, int amount) { }
    private record Theme(String name, Material floor, Material wall, Material pillar,
                         EntityType[] mobs, Loot[] rewards) { }
    private static final List<Theme> THEMES = List.of(
            new Theme("苔藓洞穴", Material.MOSS_BLOCK, Material.MOSSY_STONE_BRICKS, Material.OAK_LOG,
                    new EntityType[]{EntityType.ZOMBIE, EntityType.ZOMBIE, EntityType.ZOMBIE},
                    new Loot[]{new Loot(Material.IRON_INGOT, 1), new Loot(Material.BREAD, 2), new Loot(Material.EXPERIENCE_BOTTLE, 1)}),
            new Theme("沙漠遗迹", Material.SANDSTONE, Material.CHISELED_SANDSTONE, Material.CUT_SANDSTONE,
                    new EntityType[]{EntityType.HUSK, EntityType.HUSK, EntityType.SPIDER, EntityType.SPIDER},
                    new Loot[]{new Loot(Material.EMERALD, 1), new Loot(Material.IRON_INGOT, 1), new Loot(Material.BREAD, 2), new Loot(Material.EXPERIENCE_BOTTLE, 1)}),
            new Theme("冰雪洞窟", Material.PACKED_ICE, Material.SNOW_BLOCK, Material.BLUE_ICE,
                    new EntityType[]{EntityType.STRAY, EntityType.STRAY, EntityType.ZOMBIE, EntityType.SPIDER},
                    new Loot[]{new Loot(Material.EMERALD, 2), new Loot(Material.GOLDEN_APPLE, 1), new Loot(Material.EXPERIENCE_BOTTLE, 2)}),
            new Theme("赤焰堡垒", Material.NETHER_BRICKS, Material.RED_NETHER_BRICKS, Material.BLACKSTONE,
                    new EntityType[]{EntityType.MAGMA_CUBE, EntityType.MAGMA_CUBE, EntityType.HUSK, EntityType.HUSK, EntityType.BLAZE},
                    new Loot[]{new Loot(Material.EMERALD, 2), new Loot(Material.LAPIS_LAZULI, 4), new Loot(Material.ARROW, 8), new Loot(Material.EXPERIENCE_BOTTLE, 2)}),
            new Theme("海晶遗迹", Material.PRISMARINE_BRICKS, Material.DARK_PRISMARINE, Material.PRISMARINE,
                    new EntityType[]{EntityType.DROWNED, EntityType.DROWNED, EntityType.DROWNED, EntityType.SKELETON, EntityType.SKELETON, EntityType.SPIDER},
                    new Loot[]{new Loot(Material.EMERALD, 3), new Loot(Material.IRON_INGOT, 2), new Loot(Material.GOLDEN_APPLE, 1), new Loot(Material.EXPERIENCE_BOTTLE, 3)}),
            new Theme("深层宝库", Material.DEEPSLATE_BRICKS, Material.POLISHED_BLACKSTONE_BRICKS, Material.CHISELED_DEEPSLATE,
                    new EntityType[]{EntityType.ZOMBIE, EntityType.ZOMBIE, EntityType.HUSK, EntityType.HUSK, EntityType.SKELETON, EntityType.SKELETON, EntityType.WITCH},
                    new Loot[]{new Loot(Material.DIAMOND, 1), new Loot(Material.EMERALD, 5), new Loot(Material.GOLDEN_APPLE, 1), new Loot(Material.EXPERIENCE_BOTTLE, 4)}));

    private final AgentFriendPlugin plugin;
    private final NamespacedKey mobKey;
    private final Set<UUID> participants = new HashSet<>();
    private final Set<UUID> mobs = new HashSet<>();
    private final Map<Inventory, UUID> rewardMenus = new IdentityHashMap<>();
    private boolean built;
    private boolean active;
    private boolean spawned;
    private boolean cleared;
    private int floor;
    private long runStartedAt;
    private long floorStartedAt;
    private long spawnAt;
    private long lastRun;

    DungeonManager(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        mobKey = new NamespacedKey(plugin, "dungeon_mob");
        built = plugin.getConfig().getBoolean("dungeon-built", false);
        lastRun = plugin.getConfig().getLong("dungeon-last-run", 0L);
        if (plugin.getConfig().getBoolean("dungeon-building", false) && !built)
            plugin.getLogger().severe("Interrupted dungeon construction: inspect or restore the world before retrying.");
        plugin.getServer().getPluginManager().registerEvents(this, plugin);
        if (built) cleanupMobs();
        Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 20L, 20L);
        plugin.getLogger().info("Dungeon ready; built=" + built + ", floors=" + THEMES.size());
    }

    boolean isBuilt() { return built; }

    void shutdown() {
        if (active) {
            lastRun = System.currentTimeMillis();
            plugin.getConfig().set("dungeon-last-run", lastRun);
            plugin.saveConfig();
        }
        cleanupMobs();
        rewardMenus.clear();
    }

    private World world() { return Bukkit.getWorld("world"); }
    private boolean sameWorld(Location at) { return at != null && at.getWorld() != null && at.getWorld().equals(world()); }
    private boolean inLobby(Location at) {
        return sameWorld(at) && Math.abs(at.getBlockX() - X) <= 11 && Math.abs(at.getBlockZ() - Z) <= 11
                && at.getY() >= LOBBY_Y && at.getY() <= LOBBY_Y + 8;
    }
    private boolean inFloor(Location at, int number) {
        if (!sameWorld(at) || number < 1 || number > Y.length) return false;
        int y = Y[number - 1];
        return Math.abs(at.getBlockX() - X) <= 11 && Math.abs(at.getBlockZ() - Z) <= 11
                && at.getY() >= y + 1 && at.getY() <= y + 7;
    }
    private int floorAt(Location at) {
        for (int n = 1; n <= Y.length; n++) if (inFloor(at, n)) return n;
        return 0;
    }
    private boolean inBuild(Location at) {
        return built && sameWorld(at) && at.getY() >= Y[Y.length - 1] && at.getY() <= Y[0] + 7
                && Math.abs(at.getBlockX() - X) <= RADIUS && Math.abs(at.getBlockZ() - Z) <= RADIUS;
    }

    void command(Player player, String[] args) {
        String sub = args.length > 1 ? args[1].toLowerCase(Locale.ROOT) : "status";
        switch (sub) {
            case "status" -> player.sendMessage(ChatColor.GOLD + "六层试炼：" + (active
                    ? "第 " + floor + "/6 层 · " + THEMES.get(floor - 1).name() + (cleared ? "，已清空" : "，战斗中")
                    : "待命") + "。奖励存进个人箱子，不自动进入背包。");
            case "start" -> start(player);
            case "next" -> next(player);
            case "rewards", "reward", "箱子" -> openRewards(player);
            case "leave" -> leave(player);
            default -> player.sendMessage(ChatColor.RED + "用法：/mycli arena start|status|next|rewards|leave");
        }
    }

    boolean handleInteract(PlayerInteractEvent event) {
        if (!built || event.getHand() != EquipmentSlot.HAND || event.getAction() != Action.RIGHT_CLICK_BLOCK) return false;
        Block block = event.getClickedBlock();
        if (block == null || !sameWorld(block.getLocation())) return false;
        int n = floorAt(block.getLocation());
        boolean lobbyChest = block.getX() == X - 4 && block.getY() == LOBBY_Y + 1 && block.getZ() == Z - 8;
        if ((lobbyChest || (n > 0 && block.getX() == X - 9 && block.getY() == Y[n - 1] + 1
                && block.getZ() == Z - 9)) && block.getType() == Material.CHEST) {
            event.setCancelled(true);
            openRewards(event.getPlayer());
            return true;
        }
        if (block.getX() == X - 6 && block.getY() == LOBBY_Y + 2 && block.getZ() == Z - 8
                && block.getType() == Material.STONE_BUTTON) {
            event.setCancelled(true);
            start(event.getPlayer());
            return true;
        }
        if (n > 0 && block.getX() == X + 9 && block.getY() == Y[n - 1] + 1
                && block.getZ() == Z - 9 && block.getType() == Material.STONE_BUTTON) {
            event.setCancelled(true);
            next(event.getPlayer());
            return true;
        }
        if (n > 0 && block.getX() == X - 7 && block.getY() == Y[n - 1] + 1
                && block.getZ() == Z - 9 && block.getType() == Material.OAK_BUTTON) {
            event.setCancelled(true);
            leave(event.getPlayer());
            return true;
        }
        return false;
    }

    private void start(Player starter) {
        if (!inLobby(starter.getLocation())) { starter.sendMessage(ChatColor.RED + "请先到地面试炼场，站在场内按石按钮。"); return; }
        if (starter.getGameMode() == GameMode.SPECTATOR) { starter.sendMessage(ChatColor.RED + "旁观者不能启动。"); return; }
        if (active) { starter.sendMessage(ChatColor.YELLOW + "已有队伍在挑战六层试炼。"); return; }
        long now = System.currentTimeMillis();
        if (now - lastRun < COOLDOWN_MS) {
            starter.sendMessage(ChatColor.YELLOW + "试炼场休息中，还需 " + ((COOLDOWN_MS - (now - lastRun) + 999) / 1000) + " 秒。");
            return;
        }
        participants.clear(); mobs.clear();
        for (Player p : Bukkit.getOnlinePlayers()) if (inLobby(p.getLocation()) && p.getGameMode() != GameMode.SPECTATOR)
            participants.add(p.getUniqueId());
        if (participants.isEmpty()) return;
        active = true;
        runStartedAt = now;
        enterFloor(1);
        announce(ChatColor.GOLD + "六层试炼开始！打完每层后打开奖励箱，按绿色石按钮下楼；红色木按钮返回地面。");
    }

    private void enterFloor(int number) {
        floor = number;
        spawned = false;
        cleared = false;
        floorStartedAt = System.currentTimeMillis();
        spawnAt = floorStartedAt + 3000L;
        for (UUID id : participants) {
            Player p = Bukkit.getPlayer(id);
            if (p != null && !p.isDead()) p.teleport(center(number));
        }
        announce(ChatColor.AQUA + "进入第 " + number + "/6 层：" + THEMES.get(number - 1).name());
    }

    private Location center(int number) {
        return new Location(world(), X + 0.5, Y[number - 1] + 1, Z + 0.5, 0, 0);
    }

    private void next(Player player) {
        int here = floorAt(player.getLocation());
        if (here == 0) { player.sendMessage(ChatColor.RED + "请站在当前楼层内按下楼按钮。"); return; }
        if (!active) { leave(player); return; }
        if (!participants.contains(player.getUniqueId()) || here != floor) {
            player.sendMessage(ChatColor.RED + "只有当前试炼队伍能进入下一层。"); return;
        }
        if (!cleared) { player.sendMessage(ChatColor.YELLOW + "先打败本层全部怪物。"); return; }
        if (floor >= Y.length) { finish(true, "六层完成！可打开奖励箱，再按红色木按钮回地面。"); return; }
        enterFloor(floor + 1);
    }

    private void leave(Player player) {
        if (!inLobby(player.getLocation()) && floorAt(player.getLocation()) == 0) {
            player.sendMessage(ChatColor.RED + "你目前不在试炼场内。"); return;
        }
        Location landing = new Location(world(), X + 0.5, LOBBY_Y + 1.0, Z - 17 + 0.5, 0, 0);
        if (landing.getBlock().getType() != Material.AIR || landing.clone().add(0, 1, 0).getBlock().getType() != Material.AIR) {
            player.sendMessage(ChatColor.RED + "地面入口受阻，返回已取消。"); return;
        }
        if (player.teleport(landing)) player.sendMessage(ChatColor.GREEN + "已返回地面，未领取的奖励留在个人箱子里。");
    }

    private void tick() {
        if (!active) return;
        long now = System.currentTimeMillis();
        if (now - runStartedAt > RUN_TIMEOUT_MS || now - floorStartedAt > FLOOR_TIMEOUT_MS) {
            finish(false, "试炼超时；已赢得的奖励保存在个人箱子里。"); return;
        }
        boolean anyone = false;
        for (UUID id : participants) {
            Player p = Bukkit.getPlayer(id);
            if (p != null && !p.isDead() && inFloor(p.getLocation(), floor)) { anyone = true; break; }
        }
        if (!anyone) { finish(false, "队伍离开或倒下；已赢得的奖励保存在个人箱子里。"); return; }
        if (!spawned && now >= spawnAt) spawn();
        if (!spawned || cleared) return;
        mobs.removeIf(id -> {
            Entity e = Bukkit.getEntity(id);
            if (!(e instanceof LivingEntity living) || living.isDead() || !e.isValid()) return true;
            if (!inFloor(e.getLocation(), floor)) e.teleport(center(floor));
            return false;
        });
        if (!mobs.isEmpty()) return;
        cleared = true;
        int credited = rewardFloor();
        announce(ChatColor.GREEN + "第 " + floor + "/6 层已通关！奖励已放进个人箱子（" + credited + " 人）。");
        if (floor == Y.length) finish(true, "六层完成！打开奖励箱领取，再按红色木按钮回地面。");
        else announce(ChatColor.YELLOW + "领取后按绿色石按钮进入下一层，也可按红色木按钮离开。");
    }

    private void spawn() {
        spawned = true;
        Theme theme = THEMES.get(floor - 1);
        int[][] spots = {{-6,-5},{6,-5},{-6,5},{6,5},{0,7},{0,-7},{-8,0},{8,0}};
        for (int i = 0; i < theme.mobs().length; i++) {
            int[] spot = spots[i];
            Location at = new Location(world(), X + spot[0] + 0.5, Y[floor - 1] + 1, Z + spot[1] + 0.5);
            Entity e = world().spawnEntity(at, theme.mobs()[i]);
            e.addScoreboardTag(MOB_TAG);
            e.getPersistentDataContainer().set(mobKey, PersistentDataType.BYTE, (byte) 1);
            if (e instanceof MagmaCube cube) cube.setSize(1); // No untagged split children after a clear.
            if (e instanceof LivingEntity living) living.setRemoveWhenFarAway(false);
            mobs.add(e.getUniqueId());
        }
        announce(ChatColor.RED + "第 " + floor + "/6 层：" + theme.name() + "，" + theme.mobs().length + " 只怪物！");
    }

    private int rewardFloor() {
        int credited = 0;
        for (UUID id : participants) {
            Player p = Bukkit.getPlayer(id);
            if (p == null || p.isDead() || !inFloor(p.getLocation(), floor)) continue;
            for (Loot loot : THEMES.get(floor - 1).rewards()) {
                String path = rewardPath(id, loot.material());
                plugin.getConfig().set(path, plugin.getConfig().getInt(path, 0) + loot.amount());
            }
            if (floor == 3) plugin.teachArenaSkills(p);
            p.sendTitle(ChatColor.GOLD + "第 " + floor + " 层过关", ChatColor.YELLOW + "奖励已存入个人箱子", 5, 55, 10);
            p.sendMessage(ChatColor.GOLD + "奖励在本层宝箱或地面大厅的宝箱里；打开后点物品领取。");
            credited++;
        }
        plugin.saveConfig();
        plugin.getLogger().info("Dungeon floor reward: floor=" + floor + ", credited=" + credited);
        return credited;
    }

    private void finish(boolean won, String message) {
        if (!active) return;
        plugin.getLogger().info("Dungeon finished: won=" + won + ", floor=" + floor + ", message=" + message);
        cleanupMobs();
        announce((won ? ChatColor.GREEN : ChatColor.YELLOW) + message);
        active = false;
        participants.clear();
        lastRun = System.currentTimeMillis();
        plugin.getConfig().set("dungeon-last-run", lastRun);
        plugin.saveConfig();
    }

    private void announce(String message) {
        for (Player p : Bukkit.getOnlinePlayers()) if (inFloor(p.getLocation(), floor)) p.sendMessage(message);
    }

    private String rewardPath(UUID id, Material material) {
        return REWARDS + id + "." + material.name().toLowerCase(Locale.ROOT);
    }
    private int pending(UUID id, Material material) {
        return plugin.getConfig().getInt(rewardPath(id, material), 0);
    }
    private void openRewards(Player player) {
        Inventory inv = Bukkit.createInventory(null, 27, ChatColor.GOLD + "个人试炼奖励箱");
        rewardMenus.put(inv, player.getUniqueId());
        refreshRewards(inv, player.getUniqueId());
        player.openInventory(inv);
        player.sendMessage(ChatColor.YELLOW + "点击箱内物品领取；背包满时物品留在箱中。离线或重启后也能再领。");
    }
    private void refreshRewards(Inventory inv, UUID id) {
        for (int slot = 0; slot < REWARD_TYPES.length; slot++) {
            int count = pending(id, REWARD_TYPES[slot]);
            inv.setItem(slot, count > 0 ? new ItemStack(REWARD_TYPES[slot], Math.min(64, count)) : null);
        }
        ItemStack guide = new ItemStack(Material.BOOK);
        ItemMeta meta = guide.getItemMeta();
        meta.setDisplayName(ChatColor.YELLOW + "点击上排物品领取");
        meta.setLore(List.of(ChatColor.GRAY + "每人有自己的奖励箱", ChatColor.GRAY + "背包满时奖励留在箱中"));
        guide.setItemMeta(meta);
        inv.setItem(22, guide);
    }
    @EventHandler public void onRewardClick(InventoryClickEvent event) {
        Inventory inv = event.getView().getTopInventory();
        UUID owner = rewardMenus.get(inv);
        if (owner == null) return;
        event.setCancelled(true);
        if (!(event.getWhoClicked() instanceof Player p) || !p.getUniqueId().equals(owner)) return;
        int slot = event.getRawSlot();
        if (slot < 0 || slot >= REWARD_TYPES.length) return;
        Material material = REWARD_TYPES[slot];
        int count = Math.min(64, pending(owner, material));
        if (count <= 0) return;
        Map<Integer, ItemStack> leftover = p.getInventory().addItem(new ItemStack(material, count));
        int unclaimed = leftover.values().stream().mapToInt(ItemStack::getAmount).sum();
        int delivered = count - unclaimed;
        if (delivered <= 0) { p.sendMessage(ChatColor.YELLOW + "背包已满，奖励仍在箱子里。"); return; }
        String path = rewardPath(owner, material);
        plugin.getConfig().set(path, pending(owner, material) - delivered);
        plugin.saveConfig();
        p.saveData();
        refreshRewards(inv, owner);
        p.sendMessage(ChatColor.GREEN + "从奖励箱领取了 " + delivered + " × " + rewardName(material) + "。"
                + (unclaimed > 0 ? "剩余物品仍在箱中。" : ""));
        plugin.getLogger().info("Dungeon reward claimed: player=" + owner + ", item=" + material + ", count=" + delivered);
    }
    private String rewardName(Material material) {
        return switch (material) {
            case EMERALD -> "绿宝石";
            case IRON_INGOT -> "铁锭";
            case BREAD -> "面包";
            case EXPERIENCE_BOTTLE -> "附魔之瓶";
            case GOLDEN_APPLE -> "金苹果";
            case LAPIS_LAZULI -> "青金石";
            case ARROW -> "箭";
            case DIAMOND -> "钻石";
            default -> material.name();
        };
    }
    @EventHandler public void onRewardDrag(InventoryDragEvent event) {
        if (rewardMenus.containsKey(event.getView().getTopInventory())) event.setCancelled(true);
    }
    @EventHandler public void onRewardClose(InventoryCloseEvent event) { rewardMenus.remove(event.getInventory()); }

    private void cleanupMobs() {
        for (UUID id : mobs) {
            Entity e = Bukkit.getEntity(id);
            if (e != null) e.remove();
        }
        mobs.clear();
        World w = world();
        if (w == null || !built) return;
        for (int y : Y) for (Entity e : w.getNearbyEntities(new Location(w, X + 0.5, y + 4, Z + 0.5), 20, 8, 20))
            if (e.getScoreboardTags().contains(MOB_TAG)) e.remove();
    }

    void build(CommandSender sender) {
        if (built) { sender.sendMessage("六层试炼已经建成；拒绝重复覆盖。"); return; }
        if (!plugin.getConfig().getBoolean("arena-built", false)) { sender.sendMessage("请先建原有地面试炼场。"); return; }
        if (plugin.getConfig().getBoolean("dungeon-building", false)) {
            sender.sendMessage("上次施工中断；必须检查世界或从备份恢复，不可重试覆盖。"); return;
        }
        World w = world();
        if (w == null) { sender.sendMessage("主世界尚未加载。"); return; }
        for (Player p : Bukkit.getOnlinePlayers()) if (p.getGameMode() != GameMode.SPECTATOR
                && sameWorld(p.getLocation()) && Math.abs(p.getLocation().getBlockX() - X) <= RADIUS
                && Math.abs(p.getLocation().getBlockZ() - Z) <= RADIUS
                && p.getLocation().getY() >= Y[Y.length - 1] && p.getLocation().getY() <= LOBBY_Y + 8) {
            sender.sendMessage("施工范围内有人：" + p.getName()); return;
        }
        for (int y : Y) for (int dx = -RADIUS; dx <= RADIUS; dx++) for (int dz = -RADIUS; dz <= RADIUS; dz++)
            for (int dy = 0; dy <= 7; dy++) {
                Block b = w.getBlockAt(X + dx, y + dy, Z + dz);
                if (b.getState() instanceof TileState || suspicious(b.getType())) {
                    sender.sendMessage("地下发现建筑或容器，未施工：" + b.getLocation() + " " + b.getType()); return;
                }
            }
        for (int[] pos : new int[][]{{X - 4, LOBBY_Y + 1, Z - 8},{X - 4, LOBBY_Y + 1, Z - 9}})
            if (w.getBlockAt(pos[0], pos[1], pos[2]).getType() != Material.AIR) {
                sender.sendMessage("地面大厅奖励箱位置不是空气，未施工。"); return;
            }
        plugin.getConfig().set("dungeon-building", true);
        plugin.saveConfig();
        for (int i = 0; i < Y.length; i++) buildFloor(w, i + 1);
        w.getBlockAt(X - 4, LOBBY_Y, Z - 8).setType(Material.GOLD_BLOCK, false);
        w.getBlockAt(X - 4, LOBBY_Y + 1, Z - 8).setType(Material.CHEST, false);
        placeSign(w.getBlockAt(X - 4, LOBBY_Y + 1, Z - 9), "奖励箱", "每人独立", "手动领取");
        built = true;
        plugin.getConfig().set("dungeon-built", true);
        plugin.getConfig().set("dungeon-building", false);
        plugin.saveConfig();
        sender.sendMessage("六层试炼已建于原试炼场地下；入口仍使用原石按钮。");
        plugin.getLogger().info("Dungeon built at " + X + "," + Z + " floors=6, y=68..8");
    }

    private boolean suspicious(Material material) {
        String name = material.name();
        return material == Material.BEDROCK || name.contains("CHEST") || name.contains("BARREL")
                || name.contains("PLANKS") || name.contains("BRICKS") || name.contains("DOOR")
                || name.contains("SIGN") || name.contains("BED") || name.contains("LECTERN")
                || name.contains("SPAWNER") || name.contains("RAIL") || name.contains("TORCH")
                || name.contains("FURNACE") || name.contains("GLASS") || name.contains("WOOL")
                || name.contains("BANNER");
    }

    private void buildFloor(World w, int number) {
        Theme theme = THEMES.get(number - 1);
        int y = Y[number - 1];
        for (int dx = -RADIUS; dx <= RADIUS; dx++) for (int dz = -RADIUS; dz <= RADIUS; dz++)
            for (int dy = 0; dy <= 7; dy++) {
                Material material = dy == 0 ? theme.floor() : dy == 7 ? theme.wall()
                        : Math.abs(dx) == RADIUS || Math.abs(dz) == RADIUS ? theme.wall() : Material.AIR;
                Block b = w.getBlockAt(X + dx, y + dy, Z + dz);
                if (b.getType() != material) b.setType(material, false);
            }
        for (int dx : new int[]{-8, 8}) for (int dz : new int[]{-8, 8}) {
            for (int dy = 1; dy <= 2; dy++) w.getBlockAt(X + dx, y + dy, Z + dz).setType(theme.pillar(), false);
            w.getBlockAt(X + dx, y + 6, Z + dz).setType(Material.SEA_LANTERN, false);
        }
        w.getBlockAt(X - 9, y, Z - 9).setType(Material.GOLD_BLOCK, false);
        w.getBlockAt(X - 9, y + 1, Z - 9).setType(Material.CHEST, false);
        w.getBlockAt(X + 9, y, Z - 9).setType(Material.EMERALD_BLOCK, false);
        placeButton(w.getBlockAt(X + 9, y + 1, Z - 9), Material.STONE_BUTTON);
        w.getBlockAt(X - 7, y, Z - 9).setType(Material.REDSTONE_BLOCK, false);
        placeButton(w.getBlockAt(X - 7, y + 1, Z - 9), Material.OAK_BUTTON);
        placeSign(w.getBlockAt(X - 9, y + 1, Z - 10), "奖励箱", "每人独立", "手动领取");
        placeSign(w.getBlockAt(X + 9, y + 1, Z - 10), number == Y.length ? "完成" : "下一层", "绿色按钮", "清怪后按");
        placeSign(w.getBlockAt(X - 7, y + 1, Z - 10), "回地面", "红色按钮", "奖励保留");
    }
    private void placeButton(Block block, Material material) {
        Switch data = (Switch) Bukkit.createBlockData(material);
        data.setAttachedFace(Switch.AttachedFace.FLOOR);
        block.setBlockData(data, false);
    }
    private void placeSign(Block block, String a, String b, String c) {
        block.setType(Material.OAK_SIGN, false);
        if (block.getState() instanceof Sign sign) {
            sign.setLine(0, a);
            sign.setLine(1, b);
            sign.setLine(2, c);
            sign.update(true, false);
        }
    }

    @EventHandler public void onNaturalSpawn(CreatureSpawnEvent event) {
        if (built && event.getEntity() instanceof Monster && floorAt(event.getLocation()) > 0
                && event.getSpawnReason() != CreatureSpawnEvent.SpawnReason.CUSTOM) event.setCancelled(true);
    }
    @EventHandler public void onBreak(BlockBreakEvent event) { if (inBuild(event.getBlock().getLocation())) event.setCancelled(true); }
    @EventHandler public void onPlace(BlockPlaceEvent event) { if (inBuild(event.getBlock().getLocation())) event.setCancelled(true); }
    @EventHandler public void onChange(EntityChangeBlockEvent event) { if (inBuild(event.getBlock().getLocation())) event.setCancelled(true); }
    @EventHandler public void onBurn(BlockBurnEvent event) { if (inBuild(event.getBlock().getLocation())) event.setCancelled(true); }
    @EventHandler public void onIgnite(BlockIgniteEvent event) { if (inBuild(event.getBlock().getLocation())) event.setCancelled(true); }
    @EventHandler public void onFlow(BlockFromToEvent event) { if (inBuild(event.getToBlock().getLocation())) event.setCancelled(true); }
    @EventHandler public void onExplosion(EntityExplodeEvent event) { if (built) event.blockList().removeIf(b -> inBuild(b.getLocation())); }
    @EventHandler public void onBlockExplosion(BlockExplodeEvent event) { if (built) event.blockList().removeIf(b -> inBuild(b.getLocation())); }
}
