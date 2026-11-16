package local.qdj.maids.brain;

import com.google.gson.Gson;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

record MaidAgentsConfig(int schema, List<Binding> maids) {
    static final String SITE_PREFIX = "maidagent_";

    record Choice(String site, String model) {}
    record Voice(String site, String model, String language) {}
    record Binding(UUID maidId, UUID ownerId, Map<String, Choice> choices, Voice voice, String visitorPersona) {}

    static MaidAgentsConfig read(Path path) throws IOException {
        if (Files.notExists(path)) return new MaidAgentsConfig(1, List.of());
        if (Files.size(path) > 512 * 1024) throw new IOException("Maid agents config exceeds 512 KiB");
        var config = new Gson().fromJson(Files.readString(path, StandardCharsets.UTF_8), MaidAgentsConfig.class);
        if (config == null || config.schema != 1 || config.maids == null || config.maids.size() > 64) {
            throw new IllegalArgumentException("Expected schema 1 and at most 64 managed maids");
        }
        Set<UUID> maids = new HashSet<>();
        Set<String> sites = new HashSet<>();
        for (Binding row : config.maids) {
            if (row == null || row.maidId == null || row.ownerId == null || row.maidId.equals(row.ownerId) || !maids.add(row.maidId)) {
                throw new IllegalArgumentException("Each maid needs a distinct entity ID and its real owner ID");
            }
            if (row.choices == null || row.choices.isEmpty() || row.choices.size() > 8) {
                throw new IllegalArgumentException("Each maid needs one to eight brain choices");
            }
            for (var entry : row.choices.entrySet()) {
                Choice choice = entry.getValue();
                if (!entry.getKey().matches("[a-z][a-z0-9_-]{0,23}") || choice == null ||
                        !matches(choice.site, SITE_PREFIX + "[a-z0-9_]{1,70}") || !sites.add(choice.site) ||
                        !matches(choice.model, "[A-Za-z0-9_./:-]{1,128}")) {
                    throw new IllegalArgumentException("Managed model sites must be valid and assigned to one maid");
                }
            }
            Voice voice = row.voice;
            if (voice != null && (!matches(voice.site, "[a-zA-Z0-9_-]{1,96}") ||
                    voice.model == null || voice.model.isBlank() || voice.model.length() > 128 ||
                    voice.model.codePoints().anyMatch(Character::isISOControl) ||
                    !matches(voice.language, "[a-zA-Z0-9_-]{2,16}"))) {
                throw new IllegalArgumentException("The native voice needs a TTS site, model and language");
            }
            String persona = row.visitorPersona;
            if (persona != null && (persona.isBlank() || persona.codePointCount(0, persona.length()) > 400 ||
                    persona.codePoints().anyMatch(Character::isISOControl))) {
                throw new IllegalArgumentException("Public NPC description must be a single line of up to 400 characters");
            }
        }
        return config;
    }

    private static boolean matches(String value, String pattern) {
        return value != null && value.matches(pattern);
    }
}
