package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Enemy;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.event.Event.Result;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent.DamageModifier;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;

/** A ward adds a response to a real shield block and keeps ordinary guarding intact. */
final class ShieldRunes implements Listener {
    static final NamespacedKey KEY = NamespacedKey.fromString("agentfriend:shield_rune");
    static final String COST = "9 经验等级 + 3 青金石";
    private static final int BLOCK_COOLDOWN_SECONDS = 12;
    private static final String LORE = "§5护盾刻印 · ";
    private static final String EFFECT_LORE = "§8护盾 · ";

    enum Rune {
        STONE("ward_stone", "坚壁", "frostnova", "抗性 I", PotionEffectType.RESISTANCE, 50, 34),
        TIDE("ward_tide", "回潮", "selfheal", "生命恢复 I", PotionEffectType.REGENERATION, 60, 35),
        WIND("ward_wind", "流风", "feather", "速度 I", PotionEffectType.SPEED, 70, 36),
        EMBER("ward_ember", "熔卫", "frostnova", "抗火", PotionEffectType.FIRE_RESISTANCE, 80, 37);

        final String id, name, spell, effect;
        final PotionEffectType potion;
        final int duration, slot;

        Rune(String id, String name, String spell, String effect, PotionEffectType potion, int duration, int slot) {
            this.id = id;
            this.name = name;
            this.spell = spell;
            this.effect = effect;
            this.potion = potion;
            this.duration = duration;
            this.slot = slot;
        }

        List<String> hints() {
            return List.of("按住使用键正常格挡",
                    "实际挡住敌怪攻击：获得" + effect + " " + duration / 20.0 + "秒，每12秒最多触发一次",
                    "潜行＋使用：" + spellLabel(spell) + "（原魔力和冷却）",
                    "可放副手；面对门、箱子等方块仍可交互");
        }
    }

    private final AgentFriendPlugin plugin;
    private final Map<UUID, Long> blockCooldown = new HashMap<>();
    private Runnable nativeDetach;

    ShieldRunes(AgentFriendPlugin plugin) {
        this.plugin = plugin;
    }

    void start() {
        Bukkit.getPluginManager().registerEvents(this, plugin);
        try {
            attachNativeBlock();
            plugin.getLogger().info("Shield runes use native NeoForge block results.");
        } catch (ClassNotFoundException absent) {
            // Paper emits its own blocking damage modifier.
        } catch (ReflectiveOperationException | LinkageError unavailable) {
            plugin.getLogger().warning("Native shield block unavailable: " + unavailable);
        }
    }

    void stop() {
        if (nativeDetach != null) nativeDetach.run();
        blockCooldown.clear();
    }

    /**
     * Youer can resolve a fully blocked hit before publishing a Bukkit damage event.
     * Listen to the NeoForge result on that runtime without requiring NeoForge on Paper.
     */
    private void attachNativeBlock() throws ReflectiveOperationException {
        Class<?> type = Class.forName("net.neoforged.neoforge.event.entity.living.LivingShieldBlockEvent");
        Class<?> priority = Class.forName("net.neoforged.bus.api.EventPriority");
        Class<?> busApi = Class.forName("net.neoforged.bus.api.IEventBus");
        Object bus = Class.forName("net.neoforged.neoforge.common.NeoForge").getField("EVENT_BUS").get(null);
        Method bukkit = Class.forName("net.minecraft.world.entity.Entity").getMethod("getBukkitEntity");
        Method damageOwner = Class.forName("net.minecraft.world.damagesource.DamageSource").getMethod("getEntity");
        Method owner = type.getMethod("getEntity");
        Method source = type.getMethod("getDamageSource");
        Method cancelled = type.getMethod("isCanceled");
        Method blocked = type.getMethod("getBlocked");
        Method amount = type.getMethod("getBlockedDamage");
        Method unregister = busApi.getMethod("unregister", Object.class);
        Consumer<Object> callback = event -> {
            try {
                if (!Bukkit.isPrimaryThread() || Boolean.TRUE.equals(cancelled.invoke(event))
                        || !Boolean.TRUE.equals(blocked.invoke(event)) || ((Number) amount.invoke(event)).floatValue() <= 0) return;
                if (!(bukkit.invoke(owner.invoke(event)) instanceof Player player)) return;
                Object attacker = damageOwner.invoke(source.invoke(event));
                if (attacker != null && bukkit.invoke(attacker) instanceof Enemy) rewardBlock(player);
            } catch (ReflectiveOperationException | LinkageError problem) {
                if (nativeDetach != null) {
                    Bukkit.getScheduler().runTask(plugin, () -> {
                        if (nativeDetach == null) return;
                        nativeDetach.run();
                        nativeDetach = null;
                        plugin.getLogger().warning("Native shield block detached: " + problem);
                    });
                }
            }
        };
        busApi.getMethod("addListener", priority, boolean.class, Class.class, Consumer.class)
                .invoke(bus, priority.getField("LOWEST").get(null), false, type, callback);
        nativeDetach = () -> {
            try { unregister.invoke(bus, callback); }
            catch (ReflectiveOperationException problem) { plugin.getLogger().warning("Native shield block cleanup: " + problem); }
        };
    }

    static Rune find(String id) {
        return Arrays.stream(Rune.values()).filter(rune -> rune.id.equals(id)).findFirst().orElse(null);
    }

    static Rune at(int slot) {
        return Arrays.stream(Rune.values()).filter(rune -> rune.slot == slot).findFirst().orElse(null);
    }

    static Rune on(ItemStack stack) {
        if (stack == null || stack.getType() != Material.SHIELD || !stack.hasItemMeta()) return null;
        return find(stack.getItemMeta().getPersistentDataContainer().get(KEY, PersistentDataType.STRING));
    }

    static ItemStack engrave(ItemStack original, Rune rune) {
        if (original == null || original.getType() != Material.SHIELD || original.getAmount() != 1)
            throw new IllegalArgumentException("requires_single_shield");
        ItemStack stack = original.clone();
        var meta = stack.getItemMeta();
        var lore = meta.hasLore() ? new ArrayList<>(meta.getLore()) : new ArrayList<String>();
        lore.removeIf(line -> line.startsWith(LORE) || line.startsWith(EFFECT_LORE));
        lore.add(LORE + rune.name);
        rune.hints().forEach(line -> lore.add(EFFECT_LORE + line));
        meta.setLore(lore);
        meta.getPersistentDataContainer().set(KEY, PersistentDataType.STRING, rune.id);
        meta.setEnchantmentGlintOverride(true);
        stack.setItemMeta(meta);
        return stack;
    }

    static String spellLabel(String id) {
        var entry = SpellGuide.find(id);
        return entry == null ? id : entry.name() + " · " + entry.costLine();
    }

    static JsonObject effect(Player player) {
        Rune rune = on(player.getInventory().getItemInMainHand());
        String hand = "mainhand";
        if (rune == null) {
            rune = on(player.getInventory().getItemInOffHand());
            hand = "offhand";
        }
        if (rune == null) return null;
        var result = new JsonObject();
        result.addProperty("id", rune.id);
        result.addProperty("name", rune.name);
        result.addProperty("slot", hand);
        result.addProperty("passive", true);
        result.addProperty("trigger", "block_hostile_hit");
        result.addProperty("effect", rune.effect);
        result.addProperty("durationTicks", rune.duration);
        result.addProperty("cooldownMs", BLOCK_COOLDOWN_SECONDS * 1000);
        result.addProperty("sneakUse", rune.spell);
        return result;
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void use(PlayerInteractEvent event) {
        if (!event.getPlayer().isSneaking() || !event.getAction().isRightClick()
                || event.useItemInHand() == Result.DENY) return;
        if (event.getAction() == Action.RIGHT_CLICK_BLOCK && (event.getClickedBlock() == null
                || event.getClickedBlock().getType().isInteractable() || event.useInteractedBlock() == Result.DENY)) return;
        Rune rune = on(event.getItem());
        if (rune == null || !plugin.nativeRpgMayAct(event.getPlayer())) return;
        event.setUseItemInHand(Result.DENY);
        if (plugin.claimItemCast(event.getPlayer(), 300L)) plugin.cast(event.getPlayer(), rune.spell);
    }

    @SuppressWarnings("deprecation")
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void block(EntityDamageByEntityEvent event) {
        if (!(event.getEntity() instanceof Player player) || !event.isApplicable(DamageModifier.BLOCKING)
                || event.getDamage(DamageModifier.BLOCKING) >= 0) return;
        var damager = event.getDamager();
        if (!(damager instanceof Enemy) && !(damager instanceof Projectile shot && shot.getShooter() instanceof Enemy)) return;
        rewardBlock(player);
    }

    private void rewardBlock(Player player) {
        if (!player.isBlocking() || !plugin.nativeRpgMayAct(player)) return;
        EquipmentSlot hand = player.getHandRaised();
        if (hand != EquipmentSlot.HAND && hand != EquipmentSlot.OFF_HAND) return;
        Rune rune = on(player.getInventory().getItem(hand));
        if (rune == null) return;
        var current = player.getPotionEffect(rune.potion);
        if (current != null && (current.getAmplifier() > 0 || current.getDuration() > rune.duration)) return;
        long now = System.currentTimeMillis();
        if (now < blockCooldown.getOrDefault(player.getUniqueId(), 0L)) return;
        if (!player.addPotionEffect(new PotionEffect(rune.potion, rune.duration, 0))) return;
        blockCooldown.put(player.getUniqueId(), now + BLOCK_COOLDOWN_SECONDS * 1000L);
        player.sendActionBar(net.kyori.adventure.text.Component.text("护盾 · " + rune.name + " · " + rune.effect));
    }

    @EventHandler public void quit(PlayerQuitEvent event) {
        // Keep an unexpired cooldown through a quick reconnect, without retaining offline entries indefinitely.
        long now = System.currentTimeMillis();
        blockCooldown.values().removeIf(expires -> expires <= now);
    }
}
