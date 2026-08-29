package dev.god.settlementsfix.chest;

import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.ChestMenu;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.inventory.MenuType;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.ItemLore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;

/**
 * 宝箱技能面板 · 服务端菜单（vanilla GENERIC_9x3，客户端零 mod）。
 *
 * 手柄交互的核心：容器界面自带十字键/摇杆格子导航 + RT 确认——萌萌（5 岁，
 * PC Java + 手柄）用「选物品」的同款操作选技能。
 *
 * 点击语义（覆写 clicked，不调 super——技能图标是虚拟物品，不可拿取）：
 *   SKILL/WAYPOINT → 关箱 + performCommand("/mycli cast|传送去 ...")（书页同链路）
 *   MORE/BACK      → 关箱 + 重开目标页（页号存 Entry.id）
 *   EMPTY          → 无动作（防误点，格子是灰玻璃）
 *
 * 防抖：同玩家 800ms（可配）内只执行第一次点击。
 */
public class SkillChestMenu extends ChestMenu {

    private static final Logger GODFIX = LoggerFactory.getLogger("godfix-skillchest");

    private final ServerPlayer player;
    private final List<SkillChestLayout.Entry> entries;
    private final int page;
    private final SkillChestLayout.Debouncer debouncer;
    private final java.util.function.Consumer<Integer> pageTurner;
    /** 造物子面板开关（主面板 give 格点击时调用；null=无子面板能力）。 */
    private final java.util.function.Consumer<Integer> itemPanelOpener;

    public SkillChestMenu(int containerId, net.minecraft.world.entity.player.Inventory playerInventory,
                          ServerPlayer player, List<SkillChestLayout.Entry> entries, int page,
                          long debounceMs, java.util.function.Consumer<Integer> pageTurner) {
        this(containerId, playerInventory, player, entries, page, debounceMs, pageTurner, null);
    }

    public SkillChestMenu(int containerId, net.minecraft.world.entity.player.Inventory playerInventory,
                          ServerPlayer player, List<SkillChestLayout.Entry> entries, int page,
                          long debounceMs, java.util.function.Consumer<Integer> pageTurner,
                          java.util.function.Consumer<Integer> itemPanelOpener) {
        this(MenuType.GENERIC_9x3, 3, containerId, playerInventory, player, entries, page, debounceMs, pageTurner, itemPanelOpener);
    }

    /** 可变规格构造（2026-08-30 轮盘）：GENERIC_9x1 一行轮盘等由子类复用全部点击语义。 */
    protected SkillChestMenu(MenuType<? extends ChestMenu> type, int rows, int containerId,
                             net.minecraft.world.entity.player.Inventory playerInventory,
                             ServerPlayer player, List<SkillChestLayout.Entry> entries, int page,
                             long debounceMs, java.util.function.Consumer<Integer> pageTurner,
                             java.util.function.Consumer<Integer> itemPanelOpener) {
        super(type, containerId, playerInventory, buildContainer(entries), rows);
        this.player = player;
        this.entries = entries;
        this.page = page;
        this.debouncer = new SkillChestLayout.Debouncer(debounceMs);
        this.pageTurner = pageTurner;
        this.itemPanelOpener = itemPanelOpener;
    }

    private static SimpleContainer buildContainer(List<SkillChestLayout.Entry> entries) {
        SimpleContainer c = new SimpleContainer(SkillChestLayout.SIZE);
        for (int i = 0; i < SkillChestLayout.SIZE && i < entries.size(); i++) {
            c.setItem(i, iconStack(entries.get(i)));
        }
        return c;
    }

    /** Entry → 图标物品（名字+lore；解析失败回退空格子，不炸）。 */
    private static ItemStack iconStack(SkillChestLayout.Entry e) {
        try {
            Item item = BuiltInRegistries.ITEM.get(ResourceLocation.parse(e.icon));
            if (item == null) {
                item = net.minecraft.world.item.Items.GRAY_STAINED_GLASS_PANE;
            }
            ItemStack st = new ItemStack(item);
            if (e.kind != SkillChestLayout.Kind.EMPTY) {
                st.set(DataComponents.CUSTOM_NAME, Component.literal("§r§f" + e.name));
                List<Component> lore = new ArrayList<>();
                if (!e.lore.isEmpty()) {
                    lore.add(Component.literal("§7" + e.lore));
                }
                lore.add(Component.literal("§8" + switch (e.kind) {
                    case SKILL -> "按 A / 确认释放";
                    case WAYPOINT -> "按 A / 确认传送";
                    case ITEM -> "按 A / 变出来";
                    case MORE, BACK -> "翻页";
                    default -> "";
                }));
                st.set(DataComponents.LORE, new ItemLore(lore));
            } else if (!e.name.isEmpty()) {
                st.set(DataComponents.CUSTOM_NAME, Component.literal("§r§8" + e.name));
            }
            return st;
        } catch (Exception ex) {
            return new ItemStack(net.minecraft.world.item.Items.GRAY_STAINED_GLASS_PANE);
        }
    }

    @Override
    public void clicked(int slotId, int button, ClickType clickType, Player who) {
        // 不调 super：所有拿取/移动全拦（技能图标不可拿走）。
        try {
            if (slotId < 0 || slotId >= entries.size()) {
                return; // 点玩家背包区/格子外：忽略
            }
            SkillChestLayout.Entry e = entries.get(slotId);
            if (e == null || e.kind == SkillChestLayout.Kind.EMPTY) {
                return;
            }
            if (!debouncer.allow(player.getGameProfile().getName())) {
                return;
            }
            switch (e.kind) {
                case SKILL, WAYPOINT -> {
                    String cmd = e.command == null ? null
                            : e.command.replace("{PLAYER}", player.getGameProfile().getName());
                    player.closeContainer();
                    if (cmd != null) {
                        player.server.getCommands().performPrefixedCommand(
                                player.createCommandSourceStack().withSuppressedOutput(), cmd);
                        GODFIX.info("[skillchest] {} slot{} -> {}", player.getGameProfile().getName(), slotId, cmd);
                    } else if ("give".equals(e.id) && itemPanelOpener != null) {
                        // 造物术格：开「可造物」子面板（2026-08-30 造物扩展）
                        itemPanelOpener.accept(0);
                    }
                }
                case ITEM -> {
                    String cmd = e.command == null ? null
                            : e.command.replace("{PLAYER}", player.getGameProfile().getName());
                    player.closeContainer();
                    if (cmd != null) {
                        player.server.getCommands().performPrefixedCommand(
                                player.createCommandSourceStack().withSuppressedOutput(), cmd);
                        GODFIX.info("[skillchest] {} slot{} -> {}", player.getGameProfile().getName(), slotId, cmd);
                    }
                }
                case MORE, BACK -> {
                    int target = SkillChestLayout.navTarget(e);
                    player.closeContainer();
                    if (pageTurner != null) {
                        pageTurner.accept(target);
                    }
                }
                default -> { }
            }
        } catch (Exception ex) {
            GODFIX.warn("[skillchest] click failed: {}", ex.toString());
        }
    }

    public int page() { return page; }
}
