package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.plugin.Plugin;

/** Vanilla menus and text entry points for the optional, server-side content pack. */
final class WorldLifeManager implements Listener {
    private final AgentFriendPlugin plugin;
    private final File ledgerFile;
    private final YamlConfiguration ledger;
    private static final List<String> DEPENDENCIES = List.of("BetonQuest", "FancyNpcs", "Citizens", "Denizen",
            "ConditionalEvents", "WorldEvents", "MythicMobs", "Shopkeepers", "NPCSpeak", "ImageFrame");
    private static final List<String> LESSONS = List.of("catalog", "cast", "life");
    private record MenuHolder(java.util.UUID owner) implements InventoryHolder {
        @Override public Inventory getInventory() { return null; }
    }
    WorldLifeManager(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        ledgerFile = new File(plugin.getDataFolder(), "world-life-ledger.yml");
        ledger = YamlConfiguration.loadConfiguration(ledgerFile);
        Bukkit.getPluginManager().registerEvents(this, plugin);
    }
    private boolean enabled(String name) { return Bukkit.getPluginManager().isPluginEnabled(name); }
    private void emit(Player p, String type, JsonObject data) {
        data.addProperty("type", type);
        p.sendMessage("MC_WORLD " + data);
    }
    private void denied(Player p, String reason) {
        JsonObject data = new JsonObject(); data.addProperty("status", "denied"); data.addProperty("reason", reason);
        emit(p, "result", data);
        p.sendMessage(ChatColor.YELLOW + "生活内容：" + reason + "。用 /mycli world list 查看当前入口。");
    }
    void command(Player p, String[] args) {
        String sub = args.length > 1 ? args[1].toLowerCase(Locale.ROOT) : "list";
        try {
            switch (sub) {
                case "list", "status" -> list(p);
                case "menu" -> menu(p);
                case "npcs" -> npcs(p);
                case "talk" -> talk(p, args);
                case "end" -> end(p);
                case "guide" -> guide(p, args.length > 2 ? args[2] : "status");
                case "events" -> {
                    if (!enabled("WorldEvents")) { denied(p, "events_unavailable"); return; }
                    Bukkit.dispatchCommand(p, "wevent list");
                    JsonObject out = new JsonObject(); out.addProperty("status", "listed");
                    out.addProperty("instruction", "关注世界事件的中文开始/结束公告与 Boss 血条；事件不会自动完成公会任务。");
                    emit(p, "events", out);
                }
                case "photos" -> {
                    if (!enabled("ImageFrame")) { denied(p, "photos_unavailable"); return; }
                    Bukkit.dispatchCommand(p, "imageframe list");
                    JsonObject out = new JsonObject(); out.addProperty("displayReady", true);
                    out.addProperty("automaticCaptureReady", false);
                    out.addProperty("instruction", "已拍图片用 /imageframe create <名字> <图片URL> 1 1 导入；消耗空地图。/imageframe get <名字> 取回，挂到展示框。当前没有自动快门。");
                    emit(p, "photos", out);
                }
                default -> denied(p, "unknown_world_command");
            }
        } catch (ReflectiveOperationException | RuntimeException error) {
            plugin.getLogger().warning("World life adapter failed: " + error.getClass().getSimpleName());
            denied(p, "content_adapter_unavailable");
        }
    }
    private void list(Player p) {
        JsonObject out = new JsonObject(); JsonArray components = new JsonArray();
        for (String name : DEPENDENCIES) {
            JsonObject component = new JsonObject(); component.addProperty("id", name);
            Plugin dependency = Bukkit.getPluginManager().getPlugin(name);
            component.addProperty("enabled", dependency != null && dependency.isEnabled());
            if (dependency != null) component.addProperty("version", dependency.getPluginMeta().getVersion());
            components.add(component);
        }
        out.add("components", components);
        out.addProperty("guideCommand", "/mycli world guide start");
        out.addProperty("npcCommand", "/mycli world npcs");
        out.addProperty("eventsCommand", "/mycli world events");
        out.addProperty("photosCommand", "/mycli world photos");
        out.addProperty("automaticPhotoCapture", false);
        emit(p, "catalog", out);
        p.sendMessage(ChatColor.GREEN + "世界生活：新手实习、村民聊天、世界事件、村民商店、照片地图。");
        p.sendMessage("/mycli world guide start | npcs | talk <NPC ID> <话> | end | events | photos | menu");
    }
    private Object manager() throws ReflectiveOperationException {
        Plugin npc = Bukkit.getPluginManager().getPlugin("NPCSpeak");
        if (npc == null || !npc.isEnabled()) throw new IllegalStateException("NPCSpeak unavailable");
        return npc.getClass().getMethod("getNpcManager").invoke(npc);
    }
    private Object conversations() throws ReflectiveOperationException {
        Plugin npc = Bukkit.getPluginManager().getPlugin("NPCSpeak");
        if (npc == null || !npc.isEnabled()) throw new IllegalStateException("NPCSpeak unavailable");
        return npc.getClass().getMethod("getConversationManager").invoke(npc);
    }
    private Object property(Object value, String getter) throws ReflectiveOperationException {
        return value.getClass().getMethod(getter).invoke(value);
    }
    private void npcs(Player p) throws ReflectiveOperationException {
        if (!enabled("NPCSpeak")) { denied(p, "npcs_unavailable"); return; }
        Object manager = manager(); Collection<?> all = (Collection<?>) property(manager, "getAll");
        JsonArray entries = new JsonArray(); int count = 0;
        for (Object npc : all) {
            if (++count > 32) break;
            Location at = (Location) property(npc, "getSpawnLocation");
            String id = (String) property(npc, "getId");
            JsonObject item = new JsonObject(); item.addProperty("id", id);
            item.addProperty("name", (String) property(npc, "getDisplayName"));
            if (at != null && at.getWorld() != null) {
                item.addProperty("world", at.getWorld().getName());
                item.addProperty("x", at.getX()); item.addProperty("y", at.getY()); item.addProperty("z", at.getZ());
                item.addProperty("nearby", p.getWorld().equals(at.getWorld()) && p.getLocation().distanceSquared(at) <= 64);
            }
            item.addProperty("command", "/mycli world talk " + id + " 你好"); entries.add(item);
        }
        JsonObject out = new JsonObject(); out.add("npcs", entries); out.addProperty("talkRange", 8);
        out.addProperty("instruction", "亲自走到 NPC 8 格内，用 talk 发问；右键村民也可开始对话。/mycli world end 结束，普通聊天恢复公屏。");
        emit(p, "npcs", out);
    }
    private void talk(Player p, String[] args) throws ReflectiveOperationException {
        if (p.getGameMode() == GameMode.SPECTATOR) { denied(p, "spectator"); return; }
        if (args.length < 4 || !args[2].matches("[A-Za-z0-9_-]{1,40}")) { denied(p, "usage_talk_id_message"); return; }
        String message = String.join(" ", Arrays.copyOfRange(args, 3, args.length));
        if (message.length() > 180 || message.chars().anyMatch(c -> Character.isISOControl(c))) { denied(p, "message_too_long"); return; }
        Object manager = manager();
        Object npc = manager.getClass().getMethod("getById", String.class).invoke(manager, args[2]);
        if (npc == null) { denied(p, "npc_not_found"); return; }
        Location at = (Location) property(npc, "getSpawnLocation");
        if (at == null || !p.getWorld().equals(at.getWorld()) || p.getLocation().distanceSquared(at) > 64) { denied(p, "npc_too_far"); return; }
        Object talk = conversations();
        boolean active = (Boolean) talk.getClass().getMethod("isInConversation", java.util.UUID.class).invoke(talk, p.getUniqueId());
        String activeName = (String) talk.getClass().getMethod("getActiveNpcName", java.util.UUID.class).invoke(talk, p.getUniqueId());
        if (!active || !property(npc, "getDisplayName").equals(activeName))
            talk.getClass().getMethod("startConversation", Player.class, npc.getClass()).invoke(talk, p, npc);
        talk.getClass().getMethod("handleChatInput", Player.class, String.class).invoke(talk, p, message);
        JsonObject out = new JsonObject(); out.addProperty("status", "submitted"); out.addProperty("npc", args[2]);
        out.addProperty("instruction", "等待该 NPC 的实际答复；submitted 只表示送入对话，不代表答复成功或任务完成。");
        emit(p, "talk", out);
    }
    private void end(Player p) throws ReflectiveOperationException {
        if (!enabled("NPCSpeak")) { denied(p, "npcs_unavailable"); return; }
        Object talk = conversations();
        talk.getClass().getMethod("clearPlayer", java.util.UUID.class).invoke(talk, p.getUniqueId());
        JsonObject out = new JsonObject(); out.addProperty("status", "ended"); emit(p, "talk", out);
        p.sendMessage(ChatColor.GRAY + "已结束村民对话，普通聊天恢复公屏。");
    }
    private void guide(Player p, String action) {
        if (p.getGameMode() == GameMode.SPECTATOR && action.equals("start")) { denied(p, "spectator"); return; }
        if (!List.of("start", "status").contains(action)) { denied(p, "usage_guide_start_or_status"); return; }
        String base = "players." + p.getUniqueId();
        if (action.equals("start") && !ledger.getBoolean(base + ".started")) {
            ledger.set(base + ".started", true);
            if (!save()) { ledger.set(base + ".started", null); denied(p, "guide_storage_failed"); return; }
            bq(p, "begin");
        }
        JsonObject out = new JsonObject(); out.addProperty("started", ledger.getBoolean(base + ".started"));
        JsonArray steps = new JsonArray();
        String[] descriptions = {"读取技能目录 /mycli skills list common", "按本人资格真正成功施放一次技能；失败或只说已施法不算", "完成并交付一项生活公会委托 /mycli life board"};
        int done = 0;
        for (int i = 0; i < LESSONS.size(); i++) {
            boolean complete = ledger.getBoolean(base + ".proof." + LESSONS.get(i)); if (complete) done++;
            JsonObject step = new JsonObject(); step.addProperty("id", LESSONS.get(i)); step.addProperty("done", complete);
            step.addProperty("instruction", descriptions[i]); steps.add(step);
        }
        out.add("steps", steps); out.addProperty("completed", done == LESSONS.size()); out.addProperty("verifiedSteps", done);
        out.addProperty("rescueInstruction", "组队试炼队友倒地后，存活队友在同队倒地者4格内连续停留10秒可救起；清完本层/室也会救起；全队倒地才失败。");
        out.addProperty("travelInstruction", "技能学习/升级耗技能点；成功传送耗6魔力，支援传送耗8魔力；旧技能资格保留。");
        emit(p, "guide", out);
        p.sendMessage(ChatColor.AQUA + "新手实习 " + done + "/3；用 /mycli world guide status 随时复查。进度由真实服务器回执记录。");
    }
    void note(Player p, String lesson) {
        if (!LESSONS.contains(lesson) || p.getGameMode() == GameMode.SPECTATOR) return;
        String base = "players." + p.getUniqueId();
        if (!ledger.getBoolean(base + ".started") || ledger.getBoolean(base + ".proof." + lesson)) return;
        ledger.set(base + ".proof." + lesson, true);
        ledger.set(base + ".verified-at." + lesson, System.currentTimeMillis());
        if (!save()) { ledger.set(base + ".proof." + lesson, null); ledger.set(base + ".verified-at." + lesson, null); return; }
        bq(p, lesson + "_proof");
        JsonObject out = new JsonObject(); out.addProperty("lesson", lesson); out.addProperty("status", "verified");
        out.addProperty("source", "server_observed_success"); emit(p, "guide_progress", out);
    }
    private void bq(Player p, String action) {
        if (enabled("BetonQuest")) Bukkit.dispatchCommand(Bukkit.getConsoleSender(),
                "betonquest:betonquest action " + p.getName() + " qd_life>" + action);
    }
    private boolean save() {
        try {
            File temp = new File(ledgerFile.getParentFile(), ledgerFile.getName() + ".tmp");
            ledger.save(temp);
            try { Files.move(temp.toPath(), ledgerFile.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE); }
            catch (java.nio.file.AtomicMoveNotSupportedException e) { Files.move(temp.toPath(), ledgerFile.toPath(), StandardCopyOption.REPLACE_EXISTING); }
            return true;
        } catch (IOException e) { plugin.getLogger().warning("World life ledger not saved: " + e.getClass().getSimpleName()); return false; }
    }
    private ItemStack item(Material material, String name, String... lore) {
        ItemStack item = new ItemStack(material); ItemMeta meta = item.getItemMeta();
        meta.setDisplayName(name); meta.setLore(List.of(lore)); item.setItemMeta(meta); return item;
    }
    private void menu(Player p) {
        Inventory inv = Bukkit.createInventory(new MenuHolder(p.getUniqueId()), 27, "千灯纪 · 世界生活");
        inv.setItem(10, item(Material.WRITABLE_BOOK, "§a新手实习", "真实施法与生活委托教学", "/mycli world guide start"));
        inv.setItem(11, item(Material.VILLAGER_SPAWN_EGG, "§e村民聊天", "显示人物 ID 和位置；走近右键交谈", "/mycli world npcs"));
        inv.setItem(12, item(Material.SUNFLOWER, "§6世界事件", "查看当前正在进行的活动", "/mycli world events"));
        inv.setItem(13, item(Material.FILLED_MAP, "§b照片相册", "查看已导入的照片地图；当前没有自动快门", "/mycli world photos"));
        inv.setItem(14, item(Material.EMERALD, "§a村民商店", "到村庄集市右键补给商人交易", "实际消耗原版物品；不会免费发放"));
        inv.setItem(16, item(Material.OAK_DOOR, "§7结束聊天", "恢复普通公屏聊天"));
        p.openInventory(inv);
    }
    @EventHandler public void onClick(InventoryClickEvent event) {
        if (!(event.getView().getTopInventory().getHolder() instanceof MenuHolder holder)) return;
        event.setCancelled(true);
        if (!(event.getWhoClicked() instanceof Player p) || !holder.owner().equals(p.getUniqueId()) || event.getRawSlot() < 0 || event.getRawSlot() >= 27) return;
        String action = switch (event.getRawSlot()) { case 10 -> "guide start"; case 11 -> "npcs"; case 12 -> "events"; case 13 -> "photos"; case 16 -> "end"; default -> ""; };
        if (!action.isEmpty()) { p.closeInventory(); command(p, ("world " + action).split(" ")); }
    }
    @EventHandler public void onDrag(InventoryDragEvent event) {
        if (event.getView().getTopInventory().getHolder() instanceof MenuHolder && event.getRawSlots().stream().anyMatch(slot -> slot < 27)) event.setCancelled(true);
    }
}
