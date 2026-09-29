package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.nisovin.magicspells.MagicSpells;
import com.nisovin.magicspells.Spell;
import com.nisovin.magicspells.Spellbook;
import dev.aurelium.auraskills.api.AuraSkillsApi;
import dev.aurelium.auraskills.api.ability.Ability;
import dev.aurelium.auraskills.api.mana.ManaAbility;
import dev.aurelium.auraskills.api.registry.NamespacedId;
import dev.aurelium.auraskills.api.skill.Skill;
import dev.aurelium.auraskills.api.user.SkillsUser;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.HashSet;
import java.util.UUID;
import java.util.regex.Pattern;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerRegisterChannelEvent;
import org.bukkit.scheduler.BukkitTask;

/** Sends each online player their own bounded viewer state over a plugin channel. */
final class ViewerStatePublisher implements Listener {
    static final String CHANNEL = "mcviewer:state";
    static final String LEGACY_CHANNEL = "corti:viewer_state";
    static final int MAX_BYTES = 16_384;
    private static final int MAX_ENTRIES = 24;
    private static final long HEARTBEAT_MS = 5_000L;
    private static final Pattern VALID_ID = Pattern.compile("[a-z0-9_:.-]+");
    private static final Locale LABEL_LOCALE = Locale.SIMPLIFIED_CHINESE;
    private final AgentFriendPlugin plugin;
    private final CombatSpells combatSpells;
    private final ProspectingSpell prospectingSpell;
    private BukkitTask pollTask;
    private final Map<UUID, LastState> lastStates = new HashMap<>();
    private final Set<UUID> pendingInitial = new HashSet<>();

    private record LastState(String json, String channel, long sentAt) {}

    ViewerStatePublisher(AgentFriendPlugin plugin, CombatSpells combatSpells, ProspectingSpell prospectingSpell) {
        this.plugin = plugin;
        this.combatSpells = combatSpells;
        this.prospectingSpell = prospectingSpell;
    }

    void start() {
        Bukkit.getMessenger().registerOutgoingPluginChannel(plugin, CHANNEL);
        Bukkit.getMessenger().registerOutgoingPluginChannel(plugin, LEGACY_CHANNEL);
        Bukkit.getPluginManager().registerEvents(this, plugin);
        pollTask = Bukkit.getScheduler().runTaskTimer(plugin, this::poll, 1L, 5L);
    }

    void stop() {
        if (pollTask != null) pollTask.cancel();
        Bukkit.getMessenger().unregisterOutgoingPluginChannel(plugin, CHANNEL);
        Bukkit.getMessenger().unregisterOutgoingPluginChannel(plugin, LEGACY_CHANNEL);
        lastStates.clear();
        pendingInitial.clear();
    }

    @EventHandler public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        lastStates.remove(player.getUniqueId());
        scheduleInitial(player);
    }

    @EventHandler public void onQuit(PlayerQuitEvent event) {
        lastStates.remove(event.getPlayer().getUniqueId());
        pendingInitial.remove(event.getPlayer().getUniqueId());
    }

    @EventHandler public void onRegister(PlayerRegisterChannelEvent event) {
        Player player = event.getPlayer();
        if (!CHANNEL.equals(event.getChannel()) && !LEGACY_CHANNEL.equals(event.getChannel())) return;
        scheduleInitial(player);
    }

    private void scheduleInitial(Player player) {
        UUID id = player.getUniqueId();
        if (!pendingInitial.add(id)) return;
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            pendingInitial.remove(id);
            if (player.isOnline()) publish(player, true);
        }, 1L);
    }

    private void poll() {
        for (Player player : Bukkit.getOnlinePlayers()) publish(player, false);
    }

    private void publish(Player player, boolean force) {
        if (!player.isOnline()) return;
        JsonObject root = buildState(player);
        byte[] payload = encodeBounded(root);
        if (payload == null) return;
        String json = new String(payload, StandardCharsets.UTF_8);
        String channel = preferredChannel(player);
        long now = System.currentTimeMillis();
        LastState last = lastStates.get(player.getUniqueId());
        if (!force && last != null && json.equals(last.json()) && channel.equals(last.channel())
                && now - last.sentAt() < HEARTBEAT_MS) return;
        player.sendPluginMessage(plugin, channel, payload);
        lastStates.put(player.getUniqueId(), new LastState(json, channel, now));
    }

    private String preferredChannel(Player player) {
        Set<String> listening = player.getListeningPluginChannels();
        if (listening.contains(CHANNEL)) return CHANNEL;
        if (listening.contains(LEGACY_CHANNEL)) return LEGACY_CHANNEL;
        return CHANNEL;
    }

    private JsonObject buildState(Player player) {
        JsonObject root = new JsonObject();
        root.addProperty("schemaVersion", 1);
        SkillsUser user = AuraSkillsApi.get().getUser(player.getUniqueId());
        if (user == null || !user.isLoaded()) {
            root.add("mana", JsonNull.INSTANCE);
            root.add("skills", new JsonArray());
        } else {
            JsonObject mana = new JsonObject();
            mana.addProperty("current", finite(user.getMana()));
            mana.addProperty("max", finite(user.getMaxMana()));
            root.add("mana", mana);
            root.add("skills", skills(user));
        }
        root.add("abilities", abilities(player, user != null && user.isLoaded() ? user : null));
        return root;
    }

    private JsonArray skills(SkillsUser user) {
        JsonArray result = new JsonArray();
        var api = AuraSkillsApi.get();
        List<Skill> all = new ArrayList<>(api.getGlobalRegistry().getSkills());
        all.sort(Comparator.comparing(skill -> id(skill.getId())));
        for (Skill skill : all) {
            if (result.size() >= MAX_ENTRIES) break;
            String skillId = id(skill.getId());
            if (!skill.isEnabled() || !VALID_ID.matcher(skillId).matches()) continue;
            try {
                int level = Math.max(0, user.getSkillLevel(skill));
                boolean capped = level >= skill.getMaxLevel();
                int required = capped ? 0 : Math.max(0, api.getXpRequirements().getXpRequired(skill, level + 1));
                double xp = capped ? 0 : Math.max(0, finite(user.getSkillXp(skill)));
                JsonObject entry = new JsonObject();
                entry.addProperty("id", skillId);
                entry.addProperty("name", name(skill.getDisplayName(LABEL_LOCALE), skillId));
                entry.addProperty("level", level);
                entry.addProperty("xp", xp);
                entry.addProperty("requiredXp", required);
                result.add(entry);
            } catch (IllegalArgumentException ignored) {
                // An enabled registry skill may not be loaded for this player yet.
            }
        }
        return result;
    }

    private JsonArray abilities(Player player, SkillsUser user) {
        JsonArray result = new JsonArray();
        addAbility(result, "mycli:starbolt", "星芒箭", 1, combatSpells.remainingCooldownMs(player, "starbolt"));
        addAbility(result, "mycli:frostnova", "霜环", 1, combatSpells.remainingCooldownMs(player, "frostnova"));
        addAbility(result, "mycli:flamewave", "焰浪", 1, combatSpells.remainingCooldownMs(player, "flamewave"));
        addAbility(result, "mycli:prospect", "探矿术", 1, prospectingSpell.remainingCooldownMs(player));
        Set<String> seen = new HashSet<>(Set.of("mycli:starbolt", "mycli:frostnova", "mycli:flamewave", "mycli:prospect"));
        addMagicSpells(result, player, seen);
        if (user == null) return result;

        var registry = AuraSkillsApi.get().getGlobalRegistry();
        List<ManaAbility> manaAbilities = new ArrayList<>(registry.getManaAbilities());
        manaAbilities.sort(Comparator.comparing(ability -> id(ability.getId())));
        for (ManaAbility ability : manaAbilities) {
            if (result.size() >= MAX_ENTRIES) break;
            String abilityId = id(ability.getId());
            if (!ability.isEnabled() || !VALID_ID.matcher(abilityId).matches()) continue;
            try {
                int level = user.getManaAbilityLevel(ability);
                if (level > 0 && seen.add(abilityId))
                    addAbility(result, abilityId, ability.getDisplayName(LABEL_LOCALE), level, null);
            } catch (IllegalArgumentException ignored) {
                // The registry can contain enabled abilities absent from this user's loaded skill set.
            }
        }
        List<Ability> passiveAbilities = new ArrayList<>(registry.getAbilities());
        passiveAbilities.sort(Comparator.comparing(ability -> id(ability.getId())));
        for (Ability ability : passiveAbilities) {
            if (result.size() >= MAX_ENTRIES) break;
            String abilityId = id(ability.getId());
            if (!ability.isEnabled() || !VALID_ID.matcher(abilityId).matches()) continue;
            try {
                int level = user.getAbilityLevel(ability);
                if (level > 0 && seen.add(abilityId))
                    addAbility(result, abilityId, ability.getDisplayName(LABEL_LOCALE), level, null);
            } catch (IllegalArgumentException ignored) {
                // The registry can contain enabled abilities absent from this user's loaded skill set.
            }
        }
        return result;
    }

    private void addMagicSpells(JsonArray result, Player player, Set<String> seen) {
        if (!MagicSpells.isLoaded()) return;
        Spellbook spellbook = MagicSpells.getSpellbook(player);
        if (spellbook == null) return;
        List<Spell> spells = new ArrayList<>(spellbook.getSpells());
        spells.sort(Comparator.comparing(spell -> spell.getInternalName().toLowerCase(Locale.ROOT)));
        for (Spell spell : spells) {
            if (result.size() >= MAX_ENTRIES) break;
            if (spell.isHelperSpell()) continue;
            String spellId = "magicspells:" + spell.getInternalName().toLowerCase(Locale.ROOT);
            if (!VALID_ID.matcher(spellId).matches() || !seen.add(spellId)) continue;
            float remainingSeconds = spell.getCooldown(player);
            Long cooldownMs = Float.isFinite(remainingSeconds)
                    ? Math.max(0L, (long) Math.ceil(remainingSeconds * 1000.0)) : null;
            addAbility(result, spellId, spell.getName(), 1, cooldownMs);
        }
    }

    private void addAbility(JsonArray result, String abilityId, String label, int level, Long cooldownMs) {
        if (result.size() >= MAX_ENTRIES || !VALID_ID.matcher(abilityId).matches()) return;
        JsonObject entry = new JsonObject();
        entry.addProperty("id", abilityId);
        entry.addProperty("name", name(label, abilityId));
        entry.addProperty("level", level);
        if (cooldownMs == null) entry.add("cooldownMs", JsonNull.INSTANCE);
        else entry.addProperty("cooldownMs", Math.max(0L, cooldownMs));
        result.add(entry);
    }

    private String id(NamespacedId id) {
        return (id.getNamespace() + ":" + id.getKey()).toLowerCase(Locale.ROOT);
    }

    private String name(String label, String fallback) {
        if (label == null || label.isBlank()) return fallback;
        String plain = ChatColor.stripColor(label).trim();
        if (plain.isEmpty()) return fallback;
        int end = plain.offsetByCodePoints(0, Math.min(64, plain.codePointCount(0, plain.length())));
        return plain.substring(0, end);
    }

    private double finite(double value) { return Double.isFinite(value) ? value : 0.0; }

    private byte[] encodeBounded(JsonObject root) {
        byte[] payload = root.toString().getBytes(StandardCharsets.UTF_8);
        JsonArray abilities = root.getAsJsonArray("abilities");
        JsonArray skills = root.getAsJsonArray("skills");
        while (payload.length > MAX_BYTES && abilities.size() > 0) {
            abilities.remove(abilities.size() - 1);
            payload = root.toString().getBytes(StandardCharsets.UTF_8);
        }
        while (payload.length > MAX_BYTES && skills.size() > 0) {
            skills.remove(skills.size() - 1);
            payload = root.toString().getBytes(StandardCharsets.UTF_8);
        }
        if (payload.length > MAX_BYTES) {
            plugin.getLogger().warning("Viewer state exceeds 16384 bytes even without entries; not sent.");
            return null;
        }
        return payload;
    }
}
