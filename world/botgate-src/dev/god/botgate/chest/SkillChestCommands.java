package dev.god.botgate.chest;

import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.nio.file.Path;
import java.util.List;

/** All compass/book/keybind entry points share the same vanilla 27-slot menu. */
public final class SkillChestCommands {
    private static final Logger GODFIX = LoggerFactory.getLogger("godfix-skillchest");
    private enum View { MAIN, WAYPOINTS, ARCHIVE, ITEMS, SKILLBAR, SKILLBAR_CHOICES }
    private SkillChestCommands() {}

    public static LiteralArgumentBuilder<CommandSourceStack> root() {
        LiteralArgumentBuilder<CommandSourceStack> root = Commands.literal("skillchest");
        root.then(Commands.literal("self").executes(ctx -> openSelf(ctx.getSource())));
        for (String name : List.of("wheel", "panel", "open", "waypoints", "archive", "items", "skillbar")) {
            View view = switch (name) { case "waypoints" -> View.WAYPOINTS; case "archive" -> View.ARCHIVE; case "items" -> View.ITEMS; case "skillbar" -> View.SKILLBAR; default -> View.MAIN; };
            root.then(Commands.literal(name).then(Commands.argument("player", StringArgumentType.word())
                    .executes(ctx -> openNamed(ctx.getSource(), StringArgumentType.getString(ctx, "player"), 0, view))
                    .then(Commands.argument("page", IntegerArgumentType.integer(0))
                            .executes(ctx -> openNamed(ctx.getSource(), StringArgumentType.getString(ctx, "player"), IntegerArgumentType.getInteger(ctx, "page"), view)))));
        }
        if (Boolean.getBoolean("settlementsfix.testHooks")) {
            root.then(Commands.literal("click").requires(source -> source.hasPermission(2))
                    .then(Commands.argument("player", StringArgumentType.word())
                            .then(Commands.argument("slot", IntegerArgumentType.integer(0, SkillChestLayout.SIZE - 1))
                                    .executes(ctx -> click(ctx.getSource(), StringArgumentType.getString(ctx, "player"), IntegerArgumentType.getInteger(ctx, "slot"))))));
            GODFIX.info("[skillchest] test hooks enabled (OP only)");
        }
        return root;
    }
    public static int openSelf(CommandSourceStack source) {
        ServerPlayer player = source.getPlayer();
        if (player == null) { source.sendFailure(Component.literal("请以玩家身份执行；控制台可用 skillchest open <玩家名>")); return 0; }
        return openPage(player, 0, View.MAIN) ? 1 : 0;
    }
    private static int openNamed(CommandSourceStack source, String name, int page, View view) {
        ServerPlayer actor = source.getPlayer();
        if (!source.hasPermission(2) && (actor == null || !actor.getGameProfile().getName().equalsIgnoreCase(name))) {
            source.sendFailure(Component.literal("只能给自己开面板（skillchest self）")); return 0;
        }
        ServerPlayer player = source.getServer().getPlayerList().getPlayerByName(name);
        if (player == null) { source.sendFailure(Component.literal("玩家不在线：" + name)); return 0; }
        return openPage(player, page, view) ? 1 : 0;
    }
    public static int openWheel(CommandSourceStack source, String name, int page) { return openNamed(source, name, page, View.MAIN); }
    public static int open(CommandSourceStack source, String name, int page) { return openNamed(source, name, page, View.MAIN); }
    public static int openItems(CommandSourceStack source, String name, int page) { return openNamed(source, name, page, View.ITEMS); }
    public static void openWheelFor(ServerPlayer player, int page) { openPage(player, page, View.MAIN); }
    public static void openFor(ServerPlayer player, int page) { openPage(player, page, View.MAIN); }
    public static void openItemsFor(ServerPlayer player, int page) { openPage(player, page, View.ITEMS); }
    public static void openWaypointsFor(ServerPlayer player, int page) { openPage(player, page, View.WAYPOINTS); }
    public static void openArchiveFor(ServerPlayer player, int page) { openPage(player, page, View.ARCHIVE); }
    public static void openSkillbarFor(ServerPlayer player) { openPage(player, 0, View.SKILLBAR); }
    public static void openSkillbarChoicesFor(ServerPlayer player, int slot, int page) {
        if (slot >= 1 && slot <= SkillChestLayout.SKILLBAR_SLOTS) openPage(player, page, View.SKILLBAR_CHOICES, slot);
    }

    private static boolean openPage(ServerPlayer player, int requested, View view) {
        return openPage(player, requested, view, 0);
    }
    private static boolean openPage(ServerPlayer player, int requested, View view, int selectedSlot) {
        try {
            Path dir = Path.of(System.getProperty("settlementsfix.mcdataDir", "/mcdata"));
            SkillChestIO.PanelData data = SkillChestIO.load(dir.resolve("magic-state.json"), dir.resolve("magic-atoms.json"),
                    dir.resolve("waypoints.json"), dir.resolve("skill-chest.json"), dir.resolve("skill-catalog.json"), player.getGameProfile().getName());
            int pages = switch (view) {
                case MAIN -> SkillChestLayout.pagesFor(data.skills);
                case ARCHIVE -> SkillChestLayout.pagesFor(data.archivedSkills);
                case WAYPOINTS -> SkillChestLayout.waypointPagesFor(data.waypoints);
                case ITEMS -> SkillChestLayout.itemPagesFor(data.config.giveItems);
                case SKILLBAR -> 1;
                case SKILLBAR_CHOICES -> SkillChestLayout.skillbarChoicePagesFor(data.skills);
            };
            int page = Math.max(0, Math.min(requested, pages - 1));
            List<SkillChestLayout.Entry> entries = switch (view) {
                case MAIN -> SkillChestLayout.build(data.config, data.skills, data.waypoints, page);
                case ARCHIVE -> SkillChestLayout.buildArchive(data.config, data.archivedSkills, page);
                case WAYPOINTS -> SkillChestLayout.buildWaypoints(data.config, data.waypoints, page);
                case ITEMS -> SkillChestLayout.buildItemGrid(data.config, data.config.giveItems, page);
                case SKILLBAR -> SkillChestLayout.buildSkillbar(data.config, data.skills, data.skillbar, data.skillbarAvailable);
                case SKILLBAR_CHOICES -> SkillChestLayout.buildSkillbarChoices(data.config, data.skills, data.skillbar, selectedSlot, page);
            };
            String label = switch (view) { case MAIN -> "技能罗盘"; case ARCHIVE -> "旧技能档案 · 只读"; case WAYPOINTS -> "传送阵"; case ITEMS -> "造物 · 选择物品";
                case SKILLBAR -> "快捷栏 · 8 槽"; case SKILLBAR_CHOICES -> "快捷槽 " + selectedSlot + " · 选择秘术"; };
            Component title = Component.literal(label + " · " + (page + 1) + "/" + pages);
            var opened = player.openMenu(new net.minecraft.world.MenuProvider() {
                @Override public net.minecraft.world.inventory.AbstractContainerMenu createMenu(int id, net.minecraft.world.entity.player.Inventory inv,
                                                                                             net.minecraft.world.entity.player.Player who) {
                    return new SkillChestMenu(id, inv, player, entries, page, data.config.debounceMs,
                            target -> openPage(player, target, view, selectedSlot), target -> openItemsFor(player, target),
                            target -> openWaypointsFor(player, target), target -> openArchiveFor(player, target), () -> openFor(player, 0));
                }
                @Override public Component getDisplayName() { return title; }
            });
            if (opened.isEmpty()) return false;
            GODFIX.info("[skillchest] {} for {} page={}/{} ({} featured, {} archived, {} waypoints)",
                    view, player.getGameProfile().getName(), page + 1, pages, data.skills.size(), data.archivedSkills.size(), data.waypoints.size());
            return true;
        } catch (Exception ex) {
            GODFIX.warn("[skillchest] open failed for {}: {}", player.getGameProfile().getName(), ex.toString());
            player.sendSystemMessage(Component.literal("罗盘暂不可打开，请稍后重试")); return false;
        }
    }
    private static int click(CommandSourceStack source, String name, int slot) {
        if (!source.hasPermission(2)) return 0;
        ServerPlayer player = source.getServer().getPlayerList().getPlayerByName(name);
        if (player == null || !(player.containerMenu instanceof SkillChestMenu menu)) {
            source.sendFailure(Component.literal("玩家未打开技能罗盘")); return 0;
        }
        menu.clicked(slot, 0, net.minecraft.world.inventory.ClickType.PICKUP, player); return 1;
    }
}
