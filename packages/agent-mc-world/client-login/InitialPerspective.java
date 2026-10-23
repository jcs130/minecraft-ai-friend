package org.cortico.minecraft;

/** Optional per-account initial view. Applied once per matching connection, never a camera lock. */
public final class InitialPerspective {
    private InitialPerspective() {}
    public static int select(String value) {
        if (value == null) return -1;
        return switch (value) {
            case "first_person" -> 0;
            case "third_person_back" -> 1;
            case "third_person_front" -> 2;
            default -> -1;
        };
    }
}
