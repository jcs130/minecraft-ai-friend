package dev.qiandeng.maw;

import com.google.gson.*;
import java.util.*;

/** A bounded catalogue of game-adapted chants, never a console/script evaluator. */
final class SystemCallSyntax {
    record Formula(String id, String skillId, String chant, String description) {}
    private final Map<String, Formula> ids = new LinkedHashMap<>();
    private final Map<String, Formula> chants = new HashMap<>();

    SystemCallSyntax(JsonObject catalogue) {
        if (catalogue.get("schemaVersion").getAsInt() != 1) throw new IllegalArgumentException("unsupported_system_call_schema");
        for (JsonElement value : catalogue.getAsJsonArray("formulas")) {
            JsonObject row = value.getAsJsonObject();
            Formula f = new Formula(row.get("id").getAsString(), row.get("skillId").getAsString(),
                row.get("chant").getAsString(), row.get("description").getAsString());
            if (!f.id.matches("[a-z][a-z0-9_]{0,47}") || !f.skillId.matches("[a-z][a-z0-9_]{0,47}") ||
                ids.putIfAbsent(f.id, f) != null || chants.putIfAbsent(normalize(f.chant), f) != null)
                throw new IllegalArgumentException("invalid_or_duplicate_system_call");
        }
        if (ids.isEmpty() || ids.size() > 24) throw new IllegalArgumentException("invalid_system_call_count");
    }

    static String normalize(String input) {
        if (input == null || input.length() > 512 || input.isBlank() ||
            input.chars().anyMatch(c -> c < 32 || c > 126) || !input.matches("[A-Za-z0-9_ .]+"))
            throw new IllegalArgumentException("invalid_system_call_syntax");
        String normalized = input.trim().replaceAll(" +", " ").replaceAll(" *\\. *", ".").toLowerCase(Locale.ROOT);
        // Exactly one optional final period. Missing/extra clauses are not guessed.
        return normalized.endsWith(".") ? normalized.substring(0, normalized.length() - 1) : normalized;
    }

    Formula parse(String input) {
        String key = normalize(input);
        Formula formula = ids.get(key);
        if (formula == null) formula = chants.get(key);
        if (formula == null) throw new IllegalArgumentException("unknown_system_call_use_list_or_explain");
        return formula;
    }

    String skillId(String input) { return ids.containsKey(input) ? ids.get(input).skillId : input; }
    Collection<Formula> formulas() { return Collections.unmodifiableCollection(ids.values()); }
    Formula forSkill(String skillId) { return ids.values().stream().filter(f -> f.skillId.equals(skillId)).findFirst().orElse(null); }
}
