package org.qiandengji.villagerquests.core;

import java.util.Locale;

/**
 * Commission types. {@code slay} and {@code gather} are the bridge schema's types and may be handed to heroes;
 * {@code reach} is plugin-local (players only) until the bridge schema grows {@code location_reached}.
 */
public enum QuestType {
    SLAY, GATHER, REACH;

    public String wire() { return name().toLowerCase(Locale.ROOT); }

    public boolean heroCapable() { return this != REACH; }

    public static QuestType parse(String value) {
        return valueOf(value.trim().toUpperCase(Locale.ROOT));
    }
}
