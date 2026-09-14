package dev.god.botgate;

import java.util.function.Supplier;

/** One complete native RCON command owns the shared console response buffer. */
public final class RconCommandTransaction {
    public static final String VERSION = "rcon-command-transaction-v1";

    // Only RCON client threads acquire this private lock. In particular, never
    // synchronize on MinecraftServer: executeBlocking waits for its main thread.
    private static final Object LOCK = new Object();

    private RconCommandTransaction() {}

    public static String run(Supplier<String> nativeCommand) {
        synchronized (LOCK) {
            // The native method still prepares its console, executes on the
            // server thread, and reads its response. Exceptions propagate once;
            // monitor exit releases the lock even when a command throws.
            return nativeCommand.get();
        }
    }
}
