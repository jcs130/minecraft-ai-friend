package dev.aurelium.auraskills.common.message;

import java.util.Locale;
import java.util.Objects;

/** Value equality for the existing AuraSkills 2.4.0 cache-key record. */
public record LocalizedKey(MessageKey key, Locale locale) {
    @Override
    public final int hashCode() {
        return 31 * Objects.hashCode(key == null ? null : key.getPath())
                + Objects.hashCode(locale);
    }

    @Override
    public final boolean equals(Object object) {
        if (this == object) return true;
        if (!(object instanceof LocalizedKey other)) return false;
        return Objects.equals(locale, other.locale)
                && Objects.equals(key == null ? null : key.getPath(),
                                  other.key == null ? null : other.key.getPath());
    }
}
