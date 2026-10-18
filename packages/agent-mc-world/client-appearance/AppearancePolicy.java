package org.agentmc.appearance;

import java.util.Locale;
import java.util.UUID;

/** Optional client display policy. No player, model or server defaults. */
public final class AppearancePolicy {
    private AppearancePolicy() {}
    public static boolean matches(String configuredServer, String actualServer, String configuredObserver, String actualObserver) {
        return configuredServer != null && configuredObserver != null && !configuredServer.isBlank()
            // Minecraft may omit its default port in ServerInfo after a reconnect.
            // Compare that equivalent spelling only; never resolve aliases or broaden host/port scope.
            && configuredServer.trim().replaceFirst("^([^:\\[\\]\\s]+|\\[[^\\]]+\\]):25565$", "$1")
                .equalsIgnoreCase(actualServer == null ? "" : actualServer.trim()
                    .replaceFirst("^([^:\\[\\]\\s]+|\\[[^\\]]+\\]):25565$", "$1"))
            && configuredObserver.equalsIgnoreCase(actualObserver == null ? "" : actualObserver);
    }
    public static String uuid(String value) {
        try {
            if (value == null || !value.matches("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")) return null;
            return UUID.fromString(value).toString().toLowerCase(Locale.ROOT);
        } catch (IllegalArgumentException error) { return null; }
    }
    public static boolean validAssetId(String value) {
        // Opaque catalogue identifiers, not file paths. Preserve Unicode and namespaced IDs.
        return value != null && !value.isBlank() && value.chars().noneMatch(Character::isISOControl);
    }
}
