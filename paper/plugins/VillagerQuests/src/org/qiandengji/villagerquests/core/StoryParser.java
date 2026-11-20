package org.qiandengji.villagerquests.core;

import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonToken;
import java.io.StringReader;
import java.util.Optional;

/**
 * Strict parser for the model's reply. The model may only write {@code title} and {@code story}; anything else
 * (reward, quantity, commands, extra keys, prose around the JSON, several objects) rejects the whole reply and the
 * caller falls back to a template. An optional {@code [委托]} prefix and one surrounding code fence are tolerated.
 */
public final class StoryParser {
    public static final String PREFIX = "[委托]";
    public static final int MAX_REPLY = 4096;

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
        String title = null;
        String story = null;
        try (JsonReader reader = new JsonReader(new StringReader(text))) {
            reader.setLenient(false); // gson 2.10 (bundled by Paper 1.21.1): no comments, single quotes or bare words
            reader.beginObject();
            while (reader.hasNext()) {
                String key = reader.nextName();
                if (reader.peek() != JsonToken.STRING) return Optional.empty();
                if ("title".equals(key) && title == null) title = Text.clean(reader.nextString(), 40);
                else if ("story".equals(key) && story == null) story = Text.clean(reader.nextString(), 300);
                else return Optional.empty();
            }
            reader.endObject();
            if (reader.peek() != JsonToken.END_DOCUMENT) return Optional.empty();
        } catch (Exception e) {
            return Optional.empty();
        }
        if (title == null || title.isEmpty() || story == null || story.isEmpty()) return Optional.empty();
        return Optional.of(new Story(title, story));
    }
}
