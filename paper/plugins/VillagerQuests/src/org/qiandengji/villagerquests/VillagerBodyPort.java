package org.qiandengji.villagerquests;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.lang.reflect.Method;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.logging.Level;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.attribute.Attribute;
import org.bukkit.entity.Enemy;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Villager;
import org.bukkit.entity.memory.MemoryKey;
import org.bukkit.plugin.Plugin;
import org.bukkit.persistence.PersistentDataType;
import org.qiandengji.villagerquests.BodyReceiptLedger.Entry;
import org.qiandengji.villagerquests.BodyReceiptLedger.Status;
import org.qiandengji.villagerquests.core.Text;

/** Authenticated bind-existing control port. Every game observation and mutation runs on the server thread. */
final class VillagerBodyPort {
    static final String PROTOCOL = "qiandengji-villager-body/v1";
    private static final List<String> ACTIONS = List.of("context", "inbox", "walk", "speak", "stop", "receipt");

    private record Settings(boolean enabled, int port, Path tokenFile, Map<String, VillagerBodyRules.Binding> bindings) {}
    private record Lease(VillagerBodyRules.Binding binding, String generation, long expiresAt) {}
    private record Event(long sequence, String eventId, UUID speakerId, String speaker, String text, String channel,
                         String deliveryScope, long occurredAt, String world, String generation) {}
    private record Walk(String residentId, UUID bodyId, String controllerId, String generation, String operationId,
                        Location target, long deadline) {
        JsonObject observation(long now) {
            JsonObject row = position(target);
            row.addProperty("observedAt", now);
            return row;
        }
    }
    record Reply(int status, JsonObject json) {}

    private final VillagerQuestsPlugin plugin;
    private final NamespacedKey residentKey = NamespacedKey.fromString("qiandeng-villager-quests:resident-id");
    private final Path configPath;
    private final BodyReceiptLedger ledger;
    private final NativeVillagerWalk walk;
    private final Map<String, VillagerBodyRules.Binding> bindings = new LinkedHashMap<>();
    private final Map<UUID, Lease> leases = new HashMap<>();
    private final Map<UUID, List<Event>> events = new HashMap<>();
    private final Map<UUID, Long> eventSequences = new HashMap<>();
    private final Map<UUID, Walk> pendingWalks = new HashMap<>();
    private Settings settings;
    private boolean ledgerReady = true;
    private HttpServer server;
    private volatile String token;
    private Plugin voice;
    private Method bindVoice, speakReply, speakReplyDirect, speakNearby, nearbyAudience, speechStatus, recordManagedReply;
    private boolean voiceWarning;
    private Plugin bubbles;
    private Method managedBubble;
    private boolean bubbleWarning;

    VillagerBodyPort(VillagerQuestsPlugin plugin) {
        this.plugin = plugin;
        this.configPath = plugin.getDataFolder().toPath().resolve("villager-body-port.json");
        this.ledger = new BodyReceiptLedger(plugin.getDataFolder().toPath().resolve("villager-body-receipts"));
        this.walk = new NativeVillagerWalk(plugin.getLogger());
        try { ledger.load(); } catch (IOException failure) {
            ledgerReady = false;
            plugin.getLogger().log(Level.SEVERE, "Body receipts could not be loaded; refusing all writes until restart", failure);
        }
    }

    synchronized void reload() throws IOException {
        Settings next = readSettings();
        if (!next.enabled()) {
            stop();
            settings = next;
            bindings.clear();
            bindings.putAll(next.bindings());
            plugin.getLogger().info("Villager body port disabled");
            return;
        }
        String nextToken = readToken(next.tokenFile());
        if (server != null && server.getAddress().getPort() == next.port()) serverStop();
        HttpServer nextServer = open(next.port(), nextToken);
        stop();
        settings = next;
        token = nextToken;
        server = nextServer;
        bindings.clear();
        bindings.putAll(next.bindings());
        nextServer.start();
        plugin.getLogger().info("Villager body port listening on loopback:" + next.port() + " for " + next.bindings().size() + " configured bodies");
    }

    private Settings readSettings() throws IOException {
        if (Files.notExists(configPath)) return new Settings(false, 0, configPath.resolveSibling("villager-body.token"), Map.of());
        JsonObject root = JsonParser.parseString(Files.readString(configPath, StandardCharsets.UTF_8)).getAsJsonObject();
        if (root.get("schema").getAsInt() != 1) throw new IllegalArgumentException("villager-body-port schema must be 1");
        boolean enabled = root.get("enabled").getAsBoolean();
        int port = root.get("port").getAsInt();
        if (port < 1 || port > 65535) throw new IllegalArgumentException("body port must be 1..65535");
        String tokenName = root.get("tokenFile").getAsString();
        Path rootPath = plugin.getDataFolder().toPath().toAbsolutePath().normalize();
        Path tokenPath = Path.of(tokenName);
        tokenPath = (tokenPath.isAbsolute() ? tokenPath : rootPath.resolve(tokenPath)).toAbsolutePath().normalize();
        if (!tokenPath.startsWith(rootPath) || tokenPath.equals(rootPath)) throw new IllegalArgumentException("tokenFile must stay inside the plugin data folder");
        Map<String, VillagerBodyRules.Binding> parsed = new LinkedHashMap<>();
        for (VillagerBodyRules.Binding binding : VillagerBodyRules.bindings(root.getAsJsonArray("bindings"))) {
            Villagers.Spot spot = plugin.villagers.spot(binding.residentId());
            if (spot == null || spot.entityUuid() == null || !spot.entityUuid().equals(binding.bodyId())
                    || spot.npcId() != null || spot.serviceCounter() != null)
                throw new IllegalArgumentException("binding is not a configured non-service native villager: " + binding.residentId());
            if (parsed.containsKey(binding.residentId())
                    || parsed.values().stream().anyMatch(old -> old.bodyId().equals(binding.bodyId())))
                throw new IllegalArgumentException("duplicate resident/body binding");
            parsed.put(binding.residentId(), binding);
        }
        return new Settings(enabled, port, tokenPath, Map.copyOf(parsed));
    }

    private String readToken(Path file) throws IOException {
        if (!Files.isRegularFile(file) || Files.size(file) > 4096) throw new IOException("body tokenFile must be a regular file of at most 4096 bytes");
        String value = Files.readString(file, StandardCharsets.UTF_8).strip();
        if (value.length() < 16 || value.length() > 512 || value.chars().anyMatch(Character::isWhitespace))
            throw new IOException("body token must contain 16..512 non-whitespace characters");
        return value;
    }

    private HttpServer open(int port, String expectedToken) throws IOException {
        HttpServer http = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), port), 32);
        http.createContext("/villager-body", new VillagerBodyHttp(this, expectedToken));
        return http;
    }

    synchronized void close() {
        stop();
    }

    private synchronized void stop() {
        long now = System.currentTimeMillis();
        for (Lease lease : List.copyOf(leases.values())) release(lease, now, "server_stopping");
        serverStop();
    }

    private void serverStop() {
        if (server != null) { server.stop(0); server = null; }
        token = null;
    }

    boolean active() { return settings != null && settings.enabled() && server != null && !plugin.closing && plugin.isEnabled(); }
    VillagerQuestsPlugin plugin() { return plugin; }

    boolean controls(UUID body) {
        Lease lease = leases.get(body);
        return lease != null && VillagerBodyRules.leaseActive(lease.expiresAt(), System.currentTimeMillis());
    }

    void tick(long now) {
        if (!Bukkit.isPrimaryThread()) return;
        expire(now);
        for (Lease lease : List.copyOf(leases.values())) bindInbox(lease);
        for (Walk pending : List.copyOf(pendingWalks.values())) observeWalk(pending, now);
    }

    private void expire(long now) {
        for (Lease lease : List.copyOf(leases.values())) if (lease.expiresAt() < now) release(lease, now, "lease_expired");
    }

    private void release(Lease lease, long now, String reason) {
        leases.remove(lease.binding().bodyId());
        Walk pending = pendingWalks.get(lease.binding().bodyId());
        if (pending != null && pending.generation().equals(lease.generation())) {
            clearWalk(pending);
            pendingWalks.remove(pending.bodyId());
            finish(pending.operationId(), Status.FAILED, reason, pending.observation(now));
        }
    }

    Reply dispatch(JsonObject request, byte[] authenticatedToken) {
        if (!Bukkit.isPrimaryThread() || !active()) return error(503, "port_disabled", "Body port is not active");
        if (token == null || !MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8), authenticatedToken))
            return error(401, "unauthorized", "Authentication changed before main-thread dispatch");
        try {
            String operation = request.has("operation") && request.get("operation").isJsonPrimitive()
                    ? request.get("operation").getAsString() : "";
            if ("roster".equals(operation)) return roster();
            if (!List.of("bind", "release", "call").contains(operation)) return error(400, "bad_operation", "Unknown operation");
            VillagerBodyRules.Binding binding = binding(request);
            if (binding == null) return error(403, "binding_not_allowed", "Resident/body/controller is not configured");
            return switch (operation) {
                case "bind" -> bind(binding);
                case "release" -> release(request, binding);
                case "call" -> call(request, binding);
                default -> error(400, "bad_operation", "Unknown operation");
            };
        } catch (RuntimeException failure) {
            plugin.getLogger().log(Level.WARNING, "Body request failed", failure);
            return error(500, "internal_error", "Body request failed");
        }
    }

    private VillagerBodyRules.Binding binding(JsonObject request) {
        String resident = string(request, "residentId");
        UUID body = VillagerBodyRules.uuid(string(request, "bodyId"));
        UUID controller = VillagerBodyRules.uuid(string(request, "controllerId"));
        if (resident == null || body == null || controller == null) return null;
        VillagerBodyRules.Binding expected = bindings.get(resident);
        return expected != null && expected.bodyId().equals(body) && expected.controllerId().equals(controller) ? expected : null;
    }

    private Reply roster() {
        JsonArray rows = new JsonArray();
        for (VillagerBodyRules.Binding binding : bindings.values()) {
            Villagers.Spot spot = plugin.villagers.spot(binding.residentId());
            EntityView view = body(binding, false);
            JsonObject row = new JsonObject();
            row.addProperty("residentId", binding.residentId());
            row.addProperty("bodyId", binding.bodyId().toString());
            row.addProperty("controllerId", binding.controllerId().toString());
            row.addProperty("name", spot.name());
            row.addProperty("managed", identityAllowed(binding) && (plugin.lives == null || !plugin.lives.blocksHandoff(binding.residentId())));
            row.addProperty("loaded", view != null);
            row.addProperty("profession", view == null ? "unknown" : view.villager.getProfession().getKey().toString());
            rows.add(row);
        }
        JsonObject envelope = new JsonObject();
        envelope.addProperty("protocol", PROTOCOL);
        envelope.add("villagers", rows);
        return new Reply(200, envelope);
    }

    private Reply bind(VillagerBodyRules.Binding binding) {
        expire(System.currentTimeMillis());
        Lease prior = leases.get(binding.bodyId());
        if (prior != null && !prior.binding().controllerId().equals(binding.controllerId()))
            return error(409, "controller_conflict", "Body already has a live controller generation");
        EntityView view = body(binding, true);
        if (view == null) return error(409, "body_unavailable", "Original body must be loaded, alive, native, AI-enabled and not trading");
        if (plugin.lives != null && plugin.lives.blocksHandoff(binding.residentId()))
            return error(409, "life_blocked", "Resident life/handoff state blocks control");
        if (prior != null) release(prior, System.currentTimeMillis(), "generation_replaced");
        view.villager.getPersistentDataContainer().set(residentKey, PersistentDataType.STRING, binding.residentId());
        String generation = UUID.randomUUID().toString();
        leases.put(binding.bodyId(), new Lease(binding, generation, System.currentTimeMillis() + VillagerBodyRules.LEASE_MS));
        bindInbox(leases.get(binding.bodyId()));
        JsonObject envelope = new JsonObject();
        envelope.addProperty("protocol", PROTOCOL);
        envelope.addProperty("residentId", binding.residentId());
        envelope.addProperty("bodyId", binding.bodyId().toString());
        envelope.addProperty("controllerId", binding.controllerId().toString());
        envelope.addProperty("generation", generation);
        envelope.addProperty("leaseTimeoutMs", VillagerBodyRules.LEASE_MS);
        envelope.add("tools", tools());
        return new Reply(200, envelope);
    }

    private Reply release(JsonObject request, VillagerBodyRules.Binding binding) {
        expire(System.currentTimeMillis());
        Lease lease = leases.get(binding.bodyId());
        if (lease == null || !lease.generation().equals(string(request, "generation")))
            return error(409, "generation_mismatch", "No matching controller generation");
        release(lease, System.currentTimeMillis(), "controller_released");
        JsonObject data = new JsonObject();
        data.addProperty("released", true);
        return identified(data, binding, lease.generation());
    }

    private Reply call(JsonObject request, VillagerBodyRules.Binding binding) {
        JsonElement argsElement = request.get("arguments");
        if (argsElement == null || !argsElement.isJsonObject()) return error(400, "bad_arguments", "arguments must be an object");
        JsonObject args = argsElement.getAsJsonObject();
        String action = string(args, "action");
        if (!ACTIONS.contains(action)) return error(400, "bad_action", "Unknown mc_villager action");
        if (!"mc_villager".equals(string(request, "tool"))) return error(400, "bad_tool", "Only mc_villager is available");
        String generation = string(request, "generation");
        if (generation == null || VillagerBodyRules.uuid(generation) == null)
            return error(400, "bad_generation", "generation must be a canonical UUID");
        String operationId = VillagerBodyRules.operationId(request, args);
        JsonObject identity = new JsonObject();
        identity.addProperty("residentId", binding.residentId());
        identity.addProperty("bodyId", binding.bodyId().toString());
        identity.addProperty("controllerId", binding.controllerId().toString());
        identity.addProperty("generation", generation);
        identity.addProperty("action", action);
        identity.add("arguments", args.deepCopy());
        String fingerprint = VillagerBodyRules.fingerprint(identity);
        boolean write = !List.of("context", "inbox", "receipt").contains(action);
        long now = System.currentTimeMillis();
        expire(now);
        Entry existing = operationId == null ? null : ledger.get(operationId);
        if (existing != null) {
            if (!same(existing, binding, generation, action, fingerprint)) return error(409, "request_id_conflict", "Original request ID has different immutable arguments");
            return receiptReply(existing);
        }
        if ("receipt".equals(action)) {
            String requested = string(args, "operationId");
            Entry found = requested == null ? null : ledger.get(requested);
            if (found != null && !same(found, binding, generation, found.action(), found.fingerprint()))
                return error(403, "receipt_not_owned", "Receipt belongs to another controller generation");
            if (found == null) {
                JsonObject data = new JsonObject();
                Entry unknown = new Entry(binding.residentId(), binding.bodyId().toString(), binding.controllerId().toString(),
                        generation, requested == null ? "" : requested, "unknown", Status.UNKNOWN, true,
                        System.currentTimeMillis(), new JsonObject(), "");
                data.add("receipt", unknown.toJson());
                data.addProperty("found", false);
                return tool(true, null, data, binding, generation);
            }
            return receiptReply(found);
        }
        Lease lease = leases.get(binding.bodyId());
        if (lease == null || !lease.generation().equals(generation)) {
            if (!write) return error(409, "lease_expired", "Controller generation is not current");
            return rejected(binding, generation, action, operationId, fingerprint, "lease_expired");
        }
        lease = new Lease(lease.binding(), lease.generation(), System.currentTimeMillis() + VillagerBodyRules.LEASE_MS);
        leases.put(binding.bodyId(), lease);
        if (!write) return switch (action) {
            case "context" -> context(binding, generation);
            case "inbox" -> inbox(binding, generation, args);
            default -> error(400, "bad_action", "Unknown read action");
        };
        if (operationId == null) return error(400, "request_id_mismatch", "Writes require matching outer and arguments requestId");
        EntityView view = body(binding, true);
        if (view == null) return rejected(binding, generation, action, operationId, fingerprint, "body_unavailable");
        if (plugin.lives != null && plugin.lives.blocksHandoff(binding.residentId()))
            return rejected(binding, generation, action, operationId, fingerprint, "life_blocked");
        Entry accepted = new Entry(binding.residentId(), binding.bodyId().toString(), binding.controllerId().toString(),
                generation, operationId, action, Status.ACCEPTED, false, now, new JsonObject(), fingerprint);
        if (!persist(accepted)) return unknown(binding, generation, action, operationId);
        JsonObject data;
        try {
            data = switch (action) {
                case "walk" -> startWalk(binding, generation, operationId, view, args, now);
                case "speak" -> speak(binding, generation, operationId, view, args, now);
                case "stop" -> stop(binding, generation, view);
                default -> throw new IllegalArgumentException("Unsupported write");
            };
        } catch (RuntimeException failure) {
            JsonObject reason = new JsonObject();
            reason.addProperty("code", failure.getMessage() == null ? "action_failed" : failure.getMessage());
            finish(operationId, Status.FAILED, failure.getMessage(), reason);
            return receiptReply(ledger.get(operationId));
        }
        if ("walk".equals(action)) {
            Entry current = ledger.get(operationId);
            Entry acceptedWithObservation = new Entry(current.residentId(), current.bodyId(), current.controllerId(), current.generation(),
                    current.operationId(), current.action(), Status.ACCEPTED, false, current.observedAt(), data, current.fingerprint());
            try { ledger.put(acceptedWithObservation); }
            catch (IOException observationFailure) {
                plugin.getLogger().log(Level.SEVERE, "Walk accepted receipt observation could not be updated; original accepted receipt remains authoritative", observationFailure);
            }
        } else {
            finish(operationId, Status.COMPLETED, null, data);
        }
        return receiptReply(ledger.get(operationId));
    }

    private boolean same(Entry entry, VillagerBodyRules.Binding binding, String generation, String action, String fingerprint) {
        return entry != null && binding.residentId().equals(entry.residentId()) && binding.bodyId().toString().equals(entry.bodyId())
                && binding.controllerId().toString().equals(entry.controllerId()) && generation != null
                && generation.equals(entry.generation()) && action.equals(entry.action()) && fingerprint.equals(entry.fingerprint());
    }

    private Reply rejected(VillagerBodyRules.Binding binding, String generation, String action, String operationId,
                           String fingerprint, String code) {
        if (operationId == null) return error(400, "request_id_mismatch", "Writes require matching requestId");
        JsonObject data = new JsonObject();
        data.addProperty("code", code);
        Entry rejected = new Entry(binding.residentId(), binding.bodyId().toString(), binding.controllerId().toString(),
                generation, operationId, action, Status.REJECTED, true, System.currentTimeMillis(), data, fingerprint);
        if (!persist(rejected)) return unknown(binding, generation, action, operationId);
        return receiptReply(rejected);
    }

    private Reply unknown(VillagerBodyRules.Binding binding, String generation, String action, String operationId) {
        JsonObject data = new JsonObject();
        data.addProperty("code", "receipt_persistence_failed");
        data.addProperty("retryAllowed", false);
        Entry unknown = new Entry(binding.residentId(), binding.bodyId().toString(), binding.controllerId().toString(),
                generation, operationId, action, Status.UNKNOWN, true, System.currentTimeMillis(), data, "");
        JsonObject result = new JsonObject();
        result.add("receipt", unknown.toJson());
        return tool(false, "receipt_persistence_failed", result, binding, generation);
    }

    private boolean persist(Entry entry) {
        if (!ledgerReady) return false;
        try { return ledger.put(entry); }
        catch (IOException failure) {
            plugin.getLogger().log(Level.SEVERE, "Body receipt could not be persisted; operation was not executed", failure);
            return false;
        }
    }

    private void finish(String operationId, Status status, String reason, JsonElement data) {
        Entry old = ledger.get(operationId);
        if (old == null || old.terminal()) return;
        JsonObject result = data == null ? new JsonObject() : data.deepCopy().getAsJsonObject();
        if (reason != null) result.addProperty("reason", reason);
        Entry terminal = new Entry(old.residentId(), old.bodyId(), old.controllerId(), old.generation(), old.operationId(),
                old.action(), status, true, System.currentTimeMillis(), result, old.fingerprint());
        if (!persist(terminal)) plugin.getLogger().severe("Terminal receipt update failed for " + operationId + "; original remains non-terminal and will not replay");
    }

    private Reply context(VillagerBodyRules.Binding binding, String generation) {
        EntityView view = body(binding, false);
        if (view == null) return error(409, "body_unavailable", "Original body is not loaded");
        Villager v = view.villager;
        Location at = v.getLocation();
        JsonObject data = new JsonObject();
        data.addProperty("protocol", PROTOCOL);
        data.addProperty("residentId", binding.residentId());
        data.addProperty("bodyId", binding.bodyId().toString());
        data.addProperty("controllerId", binding.controllerId().toString());
        data.addProperty("name", plugin.name(binding.residentId()));
        data.addProperty("profession", v.getProfession().getKey().toString());
        data.addProperty("level", v.getVillagerLevel());
        data.addProperty("health", v.getHealth());
        data.addProperty("maxHealth", v.getAttribute(Attribute.GENERIC_MAX_HEALTH).getValue());
        data.add("position", position(at));
        data.addProperty("dimension", at.getWorld().getKey().toString());
        data.addProperty("world", at.getWorld().getName());
        data.addProperty("gameTime", at.getWorld().getTime());
        data.addProperty("sleeping", v.isSleeping());
        data.addProperty("ai", v.hasAI());
        data.addProperty("trading", v.getTrader() != null);
        data.add("home", location(v.getMemory(MemoryKey.HOME)));
        data.add("jobSite", location(v.getMemory(MemoryKey.JOB_SITE)));
        JsonArray players = new JsonArray(), hostiles = new JsonArray();
        for (Player player : at.getWorld().getPlayers()) if (eligibleNearby(player, v, false)) {
            JsonObject row = new JsonObject();
            row.addProperty("uuid", player.getUniqueId().toString());
            row.addProperty("name", player.getName());
            row.add("position", position(player.getLocation()));
            row.addProperty("dimension", player.getWorld().getKey().toString());
            players.add(row);
        }
        for (var entity : v.getNearbyEntities(16, 8, 16)) if (entity instanceof Enemy hostile) {
            JsonObject row = new JsonObject();
            row.addProperty("id", hostile.getUniqueId().toString());
            row.addProperty("type", hostile.getType().getKey().toString());
            hostiles.add(row);
        }
        data.add("nearbyPlayers", players);
        data.add("hostilesNearby", hostiles);
        JsonArray open = new JsonArray();
        if (plugin.board != null) plugin.board.open().stream().filter(q -> q.commission.issuer().equals(binding.residentId())).limit(16).forEach(q -> {
            JsonObject row = new JsonObject();
            row.addProperty("id", q.id);
            row.addProperty("title", q.commission.title());
            open.add(row);
        });
        data.add("openCommissions", open);
        data.addProperty("observedAt", System.currentTimeMillis());
        return tool(true, null, data, binding, generation);
    }

    private Reply inbox(VillagerBodyRules.Binding binding, String generation, JsonObject args) {
        long cursor = VillagerBodyRules.cursor(args);
        if (cursor < 0) return error(400, "bad_cursor", "cursor must be a non-negative integer");
        List<Event> log = events.getOrDefault(binding.bodyId(), List.of());
        JsonArray page = new JsonArray();
        long next = cursor;
        for (Event event : log) {
            if (event.sequence() <= cursor) continue;
            JsonObject row = new JsonObject();
            row.addProperty("sequence", event.sequence());
            row.addProperty("eventId", event.eventId());
            row.addProperty("residentId", binding.residentId());
            row.addProperty("bodyId", binding.bodyId().toString());
            row.addProperty("listenerId", binding.bodyId().toString());
            row.addProperty("speakerId", event.speakerId().toString());
            row.addProperty("speaker", event.speaker());
            row.addProperty("text", event.text());
            row.addProperty("channel", event.channel());
            row.addProperty("deliveryScope", event.deliveryScope());
            row.addProperty("occurredAt", event.occurredAt());
            row.addProperty("world", event.world());
            page.add(row);
            next = event.sequence();
            if (page.size() == 32) break;
        }
        JsonObject data = new JsonObject();
        data.add("events", page);
        data.addProperty("nextCursor", next);
        data.addProperty("retained", log.size());
        data.addProperty("droppedBeforeCursor", cursor > 0 && !log.isEmpty() && cursor < log.getFirst().sequence() - 1);
        return tool(true, null, data, binding, generation);
    }

    private JsonObject startWalk(VillagerBodyRules.Binding binding, String generation, String operationId, EntityView view,
                                 JsonObject args, long now) {
        if (pendingWalks.containsKey(binding.bodyId())) throw new IllegalArgumentException("walk_busy");
        JsonElement x = args.get("x"), y = args.get("y"), z = args.get("z");
        if (x == null || y == null || z == null || !number(x) || !number(y) || !number(z)) throw new IllegalArgumentException("invalid_target");
        Location at = view.villager.getLocation();
        Location target = new Location(at.getWorld(), x.getAsDouble(), y.getAsDouble(), z.getAsDouble());
        if (target.getWorld() != at.getWorld()) throw new IllegalArgumentException("world_changed");
        var decision = VillagerBodyRules.walk(at.getX(), at.getY(), at.getZ(), target.getX(), target.getY(), target.getZ(),
                at.getWorld().getMinHeight(), at.getWorld().getMaxHeight(), target.isChunkLoaded());
        if (!decision.allowed()) throw new IllegalArgumentException(decision.reason());
        if (!walk.move(view.villager, target)) throw new IllegalArgumentException("native_walk_unavailable");
        pendingWalks.put(binding.bodyId(), new Walk(binding.residentId(), binding.bodyId(), binding.controllerId().toString(),
                generation, operationId, target, now + VillagerBodyRules.WALK_TIMEOUT_MS));
        JsonObject data = new JsonObject();
        data.addProperty("status", "accepted");
        data.addProperty("terminal", false);
        data.addProperty("arrivalTolerance", 2);
        data.addProperty("timeoutMs", VillagerBodyRules.WALK_TIMEOUT_MS);
        data.add("target", position(target));
        return data;
    }

    private void observeWalk(Walk pending, long now) {
        Lease lease = leases.get(pending.bodyId());
        if (lease == null || !lease.generation().equals(pending.generation())) {
            pendingWalks.remove(pending.bodyId());
            finish(pending.operationId(), Status.FAILED, "lease_lost", pending.observation(now));
            return;
        }
        EntityView view = body(lease.binding(), true);
        if (view == null) {
            pendingWalks.remove(pending.bodyId());
            finish(pending.operationId(), Status.FAILED, "body_unavailable", pending.observation(now));
            return;
        }
        Location at = view.villager.getLocation();
        var measured = VillagerBodyRules.near(at.getX(), at.getY(), at.getZ(), pending.target().getX(), pending.target().getY(), pending.target().getZ());
        var observation = VillagerBodyRules.walkObservation(measured.allowed(), now, pending.deadline());
        if (!observation.terminal()) return;
        pendingWalks.remove(pending.bodyId());
        JsonObject data = position(at);
        data.addProperty("observedAt", now);
        data.addProperty("measuredArrival", observation.arrived());
        data.addProperty("distance", Math.sqrt(at.distanceSquared(pending.target())));
        finish(pending.operationId(), observation.arrived() ? Status.COMPLETED : Status.FAILED,
                observation.arrived() ? null : "timeout", data);
    }

    private JsonObject stop(VillagerBodyRules.Binding binding, String generation, EntityView view) {
        Walk pending = pendingWalks.get(binding.bodyId());
        boolean cleared = false;
        if (pending != null && pending.generation().equals(generation)) {
            cleared = clearWalk(pending);
            pendingWalks.remove(binding.bodyId());
            finish(pending.operationId(), Status.FAILED, "stopped_by_controller", pending.observation(System.currentTimeMillis()));
            if (!cleared) throw new IllegalArgumentException("native_walk_clear_unavailable");
        }
        JsonObject data = new JsonObject();
        data.addProperty("stopped", pending != null);
        data.addProperty("walkTargetCleared", cleared);
        data.addProperty("aiUnchanged", true);
        return data;
    }

    private boolean clearWalk(Walk pending) {
        Entity entity = Bukkit.getEntity(pending.bodyId());
        return entity instanceof Villager villager && walk.clear(villager);
    }

    private List<Player> nearbyAudience(VillagerBodyRules.Binding binding, EntityView view) {
        try {
            connectVoice();
            if (nearbyAudience != null) {
                JsonObject row = JsonParser.parseString((String) nearbyAudience.invoke(voice, plugin, binding.bodyId())).getAsJsonObject();
                JsonArray ids = row.getAsJsonArray("players");
                if (ids == null) return List.of();
                List<Player> audience = new ArrayList<>();
                for (JsonElement value : ids) {
                    Player player = Bukkit.getPlayer(VillagerBodyRules.uuid(value.getAsString()));
                    if (player != null && eligibleNearby(player, view.villager, true)) audience.add(player);
                }
                return List.copyOf(audience);
            }
        } catch (ReflectiveOperationException | RuntimeException unavailable) {
            if (!voiceWarning) {
                voiceWarning = true;
                plugin.getLogger().warning("Shared villager voice audience unavailable; using conservative local text audience: "
                        + unavailable.getClass().getSimpleName());
            }
        }
        List<Player> audience = new ArrayList<>();
        for (Player player : view.villager.getWorld().getPlayers()) if (eligibleNearby(player, view.villager, true)) audience.add(player);
        return List.copyOf(audience);
    }

    private JsonObject speak(VillagerBodyRules.Binding binding, String generation, String operationId, EntityView view,
                             JsonObject args, long now) {
        String text = Text.clean(string(args, "text"), 200);
        if (text.isBlank()) throw new IllegalArgumentException("text_required");
        String eventId = string(args, "eventId"), listenerText = string(args, "listenerId");
        UUID listenerId = VillagerBodyRules.uuid(listenerText);
        boolean reply = eventId != null || listenerText != null;
        boolean direct = false;
        List<Player> audience = new ArrayList<>();
        if (reply) {
            if (eventId == null || listenerId == null) throw new IllegalArgumentException("reply_requires_event_and_listener");
            Event event = findEvent(binding.bodyId(), eventId);
            direct = event != null && "private".equals(event.deliveryScope());
            if (event == null || !event.generation().equals(generation) || !event.speakerId().equals(listenerId)
                    || !VillagerBodyRules.fresh(event.occurredAt(), now)) throw new IllegalArgumentException("original_event_not_fresh");
            Player listener = Bukkit.getPlayer(listenerId);
            if (!eligibleListener(listener, view.villager, "private".equals(event.deliveryScope())))
                throw new IllegalArgumentException("original_listener_unavailable");
            audience.add(listener);
        } else {
            audience.addAll(nearbyAudience(binding, view));
            if (audience.isEmpty()) throw new IllegalArgumentException("no_eligible_listener");
        }
        JsonArray delivered = new JsonArray(), bubbled = new JsonArray();
        boolean bubbleApi = connectBubbles();
        String caption = "[" + plugin.name(binding.residentId()) + "] " + text;
        for (Player player : audience) {
            try {
                player.sendMessage(caption);
                delivered.add(player.getUniqueId().toString());
                if (bubbleApi && Boolean.TRUE.equals(managedBubble.invoke(bubbles, binding.residentId(), view.villager, player, text))) {
                    bubbled.add(player.getUniqueId().toString());
                }
            } catch (RuntimeException | ReflectiveOperationException deliveryFailure) {
                plugin.getLogger().log(Level.WARNING, "Villager caption/bubble delivery failed for " + player.getUniqueId(), deliveryFailure);
            }
        }
        if (delivered.isEmpty()) throw new IllegalArgumentException("text_delivery_failed");
        JsonObject data = new JsonObject();
        JsonObject observation = new JsonObject();
        observation.addProperty("deliveredPlayers", delivered.size());
        observation.addProperty("captionRecipients", delivered.size());
        observation.addProperty("bubbleQueuedRecipients", bubbled.size());
        observation.addProperty("bubbleApiAvailable", bubbleApi);
        observation.addProperty("hearingVerified", false);
        data.add("observation", observation);
        JsonObject textDelivery = new JsonObject();
        textDelivery.addProperty("state", "delivered");
        textDelivery.add("deliveredPlayers", delivered);
        textDelivery.addProperty("bubbleApiAvailable", bubbleApi);
        textDelivery.add("bubbleQueuedPlayers", bubbled);
        data.add("textDelivery", textDelivery);
        data.add("deliveredPlayers", delivered);
        JsonObject voice = new JsonObject();
        voice.addProperty("hearingVerified", false);
        String speechRequestId = null;
        try {
            connectVoice();
            String raw;
            if (reply) {
                if (direct && speakReplyDirect != null) {
                    raw = (String) speakReplyDirect.invoke(this.voice, plugin, binding.bodyId(), listenerId, eventId, text, true);
                } else {
                    if (speakReply == null) throw new NoSuchMethodException("speakVillagerReply");
                    raw = (String) speakReply.invoke(this.voice, plugin, binding.bodyId(), listenerId, eventId, text);
                }
            } else {
                if (speakNearby == null) throw new NoSuchMethodException("speakVillagerNearby");
                raw = (String) speakNearby.invoke(this.voice, plugin, binding.bodyId(), operationId, text, now);
            }
            JsonObject status = raw == null ? new JsonObject() : JsonParser.parseString(raw).getAsJsonObject();
            if (status.has("requestId") && status.get("requestId").isJsonPrimitive()) speechRequestId = status.get("requestId").getAsString();
            voice.addProperty("available", true);
            voice.add("status", status);
        } catch (ReflectiveOperationException | RuntimeException unavailable) {
            voice.addProperty("available", false);
            voice.addProperty("state", "unavailable");
            Throwable cause = unavailable instanceof java.lang.reflect.InvocationTargetException invoked ? invoked.getCause() : unavailable;
            voice.addProperty("error", cause == null ? unavailable.getClass().getSimpleName() : cause.getClass().getSimpleName());
            if (cause != null && cause.getMessage() != null) voice.addProperty("errorMessage", cause.getMessage().substring(0, Math.min(300, cause.getMessage().length())));
        }
        if (reply && direct && recordManagedReply != null) {
            try {
                recordManagedReply.invoke(this.voice, plugin, binding.bodyId(), listenerId, eventId, text, delivered.size(), speechRequestId);
            } catch (ReflectiveOperationException | RuntimeException unavailable) {
                plugin.getLogger().log(Level.WARNING, "Managed private villager reply receipt could not be closed", unavailable);
            }
        }
        data.add("voice", voice);
        data.addProperty("voiceOperation", reply ? eventId : operationId);
        data.addProperty("observedAt", now);
        data.addProperty("hearingVerified", false);
        return data;
    }

    private Event findEvent(UUID body, String eventId) {
        List<Event> log = events.getOrDefault(body, List.of());
        for (int index = log.size() - 1; index >= 0; index--) if (log.get(index).eventId().equals(eventId)) return log.get(index);
        return null;
    }

    /** Called only by the registered QiandengVoice callback, on the main thread. */
    private boolean receive(String payload) {
        if (!Bukkit.isPrimaryThread() || payload == null || payload.length() > 8192) return false;
        try {
            JsonObject input = JsonParser.parseString(payload).getAsJsonObject();
            if (input.get("schema").getAsInt() != 1) return false;
            String resident = string(input, "residentId");
            UUID body = VillagerBodyRules.uuid(string(input, "listenerId"));
            Lease lease = body == null ? null : leases.get(body);
            if (lease == null || !lease.binding().residentId().equals(resident)
                    || !VillagerBodyRules.leaseActive(lease.expiresAt(), System.currentTimeMillis())) return false;
            UUID speaker = VillagerBodyRules.uuid(string(input, "speakerId"));
            String eventId = string(input, "eventId"), channel = string(input, "channel"), scope = string(input, "deliveryScope");
            long at = input.get("occurredAt").getAsLong();
            if (speaker == null || eventId == null || eventId.length() > 200 || !List.of("voice", "chat").contains(channel)
                    || !List.of("nearby", "private").contains(scope) || at <= 0 || at > System.currentTimeMillis() + 1_000
                    || System.currentTimeMillis() - at > 120_000 || "private".equals(scope) && !"chat".equals(channel)) return false;
            String text = Text.clean(string(input, "text"), 300);
            String name = Text.clean(string(input, "speaker"), 64);
            if (text.isBlank() || name.isBlank() || findEvent(body, eventId) != null) return false;
            EntityView view = body(lease.binding(), false);
            Player player = Bukkit.getPlayer(speaker);
            if (view == null || player == null || !name.equals(player.getName()) || !view.villager.getWorld().getKey().toString().equals(string(input, "world"))
                    || !eligibleListener(player, view.villager, "private".equals(scope))) return false;
            long sequence = eventSequences.computeIfAbsent(body, ignored -> 0L) + 1;
            eventSequences.put(body, sequence);
            Event event = new Event(sequence, eventId, speaker, name, text, channel, scope, at,
                    view.villager.getWorld().getKey().toString(), lease.generation());
            List<Event> log = events.computeIfAbsent(body, ignored -> new ArrayList<>());
            log.add(event);
            while (log.size() > VillagerBodyRules.RETAINED_EVENTS) log.removeFirst();
            return true;
        } catch (RuntimeException invalid) {
            return false;
        }
    }

    private void bindInbox(Lease lease) {
        EntityView view = body(lease.binding(), true);
        if (view == null) return;
        try {
            connectVoice();
            if (bindVoice == null) return;
            Function<String, Boolean> inbox = this::receive;
            bindVoice.invoke(voice, plugin, lease.binding().bodyId(), inbox);
        } catch (ReflectiveOperationException unavailable) {
            if (!voiceWarning) {
                voiceWarning = true;
                plugin.getLogger().warning("QiandengVoice body inbox binding unavailable: " + unavailable.getClass().getSimpleName());
            }
        }
    }

    private boolean connectBubbles() {
        if (bubbles == null || !bubbles.isEnabled()) {
            bubbles = Bukkit.getPluginManager().getPlugin("AgentFriend");
            managedBubble = null;
            bubbleWarning = false;
        }
        if (bubbles == null || !bubbles.isEnabled()) return false;
        if (managedBubble != null) return true;
        try {
            managedBubble = bubbles.getClass().getMethod("managedNpcSpeech", String.class,
                    org.bukkit.entity.LivingEntity.class, Player.class, String.class);
            return true;
        } catch (ReflectiveOperationException | LinkageError unavailable) {
            if (!bubbleWarning) {
                bubbleWarning = true;
                plugin.getLogger().warning("AgentFriend managed villager bubble API unavailable: " + unavailable.getClass().getSimpleName());
            }
            return false;
        }
    }

    private void connectVoice() throws ReflectiveOperationException {
        if (voice == null || !voice.isEnabled()) {
            voice = Bukkit.getPluginManager().getPlugin("QiandengVoice");
            bindVoice = speakReply = speakReplyDirect = speakNearby = nearbyAudience = speechStatus = recordManagedReply = null;
            voiceWarning = false;
        }
        if (voice == null || !voice.isEnabled()) throw new NoSuchMethodException("QiandengVoice");
        if (bindVoice != null && speakReply != null) return;
        Class<?> api = voice.getClass();
        bindVoice = api.getMethod("bindVillagerNpcVoice", Plugin.class, UUID.class, Function.class);
        speakReply = api.getMethod("speakVillagerReply", Plugin.class, UUID.class, UUID.class, String.class, String.class);
        try {
            speakReplyDirect = api.getMethod("speakVillagerReply", Plugin.class, UUID.class, UUID.class,
                    String.class, String.class, boolean.class);
        } catch (NoSuchMethodException olderVoice) {
            speakReplyDirect = null;
        }
        try {
            speakNearby = api.getMethod("speakVillagerNearby", Plugin.class, UUID.class, String.class, String.class, long.class);
        } catch (NoSuchMethodException olderVoice) {
            speakNearby = null;
        }
        try {
            nearbyAudience = api.getMethod("nearbyVillagerAudience", Plugin.class, UUID.class);
        } catch (NoSuchMethodException olderVoice) {
            nearbyAudience = null;
        }
        try {
            speechStatus = api.getMethod("npcSpeechStatus", UUID.class, String.class);
        } catch (NoSuchMethodException olderVoice) {
            speechStatus = null;
        }
        try {
            recordManagedReply = api.getMethod("recordManagedVillagerReply", Plugin.class, UUID.class, UUID.class,
                    String.class, String.class, int.class, String.class);
        } catch (NoSuchMethodException olderVoice) {
            recordManagedReply = null;
        }
    }

    private static boolean eligibleNearby(Player player, Villager body, boolean lineOfSight) {
        return eligibleListener(player, body, false) && player.getWorld().equals(body.getWorld())
                && player.getLocation().distanceSquared(body.getLocation()) <= 256.0 && (!lineOfSight || player.hasLineOfSight(body));
    }

    private static boolean eligibleListener(Player player, Villager body, boolean direct) {
        return player != null && player.isOnline() && !player.isDead() && player.getGameMode() != GameMode.SPECTATOR
                && player.canSee(body) && (direct || player.getWorld().equals(body.getWorld())
                && player.getLocation().distanceSquared(body.getLocation()) <= 256.0);
    }

    private record EntityView(Villager villager) {}

    private EntityView body(VillagerBodyRules.Binding binding, boolean requireReady) {
        if (!identityAllowed(binding) || plugin.lives != null && plugin.lives.blocksHandoff(binding.residentId())) return null;
        var entity = Bukkit.getEntity(binding.bodyId());
        if (!(entity instanceof Villager villager) || !villager.isValid() || villager.isDead() || villager.hasMetadata("NPC")
                || plugin.villagers.isCitizensBody(villager) || !villager.getLocation().isChunkLoaded()) return null;
        String markedResident = villager.getPersistentDataContainer().get(residentKey, PersistentDataType.STRING);
        if (markedResident != null && !markedResident.equals(binding.residentId())) return null;
        if (requireReady && (!villager.hasAI() || villager.isSleeping() || villager.getTrader() != null)) return null;
        return new EntityView(villager);
    }

    private boolean identityAllowed(VillagerBodyRules.Binding binding) {
        Villagers.Spot spot = plugin.villagers.spot(binding.residentId());
        return spot != null && binding.bodyId().equals(spot.entityUuid()) && spot.npcId() == null && spot.serviceCounter() == null;
    }

    private static JsonObject position(Location at) {
        JsonObject row = new JsonObject();
        row.addProperty("x", at.getX()); row.addProperty("y", at.getY()); row.addProperty("z", at.getZ());
        return row;
    }

    private static JsonElement location(Location at) {
        if (at == null || at.getWorld() == null) return null;
        JsonObject row = position(at);
        row.addProperty("world", at.getWorld().getName());
        return row;
    }

    private static boolean number(JsonElement value) {
        try { return value.isJsonPrimitive() && value.getAsJsonPrimitive().isNumber() && Double.isFinite(value.getAsDouble()); }
        catch (RuntimeException invalid) { return false; }
    }

    private static String string(JsonObject object, String key) {
        JsonElement value = object.get(key);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) return null;
        String text = value.getAsString();
        return text.length() > 4096 ? null : text;
    }

    private static JsonArray tools() {
        JsonObject properties = new JsonObject();
        JsonObject action = new JsonObject();
        JsonArray values = new JsonArray();
        ACTIONS.forEach(values::add);
        action.add("enum", values);
        properties.add("action", action);
        JsonObject input = new JsonObject();
        input.addProperty("type", "object");
        input.add("properties", properties);
        JsonObject tool = new JsonObject();
        tool.addProperty("name", "mc_villager");
        tool.add("inputSchema", input);
        JsonArray tools = new JsonArray();
        tools.add(tool);
        return tools;
    }

    private Reply receiptReply(Entry entry) {
        // A valid receipt is a successful protocol read even when the action itself failed.
        JsonObject data = entry.toJson();
        if ("speak".equals(entry.action()) && data.has("voiceOperation")) {
            try {
                connectVoice();
                if (speechStatus != null) {
                    String raw = (String) speechStatus.invoke(voice, UUID.fromString(entry.bodyId()), data.get("voiceOperation").getAsString());
                    data.add("voiceStatus", raw == null ? JsonParser.parseString("{}") : JsonParser.parseString(raw));
                }
            } catch (ReflectiveOperationException | RuntimeException unavailable) {
                plugin.getLogger().log(Level.WARNING, "Original villager voice status unavailable", unavailable);
            }
        }
        return tool(true, null, data, entry.residentId(), entry.bodyId(), entry.controllerId(), entry.generation());
    }

    private Reply tool(boolean ok, String error, JsonObject data, VillagerBodyRules.Binding binding, String generation) {
        return tool(ok, error, data, binding.residentId(), binding.bodyId().toString(), binding.controllerId().toString(), generation);
    }

    private Reply tool(boolean ok, String error, JsonObject data, String residentId, String bodyId,
                       String controllerId, String generation) {
        JsonObject inner = new JsonObject();
        inner.addProperty("ok", ok);
        if (error != null) {
            JsonObject failure = new JsonObject();
            failure.addProperty("code", error);
            inner.add("error", failure);
        }
        inner.add("data", data);
        JsonObject result = new JsonObject();
        JsonArray content = new JsonArray();
        JsonObject text = new JsonObject();
        text.addProperty("type", "text");
        text.addProperty("text", inner.toString());
        content.add(text);
        result.add("content", content);
        return identified(result, residentId, bodyId, controllerId, generation);
    }

    private static Reply identified(JsonObject data, VillagerBodyRules.Binding binding, String generation) {
        return identified(data, binding.residentId(), binding.bodyId().toString(), binding.controllerId().toString(), generation);
    }

    private static Reply identified(JsonObject data, String residentId, String bodyId, String controllerId, String generation) {
        JsonObject result = new JsonObject();
        result.addProperty("protocol", PROTOCOL);
        result.addProperty("residentId", residentId);
        result.addProperty("bodyId", bodyId);
        result.addProperty("controllerId", controllerId);
        result.addProperty("generation", generation);
        result.add("result", data);
        return new Reply(200, result);
    }

    private static Reply ok(JsonObject data) {
        JsonObject result = new JsonObject();
        result.addProperty("protocol", PROTOCOL);
        result.add("result", data);
        return new Reply(200, result);
    }

    private static Reply error(int status, String code, String message) {
        JsonObject result = new JsonObject();
        result.addProperty("protocol", PROTOCOL);
        JsonObject error = new JsonObject();
        error.addProperty("code", code);
        error.addProperty("message", message);
        result.add("error", error);
        return new Reply(status, result);
    }
}
