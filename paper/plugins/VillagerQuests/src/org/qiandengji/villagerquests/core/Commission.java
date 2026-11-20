package org.qiandengji.villagerquests.core;

import com.google.gson.JsonObject;
import java.util.regex.Pattern;

/**
 * What a villager asks for. Numbers, target and issuer come from rules and configuration; only {@code title}
 * and {@code story} may come from a model (after {@link Text#clean}). There is no reward field on purpose.
 * {@link #toWire()} is exactly the bridge's {@code Commission} (schemas/villager_quest.schema.json).
 */
public record Commission(String commissionId, String issuer, QuestType type, String target, int quantity, Area area,
                         String difficulty, int deadlineMinutes, String title, String story) {
    public static final Pattern COMMISSION_ID = Pattern.compile("^[A-Za-z0-9_.-]{4,64}$");
    public static final Pattern LOCAL_ID = Pattern.compile("^[A-Za-z0-9_-]{1,48}$");
    public static final Pattern NAMESPACED_ID = Pattern.compile("^[a-z0-9_.-]{1,32}:[a-z0-9_./-]{1,64}$");

    public Commission {
        if (!COMMISSION_ID.matcher(commissionId).matches()) throw new IllegalArgumentException("bad commissionId");
        if (!LOCAL_ID.matcher(issuer).matches()) throw new IllegalArgumentException("bad issuer");
        if (!NAMESPACED_ID.matcher(target).matches()) throw new IllegalArgumentException("bad target");
        if (quantity < 1 || quantity > 64) throw new IllegalArgumentException("bad quantity");
        if (deadlineMinutes < 1 || deadlineMinutes > 10080) throw new IllegalArgumentException("bad deadline");
        if (!Policy.DIFFICULTIES.contains(difficulty)) throw new IllegalArgumentException("bad difficulty");
        title = Text.clean(title, 40);
        story = Text.clean(story, 300);
        if (title.isEmpty()) throw new IllegalArgumentException("empty title");
    }

    public Commission withText(String newTitle, String newStory) {
        return new Commission(commissionId, issuer, type, target, quantity, area, difficulty, deadlineMinutes, newTitle, newStory);
    }

    public Commission withDeadlineMinutes(int minutes) {
        return new Commission(commissionId, issuer, type, target, quantity, area, difficulty, minutes, title, story);
    }

    /** Bridge wire format (camelCase). Only for hero-capable types. */
    public JsonObject toWire() {
        if (!type.heroCapable()) throw new IllegalStateException(type + " is not part of the bridge schema");
        return toJson();
    }

    /** Persistence format (includes plugin-local types). */
    public JsonObject toJson() {
        JsonObject o = new JsonObject();
        o.addProperty("commissionId", commissionId);
        o.addProperty("issuer", issuer);
        o.addProperty("type", type.wire());
        o.addProperty("target", target);
        o.addProperty("quantity", quantity);
        if (area != null) o.add("area", area.toWire());
        o.addProperty("difficulty", difficulty);
        o.addProperty("deadlineMinutes", deadlineMinutes);
        o.addProperty("title", title);
        o.addProperty("story", story);
        return o;
    }

    public static Commission fromJson(JsonObject o) {
        return new Commission(o.get("commissionId").getAsString(), o.get("issuer").getAsString(),
                QuestType.parse(o.get("type").getAsString()), o.get("target").getAsString(), o.get("quantity").getAsInt(),
                o.has("area") ? Area.fromJson(o.getAsJsonObject("area")) : null, o.get("difficulty").getAsString(),
                o.get("deadlineMinutes").getAsInt(), o.get("title").getAsString(),
                o.has("story") ? o.get("story").getAsString() : "");
    }
}
