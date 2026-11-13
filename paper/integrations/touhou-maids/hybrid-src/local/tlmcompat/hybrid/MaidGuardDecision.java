package local.tlmcompat.hybrid;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.net.ProxySelector;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Set;
import java.util.concurrent.CompletableFuture;

/** The loopback scorer receives only bounded combat facts and can select only an offered mode. */
final class MaidGuardDecision implements AutoCloseable {
    enum Mode {
        MELEE("melee", "Approach and use the equipped native melee weapon; useful at close range."),
        RANGED("ranged", "Use the equipped native projectile weapon with usable ammunition; useful at range."),
        MAGIC("magic", "Use the available ranged spell with a clear target; useful outside melee reach.");

        final String id;
        final String description;
        Mode(String id, String description) { this.id = id; this.description = description; }
    }

    record Result(Mode choice, String status) {}

    private final URI endpoint;
    private final HttpClient client;

    MaidGuardDecision(int port) {
        endpoint = URI.create("http://127.0.0.1:" + port + "/v1/systemone");
        client = HttpClient.newBuilder().connectTimeout(Duration.ofMillis(350))
            .proxy(ProxySelector.of(null)).followRedirects(HttpClient.Redirect.NEVER).build();
    }

    CompletableFuture<Result> request(JsonObject state, Set<Mode> choices) {
        var criteria = new JsonObject();
        for (var mode : Mode.values()) if (choices.contains(mode)) criteria.addProperty(mode.id, mode.description);
        var question = new JsonObject();
        question.addProperty("type", "choice");
        question.addProperty("instructions", "Choose one available way for a Minecraft companion to protect its partner. "
            + "Prefer a reliable melee strike on a nearby ground target; use magic or a projectile weapon for distant "
            + "or airborne threats. Use the reported distance, attack target, mana and ammunition. Keep an effective "
            + "current mode when choices are otherwise equivalent.");
        question.add("criteria", criteria);
        var questions = new JsonObject();
        questions.add("mode", question);
        var body = new JsonObject();
        body.add("state", state);
        body.add("questions", questions);
        var request = HttpRequest.newBuilder(endpoint).timeout(Duration.ofMillis(900))
            .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body.toString())).build();
        return client.sendAsync(request, HttpResponse.BodyHandlers.ofString())
            .handle((response, error) -> error == null && response.statusCode() == 200
                ? parse(response.body(), choices) : new Result(null, "unavailable"));
    }

    // Same typed-choice conventions as the MC core: reported confidence may be above chance.
    static Result parse(String body, Set<Mode> choices) {
        if (choices.size() < 2 || body.length() > 8192) return new Result(null, "invalid_response");
        try {
            var answer = JsonParser.parseString(body).getAsJsonObject().getAsJsonObject("answers").getAsJsonObject("mode");
            if (answer.has("type") && !"choice".equals(answer.get("type").getAsString())) throw new IllegalArgumentException();
            var choice = answer.getAsJsonPrimitive("choice");
            if (!choice.isString()) throw new IllegalArgumentException();
            Mode selected = choices.stream().filter(mode -> mode.id.equals(choice.getAsString())).findFirst().orElseThrow();
            var probabilities = answer.getAsJsonObject("probabilities");
            if (probabilities.size() != choices.size()) throw new IllegalArgumentException();
            double top = probability(probabilities, selected.id);
            double confidence = probability(answer, "confidence");
            double sum = 0, runnerUp = 0;
            for (Mode mode : choices) {
                double score = probability(probabilities, mode.id);
                sum += score;
                if (mode != selected) runnerUp = Math.max(runnerUp, score);
            }
            double chance = 1.0 / choices.size();
            double aboveChance = Math.max(0, (top - chance) / (1 - chance));
            if (Math.abs(sum - 1) > .02 || runnerUp - top > .000001
                    || Math.min(Math.abs(confidence - top), Math.abs(confidence - aboveChance)) > .01)
                throw new IllegalArgumentException();
            return top >= .55 && top - runnerUp >= .10
                ? new Result(selected, "selected") : new Result(null, "ambiguous");
        } catch (RuntimeException invalid) {
            return new Result(null, "invalid_response");
        }
    }

    private static double probability(JsonObject row, String key) {
        var value = row.getAsJsonPrimitive(key);
        if (!value.isNumber()) throw new IllegalArgumentException();
        double p = value.getAsDouble();
        if (!Double.isFinite(p) || p < 0 || p > 1) throw new IllegalArgumentException();
        return p;
    }

    @Override public void close() { client.shutdownNow(); }
}
