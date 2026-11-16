package org.afuhome.agentfriend;

import io.papermc.paper.event.player.PrePlayerAttackEntityEvent;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.attribute.Attribute;
import org.bukkit.entity.Enemy;
import org.bukkit.entity.Player;
import org.bukkit.event.Event.Result;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent.DamageCause;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.potion.PotionEffectType;
import static org.afuhome.agentfriend.WeaponSkillRolls.Binding;

/** Item-bound combat shortcuts. All effects go through the existing spell dispatcher. */
final class WeaponEngravings implements Listener {
    static final int LEVELS = 9;
    static final int LAPIS = 3;
    static final String COST = LEVELS + " 经验等级 + " + LAPIS + " 青金石";
    private static final String LORE_PREFIX = "§5✦ 武器刻印 · ";
    private static final String BINDING_LORE = "§8┆ ";
    private static final List<NamespacedKey> VORTEX_IDS = List.of(
            NamespacedKey.fromString("vortexrpg:vortex_item_id"),
            NamespacedKey.fromString("vortexrpg:profession_item_id"),
            NamespacedKey.fromString("vortexrpg:fracture_item_id"));

    enum Preset {
        GUARD("guard", "守卫", new Binding("selfheal", "starbolt", "frostnova"), Material.SHIELD, 30),
        RANDOM("random", "随机", null, Material.ENCHANTED_BOOK, 31),
        SKIRMISH("skirmish", "疾行", new Binding("selfheal", "frostnova", "blink"), Material.ENDER_PEARL, 32);

        final String id, title;
        final Binding binding;
        final Material icon;
        final int slot;

        Preset(String id, String title, Binding binding, Material icon, int slot) {
            this.id = id;
            this.title = title;
            this.binding = binding;
            this.icon = icon;
            this.slot = slot;
        }

        List<String> hints() {
            if (binding == null) return List.of("从通用技和本人已学职业技抽取三个不同技能",
                    "普攻命中位抽取恢复或夜视，右键和潜行右键各抽一项主动技");
            return lines(binding, Map.of());
        }

        static Preset find(String id) {
            for (Preset preset : values()) if (preset.id.equals(id)) return preset;
            return null;
        }

        static Preset at(int slot) {
            for (Preset preset : values()) if (preset.slot == slot) return preset;
            return null;
        }
    }

    private record Attack(UUID target, int tick, int slot, Material weapon, Binding binding) { }

    private final AgentFriendPlugin plugin;
    private final NamespacedKey presetKey;
    private final NamespacedKey bindingKey;
    private final NamespacedKey legacyImprintKey;
    private final Map<UUID, Attack> attacks = new HashMap<>();

    WeaponEngravings(AgentFriendPlugin plugin, NamespacedKey legacyImprintKey) {
        this.plugin = plugin;
        this.legacyImprintKey = legacyImprintKey;
        presetKey = new NamespacedKey(plugin, "weapon_spell_preset");
        bindingKey = new NamespacedKey(plugin, "weapon_spell_combo_v1");
        Bukkit.getPluginManager().registerEvents(this, plugin);
    }

    boolean canEngrave(ItemStack stack) {
        if (stack == null || stack.getAmount() != 1) return false;
        String type = stack.getType().name();
        if (!type.endsWith("_SWORD") && !type.endsWith("_AXE")) return false;
        if (!stack.hasItemMeta()) return true;
        var tags = stack.getItemMeta().getPersistentDataContainer();
        return !tags.has(legacyImprintKey) && VORTEX_IDS.stream().noneMatch(tags::has);
    }

    Preset preset(ItemStack stack) {
        if (!canEngrave(stack) || !stack.hasItemMeta()) return null;
        return Preset.find(stack.getItemMeta().getPersistentDataContainer().get(presetKey, PersistentDataType.STRING));
    }

    Binding binding(ItemStack stack) {
        if (!canEngrave(stack) || !stack.hasItemMeta()) return null;
        var data = stack.getItemMeta().getPersistentDataContainer();
        String raw = data.get(bindingKey, PersistentDataType.STRING);
        if (raw != null) return WeaponSkillRolls.decode(raw);
        Preset old = Preset.find(data.get(presetKey, PersistentDataType.STRING));
        return old == null ? null : old.binding;
    }

    ItemStack engraved(Player player, ItemStack original, Preset preset) {
        if (preset.binding != null) return engrave(original, preset.binding, preset, Map.of());
        var known = new java.util.LinkedHashMap<String, String>();
        var rpg = plugin.nativeRpg();
        if (rpg.selected()) rpg.classSpells(rpg.state(player)).forEach(spell -> known.put(spell.id(), spell.name()));
        Binding next = WeaponSkillRolls.roll(List.copyOf(known.keySet()), binding(original), ThreadLocalRandom.current());
        return engrave(original, next, preset, known);
    }

    DungeonLoot.Bonus reward(Player player, DungeonLoot.Bonus bonus, int floor) {
        if (!canEngrave(bonus.item()) || binding(bonus.item()) != null
                || ThreadLocalRandom.current().nextInt(100) >= WeaponSkillRolls.rewardChance(floor, bonus.tier())) return bonus;
        return new DungeonLoot.Bonus(engraved(player, bonus.item(), Preset.RANDOM), bonus.rare(),
                bonus.label() + " · 随机技能刻印", bonus.tier());
    }

    String receipt(ItemStack item) {
        Binding binding = binding(item);
        return binding == null ? "" : " weaponHit=" + binding.hit() + " weaponUse=" + binding.use()
                + " weaponSneakUse=" + binding.sneakUse();
    }

    private ItemStack engrave(ItemStack original, Binding binding, Preset preset, Map<String, String> known) {
        ItemStack stack = original.clone();
        var meta = stack.getItemMeta();
        List<String> lore = meta.hasLore() ? new ArrayList<>(meta.getLore()) : new ArrayList<>();
        Preset previous = preset(original);
        if (previous != null) {
            lore.remove(LORE_PREFIX + previous.title);
            if (previous.binding != null) {
                lore.remove("§7命中敌怪且缺血时 · 圣愈术");
                lore.remove("§7右键 · " + name(previous.binding.use(), Map.of()));
                lore.remove("§7潜行右键 · " + name(previous.binding.sneakUse(), Map.of()));
                lore.remove("§7主手持剑；右键施法时腾空副手");
            }
            lore.removeIf(line -> line.startsWith(BINDING_LORE));
        }
        lore.add(LORE_PREFIX + preset.title);
        for (String label : lines(binding, known)) lore.add(BINDING_LORE + label);
        meta.setLore(lore);
        meta.getPersistentDataContainer().set(presetKey, PersistentDataType.STRING, preset.id);
        meta.getPersistentDataContainer().set(bindingKey, PersistentDataType.STRING, binding.encode());
        meta.setEnchantmentGlintOverride(true);
        stack.setItemMeta(meta);
        return stack;
    }

    private static List<String> lines(Binding binding, Map<String, String> known) {
        String condition = switch (binding.hit()) {
            case "selfheal" -> "缺血";
            case "food" -> "饥饿";
            default -> "在暗处且没有夜视";
        };
        return List.of("命中敌怪且" + condition + " · " + name(binding.hit(), known),
                "右键 · " + name(binding.use(), known),
                "潜行右键 · " + name(binding.sneakUse(), known),
                "主手持武器，副手留空。战斧朝空处使用",
                "职业技能依照本人职业与学习进度");
    }

    private static String name(String id, Map<String, String> known) {
        var common = SpellGuide.find(id);
        return common != null ? common.name() : known.getOrDefault(id, id);
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void use(PlayerInteractEvent event) {
        if (event.getHand() != EquipmentSlot.HAND || !event.getAction().isRightClick()
                || event.useItemInHand() == Result.DENY) return;
        if (event.getAction() == Action.RIGHT_CLICK_BLOCK && (event.useInteractedBlock() == Result.DENY
                || event.getClickedBlock() == null || event.getClickedBlock().getType().isInteractable())) return;
        Player player = event.getPlayer();
        if (!player.getInventory().getItemInOffHand().getType().isAir()) return;
        ItemStack item = event.getItem();
        Binding binding = binding(item);
        if (binding == null || !plugin.nativeRpgMayAct(player)) return;
        if (event.getAction() == Action.RIGHT_CLICK_BLOCK && item.getType().name().endsWith("_AXE")) return;
        event.setUseItemInHand(Result.DENY);
        if (plugin.claimItemCast(player, 300L)) plugin.cast(player, binding.spell(player.isSneaking()));
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void attack(PrePlayerAttackEntityEvent event) {
        Player player = event.getPlayer();
        UUID id = player.getUniqueId();
        attacks.remove(id);
        if (!event.willAttack() || !(event.getAttacked() instanceof Enemy)) return;
        ItemStack stack = player.getInventory().getItemInMainHand();
        Binding binding = binding(stack);
        if (binding == null || !canProc(player, binding.hit())) return;
        attacks.put(id, new Attack(event.getAttacked().getUniqueId(), Bukkit.getCurrentTick(),
                player.getInventory().getHeldItemSlot(), stack.getType(), binding));
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void damage(EntityDamageByEntityEvent event) {
        if (!(event.getDamager() instanceof Player player) || event.getCause() != DamageCause.ENTITY_ATTACK
                || event.getFinalDamage() <= 0) return;
        UUID id = player.getUniqueId();
        Attack attack = attacks.get(id);
        if (attack == null || attack.tick() != Bukkit.getCurrentTick()
                || !attack.target().equals(event.getEntity().getUniqueId())) return;
        attacks.remove(id);
        // Resolve only after the hit. Skill-generated damage and sweep hits cannot arm another cast.
        var world = player.getWorld();
        Bukkit.getScheduler().runTask(plugin, () -> {
            var inventory = player.getInventory();
            ItemStack held = inventory.getItemInMainHand();
            if (player.getWorld() == world && inventory.getHeldItemSlot() == attack.slot()
                    && held.getType() == attack.weapon() && attack.binding().equals(binding(held))
                    && canProc(player, attack.binding().hit()) && plugin.claimItemCast(player, 1500L))
                plugin.cast(player, attack.binding().hit());
        });
    }

    private boolean canProc(Player player, String spell) {
        if (!plugin.nativeRpgMayAct(player)) return false;
        var max = player.getAttribute(Attribute.GENERIC_MAX_HEALTH);
        boolean useful = switch (spell) {
            case "selfheal" -> max != null && player.getHealth() < max.getValue();
            case "food" -> player.getFoodLevel() <= 17;
            case "night" -> !player.hasPotionEffect(PotionEffectType.NIGHT_VISION)
                    && player.getLocation().getBlock().getLightLevel() <= 7;
            default -> false;
        };
        if (!useful) return false;
        Long cooldown = plugin.readBasicCooldown(player, spell);
        return cooldown != null && cooldown == 0L;
    }

    @EventHandler public void quit(PlayerQuitEvent event) { attacks.remove(event.getPlayer().getUniqueId()); }
}
