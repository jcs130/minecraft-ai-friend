package dev.god.godvoice;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import org.bukkit.Bukkit;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/** Authenticated conversation delivery and per-player relationship views. */
final class NpcSocial {
    private static final long REPLY_WINDOW_MS = 120_000;
    private final PaperVoicePlugin plugin;
    private final NpcConversations residents;
    private final Path root;
    private record Pending(Player player, long at, UUID world, Set<Player> audience, boolean automatic) {}
    private final Map<UUID, Pending> pending = new HashMap<>();
    private final AtomicBoolean polling = new AtomicBoolean();

    NpcSocial(PaperVoicePlugin plugin, NpcConversations residents) {
        this.plugin = plugin;
        this.residents = residents;
        this.root = Bukkit.getWorlds().getFirst().getWorldFolder().toPath().resolve("data/tlm-companion-memory");
        Bukkit.getScheduler().runTaskTimerAsynchronously(plugin, this::poll, 20, 20);
    }

    private static JsonObject read(Path path) throws IOException {
        if (!Files.isRegularFile(path) || Files.size(path) > 32768) return null;
        return JsonParser.parseString(Files.readString(path, StandardCharsets.UTF_8)).getAsJsonObject();
    }

    private static void write(Path file, JsonObject row) throws IOException {
        Files.createDirectories(file.getParent());
        Path temp = Files.createTempFile(file.getParent(), ".social-", ".tmp");
        try {
            byte[] bytes = row.toString().getBytes(StandardCharsets.UTF_8);
            try (var channel = java.nio.channels.FileChannel.open(temp, java.nio.file.StandardOpenOption.WRITE)) {
                var buffer = java.nio.ByteBuffer.wrap(bytes);
                while (buffer.hasRemaining()) channel.write(buffer);
                channel.force(true);
            }
            Files.move(temp, file, StandardCopyOption.ATOMIC_MOVE);
        } finally {
            Files.deleteIfExists(temp);
        }
    }

    private Path directory(UUID body) {
        return root.resolve(body.toString());
    }

    private static String value(JsonObject row, String key) {
        return row != null && row.has(key) && row.get(key).isJsonPrimitive() ? row.get(key).getAsString() : "";
    }

    private JsonObject ready(UUID body) throws IOException {
        var row = read(directory(body).resolve("relationship-ready.json"));
        var roster = read(root.resolve("relationship-roster.json"));
        if (!"1".equals(value(row, "schemaVersion")) || !"1".equals(value(row, "policyVersion"))
                || !body.toString().equals(value(row, "bodyId")) || "false".equals(value(row, "enabled"))
                || !"1".equals(value(roster, "schemaVersion")) || value(row, "realm").isBlank()
                || !value(row, "realm").equals(value(roster, "realm"))
                || !value(row, "maidId").equals(value(roster.getAsJsonObject("bodies"), body.toString()))) {
            return null;
        }
        return row;
    }

    JsonObject view(UUID body, UUID speaker, boolean privateView) throws IOException {
        if (residents.profile(body) == null) return null;
        var active = ready(body);
        if (active == null) return null;
        var roster = read(root.resolve("relationship-roster.json"));
        String character = value(roster.getAsJsonObject("bodies"), speaker.toString());
        String peerType = character.isEmpty() ? "player" : "npc";
        String peerId = character.isEmpty() ? speaker.toString() : UUID.fromString(character).toString();
        String visibility = privateView ? "peer_only" : "public";
        var peer = new JsonObject();
        peer.addProperty("type", peerType);
        peer.addProperty("id", peerId);
        var row = read(directory(body).resolve("relationship-" + peerType + "-" + peerId + ".json"));
        if (row == null) {
            var empty = new JsonObject();
            empty.addProperty("schemaVersion", 1);
            empty.addProperty("policyVersion", 1);
            empty.add("peer", peer);
            empty.addProperty("visibility", visibility);
            empty.addProperty("familiarity", "初识");
            empty.addProperty("trust", "待建立");
            empty.add("evidence", new JsonArray());
            return empty;
        }
        for (String key : new String[]{"realm", "maidId", "bodyId", "schemaVersion", "policyVersion"}) {
            if (!value(active, key).equals(value(row, key))) return null;
        }
        var selected = row.getAsJsonObject(privateView ? "peerOnly" : "public");
        if (!peer.equals(selected.get("peer")) || !visibility.equals(value(selected, "visibility"))) return null;
        selected.remove("scores");
        selected.remove("sourceCount");
        var evidence = selected.getAsJsonArray("evidence");
        while (evidence.size() > 3) evidence.remove(evidence.size() - 1);
        return selected;
    }

    boolean command(CommandSender sender, org.bukkit.command.Command command, String label, String[] args) {
        if (!(sender instanceof Player player) || args.length == 0) return false;
        var target = residents.find(args[0]);
        if (target == null) {
            player.sendMessage("找不到这位登记居民。");
            return true;
        }
        try {
            if (args.length >= 3 && args[1].equalsIgnoreCase("tell")) {
                UUID request = queue(target.id(), player, String.join(" ", java.util.Arrays.copyOfRange(args, 2, args.length)), true);
                player.sendMessage("私聊已提交 " + request);
            } else if (args.length >= 3 && args[1].equalsIgnoreCase("public")) {
                UUID request = queue(target.id(), player, String.join(" ", java.util.Arrays.copyOfRange(args, 2, args.length)), false);
                player.sendMessage("公开交谈已提交 " + request);
            } else if (args.length == 3 && args[1].equalsIgnoreCase("receipt")) {
                JsonObject receipt = receipt(target.id(), player.getUniqueId(), UUID.fromString(args[2]));
                if (receipt == null) throw new IllegalArgumentException("找不到这条对话");
                player.sendMessage("MC_NPC_SOCIAL " + receipt);
            } else if (args.length == 1 || args.length == 2 && args[1].equalsIgnoreCase("json")) {
                var snapshot = view(target.id(), player.getUniqueId(), true);
                if (snapshot == null) throw new IllegalArgumentException("这位居民的关系记忆暂不可用");
                if (args.length == 2) player.sendMessage("MC_NPC_SOCIAL " + snapshot);
                else {
                    player.sendMessage(target.name() + " · " + value(snapshot, "familiarity") + " · " + value(snapshot, "trust"));
                    for (var entry : snapshot.getAsJsonArray("evidence")) player.sendMessage("  " + value(entry.getAsJsonObject(), "summary"));
                }
            } else return false;
        } catch (IllegalArgumentException denied) {
            player.sendMessage("居民关系：" + denied.getMessage());
        } catch (Exception unavailable) {
            player.sendMessage("居民关系暂不可用。");
        }
        return true;
    }

    private JsonObject receipt(UUID body, UUID speaker, UUID id) throws IOException {
        Path folder = directory(body);
        var source = read(folder.resolve(id + "-request.json"));
        if (!speaker.toString().equals(value(source, "speakerId"))
                || !id.toString().equals(value(source, "id")) || !body.toString().equals(value(source, "maidId"))
                || !"social_dialogue".equals(value(source, "kind"))) return null;
        var result = read(folder.resolve(id + "-result.json"));
        if (speaker.toString().equals(value(result, "speakerId")) && id.toString().equals(value(result, "id"))
                && body.toString().equals(value(result, "maidId"))) return result;
        var state = new JsonObject();
        state.addProperty("id", id.toString());
        var started = Files.exists(folder.resolve(id + "-sending.json"));
        boolean expired = System.currentTimeMillis() - source.get("at").getAsLong() > REPLY_WINDOW_MS;
        state.addProperty("status", started ? "unknown" : expired ? "expired" : "accepted");
        return state;
    }

    UUID queue(UUID body, Player speaker, String message, boolean privateDialogue) throws IOException {
        return enqueue(body,speaker,message,privateDialogue?"private":"public",null,false);
    }

    boolean natural(NpcDialoguePolicy.Profile profile, Player speaker, String message, String scope, Set<UUID> viewers) {
        try {
            if(ready(profile.id())==null)return false;
            Set<Player> audience=new HashSet<>();
            for(UUID viewer:viewers){
                Player current=Bukkit.getPlayer(viewer);
                if(current!=null)audience.add(current);
            }
            enqueue(profile.id(),speaker,message,scope,Set.copyOf(audience),true);
        }catch(IllegalArgumentException busy){
            // The explicitly addressed resident already owns this dialogue lane.
        }catch(IOException unavailable){
            plugin.getLogger().fine("NPC natural dialogue could not be saved: "+unavailable.getClass().getSimpleName());
        }
        return true;
    }

    private UUID enqueue(UUID body, Player speaker, String message, String scope, Set<Player> audience, boolean automatic) throws IOException {
        var entity = residents.live(body);
        if (!Bukkit.isPrimaryThread() || Bukkit.getPlayer(speaker.getUniqueId()) != speaker || ready(body) == null
                || entity == null || body.equals(speaker.getUniqueId()))
            throw new IllegalArgumentException("居民对话暂不可用");
        if (!scope.equals("private") && !residents.hears(speaker, entity, residents.profile(body)))
            throw new IllegalArgumentException("请靠近居民并退出旁观模式");
        if (message.isBlank() || message.codePointCount(0, message.length()) > 400
                || message.codePoints().anyMatch(cp -> Character.isISOControl(cp) || cp == 0xA7))
            throw new IllegalArgumentException("请输入一行不超过 400 字的消息");
        long now = System.currentTimeMillis();
        pending.values().removeIf(item -> now - item.at() > REPLY_WINDOW_MS);
        if (pending.size() >= 256 || pending.values().stream().anyMatch(item -> item.player() == speaker))
            throw new IllegalArgumentException("请等前一条对话完成");
        UUID request = UUID.randomUUID();
        var row = new JsonObject();
        row.addProperty("schemaVersion", 1);
        row.addProperty("kind", "social_dialogue");
        row.addProperty("id", request.toString());
        row.addProperty("maidId", body.toString());
        row.addProperty("speakerId", speaker.getUniqueId().toString());
        row.addProperty("message", message);
        row.addProperty("channel", scope);
        row.addProperty("at", now);
        row.addProperty("status", "accepted");
        write(directory(body).resolve(request + "-request.json"), row);
        pending.put(request, new Pending(speaker, now, speaker.getWorld().getUID(), audience, automatic));
        return request;
    }

    private void poll() {
        if (!polling.compareAndSet(false, true)) return;
        try {
            for (var profile : residents.profiles()) {
                Path folder = directory(profile.id());
                if (!Files.isDirectory(folder)) continue;
                try (var paths = Files.list(folder)) {
                    for (Path answer : paths.filter(file -> file.getFileName().toString().matches("[a-f0-9-]{36}-answer\\.json")).limit(8).toList()) {
                        try { claim(profile, folder, answer); }
                        catch (IOException | RuntimeException unavailable) {
                            plugin.getLogger().fine("NPC reply not claimed: " + unavailable.getClass().getSimpleName());
                        }
                    }
                }
            }
        } catch (Exception unavailable) {
            plugin.getLogger().fine("NPC dialogue mailbox advance interrupted: " + unavailable.getClass().getSimpleName());
        } finally {
            polling.set(false);
        }
    }

    private void claim(NpcDialoguePolicy.Profile profile, Path folder, Path answer) throws IOException {
        var row = read(answer);
        if (!"1".equals(value(row, "schemaVersion"))) return;
        UUID request = UUID.fromString(value(row, "id"));
        if (!answer.getFileName().toString().equals(request + "-answer.json")) return;
        var submitted = read(folder.resolve(request + "-request.json"));
        if (!profile.id().toString().equals(value(row, "maidId"))
                || !value(row, "maidId").equals(value(submitted, "maidId"))
                || !value(row, "speakerId").equals(value(submitted, "speakerId"))
                || !value(row, "channel").equals(value(submitted, "channel"))
                || !request.toString().equals(value(submitted, "id"))
                || !"accepted".equals(value(submitted, "status")) || !"1".equals(value(submitted, "schemaVersion"))
                || !"social_dialogue".equals(value(submitted, "kind"))
                || !Set.of("private", "public", "nearby").contains(value(submitted, "channel"))) return;
        Path result = folder.resolve(request + "-result.json");
        Path sending = folder.resolve(request + "-sending.json");
        if (Files.exists(result) || Files.exists(sending)) return;
        Files.move(answer, sending, StandardCopyOption.ATOMIC_MOVE);
        Bukkit.getScheduler().runTask(plugin, () -> deliver(profile, request, submitted, row, result));
    }

    private void deliver(NpcDialoguePolicy.Profile profile, UUID request, JsonObject submitted, JsonObject answer, Path target) {
        Pending source = pending.remove(request);
        submitted.addProperty("status", "failed");
        boolean privateDialogue = "private".equals(value(submitted, "channel"));
        if (source != null && Bukkit.getPlayer(source.player().getUniqueId()) == source.player()
                && source.player().getUniqueId().toString().equals(value(submitted, "speakerId"))
                && (!source.automatic() || source.world().equals(source.player().getWorld().getUID()))
                && System.currentTimeMillis() - source.at() <= REPLY_WINDOW_MS) {
            String reply = value(answer, "reply");
            boolean valid = "prepared".equals(value(answer, "status")) && !reply.isBlank() && reply.codePointCount(0, reply.length()) <= 140
                    && reply.codePoints().noneMatch(cp -> Character.isISOControl(cp) || cp == 0xA7);
            var body = residents.live(profile.id());
            if (valid && (privateDialogue && !source.automatic() || residents.hears(source.player(), body, profile))) {
                String line=(privateDialogue && !source.automatic() ? "[私聊] " : "[居民] ")
                    +(source.automatic()?profile.display():profile.name())+"："+reply;
                source.player().sendMessage(line);
                Map<UUID,Player> heard=new HashMap<>();
                heard.put(source.player().getUniqueId(),source.player());
                if(!privateDialogue) for (Player nearby : body.getWorld().getPlayers()) {
                    if (nearby!=source.player() && (source.audience()==null||source.audience().stream().anyMatch(captured->captured==nearby))
                            && residents.hears(nearby, body, profile)){
                        nearby.sendMessage(line);
                        heard.put(nearby.getUniqueId(),nearby);
                    }
                }
                submitted.addProperty("status", "answered");
                submitted.addProperty("reply", reply);
                submitted.addProperty("completedAt", System.currentTimeMillis());
                if(profile.kind().equals("numen")){
                    try{plugin.speakHostedReply(profile,request,reply,source.player(),privateDialogue,heard);}
                    catch(RuntimeException unavailable){plugin.getLogger().warning("Hosted social reply audio unavailable for request "+request);}
                }
            } else if(!source.automatic()) source.player().sendMessage(profile.name() + "暂时无法回复。");
        }
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try { write(target, submitted); }
            catch (IOException failure) { plugin.getLogger().fine("NPC outcome pending inspection for " + request); }
        });
    }
}
