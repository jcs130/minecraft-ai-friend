package local.tlmcompat.hybrid;

import com.google.gson.JsonObject;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Set;
import java.util.UUID;

/** The same private server TTS request for native TLM audio and nearby SVC playback. */
final class MaidSpeechMedia implements AutoCloseable {
    private final HttpClient http;
    private final URI endpoint;
    private final String token;

    MaidSpeechMedia(JsonObject transport) throws IOException {
        URI origin = URI.create(transport.get("backend").getAsString());
        if (!"http".equals(origin.getScheme()) || !"127.0.0.1".equals(origin.getHost())
            || origin.getPort() < 1 || origin.getUserInfo() != null || origin.getQuery() != null
            || origin.getFragment() != null || !Set.of("", "/").contains(origin.getPath()))
            throw new IllegalArgumentException("Exact loopback media origin required");
        endpoint = origin.resolve("/v1/tts");
        token = Files.readString(Path.of(transport.get("tokenFile").getAsString())).strip();
        if (token.length() < 32 || token.length() > 128) throw new IllegalArgumentException("Private media token required");
        http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).followRedirects(HttpClient.Redirect.NEVER).build();
    }

    byte[] wav(UUID maid, UUID request, String voice, String text) throws Exception {
        JsonObject data = new JsonObject();
        data.addProperty("actor", maid.toString());
        data.addProperty("requestId", request.toString());
        data.addProperty("voice", voice);
        data.addProperty("text", text);
        var post = HttpRequest.newBuilder(endpoint).timeout(Duration.ofSeconds(100))
            .header("Authorization", "Bearer " + token).header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(data.toString())).build();
        var response = http.send(post, HttpResponse.BodyHandlers.ofInputStream());
        try (var input = response.body()) {
            if (response.statusCode() != 200) throw new IOException("Media preparation refused");
            byte[] bytes = input.readNBytes(2_900_001);
            if (bytes.length < 44 || bytes.length > 2_900_000) throw new IOException("Invalid voice audio size");
            return bytes;
        }
    }

    @Override public void close() { http.shutdownNow(); }
}
