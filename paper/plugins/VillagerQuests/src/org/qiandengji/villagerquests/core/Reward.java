package org.qiandengji.villagerquests.core;

import com.google.gson.JsonObject;

/** A row of the configured reward table. Never built from commission, model or outbox data. */
public record Reward(int emeralds, int vortexXp, int fame) {
    public Reward {
        if (emeralds < 0 || emeralds > 64 || vortexXp < 0 || vortexXp > 10000 || fame < 0 || fame > 100)
            throw new IllegalArgumentException("reward out of bounds");
    }

    public JsonObject toJson() {
        JsonObject o = new JsonObject();
        o.addProperty("emeralds", emeralds);
        o.addProperty("vortexXp", vortexXp);
        o.addProperty("fame", fame);
        return o;
    }
}
