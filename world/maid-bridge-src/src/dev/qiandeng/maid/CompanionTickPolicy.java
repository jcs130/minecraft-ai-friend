package dev.qiandeng.maid;

import java.util.UUID;
import java.util.Set;
import java.util.LinkedHashSet;

/** Explicit consent for one companion's following or home-work body to keep ticking. */
public record CompanionTickPolicy(boolean enabled, UUID bodyUuid, UUID ownerUuid) {
    public static Set<Long> worldChunks(int centerX, int centerZ) {
        var chunks = new LinkedHashSet<Long>();
        for (int dx = -1; dx <= 1; dx++) for (int dz = -1; dz <= 1; dz++)
            chunks.add(((long)(centerZ + dz) << 32) | ((centerX + dx) & 0xffffffffL));
        return chunks;
    }
    public static CompanionTickPolicy disabled() { return new CompanionTickPolicy(false, null, null); }
    public static CompanionTickPolicy parse(String text) {
        // Same strict schema and canonical UUID contract; this is a separate config and authority.
        var identity = CompanionProtectionPolicy.parse(text);
        return new CompanionTickPolicy(identity.enabled(), identity.bodyUuid(), identity.ownerUuid());
    }
    public boolean eligible(UUID body, UUID owner, UUID onlineOwner, boolean numenOwner,
                            boolean sameDimension, boolean alive, boolean removed,
                            boolean following, boolean sitting, boolean noAi) {
        return enabled && bodyUuid != null && bodyUuid.equals(body) && ownerUuid.equals(owner)
            && ownerUuid.equals(onlineOwner) && numenOwner && sameDimension && alive && !removed
            // Following/home is a native work choice, not an authorization boundary.
            // Keeping only follow alive silently freezes a legitimate stationary farm.
            && !sitting && !noAi;
    }
}
