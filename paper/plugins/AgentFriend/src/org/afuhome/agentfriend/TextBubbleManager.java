package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import io.papermc.paper.event.player.AsyncChatEvent;
import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.Color;
import org.bukkit.Location;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Display;
import org.bukkit.entity.Player;
import org.bukkit.entity.TextDisplay;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerGameModeChangeEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.scheduler.BukkitTask;

/** One bounded main-thread renderer. Only accepted public chat enters the queue. */
final class TextBubbleManager implements Listener {
    private record Limits(boolean enabled, double range, int seconds, int active, int pending,
                          int characters, int columns, int lines, int ticks, int cooldown, boolean sight) {}
    private record Session(UUID world, long token, boolean speaker) {}
    private record Speech(UUID speaker, Session session, Map<UUID, Long> viewers,
                          String text, long sequence, long created) {}
    private static final class Bubble {
        final TextDisplay entity;
        final Session session;
        final Set<UUID> shown = new HashSet<>();
        Map<UUID, Long> viewers;
        long expires, replaced;
        Bubble(TextDisplay entity, Speech speech, long expires, long now) {
            this.entity = entity; this.session = speech.session; this.viewers = speech.viewers;
            this.expires = expires; this.replaced = now;
        }
    }
    private final AgentFriendPlugin plugin;
    private final File file;
    private final Map<UUID, Session> sessions = new ConcurrentHashMap<>();
    // Only these immutable snapshots cross the chat thread boundary. No entity/world calls there.
    private final Map<UUID, Speech> pending = new LinkedHashMap<>();
    private final Map<UUID, Bubble> active = new HashMap<>();
    private final AtomicLong sequence = new AtomicLong(), rejected = new AtomicLong();
    private volatile Limits limits = new Limits(true,24,8,32,64,120,36,3,5,650,true);
    private BukkitTask task;
    private long admitted, replaced, expired, errors, frames, peakMicros;

    TextBubbleManager(AgentFriendPlugin plugin) {
        this.plugin = plugin; file = new File(plugin.getDataFolder(), "text-bubbles.yml");
        if (!file.isFile()) plugin.saveResource("text-bubbles.yml", false);
        reload();
        Bukkit.getPluginManager().registerEvents(this, plugin);
        for (Player player : Bukkit.getOnlinePlayers()) refresh(player);
        startTask();
    }
    private void startTask() {
        if (task != null) task.cancel();
        task = Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 1, limits.ticks);
    }
    boolean reload() {
        try {
            if (file.length() > 16_384) throw new IllegalArgumentException("file too large");
            YamlConfiguration c = new YamlConfiguration(); c.load(file);
            if (integer(c,"schema-version",1,1) != 1) throw new IllegalArgumentException("schema-version");
            Limits next = new Limits(bool(c,"enabled"), integer(c,"view-distance",8,48),
                    integer(c,"duration-seconds",2,15), integer(c,"max-active",1,32),
                    integer(c,"max-pending",1,64), integer(c,"max-characters",16,160),
                    integer(c,"line-columns",16,48), integer(c,"max-lines",1,3),
                    integer(c,"update-ticks",4,20), integer(c,"replace-cooldown-ms",500,5000),
                    bool(c,"require-line-of-sight"));
            limits = next;
            clear(); // Existing messages never acquire a new audience after configuration changes.
            if (task != null) startTask();
            return true;
        } catch (Exception e) {
            plugin.getLogger().warning("Text bubble config rejected; keeping previous settings: " + e.getMessage());
            return false;
        }
    }
    private static int integer(YamlConfiguration c, String key, int min, int max) {
        Object value = c.get(key);
        if (!(value instanceof Integer n) || n < min || n > max) throw new IllegalArgumentException(key);
        return n;
    }
    private static boolean bool(YamlConfiguration c, String key) {
        Object value = c.get(key);
        if (!(value instanceof Boolean b)) throw new IllegalArgumentException(key);
        return b;
    }
    private void refresh(Player player) {
        UUID id = player.getUniqueId(), world = player.getWorld().getUID();
        boolean speaker = !plugin.isObserver(player) && !player.isDead() && !player.isInvisible();
        Session before = sessions.get(id);
        if (before == null || !before.world.equals(world) || before.speaker != speaker) {
            forget(id);
            sessions.put(id, new Session(world, sequence.incrementAndGet(), speaker));
        }
    }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void chat(AsyncChatEvent event) {
        Limits l = limits;
        UUID id = event.getPlayer().getUniqueId();
        Session session = sessions.get(id);
        if (!l.enabled || session == null || !session.speaker) return;
        String text = clean(PlainTextComponentSerializer.plainText().serialize(event.message()), l.characters);
        if (text.isEmpty()) return;
        Map<UUID, Long> viewers = new HashMap<>();
        for (var audience : event.viewers()) {
            if (audience instanceof Player viewer) {
                UUID viewerId = viewer.getUniqueId(); Session v = sessions.get(viewerId);
                if (v != null && v.world.equals(session.world)) viewers.put(viewerId, v.token);
            }
            if (viewers.size() >= 256) break;
        }
        if (viewers.isEmpty()) return;
        Speech speech = new Speech(id, session, Map.copyOf(viewers), text, sequence.incrementAndGet(), System.nanoTime());
        synchronized (pending) {
            if (!pending.containsKey(id) && pending.size() >= l.pending) { rejected.incrementAndGet(); return; }
            Speech previous = pending.get(id);
            if (previous == null || speech.sequence > previous.sequence) pending.put(id, speech);
        }
    }
    static String clean(String raw, int max) {
        StringBuilder out = new StringBuilder(); boolean format = false, gap = false; int count = 0;
        for (int i = 0; i < raw.length() && count < max;) {
            int cp = raw.codePointAt(i); i += Character.charCount(cp);
            if (format) { format = false; continue; }
            if (cp == 0xA7) { format = true; continue; }
            if (Character.isWhitespace(cp)) { gap = !out.isEmpty(); continue; }
            int type = Character.getType(cp);
            if (Character.isISOControl(cp) || type == Character.FORMAT || type == Character.SURROGATE) continue;
            if (gap && count + 1 < max) { out.append(' '); count++; }
            gap = false; out.appendCodePoint(cp); count++;
        }
        return out.toString();
    }
    private String wrap(String text) {
        Limits l = limits; StringBuilder out = new StringBuilder(); int width = 0, line = 1;
        for (int i = 0; i < text.length();) {
            int cp = text.codePointAt(i); i += Character.charCount(cp);
            int size = cp <= 0xFF ? 1 : 2;
            if (width + size > l.columns) {
                if (line == l.lines) { out.append('…'); break; }
                out.append('\n'); line++; width = 0;
            }
            out.appendCodePoint(cp); width += size;
        }
        return out.append("\n▼").toString();
    }
    private Location anchor(Player player) {
        Location at = player.getLocation().add(0, player.getHeight() + 0.35, 0);
        at.setYaw(0); at.setPitch(0); return at;
    }
    private void tick() {
        long began = System.nanoTime(), now = began; frames++;
        try {
            for (Player player : Bukkit.getOnlinePlayers()) refresh(player);
            if (!limits.enabled) return;
            ArrayList<Speech> ready = new ArrayList<>();
            synchronized (pending) {
                Iterator<Speech> iterator = pending.values().iterator();
                while (iterator.hasNext()) {
                    Speech speech = iterator.next(); Bubble bubble = active.get(speech.speaker);
                    if (now - speech.created > limits.seconds * 1_000_000_000L) { iterator.remove(); rejected.incrementAndGet(); }
                    else if (bubble == null || now - bubble.replaced >= limits.cooldown * 1_000_000L) {
                        iterator.remove(); ready.add(speech);
                    }
                }
            }
            for (Speech speech : ready) {
                try { show(speech, now); } catch (RuntimeException e) { failed(speech.speaker, e); }
            }
            for (UUID id : new ArrayList<>(active.keySet())) {
                Bubble bubble = active.get(id); Player speaker = Bukkit.getPlayer(id);
                if (speaker == null || !bubble.entity.isValid() || bubble.expires <= now
                        || !bubble.session.equals(sessions.get(id))) { remove(id); expired++; continue; }
                try {
                    Location at = anchor(speaker);
                    if (bubble.entity.getLocation().distanceSquared(at) > 0.0004) bubble.entity.teleport(at);
                    viewers(speaker, bubble);
                } catch (RuntimeException e) { failed(id, e); }
            }
        } finally { peakMicros = Math.max(peakMicros, (System.nanoTime() - began) / 1000); }
    }
    private void show(Speech speech, long now) {
        Player speaker = Bukkit.getPlayer(speech.speaker);
        if (speaker == null || !speech.session.equals(sessions.get(speech.speaker))) return;
        Bubble bubble = active.get(speech.speaker);
        if (bubble == null && active.size() >= limits.active) { rejected.incrementAndGet(); return; }
        if (bubble == null) {
            TextDisplay entity = speaker.getWorld().spawn(anchor(speaker), TextDisplay.class, display -> {
                display.setVisibleByDefault(false); // Before adding to the world: no spawn/metadata leak.
                display.setPersistent(false); display.setGravity(false); display.setInvulnerable(true);
                display.addScoreboardTag("af_text_bubble"); display.setBillboard(Display.Billboard.CENTER);
                display.setTeleportDuration(Math.min(10, limits.ticks)); display.setViewRange(1);
                display.setShadowed(true); display.setSeeThrough(false); display.setAlignment(TextDisplay.TextAlignment.CENTER);
                display.setDefaultBackground(false); display.setBackgroundColor(Color.fromARGB(175,22,29,40));
                display.setLineWidth(320); display.setBrightness(new Display.Brightness(15,15));
                display.text(Component.text(wrap(speech.text), NamedTextColor.WHITE));
            });
            bubble = new Bubble(entity, speech, speech.created + limits.seconds * 1_000_000_000L, now);
            active.put(speech.speaker, bubble); admitted++;
        } else {
            // Revoke previous recipients before changing text, even for another restricted chat audience.
            bubble.viewers = speech.viewers;
            for (UUID id : new HashSet<>(bubble.shown)) if (!canView(speaker, bubble, id)) hide(bubble, id);
            bubble.entity.text(Component.text(wrap(speech.text), NamedTextColor.WHITE));
            bubble.expires = speech.created + limits.seconds * 1_000_000_000L; bubble.replaced = now; replaced++;
        }
    }
    private void viewers(Player speaker, Bubble bubble) {
        Set<UUID> wanted = new HashSet<>();
        for (Map.Entry<UUID, Long> entry : bubble.viewers.entrySet()) {
            Player viewer = Bukkit.getPlayer(entry.getKey());
            if (!canView(speaker, bubble, entry.getKey())) continue;
            wanted.add(entry.getKey());
            if (bubble.shown.add(entry.getKey())) viewer.showEntity(plugin, bubble.entity);
        }
        for (UUID id : new HashSet<>(bubble.shown)) if (!wanted.contains(id)) hide(bubble, id);
    }
    private boolean canView(Player speaker, Bubble bubble, UUID id) {
        Player viewer = Bukkit.getPlayer(id); Session session = sessions.get(id); Long token = bubble.viewers.get(id);
        return viewer != null && session != null && token != null && session.token == token
                && viewer.getWorld() == speaker.getWorld() && viewer.canSee(speaker)
                && viewer.getLocation().distanceSquared(speaker.getLocation()) <= limits.range * limits.range
                && (!limits.sight || viewer == speaker || viewer.hasLineOfSight(speaker));
    }
    private void hide(Bubble bubble, UUID id) {
        Player viewer = Bukkit.getPlayer(id); if (viewer != null) viewer.hideEntity(plugin, bubble.entity);
        bubble.shown.remove(id);
    }
    private void failed(UUID id, RuntimeException e) {
        errors++; remove(id);
        if (errors <= 3) plugin.getLogger().warning("Text bubble stopped: " + e.getClass().getSimpleName());
    }
    private void remove(UUID id) { Bubble bubble = active.remove(id); if (bubble != null) bubble.entity.remove(); }
    private void forget(UUID id) { sessions.remove(id); synchronized (pending) { pending.remove(id); } remove(id); }
    private void clear() { synchronized (pending) { pending.clear(); } for (UUID id : new ArrayList<>(active.keySet())) remove(id); }
    void stop() { if (task != null) task.cancel(); clear(); sessions.clear(); }
    @EventHandler public void join(PlayerJoinEvent e) { refresh(e.getPlayer()); }
    @EventHandler public void quit(PlayerQuitEvent e) { forget(e.getPlayer().getUniqueId()); }
    @EventHandler public void world(PlayerChangedWorldEvent e) { forget(e.getPlayer().getUniqueId()); refresh(e.getPlayer()); }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)
    public void mode(PlayerGameModeChangeEvent e) { forget(e.getPlayer().getUniqueId()); }
    @EventHandler public void death(PlayerDeathEvent e) { forget(e.getEntity().getUniqueId()); }
    void say(Player player, String text) {
        String clean = clean(text, 160);
        if (clean.isEmpty() || clean.startsWith("/")) {
            player.sendMessage("§c请输入公开发言正文：/mycli say 大家好。私聊请用 /msg <玩家> <话>，私聊不会显示气泡。"); return;
        }
        player.chat(clean); // Same chat event, cancellation, recipient policy and NPC input handlers as normal chat.
    }
    void audit(CommandSender sender) {
        JsonObject o = new JsonObject(); o.addProperty("schemaVersion",1); o.addProperty("enabled",limits.enabled);
        o.addProperty("viewDistance",limits.range); o.addProperty("durationSeconds",limits.seconds);
        o.addProperty("maxActive",limits.active); o.addProperty("maxPending",limits.pending); o.addProperty("active",active.size());
        synchronized (pending) { o.addProperty("pending",pending.size()); }
        o.addProperty("admitted",admitted); o.addProperty("replaced",replaced); o.addProperty("expired",expired);
        o.addProperty("throttled",rejected.get()); o.addProperty("errors",errors); o.addProperty("frames",frames);
        o.addProperty("peakFrameMicros",peakMicros); o.addProperty("publicChatOnly",true); o.addProperty("clientModRequired",false);
        sender.sendMessage("MC_BUBBLES " + o);
    }
    void admin(CommandSender sender, String[] args) {
        if (args.length == 3 && args[2].equalsIgnoreCase("reload")) {
            sender.sendMessage("MC_BUBBLES_RELOAD status=" + (reload() ? "success" : "rejected")
                    + " next=编辑text-bubbles.yml后再次reload；失败保留上一份配置"); return;
        }
        if (args.length == 3 && args[2].equalsIgnoreCase("audit")) { audit(sender); return; }
        sender.sendMessage("mycli admin bubbles audit|reload；仅控制台维护，玩家用 /mycli bubbles 查看。");
    }
}
