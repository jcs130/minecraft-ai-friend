package dev.god.settlementsfix.chest;

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

/**
 * 宝箱技能面板 · 命令层。
 *
 *   /skillchest open <player> [page]   OP：给玩家开面板（页号默认 0）
 *   /skillchest click <player> <slot>  测试钩子（仅 -Dsettlementsfix.testHooks=true
 *                                      注册）：模拟点击某格——CI/E2E 用，
 *                                      不需要在客户端真点。
 *
 * 开面板链：load(magic-state+atoms+waypoints+skill-chest.json) → build 布局 →
 * SkillChestMenu（vanilla GENERIC_9x3）→ player.openMenu。vanilla 客户端
 * 零 mod；十字键/摇杆导航原生可用。
 */
public final class SkillChestCommands {

    private static final Logger GODFIX = LoggerFactory.getLogger("godfix-skillchest");

    private SkillChestCommands() {}

    /** 命令树根（BootMixin 直接注进 Commands 构造器——不依赖事件时序）。
     * 2026-08-30 权限分层：root 不再整体 requires OP——self 子命令人人可跑
     * （命格书首页入口点进来的是玩家身份）；open/items 代开他人仍需 OP
     * （executes 内校验，控制台/RCON 恒放行）；click 仅测试钩子。 */
    public static LiteralArgumentBuilder<CommandSourceStack> root() {
        LiteralArgumentBuilder<CommandSourceStack> root = Commands.literal("skillchest");
        root.then(Commands.literal("self")
                .executes(ctx -> openSelf(ctx.getSource())));
        root.then(Commands.literal("open")
                .then(Commands.argument("player", StringArgumentType.word())
                        .executes(ctx -> open(ctx.getSource(), StringArgumentType.getString(ctx, "player"), 0))
                        .then(Commands.argument("page", IntegerArgumentType.integer(0))
                                .executes(ctx -> open(ctx.getSource(), StringArgumentType.getString(ctx, "player"),
                                        IntegerArgumentType.getInteger(ctx, "page"))))));
        // 造物子面板（2026-08-30 造物扩展）：/skillchest items <player> [page]
        root.then(Commands.literal("items")
                .then(Commands.argument("player", StringArgumentType.word())
                        .executes(ctx -> openItems(ctx.getSource(), StringArgumentType.getString(ctx, "player"), 0))
                        .then(Commands.argument("page", IntegerArgumentType.integer(0))
                                .executes(ctx -> openItems(ctx.getSource(), StringArgumentType.getString(ctx, "player"),
                                        IntegerArgumentType.getInteger(ctx, "page"))))));
        if (Boolean.getBoolean("settlementsfix.testHooks")) {
            root.then(Commands.literal("click")
                    .then(Commands.argument("player", StringArgumentType.word())
                            .then(Commands.argument("slot", IntegerArgumentType.integer(0, 26))
                                    .executes(ctx -> click(ctx.getSource(),
                                            StringArgumentType.getString(ctx, "player"),
                                            IntegerArgumentType.getInteger(ctx, "slot"))))));
            GODFIX.info("[skillchest] test hooks enabled (skillchest click)");
        }
        return root;
    }

    /** self：玩家给自己开面板（无需 OP；控制台跑报错——控制台用 open <player>）。 */
    public static int openSelf(CommandSourceStack source) {
        try {
            ServerPlayer sp = source.getPlayerOrException();
            openFor(sp, 0);
            return 1;
        } catch (Exception e) {
            source.sendFailure(Component.literal("此命令需以玩家身份执行（控制台请用 open <玩家名>）"));
            return 0;
        }
    }

    /** 权限校验：玩家只能开自己；OP/控制台可代开任何人。 */
    private static boolean mayOpenOther(CommandSourceStack source, String targetName) {
        try {
            ServerPlayer sp = source.getPlayer();
            return sp == null // 控制台/RCON
                    || sp.hasPermissions(2)
                    || sp.getGameProfile().getName().equalsIgnoreCase(targetName);
        } catch (Exception e) {
            return true; // 无玩家上下文（控制台）
        }
    }

    /** 开面板主流程。返回 1 成功 / 0 玩家不在线。 */
    public static int open(CommandSourceStack source, String playerName, int page) {
        if (!mayOpenOther(source, playerName)) {
            source.sendFailure(Component.literal("只能给自己开面板（skillchest self）"));
            return 0;
        }
        ServerPlayer sp = source.getServer().getPlayerList().getPlayerByName(playerName);
        if (sp == null) {
            source.sendFailure(Component.literal("玩家不在线: " + playerName));
            return 0;
        }
        openFor(sp, page);
        return 1;
    }

    /** 面板数据 + 菜单构造 + openMenu（SkillBookUseMixin 书匣分支也调这里）。 */
    public static void openFor(ServerPlayer sp, int page) {
        try {
            String mcdata = System.getProperty("settlementsfix.mcdataDir", "/mcdata");
            SkillChestIO.PanelData data = SkillChestIO.load(
                    Path.of(mcdata, "magic-state.json"),
                    Path.of(mcdata, "magic-atoms.json"),
                    Path.of(mcdata, "waypoints.json"),
                    Path.of(mcdata, "skill-chest.json"),
                    sp.getGameProfile().getName());
            int safePage = Math.max(0, Math.min(page, SkillChestLayout.pagesFor(data.skills) - 1));
            List<SkillChestLayout.Entry> entries = SkillChestLayout.build(
                    data.config, data.skills, data.waypoints, safePage);
            String title = "§3技能 · §b魔 " + data.mana + "§3/§b" + data.maxMana;
            sp.openMenu(new net.minecraft.world.MenuProvider() {
                @Override
                public net.minecraft.world.inventory.AbstractContainerMenu createMenu(
                        int syncId, net.minecraft.world.entity.player.Inventory inv,
                        net.minecraft.world.entity.player.Player p) {
                    return new SkillChestMenu(syncId, inv, sp, entries, safePage,
                            data.config.debounceMs, target -> openFor(sp, target),
                            target -> openItemsFor(sp, target));
                }

                @Override
                public Component getDisplayName() {
                    return Component.literal(title);
                }
            });
            GODFIX.info("[skillchest] opened for {} page={} ({} skills, {} waypoints)",
                    sp.getGameProfile().getName(), safePage, data.skills.size(), data.waypoints.size());
        } catch (Exception e) {
            GODFIX.warn("[skillchest] open failed for {}: {}", sp.getGameProfile().getName(), e.toString());
        }
    }

    /** 造物子面板入口。 */
    public static int openItems(CommandSourceStack source, String playerName, int page) {
        if (!mayOpenOther(source, playerName)) {
            source.sendFailure(Component.literal("只能给自己开面板（skillchest self）"));
            return 0;
        }
        ServerPlayer sp = source.getServer().getPlayerList().getPlayerByName(playerName);
        if (sp == null) {
            source.sendFailure(Component.literal("玩家不在线: " + playerName));
            return 0;
        }
        openItemsFor(sp, page);
        return 1;
    }

    /** 造物子面板（2026-08-30 造物扩展）：可造物 27 格网格，点击 → /mycli cast 造物 <名>。 */
    public static void openItemsFor(ServerPlayer sp, int page) {
        try {
            String mcdata = System.getProperty("settlementsfix.mcdataDir", "/mcdata");
            SkillChestLayout.Config cfg = SkillChestIO.loadConfig(Path.of(mcdata, "skill-chest.json"));
            int safePage = Math.max(0, Math.min(page, SkillChestLayout.itemPagesFor(cfg.giveItems) - 1));
            List<SkillChestLayout.Entry> entries = SkillChestLayout.buildItemGrid(cfg, cfg.giveItems, safePage);
            sp.openMenu(new net.minecraft.world.MenuProvider() {
                @Override
                public net.minecraft.world.inventory.AbstractContainerMenu createMenu(
                        int syncId, net.minecraft.world.entity.player.Inventory inv,
                        net.minecraft.world.entity.player.Player p) {
                    return new SkillChestMenu(syncId, inv, sp, entries, safePage,
                            cfg.debounceMs, target -> openItemsFor(sp, target), null);
                }

                @Override
                public Component getDisplayName() {
                    return Component.literal("§3造物 · §b选一个变出来");
                }
            });
            GODFIX.info("[skillchest] items panel for {} page={} ({} items)",
                    sp.getGameProfile().getName(), safePage, cfg.giveItems.size());
        } catch (Exception e) {
            GODFIX.warn("[skillchest] items open failed for {}: {}", sp.getGameProfile().getName(), e.toString());
        }
    }

    /** 测试钩子：模拟点击（player 当前 containerMenu 必须是 SkillChestMenu）。 */
    private static int click(CommandSourceStack source, String playerName, int slot) {
        ServerPlayer sp = source.getServer().getPlayerList().getPlayerByName(playerName);
        if (sp == null) {
            source.sendFailure(Component.literal("玩家不在线"));
            return 0;
        }
        if (!(sp.containerMenu instanceof SkillChestMenu menu)) {
            source.sendFailure(Component.literal("面板未打开（先 skillchest open）"));
            return 0;
        }
        menu.clicked(slot, 0, net.minecraft.world.inventory.ClickType.PICKUP, sp);
        return 1;
    }
}
