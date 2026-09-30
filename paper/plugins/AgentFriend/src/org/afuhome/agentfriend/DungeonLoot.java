package org.afuhome.agentfriend;

import java.util.List;
import java.util.concurrent.ThreadLocalRandom;
import org.bukkit.ChatColor;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

/** Vanilla-only personal loot: guaranteed floor supplies remain in DungeonManager. */
final class DungeonLoot {
    record Bonus(ItemStack item, boolean rare, String label) { }

    static Bonus roll(int floor, int floorsWithoutRare) {
        ThreadLocalRandom random = ThreadLocalRandom.current();
        boolean rare = floorsWithoutRare >= 4 || random.nextInt(100) < 10 + 2 * floor;
        if (rare) return rare(floor, random.nextInt(floor >= 5 ? 5 : floor >= 3 ? 4 : 2));
        if (random.nextInt(100) < 38) return uncommon(random.nextInt(4));
        return common(random.nextInt(5));
    }

    private static Bonus common(int pick) {
        return switch (pick) {
            case 0 -> new Bonus(new ItemStack(Material.ARROW, 8), false, "箭矢 ×8");
            case 1 -> new Bonus(new ItemStack(Material.IRON_INGOT, 2), false, "铁锭 ×2");
            case 2 -> new Bonus(new ItemStack(Material.LAPIS_LAZULI, 4), false, "青金石 ×4");
            case 3 -> new Bonus(new ItemStack(Material.EXPERIENCE_BOTTLE, 2), false, "附魔之瓶 ×2");
            default -> new Bonus(new ItemStack(Material.BREAD, 4), false, "面包 ×4");
        };
    }

    private static Bonus uncommon(int pick) {
        return switch (pick) {
            case 0 -> new Bonus(named(Material.IRON_SWORD, "冒险者铁剑", "sharpness", 1,
                    "unbreaking", 1), false, "附魔铁剑");
            case 1 -> new Bonus(named(Material.IRON_BOOTS, "守护铁靴", "protection", 2,
                    "unbreaking", 1), false, "附魔铁靴");
            case 2 -> new Bonus(named(Material.CROSSBOW, "迅发弩", "quick_charge", 1,
                    "unbreaking", 1), false, "附魔弩");
            default -> new Bonus(new ItemStack(Material.GOLDEN_APPLE), false, "金苹果");
        };
    }

    private static Bonus rare(int floor, int pick) {
        if (floor <= 2) return pick == 0
                ? new Bonus(named(Material.IRON_SWORD, "晨光之刃", "sharpness", 2,
                    "unbreaking", 2), true, "稀有附魔铁剑")
                : new Bonus(named(Material.BOW, "星弦", "power", 2,
                    "unbreaking", 2), true, "稀有附魔弓");
        return switch (pick) {
            case 0 -> new Bonus(named(Material.DIAMOND_SWORD, "千灯·破晓", "sharpness",
                    floor >= 5 ? 3 : 2, "unbreaking", 2), true, "稀有附魔钻石剑");
            case 1 -> new Bonus(named(Material.DIAMOND_PICKAXE, "星矿镐", "efficiency", 3,
                    "unbreaking", 2), true, "稀有附魔钻石镐");
            case 2 -> new Bonus(new ItemStack(Material.TOTEM_OF_UNDYING), true, "稀有不死图腾");
            case 3 -> new Bonus(named(Material.BOW, "夜空之弦", "power", 3,
                    "unbreaking", 2), true, "稀有附魔弓");
            default -> new Bonus(named(Material.TRIDENT, "海渊之矛", "loyalty", 2,
                    "unbreaking", 2), true, "稀有附魔三叉戟");
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

    private static void enchant(ItemMeta meta, String name, int level) {
        Enchantment enchantment = Enchantment.getByKey(NamespacedKey.minecraft(name));
        if (enchantment == null || !meta.addEnchant(enchantment, level, false))
            throw new IllegalStateException("Unsupported dungeon enchantment: " + name);
    }

    private DungeonLoot() { }
}
