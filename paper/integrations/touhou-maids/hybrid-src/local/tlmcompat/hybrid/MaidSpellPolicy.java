package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import io.vortexcore.progression.VortexAttribute;
import java.net.ProxySelector;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.Mob;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

/** The body supplies eligible targets and effective changes. The MC core owns policy and experience. */
final class MaidSpellPolicy {
    private static final Gson JSON = new Gson();
    private static final long CHOICE_MAX_AGE = 1500;
    record Selection(NativeMaidMagicSupport.Attempt attempt, JsonObject frame, String decisionId, String source) {}
    private record Pending(UUID maid, String scene, String decision, long started, CompletableFuture<JsonObject> result) {}
    private final String endpoint, token;
    private final String run = UUID.randomUUID().toString();
    private final String realm = Bukkit.getWorlds().getFirst().getUID().toString();
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofMillis(180))
        .proxy(ProxySelector.of(null)).followRedirects(HttpClient.Redirect.NEVER).build();
    private Pending pending;
    private Long lastRequest;

    private MaidSpellPolicy(int port, String token) {
        endpoint = "http://127.0.0.1:" + port + "/v1/combat-effect/";
        this.token = token;
    }

    static MaidSpellPolicy fromConfig(JavaPlugin plugin) {
        int port = plugin.getConfig().getInt("companion.spell-policy.port", 0);
        if (port == 0) return null;
        try {
            Path file = Path.of(plugin.getConfig().getString("companion.spell-policy.token-file", ""));
            if (port < 1024 || port > 65535 || !file.isAbsolute() || Files.size(file) > 256) throw new IllegalArgumentException();
            String secret = Files.readString(file).strip();
            if (!secret.matches("[a-f0-9]{64}")) throw new IllegalArgumentException();
            return new MaidSpellPolicy(port, secret);
        } catch (Exception invalid) {
            plugin.getLogger().warning("MC core spell policy configuration is unavailable. The companion uses the local combat fallback.");
            return null;
        }
    }

    Selection choose(EntityMaid maid, Player owner, List<Mob> threats, List<NativeMaidMagicSupport.Attempt> options,
                     NativeMaidMagicSupport.Attempt fallback, boolean forecasting, long now) {
        boolean urgent = options.stream().anyMatch(row -> row.friends().stream().anyMatch(friend -> friend.getHealth() <= 10));
        var candidates = options.stream().filter(row -> !urgent || !row.friends().isEmpty()).limit(8).toList();
        if (!candidates.contains(fallback)) return new Selection(fallback, null, null, "rule");
        if (forecasting && (candidates.size() < 2 || lastRequest != null && now - lastRequest < 500)) return null;
        var frame = frame(maid, owner, threats, candidates, fallback, urgent);
        var scene = frame.get("sceneId").getAsString();
        if (forecasting) {
            if (pending != null && pending.maid.equals(maid.getUUID()) && pending.scene.equals(scene)
                    && now - pending.started < CHOICE_MAX_AGE) return null;
            if (pending != null && !pending.result.isDone()) return null;
            var id = UUID.randomUUID().toString();
            var input = new JsonObject();
            input.addProperty("decisionId", id);
            input.add("frame", frame);
            lastRequest = now;
            pending = new Pending(maid.getUUID(), scene, id, now, post("choose", input));
            return null;
        }

        var prior = pending;
        pending = null;
        if (prior != null && prior.maid.equals(maid.getUUID()) && prior.scene.equals(scene) && now - prior.started < CHOICE_MAX_AGE) {
            var answer = prior.result.getNow(null);
            if (answer != null) try {
                String id = answer.get("decisionId").getAsString(), source = answer.get("source").getAsString();
                if (id.equals(prior.decision) && Instant.now().toEpochMilli() < answer.get("expiresAt").getAsLong()
                    && List.of("system1", "history").contains(source)) {
                    String choice = answer.get("choice").getAsString();
                    var selected = candidates.stream().filter(option -> option.spell().id().equals(choice)).findFirst().orElse(null);
                    if (selected != null) return new Selection(selected, frame, id, source);
                }
            } catch (RuntimeException malformed) { /* The current local fallback is ready. */ }
        }
        return new Selection(fallback, frame, null, "rule");
    }

    private JsonObject frame(EntityMaid maid, Player owner, List<Mob> threats,
                             List<NativeMaidMagicSupport.Attempt> options, NativeMaidMagicSupport.Attempt fallback, boolean urgent) {
        var out = new JsonObject();
        var scope = new JsonObject();
        scope.addProperty("realm", realm);
        scope.addProperty("account", owner.getUniqueId().toString());
        scope.addProperty("agent", maid.getUUID().toString());
        out.add("scope", scope);
        out.addProperty("run", run);
        String dimension = maid.level().dimension().location().toString();
        var primary = threats.getFirst();
        double distance = maid.distanceToSqr(primary);
        int range = distance <= 9 ? 0 : distance <= 36 ? 1 : 2;
        boolean durable = primary.getHealth() >= 12;
        int injured = options.stream().mapToInt(row -> row.friends().size()).max().orElse(0);
        String goal = urgent ? "heal" : "guard";
        String threatType = BuiltInRegistries.ENTITY_TYPE.getKey(primary.getType()).toString();
        var binding = new JsonArray();
        binding.add(maid.getUUID().toString());
        binding.add(maid.getBukkitEntity().getWorld().getUID().toString());
        binding.add(MaidCompanionActions.revision(maid));
        binding.add(range);
        binding.add(durable);
        binding.add(goal);
        binding.add(threats.size());

        var ready = new JsonArray();
        for (var option : options) {
            var data = new JsonObject();
            data.addProperty("id", option.spell().id());
            data.addProperty("effect", option.spell().use());
            data.addProperty("priority", option.priority());
            data.addProperty("expectedTargets", option.enemies().size());
            data.addProperty("expectedAllies", option.friends().size());
            data.addProperty("cost", option.cost());
            var definition = option.spell().nativeSpell().definition();
            String revision = digest(canonical(JSON.toJsonTree(List.of(definition.id(), definition.targeters(), definition.mechanics(),
                definition.minLevel(), option.spell().cooldown(), option.cost(),
                option.stats().stat(VortexAttribute.INTELLIGENCE).current(),
                option.stats().stat(VortexAttribute.SPIRIT).current()))).toString());
            data.addProperty("revision", revision);
            ready.add(data);
            binding.add(List.of(option.spell().id(), revision,
                option.enemies().stream().map(Mob::getUUID).toList(),
                option.friends().stream().map(Player::getUniqueId).toList()).toString());
        }
        out.addProperty("sceneId", digest(binding.toString()));
        out.addProperty("dimension", dimension);
        out.addProperty("goal", goal);
        out.addProperty("rangeBand", range);
        out.addProperty("threatType", threatType);
        out.addProperty("threatCount", Math.min(8, threats.size()));
        out.addProperty("injuredAllies", injured);
        out.addProperty("durable", durable);
        out.add("before", sample(maid));
        out.addProperty("resource", fallback.availableMana());
        out.add("candidates", ready);
        out.addProperty("baseline", fallback.spell().id());
        return out;
    }

    void observe(Selection choice, EntityMaid maid, UUID operation, double damage, double healing, double spent) {
        if (choice == null || choice.frame == null) return;
        var receipt = new JsonObject();
        receipt.add("frame", choice.frame);
        if (choice.decisionId != null) receipt.addProperty("decisionId", choice.decisionId);
        receipt.addProperty("operationId", operation.toString());
        receipt.addProperty("candidateId", choice.attempt.spell().id());
        receipt.add("after", sample(maid));
        receipt.addProperty("damage", damage);
        receipt.addProperty("healing", healing);
        receipt.addProperty("resourceSpent", spent);
        receipt.addProperty("status", damage + healing > 0 ? "applied" : "blocked");
        post("observe", receipt);
    }

    private CompletableFuture<JsonObject> post(String suffix, JsonObject body) {
        var request = HttpRequest.newBuilder(URI.create(endpoint + suffix)).timeout(Duration.ofMillis(600))
            .header("Content-Type", "application/json").header("Authorization", "Bearer " + token)
            .POST(HttpRequest.BodyPublishers.ofString(body.toString())).build();
        return http.sendAsync(request, HttpResponse.BodyHandlers.ofString()).handle((answer, failed) -> {
            if (failed != null || answer == null || answer.statusCode() != 200 || answer.body().length() > 16_384) return null;
            try { return JsonParser.parseString(answer.body()).getAsJsonObject(); }
            catch (RuntimeException invalid) { return null; }
        });
    }

    private static JsonObject sample(EntityMaid maid) {
        var sample = new JsonObject();
        var position = new JsonObject();
        position.addProperty("x", maid.getX());
        position.addProperty("y", maid.getY());
        position.addProperty("z", maid.getZ());
        sample.addProperty("at", Instant.now().toString());
        sample.addProperty("health", maid.getHealth());
        sample.add("position", position);
        return sample;
    }

    private static String digest(String text) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException missing) { throw new IllegalStateException("SHA-256 unavailable", missing); }
    }

    private static JsonElement canonical(JsonElement value) {
        if (value.isJsonArray()) {
            var sorted = new JsonArray();
            value.getAsJsonArray().forEach(row -> sorted.add(canonical(row)));
            return sorted;
        }
        if (value.isJsonObject()) {
            var sorted = new JsonObject();
            value.getAsJsonObject().entrySet().stream().sorted(Map.Entry.comparingByKey())
                .forEach(row -> sorted.add(row.getKey(), canonical(row.getValue())));
            return sorted;
        }
        return value;
    }
}
