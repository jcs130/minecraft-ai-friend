package org.afuhome.agentfriend;

import java.util.List;
import java.util.concurrent.ThreadLocalRandom;
import org.bukkit.ChatColor;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;

/** Vanilla-only personal loot shared by Java, Geyser Bedrock and Mineflayer. */
final class DungeonLoot {
    record Bonus(ItemStack item, boolean rare, String label) { }

    /** Guaranteed equipment favors useful iron gear and spell imprints over raw attack power. */
    static Bonus milestone(int floor, int equipmentIndex) {
        return switch (floor) {
            case 4 -> new Bonus(extra(named(Material.IRON_HELMET, "苔原旅盔", "protection", 1,
                    "unbreaking", 1), "respiration", 1), false, "铁盔（呼吸）");
            case 5 -> new Bonus(named(Material.IRON_CHESTPLATE, "遗迹守护甲", "protection", 2,
                    "unbreaking", 1), false, "铁胸甲（保护）");
            case 8 -> new Bonus(named(Material.IRON_LEGGINGS, "雪行护腿", "protection", 2,
                    "unbreaking", 1), false, "铁护腿（保护）");
            case 9 -> new Bonus(extra(named(Material.IRON_BOOTS, "焰路行靴", "protection", 2,
                    "unbreaking", 1), "feather_falling", 2), false, "铁靴（摔落保护）");
            case 6, 10 -> equipmentPiece(equipmentIndex);
            case 12 -> new Bonus(extra(named(Material.IRON_HELMET, "潮汐探路冠",
                    "protection", 2, "unbreaking", 2), "respiration", 2), true, "潮汐探路冠");
            case 14 -> new Bonus(extra(named(Material.IRON_BOOTS, "回廊踏影靴",
                    "protection", 2, "unbreaking", 2), "feather_falling", 3), true, "回廊踏影靴");
            default -> null; // Floors one to three grant supplies; seven is a rest floor.
        };
    }

    /** Small guaranteed supply bundles keep the early floors useful without handing out armor immediately. */
    static List<Bonus> supplies(int floor) {
        return switch (floor) {
            case 1 -> List.of(
                    new Bonus(new ItemStack(Material.COPPER_INGOT, 6), false, "铜锭 ×6（铜主题材料）"),
                    new Bonus(new ItemStack(Material.IRON_INGOT, 3), false, "铁锭 ×3（可合成工具）"),
                    new Bonus(new ItemStack(Material.TORCH, 16), false, "火把 ×16"));
            case 2 -> List.of(
                    new Bonus(new ItemStack(Material.HONEY_BOTTLE, 2), false, "蜂蜜瓶 ×2（战斗补给）"),
                    new Bonus(new ItemStack(Material.GLISTERING_MELON_SLICE, 3), false,
                            "闪烁的西瓜片 ×3（可酿治疗药水）"),
                    new Bonus(new ItemStack(Material.ARROW, 24), false, "箭矢 ×24"));
            case 3 -> List.of(
                    new Bonus(new ItemStack(Material.PUFFERFISH, 2), false,
                            "河豚 ×2（可酿水下呼吸药水）"),
                    new Bonus(new ItemStack(Material.BOW), false, "弓"));
            case 11 -> List.of(new Bonus(new ItemStack(Material.ARROW, 24), false, "箭矢 ×24"),
                    new Bonus(new ItemStack(Material.GOLDEN_APPLE), false, "金苹果"));
            case 12 -> List.of(new Bonus(new ItemStack(Material.COOKED_BEEF, 12), false, "熟牛肉 ×12"),
                    new Bonus(new ItemStack(Material.MAGMA_CREAM, 2), false, "岩浆膏 ×2（抗火酿造材料）"));
            case 14 -> List.of(new Bonus(new ItemStack(Material.EXPERIENCE_BOTTLE, 12), false, "附魔之瓶 ×12"));
            default -> List.of();
        };
    }

    /** Existing persisted index stays stable; each two milestones cycle utility equipment. */
    static Bonus equipmentPiece(int index) {
        int slot = Math.floorMod(index, 4);
        return switch (slot) {
            case 0 -> new Bonus(imprint(named(Material.IRON_SWORD, "赤铜柄·闪现匕首",
                    "sharpness", 1, "unbreaking", 2), "blink",
                    "潜行使用：施放刻印法术 · 4 魔力；遵守冷却"), true, "闪现匕首 · 铁刃铜柄");
            case 1 -> new Bonus(imprint(named(Material.IRON_SWORD, "寒霜剑",
                    "sharpness", 2, "unbreaking", 2), "frostnova",
                    "潜行使用：施放刻印法术 · 7 魔力；遵守冷却"), true, "寒霜剑 · 霜环刻印");
            case 2 -> new Bonus(named(Material.SHIELD, "赤铜纹战盾", "unbreaking", 2,
                    "mending", 1), true, "赤铜纹战盾");
            default -> new Bonus(extra(named(Material.IRON_BOOTS, "踏影铁靴",
                    "protection", 2, "unbreaking", 2), "feather_falling", 2), true, "踏影铁靴");
        };
    }

    static Bonus roll(int floor, int floorsWithoutRare, int difficulty) {
        ThreadLocalRandom random = ThreadLocalRandom.current();
        boolean rare = floorsWithoutRare >= Math.max(3, 6 - difficulty)
                || random.nextInt(100) < Math.min(42, 7 + floor + difficulty * 5);
        if (floor <= 3) return rare ? earlyRare(random.nextInt(4)) : common(random.nextInt(6));
        if (rare) return improve(rare(floor, random.nextInt(10)), difficulty);
        if (random.nextInt(100) < 55) return uncommon(random.nextInt(9));
        return common(random.nextInt(6));
    }

    private static Bonus improve(Bonus bonus, int difficulty) {
        if (difficulty <= 0) return bonus;
        ItemStack item = bonus.item().clone();
        if (item.getType().getMaxDurability() == 0 || !item.hasItemMeta()) return bonus;
        ItemMeta meta = item.getItemMeta();
        for (var enchant : meta.getEnchants().entrySet()) {
            int level = Math.min(enchant.getKey().getMaxLevel(), enchant.getValue() + difficulty);
            if (level > enchant.getValue()) {
                meta.addEnchant(enchant.getKey(), level, false);
                item.setItemMeta(meta);
                return new Bonus(item, true, bonus.label() + " · "
                        + (difficulty == 1 ? "冒险" : "末日") + "强化");
            }
        }
        return bonus;
    }

    private static Bonus earlyRare(int pick) {
        return switch (pick) {
            case 0 -> new Bonus(new ItemStack(Material.COPPER_INGOT, 8), true, "铜锭 ×8");
            case 1 -> new Bonus(new ItemStack(Material.IRON_INGOT, 5), true, "铁锭 ×5");
            case 2 -> new Bonus(new ItemStack(Material.GOLDEN_APPLE), true, "金苹果");
            default -> new Bonus(new ItemStack(Material.EXPERIENCE_BOTTLE, 8), true,
                    "稀有附魔之瓶 ×8");
        };
    }

    private static Bonus common(int pick) {
        return switch (pick) {
            case 0 -> new Bonus(new ItemStack(Material.ARROW, 16), false, "箭矢 ×16");
            case 1 -> new Bonus(new ItemStack(Material.IRON_INGOT, 4), false, "铁锭 ×4");
            case 2 -> new Bonus(new ItemStack(Material.LAPIS_LAZULI, 8), false, "青金石 ×8");
            case 3 -> new Bonus(new ItemStack(Material.EXPERIENCE_BOTTLE, 4), false, "附魔之瓶 ×4");
            case 4 -> new Bonus(new ItemStack(Material.GOLDEN_APPLE), false, "金苹果");
            default -> new Bonus(new ItemStack(Material.TORCH, 16), false, "火把 ×16");
        };
    }

    private static Bonus uncommon(int pick) {
        return switch (pick) {
            case 0 -> new Bonus(named(Material.IRON_HELMET, "冒险者铁盔", "protection", 2,
                    "unbreaking", 1), false, "附魔铁盔");
            case 1 -> new Bonus(named(Material.IRON_CHESTPLATE, "冒险者胸甲", "protection", 2,
                    "unbreaking", 1), false, "附魔铁胸甲");
            case 2 -> new Bonus(named(Material.IRON_LEGGINGS, "冒险者护腿", "protection", 2,
                    "unbreaking", 1), false, "附魔铁护腿");
            case 3 -> new Bonus(named(Material.IRON_BOOTS, "守护铁靴", "protection", 2,
                    "unbreaking", 1), false, "附魔铁靴");
            case 4 -> new Bonus(named(Material.IRON_SWORD, "冒险者铁剑", "sharpness", 2,
                    "unbreaking", 1), false, "附魔铁剑");
            case 5 -> new Bonus(named(Material.IRON_PICKAXE, "冒险者矿镐", "efficiency", 2,
                    "unbreaking", 1), false, "附魔铁镐");
            case 6 -> new Bonus(named(Material.IRON_AXE, "冒险者战斧", "sharpness", 2,
                    "unbreaking", 1), false, "附魔铁斧");
            case 7 -> new Bonus(named(Material.CROSSBOW, "迅发弩", "quick_charge", 1,
                    "unbreaking", 1), false, "附魔弩");
            default -> new Bonus(named(Material.SHIELD, "远征盾", "unbreaking", 2,
                    "mending", 1), false, "附魔盾牌");
        };
    }

    private static Bonus rare(int floor, int pick) {
        return switch (pick) {
            case 0, 1 -> equipmentPiece(pick);
            case 2 -> equipmentPiece(2);
            case 3 -> new Bonus(named(Material.IRON_CHESTPLATE, "铜纹守护甲", "protection", 2,
                    "unbreaking", 2), true, "铜纹守护甲");
            case 4 -> new Bonus(named(Material.IRON_PICKAXE, "星矿镐", "efficiency", 3,
                    "unbreaking", 2), true, "星矿镐");
            case 5 -> new Bonus(named(Material.BOW, "夜空之弦", "power", 2,
                    "unbreaking", 2), true, "夜空之弦");
            case 6 -> new Bonus(new ItemStack(Material.GOLDEN_APPLE), true, "金苹果");
            case 7 -> new Bonus(new ItemStack(Material.IRON_INGOT, 6), true, "铁锭 ×6");
            case 8 -> new Bonus(new ItemStack(Material.COPPER_INGOT, 12), true, "铜锭 ×12");
            default -> floor >= 11
                    ? new Bonus(named(Material.CROSSBOW, "机关弩", "quick_charge", 2,
                            "unbreaking", 2), true, "机关弩")
                    : new Bonus(new ItemStack(Material.LAPIS_LAZULI, 12), true, "青金石 ×12");
        };
    }

    /** First boss clear has a unique weapon; repeat clears rotate useful boss caches. */
    static Bonus bossCache(int clears) {
        if (clears == 0) return new Bonus(bossRelic(), true, "首通武器 · 深渊裁决");
        return switch ((clears - 1) % 3) {
            case 0 -> equipmentPiece(0);
            case 1 -> equipmentPiece(1);
            default -> new Bonus(named(Material.IRON_AXE, "深渊破壁斧", "sharpness", 3,
                    "unbreaking", 2), true, "深渊破壁斧");
        };
    }

    static Bonus finalCache(int clears) {
        if (clears == 0) return new Bonus(named(Material.DIAMOND_SWORD, "星灯誓约",
                "sharpness", 3, "unbreaking", 2), true, "首通武器 · 星灯誓约");
        return switch ((clears - 1) % 3) {
            case 0 -> equipmentPiece(0);
            case 1 -> equipmentPiece(1);
            default -> new Bonus(named(Material.IRON_SWORD, "千灯·破晓", "sharpness", 3,
                    "unbreaking", 2), true, "千灯·破晓");
        };
    }

    static ItemStack bossRelic() {
        return named(Material.IRON_SWORD, "深渊裁决", "sharpness", 3,
                "unbreaking", 2);
    }

    private static ItemStack imprint(ItemStack item, String spell, String use) {
        ItemMeta meta = item.getItemMeta();
        meta.getPersistentDataContainer().set(NamespacedKey.fromString("agentfriend:imprint_spell"),
                PersistentDataType.STRING, spell);
        meta.setLore(List.of(ChatColor.GRAY + "千灯纪试炼战利品", ChatColor.DARK_PURPLE + "✦ 法术刻印："
                + (spell.equals("blink") ? "闪现" : "霜环"), ChatColor.GRAY + use));
        item.setItemMeta(meta);
        return item;
    }

    private static ItemStack named(Material material, String name,
            String first, int firstLevel, String second, int secondLevel) {
        ItemStack item = new ItemStack(material);
        ItemMeta meta = item.getItemMeta();
        meta.setDisplayName(ChatColor.LIGHT_PURPLE + name);
        meta.setLore(List.of(ChatColor.GRAY + "千灯纪试炼战利品"));
        enchant(meta, first, firstLevel);
        enchant(meta, second, secondLevel);
        item.setItemMeta(meta);
        return item;
    }

    private static ItemStack extra(ItemStack item, String enchantment, int level) {
        ItemMeta meta = item.getItemMeta();
        enchant(meta, enchantment, level);
        item.setItemMeta(meta);
        return item;
    }

    private static void enchant(ItemMeta meta, String name, int level) {
        Enchantment enchantment = Enchantment.getByKey(NamespacedKey.minecraft(name));
        if (enchantment == null || !meta.addEnchant(enchantment, level, false))
            throw new IllegalStateException("Unsupported dungeon enchantment: " + name);
    }

    private DungeonLoot() { }
}
