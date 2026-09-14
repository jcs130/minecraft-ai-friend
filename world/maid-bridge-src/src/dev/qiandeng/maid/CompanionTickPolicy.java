package dev.qiandeng.maid;

import java.util.UUID;

/** Separate explicit consent for one following companion to keep its own body ticking. */
public record CompanionTickPolicy(boolean enabled, UUID bodyUuid, UUID ownerUuid) {
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
            && following && !sitting && !noAi;
    }
}
