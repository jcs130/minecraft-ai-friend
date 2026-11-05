package org.afuhome.agentfriend;

import com.google.gson.*;
import java.nio.file.Path;
import java.util.*;

/** Latest request per owner, not another album. Never replays a capture after restart.
 * Uses the existing atomic UUID ledger; upload URLs/nonces are deliberately not saved. */
final class PhotoTaskLedger {
    private final ProfessionLedger ledger;
    private boolean recovered;
    PhotoTaskLedger(Path file) {
        ledger = new ProfessionLedger(file);
        recovered = ledger.ready();
        if (!recovered) return;
        try {
            for(var entry:ledger.data().getAsJsonObject("players").entrySet()) {
                JsonObject row=entry.getValue().getAsJsonObject().getAsJsonObject("photoTask");if(row==null)continue;
                UUID.fromString(row.get("job").getAsString());
                if(!entry.getKey().equals(row.get("owner").getAsString())
                        ||!Set.of("queued","rendering","confirming","unknown","stopped","success").contains(row.get("status").getAsString())
                        ||!row.get("name").getAsString().matches("[\\p{L}\\p{N}_-]{1,32}")
                        ||!Set.of("first","third","top").contains(row.get("mode").getAsString())
                        ||!Set.of(1,2).contains(row.get("tiles").getAsInt())
                        ||row.get("queuedAt").getAsLong()<0||row.get("startedAt").getAsLong()<0)throw new IllegalArgumentException("photo task");
                String story=row.get("story").getAsString();if(!story.isEmpty())PhotoEvidence.text(story,400);
            }
        }catch(RuntimeException invalid){recovered=false;return;}
        boolean interrupted = ledger.data().getAsJsonObject("players").entrySet().stream()
                .map(e -> e.getValue().getAsJsonObject().getAsJsonObject("photoTask"))
                .anyMatch(r -> r != null && Set.of("queued", "rendering", "confirming").contains(r.get("status").getAsString()));
        if (interrupted) recovered = ledger.write(data -> {
            for (var entry : data.getAsJsonObject("players").entrySet()) {
                JsonObject row = entry.getValue().getAsJsonObject().getAsJsonObject("photoTask");
                if (row == null) continue;
                String status = row.get("status").getAsString();
                if (status.equals("queued")) row.addProperty("status", "stopped");
                else if (Set.of("rendering", "confirming").contains(status)) row.addProperty("status", "unknown");
            }
        });
    }
    boolean ready() { return recovered && ledger.ready(); }
    JsonObject latest(UUID owner) {
        if (!ready()) return null;
        JsonObject row = ledger.profile(owner).getAsJsonObject("photoTask");
        return row == null ? null : row.deepCopy();
    }
    boolean unresolved(UUID owner) {
        JsonObject row = latest(owner);
        return row != null && Set.of("queued", "rendering", "confirming", "unknown").contains(row.get("status").getAsString());
    }
    long lastStarted(UUID owner) {
        JsonObject row = latest(owner);
        return row != null && row.has("startedAt") ? row.get("startedAt").getAsLong() : 0;
    }
    boolean begin(UUID owner, UUID job, PhotoRequest request, long now) {
        if (!ready() || unresolved(owner)) return false;
        long previousStart = lastStarted(owner);
        JsonObject row = new JsonObject();
        row.addProperty("job", job.toString()); row.addProperty("owner", owner.toString());
        row.addProperty("name", request.name()); row.addProperty("mode", request.mode());
        row.addProperty("tiles", request.tiles()); row.addProperty("story", request.story());
        row.addProperty("queuedAt", now); row.addProperty("startedAt", previousStart);
        row.addProperty("status", "queued");
        return ledger.write(data -> ProfessionLedger.profile(data, owner).add("photoTask", row));
    }
    boolean update(UUID owner, UUID job, String status, JsonObject fields) {
        JsonObject old = latest(owner);
        if (!ready() || old == null || !old.get("job").getAsString().equals(job.toString())) return false;
        if (old.get("status").getAsString().equals("success")) return status.equals("success");
        return ledger.write(data -> {
            JsonObject row = ProfessionLedger.profile(data, owner).getAsJsonObject("photoTask");
            row.addProperty("status", status);
            if (fields != null) for (var entry : fields.entrySet()) row.add(entry.getKey(), entry.getValue().deepCopy());
        });
    }
}
