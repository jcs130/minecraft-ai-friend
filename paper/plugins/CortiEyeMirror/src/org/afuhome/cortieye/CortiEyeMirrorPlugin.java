package org.afuhome.cortieye;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import com.comphenix.protocol.PacketType;
import com.comphenix.protocol.ProtocolLibrary;
import com.comphenix.protocol.ProtocolManager;
import com.comphenix.protocol.events.ListenerPriority;
import com.comphenix.protocol.events.PacketAdapter;
import com.comphenix.protocol.events.PacketContainer;
import com.comphenix.protocol.events.PacketEvent;
import dev.aurelium.auraskills.api.AuraSkillsApi;
import dev.aurelium.auraskills.api.user.SkillsUser;
import com.hpfxd.spectatorplus.paper.SpectatorPlugin;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.GameMode;
import org.bukkit.boss.BarColor;
import org.bukkit.boss.BarStyle;
import org.bukkit.boss.BossBar;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.EventPriority;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryOpenEvent;
import org.bukkit.event.inventory.InventoryType;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.craftbukkit.potion.CraftPotionEffectType;
import org.bukkit.craftbukkit.potion.CraftPotionUtil;
import net.minecraft.network.protocol.game.ClientboundRemoveMobEffectPacket;
import net.minecraft.network.protocol.game.ClientboundUpdateMobEffectPacket;
import net.minecraft.network.protocol.game.ClientboundContainerSetContentPacket;
import net.minecraft.network.protocol.game.ClientboundContainerSetSlotPacket;
import net.minecraft.core.component.DataComponents;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.ResolvableProfile;

/** Mirrors presentation packets into a real spectator client; night vision belongs to the camera only. */
public final class CortiEyeMirrorPlugin extends JavaPlugin implements Listener {
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
    private final Map<String, Long> cameraChat = new HashMap<>(); // main thread only
    private final Set<PotionEffectType> mirroredEffects = new HashSet<>(); // main thread only
    private String targetName;
    private String cameraName;
    private boolean mirrorChat;
    private boolean mirrorAdvancements;
    private boolean autoAttach;
    private boolean cameraNightVision;
    private boolean showVitalsBossBar;
    private boolean mirrorCraftingInventoryClicks;
    private volatile boolean attached;
    private boolean inventoryMirrorPending;
    private Inventory mirroredInventory;
    private long lastInventoryClickAt;
    private int snapshotTargetEntityId = -1;
    private ProtocolManager protocol;
    private AdditionalEyeMirrors additionalEyeMirrors;
    private BossBar vitalsBar;
    private final AtomicBoolean captureHotbarSlot36 = new AtomicBoolean();
    private long effectWindowAt;
    private int effectPacketsInWindow;

    @Override public void onEnable() {
        saveDefaultConfig();
        targetName = getConfig().getString("target", "CortiLan");
        cameraName = getConfig().getString("camera", "CortiEye");
        mirrorChat = getConfig().getBoolean("mirror-chat", true);
        mirrorAdvancements = getConfig().getBoolean("mirror-advancements", true);
        autoAttach = getConfig().getBoolean("auto-attach", true);
        cameraNightVision = getConfig().getBoolean("camera-night-vision", true);
        showVitalsBossBar = getConfig().getBoolean("show-vitals-bossbar", false);
        mirrorCraftingInventoryClicks = getConfig().getBoolean("mirror-crafting-inventory-clicks", true);
        if (targetName == null || cameraName == null || targetName.equalsIgnoreCase(cameraName)) {
            getLogger().severe("Invalid target/camera mapping; disabling.");
            Bukkit.getPluginManager().disablePlugin(this);
            return;
        }
        protocol = ProtocolLibrary.getProtocolManager();
        if (showVitalsBossBar) {
            vitalsBar = Bukkit.createBossBar("Corti 状态读取中", BarColor.RED, BarStyle.SEGMENTED_10);
        }
        Bukkit.getPluginManager().registerEvents(this, this);
        getCommand("cortieye").setExecutor(this::onStatusCommand);
        Bukkit.getScheduler().runTaskTimer(this, this::ensureCameraNightVision, 1L, 100L);
        Bukkit.getScheduler().runTaskTimer(this, this::closeIdleInventoryMirror, 20L, 20L);
        if (showVitalsBossBar) Bukkit.getScheduler().runTaskTimer(this, this::tickVitals, 5L, 5L);
        Bukkit.getScheduler().runTaskLater(this, this::attachCamera, 40L);
        Bukkit.getScheduler().runTaskTimer(this, () -> {
            Player target = Bukkit.getPlayerExact(targetName);
            Player camera = Bukkit.getPlayerExact(cameraName);
            Entity observed = camera == null || camera.getGameMode() != GameMode.SPECTATOR
                    ? null : camera.getSpectatorTarget();
            boolean current = target != null && camera != null && camera.getGameMode() == GameMode.SPECTATOR
                    && observed != null && observed.getUniqueId().equals(target.getUniqueId());
            if (attached && !current) {
                restoreCameraEffects(camera);
                snapshotTargetEntityId = -1;
            }
            attached = current;
        }, 1L, 1L);
        protocol.addPacketListener(new PacketAdapter(this, ListenerPriority.HIGHEST, PRESENTATION) {
            @Override public void onPacketSending(PacketEvent event) {
                if (additionalEyeMirrors == null || !additionalEyeMirrors.cortiAuthorized()) return;
                String recipient = event.getPlayer().getName();
                PacketType type = event.getPacketType();
                if (recipient.equalsIgnoreCase(cameraName)) {
                    if (isChat(type)) {
                        String signature = signature(event.getPacket(), type);
                        Bukkit.getScheduler().runTask(CortiEyeMirrorPlugin.this,
                                () -> cameraChat.put(signature, System.currentTimeMillis()));
                    } else if (isEffect(type) && event.getPacket().getIntegers().size() > 0
                            && event.getPacket().getIntegers().read(0) != event.getPlayer().getEntityId()) {
                        // Potion effects on other world entities are part of the scene.
                        return;
                    } else if (attached && type != PacketType.Play.Server.BOSS
                            && !isCameraNightVisionPacket(type, event.getPacket())) {
                        // The camera's own mana/action bar and progress would overwrite the target's UI.
                        event.setCancelled(true);
                    }
                    return;
                }
                if (!recipient.equalsIgnoreCase(targetName)) return;
                if (isChat(type) && !mirrorChat) return;
                if (type == PacketType.Play.Server.ADVANCEMENTS && !mirrorAdvancements) return;
                PacketContainer copy = event.getPacket().shallowClone();
                String signature = isChat(type) ? signature(copy, type) : null;
                // Broadcast chat also reaches the camera normally. Give that packet two ticks to arrive.
                long delay = signature == null ? 1L : 2L;
                UUID targetId = event.getPlayer().getUniqueId();
                Bukkit.getScheduler().runTaskLater(CortiEyeMirrorPlugin.this,
                        () -> forward(targetId, type, copy, signature), delay);
            }
        });
        protocol.addPacketListener(new PacketAdapter(this, ListenerPriority.HIGHEST,
                PacketType.Play.Server.WINDOW_ITEMS, PacketType.Play.Server.SET_SLOT) {
            @Override public void onPacketSending(PacketEvent event) {
                if (!captureHotbarSlot36.get() || !event.getPlayer().getName().equalsIgnoreCase(targetName)) return;
                Object handle = event.getPacket().getHandle();
                ItemStack item;
                String packet;
                if (handle instanceof ClientboundContainerSetContentPacket contents) {
                    if (contents.getContainerId() != 0 || contents.getItems().size() <= 36) return;
                    item = contents.getItems().get(36);
                    packet = "ClientboundContainerSetContentPacket";
                } else if (handle instanceof ClientboundContainerSetSlotPacket slot) {
                    if (slot.getContainerId() != 0 || slot.getSlot() != 36) return;
                    item = slot.getItem();
                    packet = "ClientboundContainerSetSlotPacket";
                } else return;
                if (!captureHotbarSlot36.compareAndSet(true, false)) return;
                String report;
                try {
                    report = describeSlot36(packet, item);
                } catch (RuntimeException | LinkageError error) {
                    report = packet + " container=0 slot=36 inspection-error=" + error.getClass().getSimpleName();
                }
                String capturedReport = report;
                Bukkit.getScheduler().runTask(CortiEyeMirrorPlugin.this,
                        () -> getLogger().info("CortiLan outbound slot36: " + capturedReport));
            }
        });
        Bukkit.getScheduler().runTaskTimer(this, () -> {
            long cutoff = System.currentTimeMillis() - 3_000L;
            cameraChat.values().removeIf(time -> time < cutoff);
        }, 60L, 60L);
        additionalEyeMirrors = new AdditionalEyeMirrors(this, protocol, targetName, cameraName);
        additionalEyeMirrors.start();
        getLogger().info("Native HUD mirror ready: " + targetName + " -> " + cameraName
                + "; chat=" + mirrorChat + "; advancements=" + mirrorAdvancements
                + "; camera-night-vision=" + cameraNightVision
                + "; vitals-bossbar=" + showVitalsBossBar
                + "; crafting-inventory=" + mirrorCraftingInventoryClicks
                + "; spell-effects=true");
    }

    @Override public void onDisable() {
        attached = false;
        if (additionalEyeMirrors != null) additionalEyeMirrors.stop();
        if (protocol != null) protocol.removePacketListeners(this);
        if (vitalsBar != null) vitalsBar.removeAll();
        cameraChat.clear();
        restoreCameraEffects(cameraName == null ? null : Bukkit.getPlayerExact(cameraName));
        snapshotTargetEntityId = -1;
        resetInventoryMirror();
    }

    @EventHandler public void onJoin(PlayerJoinEvent event) {
        String name = event.getPlayer().getName();
        if (name.equalsIgnoreCase(targetName) || name.equalsIgnoreCase(cameraName)) {
            if (name.equalsIgnoreCase(cameraName)) {
                Bukkit.getScheduler().runTaskLater(this, this::ensureCameraNightVision, 1L);
            }
            Bukkit.getScheduler().runTaskLater(this, this::attachCamera, 40L);
        }
    }

    @EventHandler public void onRespawn(PlayerRespawnEvent event) {
        if (!event.getPlayer().getName().equalsIgnoreCase(targetName)) return;
        Bukkit.getScheduler().runTaskLater(this, this::attachCamera, 5L);
        Bukkit.getScheduler().runTaskLater(this, this::attachCamera, 40L);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onTargetInventoryClick(InventoryClickEvent event) {
        if (!mirrorCraftingInventoryClicks || additionalEyeMirrors == null
                || !additionalEyeMirrors.cortiAuthorized()
                || !(event.getWhoClicked() instanceof Player target)
                || !target.getName().equalsIgnoreCase(targetName)
                || event.getView().getType() != InventoryType.CRAFTING) return;
        Player camera = Bukkit.getPlayerExact(cameraName);
        if (!isAttached(target, camera)) return;
        if (mirroredInventory != null
                && camera.getOpenInventory().getTopInventory() != mirroredInventory) resetInventoryMirror();
        lastInventoryClickAt = System.currentTimeMillis();
        if (inventoryMirrorPending || mirroredInventory != null) return;
        inventoryMirrorPending = true;
        Bukkit.getScheduler().runTask(this, () -> {
            inventoryMirrorPending = false;
            if (!target.isOnline() || !isAttached(target, camera)
                    || target.getOpenInventory().getType() != InventoryType.CRAFTING) return;
            if (!(Bukkit.getPluginManager().getPlugin("SpectatorPlus") instanceof SpectatorPlugin spectatorPlus)) return;
            var screens = spectatorPlus.getSyncController().getScreenSyncHandler();
            screens.onPlayerOpenInventory(target);
            if (screens.isViewingSyncedScreen(camera))
                mirroredInventory = camera.getOpenInventory().getTopInventory();
        });
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onTargetInventoryOpen(InventoryOpenEvent event) {
        if (event.getPlayer().getName().equalsIgnoreCase(targetName)
                && event.getView().getType() != InventoryType.CRAFTING) resetInventoryMirror();
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onTargetInventoryClose(InventoryCloseEvent event) {
        if (event.getPlayer().getName().equalsIgnoreCase(targetName)
                && event.getView().getType() == InventoryType.CRAFTING) closeInventoryMirror();
    }

    @EventHandler public void onCameraQuit(PlayerQuitEvent event) {
        if (event.getPlayer().getName().equalsIgnoreCase(cameraName)
                || event.getPlayer().getName().equalsIgnoreCase(targetName)) resetInventoryMirror();
    }

    private boolean isAttached(Player target, Player camera) {
        return camera != null && camera.isOnline() && camera.getGameMode() == GameMode.SPECTATOR
                && camera.getSpectatorTarget() != null
                && camera.getSpectatorTarget().getUniqueId().equals(target.getUniqueId());
    }

    private void closeIdleInventoryMirror() {
        if (mirroredInventory != null && System.currentTimeMillis() - lastInventoryClickAt >= 3000L)
            closeInventoryMirror();
    }

    private void closeInventoryMirror() {
        Player camera = Bukkit.getPlayerExact(cameraName);
        if (mirroredInventory != null && camera != null && camera.isOnline()
                && camera.getOpenInventory().getTopInventory() == mirroredInventory) camera.closeInventory();
        resetInventoryMirror();
    }

    private void resetInventoryMirror() {
        inventoryMirrorPending = false;
        mirroredInventory = null;
        lastInventoryClickAt = 0L;
    }

    private SkillsUser skillsUser(Player target) {
        SkillsUser user = AuraSkillsApi.get().getUser(target.getUniqueId());
        return user != null && user.isLoaded() ? user : null;
    }

    private static String number(double value) {
        return String.format(Locale.ROOT, "%.1f", value);
    }

    private void tickVitals() {
        if (vitalsBar == null) return;
        Player target = Bukkit.getPlayerExact(targetName);
        Player camera = Bukkit.getPlayerExact(cameraName);
        if (target == null || camera == null || camera.getGameMode() != GameMode.SPECTATOR
                || camera.getSpectatorTarget() == null
                || camera.getSpectatorTarget().getEntityId() != target.getEntityId()) {
            vitalsBar.removeAll();
            return;
        }
        if (!vitalsBar.getPlayers().contains(camera)) vitalsBar.addPlayer(camera);
        double health = Math.max(0, target.getHealth());
        double maxHealth = Math.max(1, target.getMaxHealth());
        SkillsUser user = skillsUser(target);
        String mana = user == null ? "读取中" : number(user.getMana()) + "/" + number(user.getMaxMana());
        String title = ChatColor.RED + "❤ " + number(health) + "/" + number(maxHealth)
                + ChatColor.LIGHT_PURPLE + "  ✦ " + mana;
        if (!title.equals(vitalsBar.getTitle())) vitalsBar.setTitle(title);
        double progress = Math.max(0, Math.min(1, health / maxHealth));
        if (Math.abs(vitalsBar.getProgress() - progress) > 0.001) vitalsBar.setProgress(progress);
    }

    private boolean onStatusCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!sender.isOp()) { sender.sendMessage("No permission."); return true; }
        Player target = Bukkit.getPlayerExact(targetName);
        Player camera = Bukkit.getPlayerExact(cameraName);
        if (target == null) { sender.sendMessage("Target " + targetName + " offline; camera="
                + (camera == null ? "offline" : "online")); return true; }
        if (args.length == 1 && args[0].equalsIgnoreCase("inspectslot36")) {
            captureHotbarSlot36.set(true);
            target.updateInventory();
            sender.sendMessage("Requested outbound inventory packet for " + targetName + " slot36; see server log.");
            return true;
        }
        SkillsUser user = skillsUser(target);
        sender.sendMessage("target=" + targetName + " health=" + number(target.getHealth())
                + "/" + number(target.getMaxHealth()) + " mana="
                + (user == null ? "unavailable" : number(user.getMana()) + "/" + number(user.getMaxMana()))
                + " camera=" + (camera == null ? "offline" : "online")
                + " attached=" + (camera != null && camera.getSpectatorTarget() != null
                    && camera.getSpectatorTarget().getEntityId() == target.getEntityId())
                + " cameraNightVision=" + (camera != null
                    && camera.hasPotionEffect(PotionEffectType.NIGHT_VISION))
                + " vitalsBossBar=" + showVitalsBossBar);
        return true;
    }

    private String describeSlot36(String packet, ItemStack item) {
        if (item == null || item.isEmpty()) return packet + " item=empty";
        var components = item.getComponentsPatch().entrySet().stream()
                .map(entry -> componentLabel(entry.getKey())
                        + (entry.getValue().isPresent() ? "" : "(removed)"))
                .sorted().toList();
        var customName = item.get(DataComponents.CUSTOM_NAME);
        var itemName = item.get(DataComponents.ITEM_NAME);
        ResolvableProfile profile = item.get(DataComponents.PROFILE);
        int textureCount = profile == null ? 0 : profile.properties().get("textures").size();
        int textureLength = profile == null ? 0 : profile.properties().get("textures").stream()
                .findFirst().map(property -> property.value().length()).orElse(0);
        return packet + " container=0 slot=36 item=" + item.getItem()
                + " components=" + components
                + " custom_name=" + (customName == null ? "<absent>" : customName.getString())
                + " item_name=" + (itemName == null ? "<absent>" : itemName.getString())
                + " profile=" + (profile != null)
                + " textures=" + textureCount + " firstTextureBase64Length=" + textureLength;
    }

    private String componentLabel(Object type) {
        if (type == DataComponents.CUSTOM_NAME) return "minecraft:custom_name";
        if (type == DataComponents.ITEM_NAME) return "minecraft:item_name";
        if (type == DataComponents.PROFILE) return "minecraft:profile";
        return type.toString();
    }

    private void ensureCameraNightVision() {
        if (!cameraNightVision) return;
        Player camera = Bukkit.getPlayerExact(cameraName);
        if (camera == null) return;
        PotionEffect existing = camera.getPotionEffect(PotionEffectType.NIGHT_VISION);
        if (existing == null || existing.getDuration() < 20 * 60 * 60) {
            camera.addPotionEffect(new PotionEffect(PotionEffectType.NIGHT_VISION,
                    20 * 60 * 60 * 24 * 7, 0, true, false, false));
        }
    }

    private boolean isCameraNightVisionPacket(PacketType type, PacketContainer packet) {
        if (!cameraNightVision) return false;
        if (type == PacketType.Play.Server.ENTITY_EFFECT) {
            return CraftPotionEffectType.minecraftHolderToBukkit(
                    ((ClientboundUpdateMobEffectPacket) packet.getHandle()).getEffect())
                    .equals(PotionEffectType.NIGHT_VISION);
        }
        if (type == PacketType.Play.Server.REMOVE_ENTITY_EFFECT) {
            return CraftPotionEffectType.minecraftHolderToBukkit(
                    ((ClientboundRemoveMobEffectPacket) packet.getHandle()).effect())
                    .equals(PotionEffectType.NIGHT_VISION);
        }
        return false;
    }

    private void attachCamera() {
        if (!autoAttach || additionalEyeMirrors == null || !additionalEyeMirrors.cortiAuthorized()) return;
        Player target = Bukkit.getPlayerExact(targetName);
        Player camera = Bukkit.getPlayerExact(cameraName);
        if (target == null || camera == null) return;
        ensureCameraNightVision();
        if (camera.getGameMode() != GameMode.SPECTATOR) camera.setGameMode(GameMode.SPECTATOR);
        Entity observed = camera.getSpectatorTarget();
        boolean sameEntity = observed != null && observed.getEntityId() == target.getEntityId();
        if (sameEntity && target.getEntityId() == snapshotTargetEntityId) return;
        if (!sameEntity) {
            camera.setSpectatorTarget(target);
            getLogger().info("Attached " + cameraName + " to " + targetName);
        }
        // Effects already active before the camera joined never generate a new target packet.
        // Send client-only snapshots; do not change either account's server-side effects.
        for (PotionEffect effect : camera.getActivePotionEffects()) {
            if (!cameraNightVision || !effect.getType().equals(PotionEffectType.NIGHT_VISION)) {
                sendEffectRemoval(camera, effect.getType());
            }
        }
        mirroredEffects.clear();
        for (PotionEffect effect : target.getActivePotionEffects()) {
            if (cameraNightVision && effect.getType().equals(PotionEffectType.NIGHT_VISION)) continue;
            sendEffectSnapshot(camera, effect);
            mirroredEffects.add(effect.getType());
        }
        snapshotTargetEntityId = target.getEntityId();
    }

    private void sendEffectSnapshot(Player camera, PotionEffect effect) {
        PacketContainer packet = new PacketContainer(PacketType.Play.Server.ENTITY_EFFECT,
                new ClientboundUpdateMobEffectPacket(camera.getEntityId(),
                        CraftPotionUtil.fromBukkit(effect), false));
        protocol.sendServerPacket(camera, packet, false);
    }

    private void sendEffectRemoval(Player camera, PotionEffectType type) {
        PacketContainer packet = new PacketContainer(PacketType.Play.Server.REMOVE_ENTITY_EFFECT,
                new ClientboundRemoveMobEffectPacket(camera.getEntityId(),
                        CraftPotionEffectType.bukkitToMinecraftHolder(type)));
        protocol.sendServerPacket(camera, packet, false);
    }

    private void restoreCameraEffects(Player camera) {
        if (camera != null && camera.isOnline()) {
            for (PotionEffectType type : mirroredEffects) sendEffectRemoval(camera, type);
            for (PotionEffect effect : camera.getActivePotionEffects()) sendEffectSnapshot(camera, effect);
        }
        mirroredEffects.clear();
    }

    private void forward(UUID targetId, PacketType type, PacketContainer copy, String signature) {
        if (additionalEyeMirrors == null || !additionalEyeMirrors.cortiAuthorized()) return;
        Player target = Bukkit.getPlayer(targetId);
        Player camera = Bukkit.getPlayerExact(cameraName);
        if (target == null || camera == null || !target.isOnline() || !camera.isOnline()
                || !target.getName().equalsIgnoreCase(targetName)
                || camera.getGameMode() != GameMode.SPECTATOR) return;
        Entity observed = camera.getSpectatorTarget();
        if (observed == null || !observed.getUniqueId().equals(targetId)) return;
        if (type == PacketType.Play.Server.ENTITY_EFFECT
                || type == PacketType.Play.Server.REMOVE_ENTITY_EFFECT) {
            // Effect packets address an entity. Remap target -> camera so the camera's
            // client renders HUD effect icons and vision shaders as its own view.
            if (copy.getIntegers().size() == 0
                    || copy.getIntegers().read(0) != target.getEntityId()) return;
            PotionEffectType effectType;
            if (type == PacketType.Play.Server.ENTITY_EFFECT) {
                ClientboundUpdateMobEffectPacket handle =
                        (ClientboundUpdateMobEffectPacket) copy.getHandle();
                effectType = CraftPotionEffectType.minecraftHolderToBukkit(handle.getEffect());
                if (cameraNightVision && effectType.equals(PotionEffectType.NIGHT_VISION)) return;
                mirroredEffects.add(effectType);
            } else {
                ClientboundRemoveMobEffectPacket handle =
                        (ClientboundRemoveMobEffectPacket) copy.getHandle();
                effectType = CraftPotionEffectType.minecraftHolderToBukkit(handle.effect());
                if (cameraNightVision && effectType.equals(PotionEffectType.NIGHT_VISION)) return;
                mirroredEffects.remove(effectType);
            }
            copy.getIntegers().write(0, camera.getEntityId());
        }
        if (signature != null) {
            Long alreadySeen = cameraChat.get(signature);
            if (alreadySeen != null && System.currentTimeMillis() - alreadySeen < 2_000L) return;
        }
        if (isWorldEffect(type)) {
            long now = System.currentTimeMillis();
            if (now - effectWindowAt >= 1000L) {
                effectWindowAt = now;
                effectPacketsInWindow = 0;
            }
            // Ordinary spells are far below this limit; skip pathological bursts before
            // they can overwhelm a real spectator client or the livestream encoder.
            if (++effectPacketsInWindow > 128) return;
        }
        try {
            // false bypasses this plugin's packet listeners, avoiding re-mirror loops.
            protocol.sendServerPacket(camera, copy, false);
        } catch (RuntimeException error) {
            getLogger().warning("Could not mirror " + type.name() + " to " + cameraName + ": " + error);
        }
    }

    private static boolean isChat(PacketType type) {
        return type == PacketType.Play.Server.SYSTEM_CHAT
                || type == PacketType.Play.Server.DISGUISED_CHAT;
    }

    private static boolean isEffect(PacketType type) {
        return type == PacketType.Play.Server.ENTITY_EFFECT
                || type == PacketType.Play.Server.REMOVE_ENTITY_EFFECT;
    }

    private static boolean isWorldEffect(PacketType type) {
        return type == PacketType.Play.Server.WORLD_PARTICLES
                || type == PacketType.Play.Server.NAMED_SOUND_EFFECT
                || type == PacketType.Play.Server.ENTITY_SOUND;
    }

    private static String signature(PacketContainer packet, PacketType type) {
        return type.name() + ':' + packet.getHandle().toString();
    }
}
