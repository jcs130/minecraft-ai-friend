package dev.qiandeng.controls;

import java.nio.file.Path;
import java.util.Set;

/** This optional diagnostic interface deliberately has no command-input action. */
public final class QaPolicy {
    public static final Path CLIENT = Path.of("D:/Projects/QiandengJi/client").toAbsolutePath().normalize();
    private static final Set<String> ACTIONS = Set.of("screenshot", "open_guide", "close");

    public static boolean enabled(boolean flag, String user, Path directory) {
        return flag && "QiandengTest".equals(user) && CLIENT.equals(directory.toAbsolutePath().normalize());
    }

    public static boolean valid(String id, String action) {
        return id != null && id.matches("[A-Za-z0-9_-]{1,48}") && ACTIONS.contains(action);
    }

    private QaPolicy() {}
}
