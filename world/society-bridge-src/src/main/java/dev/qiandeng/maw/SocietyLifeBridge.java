package dev.qiandeng.maw;

import com.google.gson.*;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.Commands;
import net.minecraft.core.component.DataComponents;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.SimpleMenuProvider;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.ChestMenu;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.inventory.MenuType;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.component.CustomData;
import net.minecraft.world.item.component.ItemLore;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.core.registries.BuiltInRegistries;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.entity.item.ItemTossEvent;
import net.neoforged.neoforge.event.entity.player.PlayerInteractEvent;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;

import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.function.Consumer;

/** Shared normal-player UI/SDK for native quests. No elevated player commands or second economy. */
final class SocietyLifeBridge {
    private static final JsonObject CONTENT = load();
    private static final String QUEST_DATA = "io.github.flemmli97.simplequests.data.PlayerData";
    private static final String QUEST_MANAGER = "io.github.flemmli97.simplequests_api.datapack.QuestsManager";
    private static final String QUEST_BASE = "io.github.flemmli97.simplequests_api.quest.QuestBase";
    private static final Set<String> MENUS = Set.of("guide", "quests", "current", "market", "orders", "deliveries");
    private SocietyLifeBridge() {}

    static void register() {
        NeoForge.EVENT_BUS.addListener(SocietyLifeBridge::commands);
        NeoForge.EVENT_BUS.addListener(SocietyLifeBridge::npc);
        NeoForge.EVENT_BUS.addListener(SocietyLifeBridge::useGuide);
        NeoForge.EVENT_BUS.addListener((net.neoforged.neoforge.event.tick.ServerTickEvent.Post event) -> {
            if (event.getServer().getTickCount() % 20 != 0) return;
            for (ServerPlayer player : event.getServer().getPlayerList().getPlayers()) {
                if (!PlayerAuthBridge.authenticated(player) || player.getTags().contains("maw_life_welcomed")) continue;
                player.addTag("maw_life_welcomed");
                guideItem(player);
                player.sendSystemMessage(Component.literal("欢迎来到 My Agent World！手持冒险指南针交互，即可查看新手旅程、公会委托与市场；也可 /mycli guide。委托要先接取再完成，Agent 可查询 society.state。"));
            }
        });
        NeoForge.EVENT_BUS.addListener((ItemTossEvent event) -> {
            if (!isGuide(event.getEntity().getItem())) return;
            // ItemTossEvent fires after the stack left the slot. Cancel AND return it.
            event.setCanceled(true);
            ItemStack returned = event.getEntity().getItem().copy();
            if (!event.getPlayer().getInventory().add(returned) && event.getPlayer() instanceof ServerPlayer p) {
                // A full inventory can occur when throwing the carried stack.
                // Keep a persistent replacement entitlement instead of deleting the only guide.
                p.removeTag("maw_guide_claimed"); p.addTag("maw_guide_pending");
                p.sendSystemMessage(Component.literal("指南针已安全暂存；腾出一格后 /mycli guideitem 领回，/mycli guide 始终可用。"));
            }
        });
    }

    private static JsonObject load() {
        try (var stream = SocietyLifeBridge.class.getResourceAsStream("/maw-life-catalog.json")) {
            if (stream == null) throw new IllegalStateException("society_content_missing");
            return JsonParser.parseReader(new InputStreamReader(stream, StandardCharsets.UTF_8)).getAsJsonObject();
        } catch (java.io.IOException e) { throw new IllegalStateException("society_content_unreadable", e); }
    }

    private static Object call(Object target, String method, Class<?>[] types, Object... args) {
        try { return (target instanceof Class<?> c ? c : target.getClass()).getMethod(method, types).invoke(target instanceof Class<?> ? null : target, args); }
        catch (ReflectiveOperationException failure) { throw new IllegalStateException("society_backend_unavailable", failure); }
    }
    private static Class<?> type(String name) {
        try { return Class.forName(name); }
        catch (ClassNotFoundException failure) { throw new IllegalStateException("society_backend_unavailable", failure); }
    }
    private static Object data(ServerPlayer player) { return call(type(QUEST_DATA), "get", new Class<?>[]{ServerPlayer.class}, player); }
    private static Object quest(String id) {
        if (!id.matches("maw:[a-z0-9_]+")) throw new IllegalArgumentException("unknown_society_quest");
        Object manager = call(type(QUEST_MANAGER), "instance", new Class<?>[]{});
        Object q = call(manager, "getQuest", new Class<?>[]{ResourceLocation.class}, ResourceLocation.parse(id));
        if (q == null) throw new IllegalArgumentException("society_quest_not_loaded");
        return q;
    }
    private static JsonObject definition(String id) {
        return CONTENT.getAsJsonArray("quests").asList().stream().map(JsonElement::getAsJsonObject)
            .filter(q -> ("maw:" + q.get("id").getAsString()).equals(id)).findFirst()
            .orElseThrow(() -> new IllegalArgumentException("unknown_society_quest"));
    }
    private static long balance(ServerPlayer player) {
        Object manager = call(type("com.reazip.economycraft.EconomyCraft"), "getManager", new Class<?>[]{MinecraftServer.class}, player.getServer());
        Object value = call(manager, "getBalance", new Class<?>[]{UUID.class, boolean.class}, player.getUUID(), false);
        return value == null ? 0 : ((Number) value).longValue();
    }

    static JsonObject state(ServerPlayer player) {
        PlayerAuthBridge.requireAuthenticated(player);
        Object data = data(player);
        JsonObject result = new JsonObject();
        result.addProperty("playerUuid", player.getUUID().toString());
        result.addProperty("bodyId", player.getUUID().toString());
        result.addProperty("sampledAt", Instant.now().toString());
        result.addProperty("joined", player.getTags().contains("maw_guild_member"));
        result.addProperty("balance", balance(player)); result.addProperty("currency", "灯币");
        JsonArray rows = new JsonArray(); int reputation = 0;
        Map<String, Object> active = new HashMap<>();
        for (Object progress : (Collection<?>) call(data, "getCurrentQuest", new Class<?>[]{})) {
            Object q = call(progress, "getQuest", new Class<?>[]{});
            try { active.put(q.getClass().getField("id").get(q).toString(), progress); }
            catch (ReflectiveOperationException failure) { throw new IllegalStateException("society_backend_unavailable", failure); }
        }
        for (JsonElement element : CONTENT.getAsJsonArray("quests")) {
            JsonObject q = element.getAsJsonObject(), row = q.deepCopy();
            String id = "maw:" + q.get("id").getAsString(); Object nativeQuest = quest(id);
            int finished = ((Number) call(data, "getTimesCompleted", new Class<?>[]{ResourceLocation.class}, ResourceLocation.parse(id))).intValue();
            reputation = (int)Math.min(1000000000L, reputation + (long) finished * q.get("reputation").getAsInt());
            row.addProperty("id", id); row.addProperty("active", active.containsKey(id)); row.addProperty("completed", finished);
            row.addProperty("acceptStatus", call(data, "canAcceptQuest", new Class<?>[]{type(QUEST_BASE)}, nativeQuest).toString());
            JsonArray tasks = new JsonArray();
            if (active.containsKey(id)) {
                for (Object text : (Collection<?>) call(active.get(id), "getTaskComponents", new Class<?>[]{ServerPlayer.class}, player))
                    tasks.add(((Component)text).getString());
            }
            row.add("progress", tasks); rows.add(row);
        }
        result.add("quests", rows); result.addProperty("reputation", reputation);
        result.add("guilds", CONTENT.get("guilds").deepCopy());
        String rank = "木牌见习";
        for (JsonElement value : CONTENT.getAsJsonArray("ranks")) if (reputation >= value.getAsJsonObject().get("reputation").getAsInt()) rank = value.getAsJsonObject().get("name").getAsString();
        result.addProperty("rank", rank); return result;
    }

    static JsonObject act(ServerPlayer player, String kind, JsonObject input) {
        validate(player, kind, input);
        JsonObject result = new JsonObject();
        switch (kind) {
            case "society_join" -> { player.addTag("maw_guild_member"); result.addProperty("ok", true); }
            case "society_accept" -> {
                String id = input.get("questId").getAsString(); definition(id);
                result.addProperty("ok", (Boolean)call(data(player), "acceptQuest", new Class<?>[]{type(QUEST_BASE), int.class}, quest(id), 0));
                result.addProperty("questId", id); result.addProperty("code", result.get("ok").getAsBoolean() ? "quest_accepted" : "quest_not_available");
            }
            case "society_submit" -> {
                Map<?, ?> settled = (Map<?, ?>) call(data(player), "submit", new Class<?>[]{String.class, boolean.class}, "", false);
                JsonObject completion = new JsonObject(); settled.forEach((id, outcome) -> completion.addProperty(id.toString(), outcome.toString()));
                result.addProperty("ok", true); result.add("completion", completion);
                result.addProperty("code", completion.isEmpty() ? "no_quest_completed_check_requirements" : "quest_submission_settled");
            }
            case "society_open" -> { open(player, input.get("menu").getAsString()); result.addProperty("ok", true); }
            default -> throw new IllegalArgumentException("unsupported_society_operation");
        }
        result.add("state", state(player)); return result;
    }

    static void validate(ServerPlayer player, String kind, JsonObject input) {
        PlayerAuthBridge.requireAuthenticated(player);
        if (player.isDeadOrDying()) throw new IllegalArgumentException("body_dead");
        // Resolve all backends and inputs before any write is dispatched.
        state(player);
        if (kind.equals("society_accept")) { String id = input.get("questId").getAsString(); definition(id); quest(id); }
        if (kind.equals("society_open")) {
            if (!MENUS.contains(input.get("menu").getAsString())) throw new IllegalArgumentException("unknown_society_menu");
            if (!player.containerMenu.getCarried().isEmpty()) throw new IllegalArgumentException("clear_cursor_before_society_menu");
        }
    }

    private static void commands(RegisterCommandsEvent event) {
        var root = Commands.literal("mycli").requires(s -> s.getEntity() instanceof ServerPlayer p && PlayerAuthBridge.authenticated(p));
        root.executes(c -> help(c.getSource().getPlayerOrException()));
        root.then(Commands.literal("help").executes(c -> help(c.getSource().getPlayerOrException())));
        root.then(Commands.literal("list").executes(c -> help(c.getSource().getPlayerOrException())));
        root.then(Commands.literal("status").executes(c -> status(c.getSource().getPlayerOrException(), false)));
        root.then(Commands.literal("json").executes(c -> status(c.getSource().getPlayerOrException(), true)));
        root.then(Commands.literal("guide").executes(c -> {open(c.getSource().getPlayerOrException(), "guide"); return 1;}));
        root.then(Commands.literal("guideitem").executes(c -> guideItem(c.getSource().getPlayerOrException())));
        root.then(Commands.literal("market").executes(c -> {open(c.getSource().getPlayerOrException(), "market"); return 1;}));
        root.then(Commands.literal("quests").executes(c -> {open(c.getSource().getPlayerOrException(), "quests"); return 1;}));
        var guild = Commands.literal("guild").executes(c -> {open(c.getSource().getPlayerOrException(), "guide"); return 1;});
        guild.then(Commands.literal("status").executes(c -> status(c.getSource().getPlayerOrException(), false)));
        guild.then(Commands.literal("list").executes(c -> {open(c.getSource().getPlayerOrException(), "quests"); return 1;}));
        guild.then(Commands.literal("current").executes(c -> {open(c.getSource().getPlayerOrException(), "current"); return 1;}));
        guild.then(Commands.literal("join").executes(c -> {act(c.getSource().getPlayerOrException(), "society_join", new JsonObject()); return status(c.getSource().getPlayerOrException(), false);}));
        guild.then(Commands.literal("submit").executes(c -> {act(c.getSource().getPlayerOrException(), "society_submit", new JsonObject()); return status(c.getSource().getPlayerOrException(), false);}));
        guild.then(Commands.literal("accept").then(Commands.argument("questId", StringArgumentType.word()).executes(c -> {
            JsonObject input = new JsonObject(); input.addProperty("questId", StringArgumentType.getString(c, "questId"));
            JsonObject outcome = act(c.getSource().getPlayerOrException(), "society_accept", input);
            return outcome.get("ok").getAsBoolean() ? 1 : 0;
        })));
        root.then(guild); event.getDispatcher().register(root);
    }
    private static int help(ServerPlayer player) {
        player.sendSystemMessage(Component.literal("My Agent World：/mycli guide 图形指南；/mycli guild list 委托；/mycli guild current 进度；/mycli guild submit 交付；/mycli market 市场；/mycli guideitem 领取不可丢的指南针。\nAgent：society.state/accept/submit/open/join，沿本人 SDK 连接调用。")); return 1;
    }
    private static int status(ServerPlayer player, boolean json) {
        JsonObject s = state(player);
        player.sendSystemMessage(Component.literal(json ? "MAW_SOCIETY " + s : "公会：" + s.get("rank").getAsString() + " / 声望 " + s.get("reputation").getAsInt() + " / " + s.get("balance").getAsLong() + " 灯币。使用 /mycli guild current 查看自己的委托。")); return 1;
    }

    private static boolean isGuide(ItemStack stack) {
        var data = stack.get(DataComponents.CUSTOM_DATA); return data != null && data.copyTag().getBoolean("maw_guide");
    }
    private static int guideItem(ServerPlayer player) {
        for (ItemStack stack : player.getInventory().items) if (isGuide(stack)) { player.sendSystemMessage(Component.literal("冒险指南针已经在你的背包中。")); return 0; }
        if (player.getTags().contains("maw_guide_claimed")) {player.sendSystemMessage(Component.literal("已经领取过；/mycli guide 始终可用。")); return 0;}
        if (player.getInventory().getFreeSlot() < 0) {player.sendSystemMessage(Component.literal("背包已满，请腾出一格再领取。")); return 0;}
        ItemStack stack = icon("minecraft:compass", "冒险指南针", List.of("手持交互：指南、公会、委托和市场", "绑定本账号，不可丢弃；也可 /mycli guide"));
        CompoundTag data = new CompoundTag(); data.putBoolean("maw_guide", true); data.putString("ownerUuid", player.getUUID().toString());
        stack.set(DataComponents.MAX_STACK_SIZE, 1);
        stack.set(DataComponents.CUSTOM_DATA, CustomData.of(data)); player.getInventory().add(stack); player.addTag("maw_guide_claimed"); player.removeTag("maw_guide_pending");
        player.containerMenu.broadcastChanges(); return 1;
    }
    private static void useGuide(PlayerInteractEvent.RightClickItem event) {
        if (event.getHand() != InteractionHand.MAIN_HAND || !(event.getEntity() instanceof ServerPlayer player) || !isGuide(event.getItemStack())) return;
        event.setCanceled(true); event.setCancellationResult(InteractionResult.SUCCESS);
        if (PlayerAuthBridge.authenticated(player) && player.getUUID().toString().equals(event.getItemStack().get(DataComponents.CUSTOM_DATA).copyTag().getString("ownerUuid"))) open(player, "guide");
    }
    private static void npc(PlayerInteractEvent.EntityInteract event) {
        if (event.getHand() != InteractionHand.MAIN_HAND || !(event.getEntity() instanceof ServerPlayer player) || !event.getTarget().getTags().contains("maw_guild_npc")) return;
        event.setCanceled(true); event.setCancellationResult(InteractionResult.SUCCESS);
        if (!PlayerAuthBridge.authenticated(player)) return;
        if (event.getTarget().getTags().contains("maw_role_market")) open(player, "market");
        else {
            String category = event.getTarget().getTags().stream().filter(t -> t.startsWith("maw_role_")).map(t -> t.substring(9)).findFirst().orElse("");
            openQuests(player, category, false);
        }
    }
    static void open(ServerPlayer player, String menu) {
        PlayerAuthBridge.requireAuthenticated(player);
        if (!MENUS.contains(menu)) throw new IllegalArgumentException("unknown_society_menu");
        if (!player.containerMenu.getCarried().isEmpty()) throw new IllegalArgumentException("clear_cursor_before_society_menu");
        if (Set.of("market", "orders", "deliveries").contains(menu)) {
            int previous = player.containerMenu.containerId;
            // Brigadier executes immediately and checks the vendor command's own requirements.
            // performPrefixedCommand queues nested commands while /mycli is already executing,
            // so checking the new menu there races its still-pending command context.
            try {
                player.getServer().getCommands().getDispatcher().execute(
                    switch (menu) {case "market" -> "eco menu"; case "orders" -> "eco orders"; default -> "eco deliveries";},
                    player.createCommandSourceStack());
            } catch (com.mojang.brigadier.exceptions.CommandSyntaxException failure) {
                throw new IllegalArgumentException("society_market_command_denied", failure);
            }
            if (player.containerMenu.containerId == previous) throw new IllegalStateException("society_market_menu_not_opened");
        } else if (menu.equals("guide")) openGuide(player);
        else openQuests(player, "", menu.equals("current"));
    }
    private static ItemStack icon(String id, String name, List<String> lore) {
        ItemStack stack = new ItemStack(BuiltInRegistries.ITEM.get(ResourceLocation.parse(id)));
        stack.set(DataComponents.CUSTOM_NAME, Component.literal(name));
        stack.set(DataComponents.LORE, new ItemLore(lore.stream().map(Component::literal).map(c -> (Component)c).toList())); return stack;
    }
    private static String acceptLabel(String status) {
        return switch (status) {
            case "ACCEPT" -> "可以接取";
            case "REQUIREMENTS" -> "先完成前置委托";
            case "ALREADY_ACCEPTED" -> "进行中";
            case "ALREADY_COMPLETED", "MAX_REPEAT" -> "已经完成";
            case "COOLDOWN", "REPEAT_DELAY" -> "等待重复接取冷却";
            case "MAX_QUESTS" -> "同时接取数量已满";
            default -> "暂不可接取（" + status + "）";
        };
    }
    private static final class Board extends ChestMenu {
        final ServerPlayer owner; final Map<Integer, Consumer<ServerPlayer>> buttons;
        Board(int id, Inventory inventory, ServerPlayer owner, SimpleContainer items, Map<Integer, Consumer<ServerPlayer>> buttons) {
            super(MenuType.GENERIC_9x3, id, inventory, items, 3); this.owner = owner; this.buttons = buttons;
        }
        @Override public void clicked(int slot, int button, ClickType click, Player player) {
            if (player != owner || !stillValid(player) || !getCarried().isEmpty() || click != ClickType.PICKUP || (button != 0 && button != 1)) return;
            Consumer<ServerPlayer> action = buttons.get(slot);
            if (action != null) try { action.accept(owner); }
            catch (RuntimeException failure) {
                com.mojang.logging.LogUtils.getLogger().warn("Society menu action failed", failure);
                owner.sendSystemMessage(Component.literal("这个操作暂时不可用，请关闭界面后重试；物品不会由本菜单丢弃。"));
            }
        }
        @Override public ItemStack quickMoveStack(Player p, int index) { return ItemStack.EMPTY; }
        @Override public boolean stillValid(Player p) {return p == owner && owner.isAlive() && PlayerAuthBridge.authenticated(owner);}
    }
    private static void board(ServerPlayer player, String title, SimpleContainer items, Map<Integer, Consumer<ServerPlayer>> buttons) {
        if (!player.containerMenu.getCarried().isEmpty()) throw new IllegalArgumentException("clear_cursor_before_society_menu");
        player.openMenu(new SimpleMenuProvider((id, inventory, p) -> new Board(id, inventory, player, items, buttons), Component.literal(title)));
    }
    private static void openGuide(ServerPlayer player) {
        JsonObject s = state(player); SimpleContainer items = new SimpleContainer(27); Map<Integer, Consumer<ServerPlayer>> buttons = new HashMap<>();
        int slot = 0;
        for (JsonElement element : CONTENT.getAsJsonArray("guilds")) {
            JsonObject guild = element.getAsJsonObject(); String category = guild.get("id").getAsString();
            items.setItem(slot, icon(guild.get("icon").getAsString(), guild.get("name").getAsString(), List.of(guild.get("description").getAsString(), "点击选择这一类委托")));
            buttons.put(slot++, p -> openQuests(p, category, false));
        }
        items.setItem(10, icon("minecraft:emerald", "市场 · 买卖与玩家订单", List.of("真实账户余额：" + s.get("balance").getAsLong(), "固定商店、拍卖、收购订单和待领取物品"))); buttons.put(10, p -> open(p, "market"));
        items.setItem(12, icon("minecraft:writable_book", "我的委托与进度", List.of("这里只显示本账号的任务"))); buttons.put(12, p -> open(p, "current"));
        items.setItem(14, icon("minecraft:gold_nugget", "交付当前委托", List.of("交付类任务会扣除真实物资", "制作/击杀/探索类按实际事件计进度"))); buttons.put(14, p -> {act(p, "society_submit", new JsonObject()); open(p, "current");});
        items.setItem(16, icon("minecraft:compass", "领取冒险指南针", List.of("手持交互可瞬间打开本指南", "每人一份，不可丢弃"))); buttons.put(16, SocietyLifeBridge::guideItem);
        items.setItem(22, icon("minecraft:iron_ingot", s.get("rank").getAsString(), List.of("声望：" + s.get("reputation").getAsInt(), "声望随真实完成的委托累计", "可同时体验所有公会的生活方向")));
        items.setItem(24, icon("minecraft:name_tag", "登记成为公会旅人", List.of(s.get("joined").getAsBoolean() ? "已经登记" : "点击登记，无需费用"))); buttons.put(24, p -> {act(p, "society_join", new JsonObject()); openGuide(p);});
        board(player, "My Agent World · 冒险指南", items, buttons);
    }
    private static void openQuests(ServerPlayer player, String category, boolean current) {
        JsonObject state = state(player); SimpleContainer items = new SimpleContainer(27); Map<Integer, Consumer<ServerPlayer>> buttons = new HashMap<>(); int slot = 0;
        for (JsonElement element : state.getAsJsonArray("quests")) {
            JsonObject row = element.getAsJsonObject(); if (!category.isEmpty() && !category.equals(row.get("guild").getAsString()) || current && !row.get("active").getAsBoolean()) continue;
            String id = row.get("id").getAsString();
            items.setItem(slot, icon(row.get("item").getAsString(), row.get("name").getAsString(), List.of(row.get("description").getAsString(),
                "状态：" + (row.get("active").getAsBoolean() ? "进行中" : acceptLabel(row.get("acceptStatus").getAsString())), "点击查看详情 / 接取")));
            buttons.put(slot++, p -> detail(p, id));
        }
        items.setItem(24, icon("minecraft:gold_nugget", "提交物资 / 检查完成", List.of("会实际扣除交付类任务所需物资"))); buttons.put(24, p -> {act(p, "society_submit", new JsonObject()); openQuests(p, category, current);});
        items.setItem(26, icon("minecraft:compass", "返回指南", List.of())); buttons.put(26, SocietyLifeBridge::openGuide);
        board(player, current ? "我的公会委托" : "公会委托板", items, buttons);
    }
    private static void detail(ServerPlayer player, String id) {
        JsonObject q = definition(id); SimpleContainer items = new SimpleContainer(27); Map<Integer, Consumer<ServerPlayer>> buttons = new HashMap<>();
        items.setItem(4, icon(q.get("item").getAsString(), q.get("name").getAsString(), List.of(q.get("description").getAsString(), "奖励：" + q.get("money").getAsInt() + " 灯币 / " + q.get("reputation").getAsInt() + " 声望")));
        items.setItem(11, icon("minecraft:emerald", "接取委托", List.of("先接取，再完成制作、击杀或探索"))); buttons.put(11, p -> {JsonObject input = new JsonObject(); input.addProperty("questId", id); act(p, "society_accept", input); openQuests(p, q.get("guild").getAsString(), false);});
        items.setItem(15, icon("minecraft:gold_nugget", "交付 / 检查", List.of("交付类任务实际扣除物资"))); buttons.put(15, p -> {act(p, "society_submit", new JsonObject()); open(p, "current");});
        items.setItem(26, icon("minecraft:arrow", "返回委托板", List.of())); buttons.put(26, p -> openQuests(p, q.get("guild").getAsString(), false));
        board(player, q.get("name").getAsString(), items, buttons);
    }
}
