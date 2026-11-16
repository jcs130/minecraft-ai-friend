package local.qdj.maids.brain;

import com.google.gson.Gson;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;

record CompanionConfig(int schema, int contractMinutes, int disconnectGraceSeconds, int maxCompanions,
                       int socialIntervalSeconds, List<Offer> offers) {
    record Offer(UUID maidId, String role, String description, String workTask, Map<String, List<String>> bubbles,
                 String persona, List<String> likes, List<String> dislikes) {
        String line(String event, int seed, String fallback) {
            List<String> lines = bubbles == null ? null : bubbles.get(event);
            return lines == null || lines.isEmpty() ? fallback : lines.get(Math.floorMod(seed, lines.size()));
        }
    }
    static CompanionConfig read(Path path, MaidAgentsServer server) throws java.io.IOException {
        if (!Files.exists(path)) return new CompanionConfig(1, 120, 300, 8, 0, List.of());
        if (Files.size(path) > 128 * 1024) throw new IllegalArgumentException("companion_config_too_large");
        var c = new Gson().fromJson(Files.readString(path, StandardCharsets.UTF_8), CompanionConfig.class);
        if (c == null || c.schema != 1 || c.contractMinutes < 5 || c.contractMinutes > 1440 ||
                c.disconnectGraceSeconds < 30 || c.disconnectGraceSeconds > 3600 || c.maxCompanions < 2 || c.maxCompanions > 64 ||
                c.socialIntervalSeconds != 0 && (c.socialIntervalSeconds < 60 || c.socialIntervalSeconds > 86400) ||
                c.offers == null || c.offers.size() > 64)
            throw new IllegalArgumentException("invalid_companion_config");
        var ids = new HashSet<UUID>();
        for (Offer o : c.offers) {
            if (o == null || o.maidId == null || server.agent(o.maidId) == null || !ids.add(o.maidId) ||
                    !text(o.role, 24) || !text(o.description, 160) || o.workTask == null ||
                    !o.workTask.matches("[a-z0-9_.-]+:[a-z0-9/._-]+"))
                throw new IllegalArgumentException("invalid_companion_offer");
            if (o.bubbles != null) for (var e : o.bubbles.entrySet()) {
                if (!List.of("recruit", "follow", "stay", "work", "dismiss").contains(e.getKey()) ||
                        e.getValue() == null || e.getValue().isEmpty() || e.getValue().size() > 8 ||
                        e.getValue().stream().anyMatch(s -> !text(s, 60)))
                    throw new IllegalArgumentException("invalid_companion_bubble");
            }
            if (!text(o.persona, 1200) || !preferences(o.likes) || !preferences(o.dislikes))
                throw new IllegalArgumentException("companion_persona_and_preferences_required");
        }
        return c;
    }
    private static boolean preferences(List<String> values) {
        return values != null && values.size() <= 12 && values.stream().allMatch(s -> text(s, 80));
    }
    private static boolean text(String s, int max) {
        return s != null && !s.isBlank() && s.codePointCount(0, s.length()) <= max &&
                s.codePoints().noneMatch(Character::isISOControl);
    }
}
