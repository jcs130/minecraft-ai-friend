package org.afuhome.agentfriend;

/** A suggestion never selects or replaces a player's appearance. */
final class AppearanceHintPolicy {
    static boolean shouldSuggest(boolean agent, boolean observer, boolean seen,
                                 boolean skinSelected, Boolean customModel) {
        return agent && !observer && !seen && !skinSelected && Boolean.FALSE.equals(customModel);
    }
    static boolean customModel(String model) {
        return model != null && !model.isBlank() && !model.equalsIgnoreCase("default");
    }
}
