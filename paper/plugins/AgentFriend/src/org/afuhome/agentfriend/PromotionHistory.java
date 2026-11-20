package org.afuhome.agentfriend;

import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/** Milestones for crossing guild ranks. Only delivered contracts contribute. */
record PromotionHistory(String milestone, int dimension, String example, int distinctRequired) {
    private static final Pattern DAILY = Pattern.compile("^db_[0-9]{8}_(.+)$");

    static PromotionHistory forRank(int rank) {
        return switch (rank) {
            case 2 -> new PromotionHistory("deep_explorer", 5, "pilgrimage", 0);
            case 3 -> new PromotionHistory("ocean_guard", 3, "party_oath", 0);
            case 4 -> new PromotionHistory("treasure_vault", 4, "oracle_road", 20);
            case 5 -> new PromotionHistory("trial_ten", 0, "biome_border", 25);
            default -> null;
        };
    }

    record Progress(boolean milestoneDone, boolean dimensionDone, int distinct, int minimum) {
        boolean complete() { return milestoneDone && dimensionDone && distinct >= minimum; }
    }

    Progress progress(Set<String> delivered, Set<Integer> legacyDimensions, Collection<?> dailyDimensions) {
        boolean dimensionDone = legacyDimensions.contains(dimension);
        for (Object value : dailyDimensions) {
            if (value != null && List.of(value.toString().split(",")).contains(String.valueOf(dimension))) {
                dimensionDone = true;
                break;
            }
        }
        Set<String> templates = new HashSet<>();
        for (String id : delivered) {
            var daily = DAILY.matcher(id);
            templates.add(daily.matches() ? "db_" + daily.group(1) : id);
        }
        return new Progress(delivered.contains(milestone), dimensionDone, templates.size(), distinctRequired);
    }

    boolean offers(String id, Progress progress) {
        return (id.equals(milestone) && !progress.milestoneDone()) || (categoryChoices().contains(id) && !progress.dimensionDone());
    }

    List<String> categoryChoices() {
        return example.equals("pilgrimage") ? List.of("pilgrimage","stone_only") : List.of(example);
    }
}
