package org.qiandengji.villagerquests.core;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.Gson;
import com.google.gson.TypeAdapter;
import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonToken;
import java.io.StringReader;
import java.util.Optional;
import java.util.Set;

/**
 * Strict parser for the model's reply. The model may only write {@code title} and {@code story}; anything else
 * (reward, quantity, commands, extra keys, prose around the JSON, several objects) rejects the whole reply and the
 * caller falls back to a template. An optional {@code [委托]} prefix and one surrounding code fence are tolerated.
 */
public final class StoryParser {
    public static final String PREFIX = "[委托]";
    public static final int MAX_REPLY = 4096;
    private static final Set<String> ALLOWED = Set.of("title", "story");
    private static final TypeAdapter<JsonElement> ELEMENT = new Gson().getAdapter(JsonElement.class);

    public record Story(String title, String story) {}

    private StoryParser() {}

    public static Optional<Story> parse(String reply) {
        if (reply == null || reply.length() > MAX_REPLY) return Optional.empty();
        String text = reply.strip();
        if (text.startsWith("```")) {
            int nl = text.indexOf('\n');
            if (nl < 0 || !text.endsWith("```")) return Optional.empty();
            text = text.substring(nl + 1, text.length() - 3).strip();
        }
        if (text.startsWith(PREFIX)) text = text.substring(PREFIX.length()).strip();
        if (!text.startsWith("{") || !text.endsWith("}")) return Optional.empty();
        JsonObject o;
        try (JsonReader reader = new JsonReader(new StringReader(text))) {
            reader.setLenient(false); // gson 2.10 (bundled by Paper 1.21.1): no comments, single quotes or bare words
            JsonElement el = ELEMENT.read(reader);
            if (reader.peek() != JsonToken.END_DOCUMENT || !el.isJsonObject()) return Optional.empty();
            o = el.getAsJsonObject();
        } catch (Exception e) {
            return Optional.empty();
        }
        if (!ALLOWED.containsAll(o.keySet())) return Optional.empty();
        if (!o.has("title") || !isString(o.get("title"))) return Optional.empty();
        if (o.has("story") && !isString(o.get("story"))) return Optional.empty();
        String title = Text.clean(o.get("title").getAsString(), 40);
        String story = o.has("story") ? Text.clean(o.get("story").getAsString(), 300) : "";
        if (title.isEmpty()) return Optional.empty();
        return Optional.of(new Story(title, story));
    }

    private static boolean isString(JsonElement e) {
        return e.isJsonPrimitive() && e.getAsJsonPrimitive().isString();
    }
}
