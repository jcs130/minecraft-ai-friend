package org.qiandengji.villagerquests;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Set;

/** Connects the bounded game-side observation to the resident's independent Harness. */
final class VillagerHarnessClient {
    private static final Duration TIMEOUT = Duration.ofSeconds(15);
    private final URI endpoint;
    private final String key;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2))
            .followRedirects(HttpClient.Redirect.NEVER).build();

    VillagerHarnessClient(String endpoint, String key) {
        this.endpoint = URI.create(endpoint);
        if (!"http".equals(this.endpoint.getScheme()) || !"127.0.0.1".equals(this.endpoint.getHost())
                || !"/v1/villager/decide".equals(this.endpoint.getRawPath()) || this.endpoint.getPort() <= 0
                || this.endpoint.getUserInfo() != null || this.endpoint.getQuery() != null || this.endpoint.getFragment() != null)
            throw new IllegalArgumentException("Invalid local villager harness endpoint");
        if (key == null || key.isBlank() || key.length() > 512 || !key.matches("[A-Za-z0-9._~-]+"))
            throw new IllegalArgumentException("Missing or invalid villager harness key");
        this.key = key;
    }

    String decide(JsonObject observation) throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder(endpoint).timeout(TIMEOUT)
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + key)
                .POST(HttpRequest.BodyPublishers.ofString(observation.toString(), StandardCharsets.UTF_8)).build();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() != 200 || response.body().length() > 4096)
            throw new IOException("Villager Harness decision unavailable");
        return parse(response.body(), observation.get("eventId").getAsString());
    }

    static String parse(String reply, String eventId) throws IOException {
        try {
            var root = JsonParser.parseString(reply).getAsJsonObject();
            if (!root.keySet().equals(Set.of("schemaVersion", "eventId", "decision"))
                    || root.get("schemaVersion").getAsInt() != 1 || !eventId.equals(root.get("eventId").getAsString()))
                throw new IllegalArgumentException("Wrong decision identity");
            var decision = root.getAsJsonObject("decision");
            String kind = decision.get("kind").getAsString();
            if ("continue".equals(kind) && decision.keySet().equals(Set.of("kind"))) return "";
            if ("reply".equals(kind) && decision.keySet().equals(Set.of("kind", "text"))
                    && decision.get("text").isJsonPrimitive() && decision.getAsJsonPrimitive("text").isString())
                return decision.get("text").getAsString();
        } catch (RuntimeException malformed) {
            throw new IOException("Invalid villager Harness reply", malformed);
        }
        throw new IOException("Unsupported villager Harness decision");
    }
}
