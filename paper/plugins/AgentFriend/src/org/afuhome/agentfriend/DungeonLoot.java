package org.afuhome.agentfriend;

import java.util.List;
import java.util.concurrent.ThreadLocalRandom;
import org.bukkit.ChatColor;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

/** Vanilla-only personal loot shared by Java, Geyser Bedrock and Mineflayer. */
final class DungeonLoot {
    record Bonus(ItemStack item, boolean rare, String label) { }

    /** Early floors teach crafting and preparation; the first full run still grants an iron set. */
    static Bonus milestone(int floor, int diamondIndex) {
        return switch (floor) {
            case 4 -> new Bonus(extra(named(Material.IRON_HELMET, "苔原旅盔", "protection", 1,
                    "unbreaking", 1), "respiration", 1), false, "铁盔（呼吸）");
            case 5 -> new Bonus(named(Material.IRON_CHESTPLATE, "遗迹守护甲", "protection", 2,
                    "unbreaking", 1), false, "铁胸甲（保护）");
            case 8 -> new Bonus(named(Material.IRON_LEGGINGS, "雪行护腿", "protection", 2,
                    "unbreaking", 1), false, "铁护腿（保护）");
            case 9 -> new Bonus(extra(named(Material.IRON_BOOTS, "焰路行靴", "protection", 2,
                    "unbreaking", 1), "feather_falling", 2), false, "铁靴（摔落保护）");
            case 6, 10 -> diamondPiece(diamondIndex);
            case 12 -> new Bonus(extra(named(Material.DIAMOND_HELMET, "潮汐探路冠",
                    "protection", 3, "unbreaking", 2), "respiration", 2), true, "潮汐探路冠");
            case 14 -> new Bonus(extra(named(Material.DIAMOND_BOOTS, "回廊踏影靴",
                    "protection", 3, "unbreaking", 2), "feather_falling", 3), true, "回廊踏影靴");
            default -> null; // Floors one to three grant supplies; seven is a rest floor.
        };
    }

    /** Small guaranteed supply bundles keep the early floors useful without handing out armor immediately. */
    static List<Bonus> supplies(int floor) {
        return switch (floor) {
            case 1 -> List.of(
                    new Bonus(new ItemStack(Material.IRON_INGOT, 6), false, "铁锭 ×6（可合成装备）"),
                    new Bonus(new ItemStack(Material.TORCH, 16), false, "火把 ×16"));
            case 2 -> List.of(
                    new Bonus(new ItemStack(Material.GOLDEN_APPLE), false, "金苹果（战斗恢复）"),
                    new Bonus(new ItemStack(Material.GLISTERING_MELON_SLICE, 3), false,
                            "闪烁的西瓜片 ×3（可酿治疗药水）"),
                    new Bonus(new ItemStack(Material.ARROW, 24), false, "箭矢 ×24"));
            case 3 -> List.of(
                    new Bonus(new ItemStack(Material.PUFFERFISH, 2), false,
                            "河豚 ×2（可酿水下呼吸药水）"),
                    new Bonus(new ItemStack(Material.BOW), false, "弓"));
            case 11 -> List.of(new Bonus(new ItemStack(Material.ARROW, 32), false, "箭矢 ×32"),
                    new Bonus(new ItemStack(Material.GOLDEN_APPLE, 2), false, "金苹果 ×2"));
            case 12 -> List.of(new Bonus(new ItemStack(Material.COOKED_BEEF, 12), false, "熟牛肉 ×12"),
                    new Bonus(new ItemStack(Material.MAGMA_CREAM, 2), false, "岩浆膏 ×2（抗火酿造材料）"));
            case 14 -> List.of(new Bonus(new ItemStack(Material.EXPERIENCE_BOTTLE, 12), false, "附魔之瓶 ×12"));
            default -> List.of();
        };
    }

    /** Two deep milestones per complete run; after four pieces, enchantment tier improves. */
    static Bonus diamondPiece(int index) {
        int slot = Math.floorMod(index, 4);
        int tier = Math.min(2, Math.max(0, index / 4));
        int protection = 2 + tier;
        int unbreaking = 1 + tier;
        ItemStack item = switch (slot) {
            case 0 -> extra(named(Material.DIAMOND_HELMET, "星辉冠", "protection", protection,
                    "unbreaking", unbreaking), "respiration", 1 + tier);
            case 1 -> named(Material.DIAMOND_CHESTPLATE, "星辉甲", "protection", protection,
                    "unbreaking", unbreaking);
            case 2 -> named(Material.DIAMOND_LEGGINGS, "星辉护腿", "protection", protection,
                    "unbreaking", unbreaking);
            default -> extra(named(Material.DIAMOND_BOOTS, "星辉靴", "protection", protection,
                    "unbreaking", unbreaking), "feather_falling", 2 + tier);
        };
        return new Bonus(item, true, "星辉钻石套装 " + (slot + 1) + "/4 · 阶 " + (tier + 1));
    }

    static Bonus roll(int floor, int floorsWithoutRare, int difficulty) {
        ThreadLocalRandom random = ThreadLocalRandom.current();
        boolean rare = floorsWithoutRare >= Math.max(2, 4 - difficulty)
                || random.nextInt(100) < Math.min(75, 12 + 2 * floor + difficulty * 14);
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
            case 0 -> new Bonus(new ItemStack(Material.DIAMOND), true, "稀有钻石 ×1");
            case 1 -> new Bonus(new ItemStack(Material.IRON_INGOT, 8), true, "稀有铁锭 ×8");
            case 2 -> new Bonus(new ItemStack(Material.GOLDEN_APPLE, 2), true, "稀有金苹果 ×2");
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
        int tier = floor >= 8 ? 1 : 0;
        return switch (pick) {
            case 0, 1, 2, 3 -> diamondPiece(tier * 4 + pick);
            case 4 -> new Bonus(named(Material.DIAMOND_SWORD, "千灯·破晓", "sharpness",
                    floor >= 8 ? 4 : 3, "unbreaking", 2), true, "稀有附魔钻石剑");
            case 5 -> new Bonus(named(Material.DIAMOND_PICKAXE, "星矿镐", "efficiency", 4,
                    "unbreaking", 2), true, "稀有附魔钻石镐");
            case 6 -> new Bonus(new ItemStack(Material.TOTEM_OF_UNDYING), true, "稀有不死图腾");
            case 7 -> new Bonus(named(Material.BOW, "夜空之弦", "power", 4,
                    "unbreaking", 2), true, "稀有附魔弓");
            case 8 -> new Bonus(named(Material.TRIDENT, "海渊之矛", "loyalty", 2,
                    "unbreaking", 2), true, "稀有附魔三叉戟");
            default -> new Bonus(new ItemStack(Material.ENCHANTED_GOLDEN_APPLE), true, "附魔金苹果");
        };
    }

    /** First boss clear has a unique weapon; repeat clears rotate useful boss caches. */
    static Bonus bossCache(int clears) {
        if (clears == 0) return new Bonus(bossRelic(), true, "首通武器 · 深渊裁决");
        return switch ((clears - 1) % 3) {
            case 0 -> new Bonus(new ItemStack(Material.TOTEM_OF_UNDYING), true, "不死图腾");
            case 1 -> new Bonus(new ItemStack(Material.ENCHANTED_GOLDEN_APPLE), true, "附魔金苹果");
            default -> new Bonus(named(Material.DIAMOND_AXE, "深渊破壁斧", "sharpness", 4,
                    "unbreaking", 3), true, "深渊破壁斧");
        };
    }

    static Bonus finalCache(int clears) {
        if (clears == 0) return new Bonus(named(Material.NETHERITE_SWORD, "星灯誓约",
                "sharpness", 4, "unbreaking", 3), true, "首通武器 · 星灯誓约");
        return switch ((clears - 1) % 3) {
            case 0 -> new Bonus(new ItemStack(Material.TOTEM_OF_UNDYING), true, "不死图腾");
            case 1 -> new Bonus(new ItemStack(Material.ENCHANTED_GOLDEN_APPLE), true, "附魔金苹果");
            default -> new Bonus(named(Material.DIAMOND_SWORD, "千灯·破晓", "sharpness", 4,
                    "unbreaking", 2), true, "附魔钻石剑");
        };
    }

    static ItemStack bossRelic() {
        return named(Material.DIAMOND_SWORD, "深渊裁决", "sharpness", 4,
                "unbreaking", 3);
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
