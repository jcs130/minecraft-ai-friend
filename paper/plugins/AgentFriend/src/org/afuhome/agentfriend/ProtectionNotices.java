package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import java.util.*;

/** Coalesces automatic notices only. Explicit queries always get a fresh response. */
final class ProtectionNotices {
    static final long WINDOW_MS = 5000;
    private static final int MAX_GROUPS = 16;
    private static final class Notice { long at; int skipped; Notice(long at) { this.at = at; } }
    private final Map<UUID, LinkedHashMap<JsonObject, Notice>> players = new HashMap<>();
    boolean allow(UUID player, JsonObject data, long now) {
        var groups = players.computeIfAbsent(player, ignored -> new LinkedHashMap<>());
        JsonObject key = ProtectionQuery.policy(data);
        Notice notice = groups.get(key);
        if (notice != null && now - notice.at < WINDOW_MS && now >= notice.at) { notice.skipped++; return false; }
        if (notice != null && notice.skipped > 0) {
            data.addProperty("suppressedNotices", notice.skipped); data.addProperty("noticeWindowMs", WINDOW_MS);
        }
        groups.remove(key); while (groups.size() >= MAX_GROUPS) groups.remove(groups.keySet().iterator().next());
        groups.put(key, new Notice(now)); return true;
    }
    void forget(UUID player) { players.remove(player); }
    void clear() { players.clear(); }
}
