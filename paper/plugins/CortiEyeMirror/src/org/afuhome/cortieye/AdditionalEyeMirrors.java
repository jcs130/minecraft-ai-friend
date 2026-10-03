package org.afuhome.cortieye;

import com.comphenix.protocol.PacketType;
import com.comphenix.protocol.ProtocolManager;
import com.comphenix.protocol.events.ListenerPriority;
import com.comphenix.protocol.events.PacketAdapter;
import com.comphenix.protocol.events.PacketContainer;
import com.comphenix.protocol.events.PacketEvent;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.hpfxd.spectatorplus.paper.SpectatorPlugin;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import net.minecraft.network.protocol.game.ClientboundRemoveMobEffectPacket;
import net.minecraft.network.protocol.game.ClientboundUpdateMobEffectPacket;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.craftbukkit.potion.CraftPotionEffectType;
import org.bukkit.craftbukkit.potion.CraftPotionUtil;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryOpenEvent;
import org.bukkit.event.inventory.InventoryType;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;

/** Mirrors private presentation only for registered, actually attached non-Corti Eye pairs. */
final class AdditionalEyeMirrors implements Listener {
    private static final PacketType[] PRESENTATION = {
            PacketType.Play.Server.SET_ACTION_BAR_TEXT,
            PacketType.Play.Server.SET_TITLE_TEXT,
            PacketType.Play.Server.SET_SUBTITLE_TEXT,
            PacketType.Play.Server.SET_TITLES_ANIMATION,
            PacketType.Play.Server.CLEAR_TITLES,
            PacketType.Play.Server.BOSS,
            PacketType.Play.Server.ADVANCEMENTS,
            PacketType.Play.Server.ENTITY_EFFECT,
            PacketType.Play.Server.REMOVE_ENTITY_EFFECT,
            PacketType.Play.Server.SYSTEM_CHAT,
            PacketType.Play.Server.DISGUISED_CHAT,
            PacketType.Play.Server.WORLD_PARTICLES,
            PacketType.Play.Server.NAMED_SOUND_EFFECT,
            PacketType.Play.Server.ENTITY_SOUND
    };
    private record Pair(String agent, String eye) { }
    private static final class Session {
        final UUID cameraId;
        final UUID targetId;
        final int targetEntityId;
        final Set<PotionEffectType> effects = new HashSet<>();
        long effectWindowAt;
        int effectPackets;

        Session(Player camera, Player target) {
            cameraId = camera.getUniqueId();
            targetId = target.getUniqueId();
            targetEntityId = target.getEntityId();
        }
    }

    private final CortiEyeMirrorPlugin plugin;
    private final ProtocolManager protocol;
    private final Path pairsFile;
    private final String cortiEye;
    private final String cortiTarget;
    private final String cortiEyeName;
    private final String cortiTargetName;
    private List<Pair> pairs = List.of();
    private String configError = "";
    private final Map<String, Session> sessions = new HashMap<>(); // main thread only
    private final Map<UUID, Map<String, Long>> cameraChat = new HashMap<>(); // main thread only
    private final Map<UUID, Inventory> mirroredCrafting = new HashMap<>(); // main thread only
    private final Map<UUID, Long> lastCraftingClick = new HashMap<>();
    private final Set<UUID> pendingCrafting = new HashSet<>();
    private volatile Set<String> registeredEyes = Set.of();
    private volatile Set<String> attachedEyes = Set.of();
    private volatile Set<UUID> attachedTargets = Set.of();
    private volatile boolean cortiAuthorized;
    private int ticks;

    AdditionalEyeMirrors(CortiEyeMirrorPlugin plugin, ProtocolManager protocol,
            String cortiTarget, String cortiEye) {
        this.plugin = plugin;
        this.protocol = protocol;
        this.cortiEyeName = cortiEye;
        this.cortiTargetName = cortiTarget;
        this.cortiEye = cortiEye.toLowerCase(Locale.ROOT);
        this.cortiTarget = cortiTarget.toLowerCase(Locale.ROOT);
        pairsFile = Path.of(plugin.getConfig().getString("pairs-file", "E:/MC/ops/agent-eye-pairs.json"));
    }

    boolean cortiAuthorized() { return cortiAuthorized; }

    void start() {
        loadPairs();
        Bukkit.getPluginManager().registerEvents(this, plugin);
        Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 1L, 1L);
        protocol.addPacketListener(new PacketAdapter(plugin, ListenerPriority.HIGHEST, PRESENTATION) {
            @Override public void onPacketSending(PacketEvent event) {
                PacketType type = event.getPacketType();
                Player recipient = event.getPlayer();
                String name = recipient.getName().toLowerCase(Locale.ROOT);
                if (registeredEyes.contains(name)) {
                    if (isChat(type)) {
                        String signature = signature(event.getPacket(), type);
                        UUID cameraId = recipient.getUniqueId();
                        Bukkit.getScheduler().runTask(plugin, () -> cameraChat
                                .computeIfAbsent(cameraId, ignored -> new HashMap<>())
                                .put(signature, System.currentTimeMillis()));
                    } else if (attachedEyes.contains(name) && type != PacketType.Play.Server.BOSS
                            && !cameraNightVisionPacket(type, event.getPacket())) {
                        if (!isEffect(type) || event.getPacket().getIntegers().size() == 0
                                || event.getPacket().getIntegers().read(0) == recipient.getEntityId())
                            event.setCancelled(true);
                    }
                    return;
                }
                UUID targetId = recipient.getUniqueId();
                if (!attachedTargets.contains(targetId)) return;
                PacketContainer packet = event.getPacket().shallowClone();
                String signature = isChat(type) ? signature(packet, type) : null;
                Bukkit.getScheduler().runTaskLater(plugin,
                        () -> forward(targetId, type, packet, signature), signature == null ? 1L : 2L);
            }
        });
        plugin.getLogger().info("Additional Eye mirrors reading " + pairsFile);
    }

    void stop() {
        for (UUID cameraId : new ArrayList<>(mirroredCrafting.keySet())) closeCrafting(cameraId);
        for (Session session : new ArrayList<>(sessions.values()))
            restoreEffects(Bukkit.getPlayer(session.cameraId), session);
        sessions.clear();
        cameraChat.clear();
        mirroredCrafting.clear();
        lastCraftingClick.clear();
        pendingCrafting.clear();
        registeredEyes = Set.of();
        attachedEyes = Set.of();
        attachedTargets = Set.of();
        cortiAuthorized = false;
    }

    private void loadPairs() {
        try {
            JsonObject root = JsonParser.parseString(Files.readString(pairsFile, StandardCharsets.UTF_8))
                    .getAsJsonObject();
            if (root.get("schemaVersion").getAsInt() != 1) throw new IllegalArgumentException("schemaVersion");
            JsonArray entries = root.getAsJsonArray("pairs");
            if (entries == null || entries.size() > 16) throw new IllegalArgumentException("pairs");
            List<Pair> next = new ArrayList<>();
            Set<String> eyes = new HashSet<>();
            boolean cortiPresent = false;
            for (JsonElement element : entries) {
                JsonObject pair = element.getAsJsonObject();
                String agent = pair.get("agent").getAsString();
                String eye = pair.has("eye") ? pair.get("eye").getAsString() : agent + "_eye";
                String key = eye.toLowerCase(Locale.ROOT);
                if (!agent.matches("[A-Za-z0-9_]{1,16}") || !eye.matches("[A-Za-z0-9_]{1,16}")
                        || agent.equalsIgnoreCase(eye) || agent.equalsIgnoreCase("Goddess")
                        || eye.equalsIgnoreCase("Goddess") || !eyes.add(key))
                    throw new IllegalArgumentException("invalid pair");
                if (key.equals(cortiEye))
                    cortiPresent = agent.equalsIgnoreCase(cortiTarget);
                else next.add(new Pair(agent, eye));
            }
            pairs = List.copyOf(next);
            registeredEyes = next.stream().map(pair -> pair.eye().toLowerCase(Locale.ROOT))
                    .collect(java.util.stream.Collectors.toUnmodifiableSet());
            cortiAuthorized = cortiPresent;
            configError = "";
        } catch (Exception error) {
            // A malformed or missing registry must revoke private forwarding.
            pairs = List.of();
            registeredEyes = Set.of();
            cortiAuthorized = false;
            String message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
            if (!message.equals(configError)) plugin.getLogger().warning("Eye pairs rejected: " + message);
            configError = message;
        }
    }

    private void tick() {
        if (++ticks % 100 == 0) loadPairs();
        if (!cortiAuthorized) {
            Player camera = Bukkit.getPlayerExact(cortiEyeName);
            Player target = Bukkit.getPlayerExact(cortiTargetName);
            if (camera != null && target != null && camera.getGameMode() == GameMode.SPECTATOR
                    && camera.getSpectatorTarget() != null
                    && camera.getSpectatorTarget().getUniqueId().equals(target.getUniqueId()))
                camera.setSpectatorTarget(null);
        }
        Set<String> seen = new HashSet<>();
        Set<UUID> targets = new HashSet<>();
        for (Pair pair : pairs) {
            String key = pair.eye().toLowerCase(Locale.ROOT);
            Player camera = Bukkit.getPlayerExact(pair.eye());
            Player target = Bukkit.getPlayerExact(pair.agent());
            Entity observed = camera == null ? null : camera.getSpectatorTarget();
            boolean attached = camera != null && target != null && camera.getGameMode() == GameMode.SPECTATOR
                    && observed != null && observed.getUniqueId().equals(target.getUniqueId());
            Session previous = sessions.get(key);
            if (!attached) {
                if (previous != null) restoreEffects(camera, previous);
                sessions.remove(key);
                continue;
            }
            ensureNightVision(camera);
            seen.add(key);
            targets.add(target.getUniqueId());
            if (previous == null || !previous.cameraId.equals(camera.getUniqueId())
                    || !previous.targetId.equals(target.getUniqueId())
                    || previous.targetEntityId != target.getEntityId()) {
                if (previous != null) restoreEffects(camera, previous);
                Session current = new Session(camera, target);
                sessions.put(key, current);
                snapshotEffects(camera, target, current);
                plugin.getLogger().info("Eye mirror attached " + pair.eye() + " -> " + pair.agent());
            }
        }
        for (String key : new ArrayList<>(sessions.keySet())) {
            if (seen.contains(key)) continue;
            Session previous = sessions.remove(key);
            restoreEffects(Bukkit.getPlayer(previous.cameraId), previous);
        }
        attachedEyes = Set.copyOf(seen);
        attachedTargets = Set.copyOf(targets);
        for (UUID cameraId : new ArrayList<>(mirroredCrafting.keySet())) {
            if (System.currentTimeMillis() - lastCraftingClick.getOrDefault(cameraId, 0L) >= 3_000L)
                closeCrafting(cameraId);
        }
        long cutoff = System.currentTimeMillis() - 3_000L;
        cameraChat.values().forEach(chats -> chats.values().removeIf(time -> time < cutoff));
        cameraChat.entrySet().removeIf(entry -> entry.getValue().isEmpty());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onTargetCraftingClick(InventoryClickEvent event) {
        if (!(event.getWhoClicked() instanceof Player target)
                || event.getView().getType() != InventoryType.CRAFTING
                || !attachedTargets.contains(target.getUniqueId())) return;
        UUID targetId = target.getUniqueId();
        long now = System.currentTimeMillis();
        for (Session session : sessions.values()) if (session.targetId.equals(targetId))
            lastCraftingClick.put(session.cameraId, now);
        if (!pendingCrafting.add(targetId)) return;
        Bukkit.getScheduler().runTask(plugin, () -> {
            pendingCrafting.remove(targetId);
            if (!target.isOnline() || target.getOpenInventory().getType() != InventoryType.CRAFTING)
                return;
            if (!(Bukkit.getPluginManager().getPlugin("SpectatorPlus") instanceof SpectatorPlugin spectator))
                return;
            var screens = spectator.getSyncController().getScreenSyncHandler();
            screens.onPlayerOpenInventory(target);
            for (Session session : sessions.values()) {
                if (!session.targetId.equals(targetId)) continue;
                Player camera = Bukkit.getPlayer(session.cameraId);
                if (camera != null && screens.isViewingSyncedScreen(camera))
                    mirroredCrafting.put(session.cameraId, camera.getOpenInventory().getTopInventory());
            }
        });
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onTargetInventoryOpen(InventoryOpenEvent event) {
        if (event.getView().getType() == InventoryType.CRAFTING) return;
        UUID targetId = event.getPlayer().getUniqueId();
        for (Session session : sessions.values()) if (session.targetId.equals(targetId))
            mirroredCrafting.remove(session.cameraId);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onTargetInventoryClose(InventoryCloseEvent event) {
        if (event.getView().getType() != InventoryType.CRAFTING) return;
        UUID targetId = event.getPlayer().getUniqueId();
        for (Session session : sessions.values()) if (session.targetId.equals(targetId))
            closeCrafting(session.cameraId);
    }

    @EventHandler public void onQuit(PlayerQuitEvent event) {
        UUID playerId = event.getPlayer().getUniqueId();
        mirroredCrafting.remove(playerId);
        lastCraftingClick.remove(playerId);
        pendingCrafting.remove(playerId);
        for (Session session : sessions.values()) if (session.targetId.equals(playerId))
            closeCrafting(session.cameraId);
    }

    private void closeCrafting(UUID cameraId) {
        Inventory inventory = mirroredCrafting.remove(cameraId);
        lastCraftingClick.remove(cameraId);
        Player camera = Bukkit.getPlayer(cameraId);
        if (inventory != null && camera != null && camera.isOnline()
                && camera.getOpenInventory().getTopInventory() == inventory) camera.closeInventory();
    }

    private static void ensureNightVision(Player camera) {
        PotionEffect effect = camera.getPotionEffect(PotionEffectType.NIGHT_VISION);
        if (effect == null || effect.getDuration() < 20 * 60 * 60)
            camera.addPotionEffect(new PotionEffect(PotionEffectType.NIGHT_VISION,
                    20 * 60 * 60 * 24 * 7, 0, true, false, false));
    }

    private void snapshotEffects(Player camera, Player target, Session session) {
        for (PotionEffect effect : camera.getActivePotionEffects())
            if (effect.getType() != PotionEffectType.NIGHT_VISION)
                sendEffectRemoval(camera, effect.getType());
        for (PotionEffect effect : target.getActivePotionEffects()) {
            if (effect.getType() == PotionEffectType.NIGHT_VISION) continue;
            sendEffectSnapshot(camera, effect);
            session.effects.add(effect.getType());
        }
    }

    private void restoreEffects(Player camera, Session session) {
        if (camera == null || !camera.isOnline()) return;
        for (PotionEffectType effect : session.effects) sendEffectRemoval(camera, effect);
        for (PotionEffect effect : camera.getActivePotionEffects()) sendEffectSnapshot(camera, effect);
        session.effects.clear();
    }

    private void sendEffectSnapshot(Player camera, PotionEffect effect) {
        protocol.sendServerPacket(camera, new PacketContainer(PacketType.Play.Server.ENTITY_EFFECT,
                new ClientboundUpdateMobEffectPacket(camera.getEntityId(),
                        CraftPotionUtil.fromBukkit(effect), false)), false);
    }

    private void sendEffectRemoval(Player camera, PotionEffectType effect) {
        protocol.sendServerPacket(camera, new PacketContainer(PacketType.Play.Server.REMOVE_ENTITY_EFFECT,
                new ClientboundRemoveMobEffectPacket(camera.getEntityId(),
                        CraftPotionEffectType.bukkitToMinecraftHolder(effect))), false);
    }

    private void forward(UUID targetId, PacketType type, PacketContainer original, String signature) {
        Player target = Bukkit.getPlayer(targetId);
        if (target == null || !target.isOnline()) return;
        for (Session session : sessions.values()) {
            if (!session.targetId.equals(targetId)) continue;
            Player camera = Bukkit.getPlayer(session.cameraId);
            if (camera == null || !camera.isOnline() || camera.getGameMode() != GameMode.SPECTATOR
                    || camera.getSpectatorTarget() == null
                    || !camera.getSpectatorTarget().getUniqueId().equals(targetId)) continue;
            if (signature != null) {
                Long seen = cameraChat.getOrDefault(camera.getUniqueId(), Map.of()).get(signature);
                if (seen != null && System.currentTimeMillis() - seen < 2_000L) continue;
            }
            if (worldEffect(type)) {
                long now = System.currentTimeMillis();
                if (now - session.effectWindowAt >= 1_000L) {
                    session.effectWindowAt = now;
                    session.effectPackets = 0;
                }
                if (++session.effectPackets > 128) continue;
            }
            PacketContainer copy = original.shallowClone();
            if (isEffect(type)) {
                if (copy.getIntegers().size() == 0
                        || copy.getIntegers().read(0) != target.getEntityId()) continue;
                PotionEffectType effect;
                if (type == PacketType.Play.Server.ENTITY_EFFECT) {
                    effect = CraftPotionEffectType.minecraftHolderToBukkit(
                            ((ClientboundUpdateMobEffectPacket) copy.getHandle()).getEffect());
                    if (effect == PotionEffectType.NIGHT_VISION) continue;
                    session.effects.add(effect);
                } else {
                    effect = CraftPotionEffectType.minecraftHolderToBukkit(
                            ((ClientboundRemoveMobEffectPacket) copy.getHandle()).effect());
                    if (effect == PotionEffectType.NIGHT_VISION) continue;
                    session.effects.remove(effect);
                }
                copy.getIntegers().write(0, camera.getEntityId());
            }
            try { protocol.sendServerPacket(camera, copy, false); }
            catch (RuntimeException error) {
                plugin.getLogger().warning("Could not mirror " + type.name() + " to "
                        + camera.getName() + ": " + error);
            }
        }
    }

    private static boolean isChat(PacketType type) {
        return type == PacketType.Play.Server.SYSTEM_CHAT || type == PacketType.Play.Server.DISGUISED_CHAT;
    }

    private static boolean isEffect(PacketType type) {
        return type == PacketType.Play.Server.ENTITY_EFFECT
                || type == PacketType.Play.Server.REMOVE_ENTITY_EFFECT;
    }

    private static boolean worldEffect(PacketType type) {
        return type == PacketType.Play.Server.WORLD_PARTICLES
                || type == PacketType.Play.Server.NAMED_SOUND_EFFECT
                || type == PacketType.Play.Server.ENTITY_SOUND;
    }

    private static boolean cameraNightVisionPacket(PacketType type, PacketContainer packet) {
        if (type == PacketType.Play.Server.ENTITY_EFFECT)
            return CraftPotionEffectType.minecraftHolderToBukkit(
                    ((ClientboundUpdateMobEffectPacket) packet.getHandle()).getEffect())
                    .equals(PotionEffectType.NIGHT_VISION);
        if (type == PacketType.Play.Server.REMOVE_ENTITY_EFFECT)
            return CraftPotionEffectType.minecraftHolderToBukkit(
                    ((ClientboundRemoveMobEffectPacket) packet.getHandle()).effect())
                    .equals(PotionEffectType.NIGHT_VISION);
        return false;
    }

    private static String signature(PacketContainer packet, PacketType type) {
        return type.name() + ':' + packet.getHandle();
    }
}
