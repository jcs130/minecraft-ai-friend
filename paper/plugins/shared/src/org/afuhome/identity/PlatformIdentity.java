package org.afuhome.identity;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;
import java.util.UUID;

/** A single local link between an official Java account and an existing Floodgate player. */
public record PlatformIdentity(String javaName, UUID premiumUuid, String bedrockName, UUID bedrockUuid) {
    public PlatformIdentity {
        if (!javaName.matches("[A-Za-z0-9_]{1,16}") || premiumUuid.version() != 4
                || !bedrockName.matches("\\.[A-Za-z0-9_]{1,15}")
                || bedrockUuid.getMostSignificantBits() != 0 || bedrockUuid.getLeastSignificantBits() <= 0) {
            throw new IllegalArgumentException("Invalid linked Java or Floodgate identity");
        }
    }

    public static PlatformIdentity read(Path path) throws IOException {
        var values = new Properties();
        try (var input = Files.newBufferedReader(path)) {
            values.load(input);
        }
        return new PlatformIdentity(values.getProperty("java.name"), UUID.fromString(values.getProperty("java.premium-uuid")),
            values.getProperty("bedrock.name"), UUID.fromString(values.getProperty("bedrock.uuid")));
    }

    public UUID javaStorageUuid() {
        return UUID.nameUUIDFromBytes(("OfflinePlayer:" + javaName).getBytes(StandardCharsets.UTF_8));
    }

    public boolean isJavaName(String name) {
        return javaName.equalsIgnoreCase(name);
    }

    public boolean isBedrockName(String name) {
        return bedrockName.equalsIgnoreCase(name);
    }
}
