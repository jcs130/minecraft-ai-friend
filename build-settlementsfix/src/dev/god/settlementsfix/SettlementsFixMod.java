package dev.god.settlementsfix;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import net.minecraft.ChatFormatting;
import net.minecraft.core.component.DataComponents;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.Filterable;
import net.minecraft.server.network.FilteredText;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.component.CustomData;
import net.minecraft.world.item.component.ItemLore;
import net.minecraft.world.item.component.WrittenBookContent;
import net.minecraft.world.entity.npc.Villager;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.storage.loot.LootPool;
import net.minecraft.world.level.storage.loot.LootTable;
import net.minecraft.world.level.storage.loot.entries.EmptyLootItem;
import net.minecraft.world.level.storage.loot.entries.LootItem;
import net.minecraft.world.level.storage.loot.functions.SetComponentsFunction;
import net.minecraft.world.level.storage.loot.providers.number.ConstantValue;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.event.LootTableLoadEvent;
import net.neoforged.neoforge.event.entity.living.LivingDropsEvent;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.entity.player.PlayerInteractEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.Set;

/**
 * 右键村民 → 记事件文件（mc_npc.py interact_tail_loop 消费后让 NPC 说话）。
 *
 * 纯服务端：玩家右键我们的中文 NPC（CustomName 非空）时，把 {ts, player, npc} 追加到
 * interact-events.jsonl（每行一个 JSON）。sidecar 脚本 tail 该文件 → 对玩家说今日话题。
 * 路径可用 -Dsettlementsfix.interactFile=... 覆盖（发行版迁移用）；默认本机私服布局。
 *
 * 2026-08-23 技能书施法（造物主谕「真人靠技能书一键施法」）：
 *  - 右键 written_book 且 custom_data.skillbook=<id>（固定技能书：归乡/照明/圣愈/造物）
 *    → 写 spell-requests.jsonl {speaker, skill}；mc_npc.py spell_loop 消费执行（分级冷却）。
 *  - 右键 written_book 且 custom_data.craftreq=true（空白造物卷合书产物）
 *    → 写 spell-requests.jsonl {speaker, text=<全书页>}；mc_npc 白名单直给/超纲呈神。
 *  - 合书识别：合成产物 written_book 且输入含 custom_data.craftreq=true 的书与笔
 *    → 给产物打 custom_data.craftreq=true（空白造物卷链路：买书与笔 → 自写 → 合成 → 右键）。
 * 路径可用 -Dsettlementsfix.spellFile=... 覆盖；默认与 interactFile 同卷。
 *
 * 【2026-08-23 根因修复】原 onRightClickItem 监听 PlayerInteractEvent.RightClickItem，
 * 但 NeoForge 的 RightClickItem 事件只在 ServerPlayerGameMode.useItem（对着空气右键）fire；
 * 书右键打开 GUI 最常走 useItemOn（对着方块右键），该路径根本不 fire 此事件 → 书右键无反应。
 * 正确拦截点 = WrittenBookItem.use（书被使用的唯一统一入口，对空气/对方块右键都走这里），
 * 由 WrittenBookItemMixin @Inject HEAD 调用 {@link #handleSkillBookUse} 完成写盘。
 */
@Mod("settlementsfix")
public class SettlementsFixMod {

    private static final Path INTERACT_FILE = Paths.get(System.getProperty(
            "settlementsfix.interactFile",
            "C:\\Users\\lzl19\\.copaw\\workspaces\\default\\deepseek-harness\\scratch-plugin\\data\\village\\interact-events.jsonl"));

    private static final Path SPELL_FILE = Paths.get(System.getProperty(
            "settlementsfix.spellFile",
            "C:\\Users\\lzl19\\.copaw\\workspaces\\default\\deepseek-harness\\scratch-plugin\\data\\spell-requests.jsonl"));

    /** 状态书（神使手札）请求：右键 → 写 {ts, speaker} 到 status-requests.jsonl（mc-god 消费回执状态）。 */
    private static final Path STATUS_FILE = Paths.get(System.getProperty(
            "settlementsfix.statusFile",
            "C:\\Users\\lzl19\\.copaw\\workspaces\\default\\deepseek-harness\\scratch-plugin\\data\\status-requests.jsonl"));

    private static final Gson GSON = new Gson();

    private static final Logger LOGGER = LoggerFactory.getLogger("settlementsfix");

    public SettlementsFixMod(IEventBus modBus) {
        // PlayerInteractEvent / PlayerEvent 是游戏总线事件（非 mod 总线）；NeoForge.EVENT_BUS 注册
        net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(this::onEntityInteract);
        net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(this::onItemCrafted);
        net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(this::onPlayerLoggedIn);
        net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(this::onItemToss);
        net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(this::onLivingDrops);
        net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(this::onLootTableLoad);
    }

    // ---------- 技能书世界生成（2026-08-23 造物主谕「技能书…打怪掉落 / 箱子里面」） ----------
    // 与书商 mc_npc.py SKILLBOOKS 保持同池同文案；掉落/箱子出的书可直接右键施法（custom_data.skillbook）。
    // 权重：light 最常见，heal/tp/give 稀有（保命卷/空间卷/造物卷不烂大街）。
    private static final String[][] SKILLBOOK_POOL = {
            {"home", "归乡之卷", "墨白", "咏唱：归乡/回家/回基地/归途/回巢", "归乡之卷（空间系·Lv2）｜咏唱：归乡/回家/回基地/归途/回巢。私语念出即施，成功即掌握；远行前备一卷，迷途不慌。", "2"},
            {"light", "照明之卷", "墨白", "咏唱：照明/点火/火把/光亮/照亮/驱暗", "照明之卷（光系·Lv1）｜咏唱：照明/点火/火把/光亮/照亮/驱暗。黑暗中私语念出，掌心燃光；矿洞夜路皆可应急。", "3"},
            {"feed", "饱食之卷", "墨白", "咏唱：饱食/充饥/饱腹/不饿/充能", "饱食之卷（生命系·Lv2）｜咏唱：饱食/充饥/饱腹/不饿/充能。腹空时私语念出，饥意自消；神赐一餐，不如自己种一田。", "2"},
            {"heal", "圣愈之卷", "云笈", "咏唱：圣愈/治愈/治疗/疗伤/回血/痊愈", "圣愈之卷（生命系·Lv5）｜咏唱：圣愈/治愈/治疗/疗伤/回血/痊愈。负伤时私语念出，伤口愈合；生死关头的保命卷。", "1"},
            {"tp", "传送之卷", "云笈", "咏唱：传送/瞬移/闪现/空间跳跃/跃迁", "传送之卷（空间系·Lv2）｜咏唱：传送/瞬移/闪现/撕裂虚空/空间跳跃/跃迁。报方向距离（如「传送十格东」）念出即至。", "1"},
            {"give", "造物之卷", "云笈", "咏唱：造物/赐予/给予/给我/变出", "造物之卷（创造系·Lv2）｜咏唱：造物/赐予/给予/赐下/给我/变出。报所需之物（如「给我个火把」）私语念出，神恩按白名单施予。", "1"},
    };
    private static final Random RNG = new Random();

    /** 打怪掉落：亡灵/节肢/苦力怕/女巫死亡有 3% 掉一本随机技能书。 */
    private static final Set<EntityType<?>> DROP_MOBS = Set.of(
            EntityType.ZOMBIE, EntityType.HUSK, EntityType.DROWNED,
            EntityType.SKELETON, EntityType.STRAY,
            EntityType.SPIDER, EntityType.CAVE_SPIDER,
            EntityType.CREEPER, EntityType.WITCH);

    /** 箱子注入：探索箱 → 低概率多一池技能书（空手权重 vs 技能书权重）。 */
    private static final java.util.Map<ResourceLocation, Integer> CHEST_SKILLBOOK_WEIGHT;
    static {
        java.util.Map<ResourceLocation, Integer> m = new java.util.HashMap<>();
        m.put(ResourceLocation.withDefaultNamespace("chests/simple_dungeon"), 1);
        m.put(ResourceLocation.withDefaultNamespace("chests/abandoned_mineshaft"), 1);
        m.put(ResourceLocation.withDefaultNamespace("chests/stronghold_corridor"), 1);
        m.put(ResourceLocation.withDefaultNamespace("chests/ruined_portal"), 1);
        m.put(ResourceLocation.withDefaultNamespace("chests/shipwreck_treasure"), 3);
        m.put(ResourceLocation.withDefaultNamespace("chests/jungle_temple"), 1);
        m.put(ResourceLocation.withDefaultNamespace("chests/desert_pyramid"), 1);
        m.put(ResourceLocation.withDefaultNamespace("chests/village_plains_house"), 1);
        m.put(ResourceLocation.withDefaultNamespace("chests/village_taiga_house"), 1);
        m.put(ResourceLocation.withDefaultNamespace("chests/village_desert_house"), 1);
        m.put(ResourceLocation.withDefaultNamespace("chests/village_savanna_house"), 1);
        m.put(ResourceLocation.withDefaultNamespace("chests/village_snowy_house"), 1);
        CHEST_SKILLBOOK_WEIGHT = java.util.Collections.unmodifiableMap(m);
    }

    /** 生成一本技能书（与书商 SKILLBOOKS 同结构：written_book + custom_data.skillbook + lore）。 */
    public static ItemStack makeSkillBook(String key, String title, String author, String chant, String page) {
        ItemStack book = new ItemStack(Items.WRITTEN_BOOK, 1);
        // 1.21 WrittenBookContent：title=Filterable<String>，author=String，pages=List<Filterable<Component>>
        // 书页即 Component（序列化后与书商 SNBT 的 {"text": ...} 等价）
        List<Filterable<Component>> pages = List.of(Filterable.passThrough(Component.literal(page)));
        book.set(DataComponents.WRITTEN_BOOK_CONTENT,
                new WrittenBookContent(Filterable.passThrough(title), author, 0, pages, true));
        book.set(DataComponents.CUSTOM_DATA, CustomData.EMPTY.update(j -> j.putString("skillbook", key)));
        book.set(DataComponents.LORE, new ItemLore(List.of(
                Component.literal(chant).withStyle(ChatFormatting.GRAY),
                Component.literal("右键=施放（不打开书）").withStyle(ChatFormatting.DARK_GRAY, ChatFormatting.ITALIC))));
        return book;
    }

    /** 按权重随机抽一本技能书。 */
    private static ItemStack randomSkillBook() {
        int total = 0;
        for (String[] sb : SKILLBOOK_POOL) {
            total += Integer.parseInt(sb[5]);
        }
        int pick = RNG.nextInt(total);
        for (String[] sb : SKILLBOOK_POOL) {
            pick -= Integer.parseInt(sb[5]);
            if (pick < 0) {
                return makeSkillBook(sb[0], sb[1], sb[2], sb[3], sb[4]);
            }
        }
        return makeSkillBook(SKILLBOOK_POOL[0][0], SKILLBOOK_POOL[0][1], SKILLBOOK_POOL[0][2], SKILLBOOK_POOL[0][3], SKILLBOOK_POOL[0][4]);
    }

    /** 打怪掉落：敌对怪 3% 掉一本随机技能书（技能书可自由流转，掉落物直接进世界）。 */
    private void onLivingDrops(LivingDropsEvent ev) {
        try {
            var entity = ev.getEntity();
            if (entity.level().isClientSide) {
                return;
            }
            if (!DROP_MOBS.contains(entity.getType())) {
                return;
            }
            if (RNG.nextDouble() >= 0.03) {
                return;
            }
            ItemStack book = randomSkillBook();
            ev.getDrops().add(new ItemEntity(entity.level(), entity.getX(), entity.getY(), entity.getZ(), book));
            LOGGER.info("[settlementsfix] skillbook drop: mob={} book={}", entity.getType().getDescriptionId(), book.getDisplayName().getString());
        } catch (Exception e) {
            // 掉落失败不阻断
        }
    }

    /** 箱子注入：探索箱 loot table 加载后追加一个「空手/技能书」池。
     *  LootTable 构造器包私有、原池无公开 getter，用反射重建表（原池全保留 + 追加技能书池）。
     *  任何反射失败都被兜住：箱子注入静默降级，打怪掉落不受影响。 */
    private void onLootTableLoad(LootTableLoadEvent ev) {
        try {
            Integer weight = CHEST_SKILLBOOK_WEIGHT.get(ev.getName());
            if (weight == null) {
                return;
            }
            LootTable table = ev.getTable();
            java.lang.reflect.Field f = LootTable.class.getDeclaredField("pools");
            f.setAccessible(true);
            @SuppressWarnings("unchecked")
            List<LootPool> orig = (List<LootPool>) f.get(table);
            List<LootPool> pools = new ArrayList<>(orig);
            pools.add(skillbookPool(weight));
            java.lang.reflect.Constructor<LootTable> c = LootTable.class.getDeclaredConstructor(
                    net.minecraft.world.level.storage.loot.parameters.LootContextParamSet.class,
                    java.util.Optional.class, List.class, List.class);
            c.setAccessible(true);
            LootTable newTable = c.newInstance(table.getParamSet(), java.util.Optional.empty(), pools, List.of());
            ev.setTable(newTable);
            LOGGER.info("[settlementsfix] skillbook injected into chest loot: {}", ev.getName());
        } catch (Exception e) {
            LOGGER.warn("[settlementsfix] chest loot inject failed for {}: {}", ev.getName(), e.toString());
        }
    }

    /** 构造技能书池：rolls=1，空手 19 vs 技能书 weight（默认 1，沉船宝藏 3 → 更高概率）。 */
    private static LootPool skillbookPool(int bookWeight) {
        LootPool.Builder b = LootPool.lootPool().setRolls(ConstantValue.exactly(1.0F));
        b.add(EmptyLootItem.emptyItem().setWeight(19));
        for (String[] sb : SKILLBOOK_POOL) {
            int w = bookWeight * Integer.parseInt(sb[5]);
            b.add(LootItem.lootTableItem(Items.WRITTEN_BOOK)
                    .setWeight(w)
                    .apply(SetComponentsFunction.setComponent(DataComponents.WRITTEN_BOOK_CONTENT,
                            new WrittenBookContent(Filterable.passThrough(sb[1]), sb[2], 0,
                                    List.of(Filterable.passThrough(Component.literal(sb[4]))), true)))
                    .apply(SetComponentsFunction.setComponent(DataComponents.CUSTOM_DATA,
                            CustomData.EMPTY.update(j -> j.putString("skillbook", sb[0]))))
                    .apply(SetComponentsFunction.setComponent(DataComponents.LORE,
                            new ItemLore(List.of(
                                    Component.literal(sb[3]).withStyle(ChatFormatting.GRAY),
                                    Component.literal("右键=施放（不打开书）").withStyle(ChatFormatting.DARK_GRAY, ChatFormatting.ITALIC))))));
        }
        return b.build();
    }

    /**
     * 神使手札（状态书）不可丢弃（2026-08-23 造物主谕「状态书无法丢弃」）。
     * ItemTossEvent 在玩家丢出物品（Q 键 / 拖出背包 / 丢出快捷栏）时触发且可取消。
     * 技能书/空白造物卷不在保护内——它们是搜集品，可丢、可入箱、可送人。
     */
    private void onItemToss(net.neoforged.neoforge.event.entity.item.ItemTossEvent ev) {
        try {
            var itemEntity = ev.getEntity();
            if (itemEntity != null && isMarkedBook(itemEntity.getItem())) {
                ev.setCanceled(true);
            }
        } catch (Exception e) {
            // 事件 API 变动的兜底：不因监听失败影响游戏
        }
    }

    /**
     * 守护天使以观察者模式登录（2026-08-23，造物主谕「sys 并且登录模式是观察者」）。
     *
     * 守护天使 = 客户端侧 AI 陪玩实体，登录名固定 sys_<owner>（ASCII）。它应在世界旁边
     * 看护主人，而非参与生存：切 SPECTATOR 让它不破坏方块、不拾取掉落、不挨打、不占资源，
     * 只以「守望」姿态存在。配合两个隐形 mixin（实体层 + player_info 名单层），完整形态
     * 是「名单之外、世界之内、主人可见、旁人无感」的观察者。
     *
     * 时机：PlayerLoggedInEvent 在玩家完全加入玩家列表后触发，此时 setGameMode 会向客户端
     * 同步游戏模式包，mineflayer 客户端（守护天使）能正常处理，不影响登录握手。
     */
    private void onPlayerLoggedIn(PlayerEvent.PlayerLoggedInEvent ev) {
        if (ev.getEntity() instanceof ServerPlayer sp) {
            String name = sp.getScoreboardName();
            if (name != null && name.startsWith("sys_")) {
                sp.setGameMode(GameType.SPECTATOR);
            }
        }
    }

    private void onEntityInteract(PlayerInteractEvent.EntityInteract ev) {
        if (!(ev.getTarget() instanceof Villager v)) {
            return;
        }
        var custom = v.getCustomName();
        if (custom == null || custom.getString().isEmpty()) {
            return; // 只记录我们的中文 NPC（铁匠·岳山、神官·静水…），不碰原版村民
        }
        try {
            Path parent = INTERACT_FILE.getParent();
            if (parent != null && !Files.exists(parent)) {
                Files.createDirectories(parent);
            }
            JsonObject o = new JsonObject();
            o.addProperty("ts", System.currentTimeMillis());
            o.addProperty("player", ev.getEntity().getName().getString());
            o.addProperty("npc", custom.getString());
            Files.writeString(INTERACT_FILE, GSON.toJson(o) + System.lineSeparator(),
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException e) {
            // 写盘失败不打断游戏（sidecar 不在线时静默丢弃）
        }
    }

    /**
     * 技能书施法统一入口（2026-08-23 根因修复）。
     *
     * 由 WrittenBookItemMixin @Inject 到 {@code WrittenBookItem.use} HEAD 处调用。
     * 为什么不用 PlayerInteractEvent.RightClickItem：该事件只在「对着空气右键」fire，
     * 玩家拿着书右键地面/方块打开 GUI 时走 useItemOn，不 fire 此事件 → 书右键永远不触发。
     * 而 WrittenBookItem.use 是书被使用的唯一统一入口（对空气/对方块都经过它），
     * 服务端在 HEAD 处检查 custom_data 并写 spell-requests.jsonl。
     *
     * @param player 使用书的玩家
     * @param stack  玩家手上的 ItemStack（WrittenBookItem）
     */
    /** 是否技能书（skillbook 标记）或空白造物卷（craftreq 标记）：右键 = 施法。双端一致——客户端据此取消打开。 */
    public static boolean isSkillBook(ItemStack stack) {
        if (!stack.is(Items.WRITTEN_BOOK)) {
            return false;
        }
        var cd = stack.get(DataComponents.CUSTOM_DATA);
        if (cd == null || cd.isEmpty()) {
            return false;
        }
        try {
            CompoundTag data = cd.getUnsafe();
            if (data == null) {
                return false;
            }
            return data.contains("skillbook") || data.getBoolean("craftreq");
        } catch (Exception e) {
            return false;
        }
    }

    /** 是否神使手札（custom_data.statusbook=true）。双端一致。 */
    public static boolean isStatusBook(ItemStack stack) {
        if (!stack.is(Items.WRITTEN_BOOK)) {
            return false;
        }
        var cd = stack.get(DataComponents.CUSTOM_DATA);
        if (cd == null || cd.isEmpty()) {
            return false;
        }
        try {
            CompoundTag data = cd.getUnsafe();
            return data != null && data.getBoolean("statusbook");
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * 是否受保护的神使手札（custom_data.statusbook=true）：不可丢弃、不可入箱。
     * 2026-08-23 拍板：只有状态书受保护——技能书/空白造物卷是搜集品，
     * 可丢、可入箱、可送人（用户「技能书还得自己去搜集…可以给别人」）。
     */
    public static boolean isMarkedBook(ItemStack stack) {
        if (!stack.is(Items.WRITTEN_BOOK)) {
            return false;
        }
        var cd = stack.get(DataComponents.CUSTOM_DATA);
        if (cd == null || cd.isEmpty()) {
            return false;
        }
        CompoundTag data;
        try {
            data = cd.getUnsafe();
        } catch (Exception e) {
            return false; // 非法 custom_data 视为无标记
        }
        if (data == null) {
            return false;
        }
        return data.getBoolean("statusbook");
    }

    /**
     * 技能书/神使手札使用统一入口。返回 true = 标记书（本次交互被消费，调用方取消打开书 GUI）；
     * false = 普通书，照常打开。
     */
    public static boolean handleSkillBookUse(Player player, ItemStack stack) {
        // 神使手札（statusbook=true）：右键 = 刷新状态（写 status-requests.jsonl，mc-god 回执），不打开书。
        if (isStatusBook(stack)) {
            if (!player.level().isClientSide) {
                appendStatus(player.getName().getString());
                LOGGER.info("[settlementsfix] statusbook request: player={}", player.getName().getString());
            }
            return true;
        }
        if (!isSkillBook(stack)) {
            return false;
        }
        if (player.level().isClientSide) {
            return true; // 客户端不写盘，但仍取消打开
        }
        var cd = stack.get(DataComponents.CUSTOM_DATA);
        CompoundTag data;
        try {
            data = cd.getUnsafe();
        } catch (Exception e) {
            return true;
        }
        if (data == null) {
            return true;
        }
        String playerName = player.getName().getString();
        // 固定技能书：custom_data.skillbook=<id>
        if (data.contains("skillbook")) {
            String skill = data.getString("skillbook");
            if (!skill.isEmpty()) {
                appendSpell("speaker", playerName, "skill", skill);
                LOGGER.info("[settlementsfix] skillbook cast: player={} skill={}", playerName, skill);
            }
            return true;
        }
        // 空白造物卷（合书产物）：custom_data.craftreq=true → 读全书页作为祈愿文
        if (data.getBoolean("craftreq")) {
            StringBuilder sb = new StringBuilder();
            WrittenBookContent content = stack.get(DataComponents.WRITTEN_BOOK_CONTENT);
            if (content != null) {
                for (var filtered : content.pages()) {
                    String raw = filtered.raw().getString();
                    if (raw != null && !raw.isEmpty()) {
                        sb.append(raw).append(' ');
                    }
                }
            }
            String text = sb.toString().trim();
            if (!text.isEmpty()) {
                appendSpell("speaker", playerName, "text", text);
                LOGGER.info("[settlementsfix] craftreq request: player={} len={}", playerName, text.length());
            }
            return true;
        }
        return true;
    }

    private void onItemCrafted(PlayerEvent.ItemCraftedEvent ev) {
        if (ev.getEntity().level().isClientSide) {
            return;
        }
        var result = ev.getCrafting();
        if (!result.is(Items.WRITTEN_BOOK)) {
            return;
        }
        var inv = ev.getInventory();
        if (inv == null) {
            return;
        }
        // 输入含 craftreq 标记的书与笔 → 产物打 craftreq=true（空白造物卷链路）
        boolean src = false;
        for (int i = 0; i < inv.getContainerSize(); i++) {
            var st = inv.getItem(i);
            if (st.is(Items.WRITABLE_BOOK)) {
                var cd = st.get(DataComponents.CUSTOM_DATA);
                if (cd != null && !cd.isEmpty()) {
                    try {
                        CompoundTag d = cd.getUnsafe();
                        if (d != null && d.getBoolean("craftreq")) {
                            src = true;
                            break;
                        }
                    } catch (Exception ignore) {
                        // 非法 custom_data 视为无标记
                    }
                }
            }
        }
        if (src) {
            CustomData cd = result.get(DataComponents.CUSTOM_DATA);
            if (cd == null) {
                cd = CustomData.EMPTY;
            }
            final CustomData fcd = cd;
            result.set(DataComponents.CUSTOM_DATA, fcd.update(j -> j.putBoolean("craftreq", true)));
        }
    }

    /** 追加 {ts, speaker, skill|text} 到 spell-requests.jsonl（每行一个 JSON）。 */
    private static void appendSpell(String... kv) {
        try {
            Path parent = SPELL_FILE.getParent();
            if (parent != null && !Files.exists(parent)) {
                Files.createDirectories(parent);
            }
            JsonObject o = new JsonObject();
            o.addProperty("ts", System.currentTimeMillis());
            for (int i = 0; i + 1 < kv.length; i += 2) {
                o.addProperty(kv[i], kv[i + 1]);
            }
            Files.writeString(SPELL_FILE, GSON.toJson(o) + System.lineSeparator(),
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException e) {
            // 写盘失败不打断游戏
        }
    }

    /** 追加 {ts, speaker} 到 status-requests.jsonl（神使手札右键刷新状态请求）。 */
    private static void appendStatus(String playerName) {
        try {
            Path parent = STATUS_FILE.getParent();
            if (parent != null && !Files.exists(parent)) {
                Files.createDirectories(parent);
            }
            JsonObject o = new JsonObject();
            o.addProperty("ts", System.currentTimeMillis());
            o.addProperty("speaker", playerName);
            Files.writeString(STATUS_FILE, GSON.toJson(o) + System.lineSeparator(),
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException e) {
            // 写盘失败不打断游戏
        }
    }
}
