package org.afuhome.agentfriend;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.random.RandomGenerator;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;

/** One preview and one frozen reward for each authored expedition. */
final class DungeonRelics {
    private static final NamespacedKey ORIGIN = NamespacedKey.fromString("agentfriend:expedition_relic");
    private static final NamespacedKey SPELL = NamespacedKey.fromString("agentfriend:imprint_spell");
    record Relic(String site, String name, Material material, String tactic, int x, int y, int z,
                 ShieldRunes.Rune ward, List<String> spells) {
        boolean melee() { return material.name().endsWith("_SWORD") || material.name().endsWith("_AXE"); }
        String secondary(String main) { return main.equals("frostnova") ? "starbolt" : "frostnova"; }
        String hit(String main) { return main.equals("selfheal") ? "food" : "selfheal"; }

        Map<String,Object> preview(String world, boolean earned, boolean pending) {
            return Map.of("name", name, "itemId", material.getKey().toString(),
                    "unlock", "first_verified_final_room_contribution", "claimed", earned, "pending", pending,
                    "button", Map.of("world",world,"x",x,"y",y,"z",z), "tactic", tactic,
                    "spellOptions", ward == null ? spells : List.of(ward.spell),
                    "trigger", ward != null ? "block_hostile_hit_and_sneak_use"
                            : melee() ? "hit_mainhand_use_mainhand_sneak_use" : "sneak_use_mainhand");
        }
        List<String> instructions() {
            var options = String.join(" 或 ",spells.stream().map(id->SpellGuide.find(id).name()).toList());
            if (ward != null) return ward.hints();
            if (melee()) return List.of("主手装备，副手留空。右键："+options,
                    "潜行右键：霜环或星芒箭", "命中敌怪时可触发圣愈或饱食");
            return List.of("主手装备，潜行＋使用：" + options,
                    "同件装备固定一种刻印；普通攻击或射击照常");
        }
        boolean recognizes(ItemStack stack) {
            return stack != null && stack.getType() == material && stack.getAmount() == 1 && stack.hasItemMeta()
                    && site.equals(stack.getItemMeta().getPersistentDataContainer().get(ORIGIN, PersistentDataType.STRING));
        }
    }

    private static final Map<String,Relic> RELICS = catalog();

    private static Map<String,Relic> catalog() {
        Map<String,Relic> rows = new LinkedHashMap<>();
        add(rows,new Relic("undead_crypt","守墓誓刃",Material.IRON_SWORD,"借石柱挡弓手，近身时用霜环打开缺口。",-425,4,674,null,List.of("frostnova","selfheal")));
        add(rows,new Relic("creeping_crypt","蔓影毒牙",Material.IRON_AXE,"先打投药女巫，留意蜘蛛；不要在狭窄楼梯混战。",1159,45,215,null,List.of("frostnova","blink")));
        add(rows,new Relic("bunker","破垒重弩",Material.CROSSBOW,"贴掩体分批处理弩手，再拉开持斧精英。",-1179,18,-1547,null,List.of("starbolt","frostnova")));
        add(rows,new Relic("illager_camp","黑旗守望盾",Material.SHIELD,"守卫清掉后，对牢笼围栏按使用键救人。",-1080,68,-1116,ShieldRunes.Rune.STONE,List.of()));
        add(rows,new Relic("aincrad_01","起始层破阵剑",Material.DIAMOND_SWORD,"沿前哨、守卫区、领主区推进；首领蓄力时后撤。",856,69,-1147,null,List.of("starbolt","blink")));
        add(rows,new Relic("corsair_cove","黑帆甲板弩",Material.CROSSBOW,"先清甲板远程敌人，靠船缘交战时留出退路。",8216,75,8200,null,List.of("starbolt","feather")));
        add(rows,new Relic("deep_mineworks","深岩镇守盾",Material.SHIELD,"沿矿井平台与楼梯推进，回头检查队友是否跟上。",9745,178,8733,ShieldRunes.Rune.STONE,List.of()));
        add(rows,new Relic("ember_foundry","熔心护炉盾",Material.SHIELD,"带抗火补给；靠近岩浆时稳住站位，霜环可清附近地火。",10245,104,8194,ShieldRunes.Rune.EMBER,List.of()));
        add(rows,new Relic("frost_keep","霜落寒弦",Material.BOW,"先借门框清射手，再在室内集中处理近战敌人。",9753,94,8208,null,List.of("frostnova","starbolt")));
        add(rows,new Relic("jungle_covenant","翠藤引路刃",Material.IRON_SWORD,"先散开再处理祭仪师；看到毒藤黄圈就离开范围。",8212,80,8714,null,List.of("selfheal","frostnova")));
        add(rows,new Relic("sky_watch","云阶流风盾",Material.SHIELD,"沿楼梯走，跨平台前先确认落脚处；别背对悬空边缘。",8750,133,8731,ShieldRunes.Rune.WIND,List.of()));
        add(rows,new Relic("sunken_dynasty","沉沙巡夜弓",Material.BOW,"转角前确认弓手位置，沿楼梯走，留人照看后路。",9217,78,8201,null,List.of("night","starbolt")));
        add(rows,new Relic("tide_sanctum","潮门回潮盾",Material.SHIELD,"尽量在干燥前庭与掩体旁接敌，注意水边溺尸。",8710,73,8199,ShieldRunes.Rune.TIDE,List.of()));
        add(rows,new Relic("void_citadel","虚空折锋",Material.DIAMOND_SWORD,"在紫珀平台中央接敌，用远程压制高台上的守卫。",9217,122,8702,null,List.of("blink","starbolt")));
        add(rows,new Relic("winter_manor","永夜烛影剑",Material.IRON_SWORD,"分清门后和走廊敌人，先处理有投射法术的目标。",10246,77,8732,null,List.of("night","selfheal")));
        return Collections.unmodifiableMap(rows);
    }

    private static void add(Map<String,Relic> catalogue, Relic relic) {
        if (catalogue.putIfAbsent(relic.site, relic) != null) throw new IllegalStateException(relic.site);
    }

    static Relic at(String site) { return RELICS.get(site); }
    static Map<String,Relic> all() { return RELICS; }

    static ItemStack create(Relic relic, int difficulty, RandomGenerator random) {
        ItemStack stack = new ItemStack(relic.material);
        var meta = stack.getItemMeta();
        meta.setDisplayName("§d" + relic.name);
        var lore = new ArrayList<>(List.of("§7千灯纪 · 遗迹秘宝", "§7挑战档位：" + List.of("普通","冒险","末日").get(difficulty)));
        if (relic.ward == null) {
            String spell = relic.spells.get(random.nextInt(relic.spells.size()));
            if (relic.melee()) {
                WeaponEngravings.inscribeRelic(meta,lore,new WeaponSkillRolls.Binding(relic.hit(spell),spell,relic.secondary(spell)));
            } else {
                meta.getPersistentDataContainer().set(SPELL, PersistentDataType.STRING, spell);
                lore.add("§5✦ 法术刻印：" + ShieldRunes.spellLabel(spell));
                lore.add("§7潜行使用：施放刻印法术（主手）");
            }
        }
        meta.setLore(lore);
        meta.getPersistentDataContainer().set(ORIGIN, PersistentDataType.STRING, relic.site);
        meta.addEnchant(org.bukkit.enchantments.Enchantment.UNBREAKING, difficulty + 1, false);
        switch (relic.material) {
            case BOW -> meta.addEnchant(org.bukkit.enchantments.Enchantment.POWER, difficulty + 1, false);
            case CROSSBOW -> meta.addEnchant(org.bukkit.enchantments.Enchantment.QUICK_CHARGE, difficulty + 1, false);
            case SHIELD -> { if (difficulty > 0) meta.addEnchant(org.bukkit.enchantments.Enchantment.MENDING, 1, false); }
            default -> meta.addEnchant(org.bukkit.enchantments.Enchantment.SHARPNESS, difficulty + 1, false);
        }
        meta.setEnchantmentGlintOverride(true);
        stack.setItemMeta(meta);
        return relic.ward == null ? stack : ShieldRunes.engrave(stack, relic.ward);
    }
}
