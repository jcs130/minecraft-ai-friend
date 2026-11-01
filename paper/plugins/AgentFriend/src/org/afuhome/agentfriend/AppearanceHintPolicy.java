package org.afuhome.agentfriend;

/** A suggestion never selects or replaces a player's appearance. */
final class AppearanceHintPolicy {
    static boolean trustedProfile(String source,String version,String protocol,String jar) {
        return "freesia_worker".equals(source)
            ||"ysm_native_backend".equals(source)&&"2.6.5".equals(version)&&"2.6.0".equals(protocol)
            &&"b285c73d4ec010d9a9be3c53c1bee890cf269645be5f1bcf1c27a2e8e82807cb".equals(jar);
    }
    static boolean shouldSuggest(boolean agent, boolean observer, boolean seen,
                                 boolean skinSelected, Boolean customModel) {
        return agent && !observer && !seen && !skinSelected && Boolean.FALSE.equals(customModel);
    }
    static boolean customModel(String model) {
        return model != null && !model.isBlank() && !model.equalsIgnoreCase("default");
    }
}
