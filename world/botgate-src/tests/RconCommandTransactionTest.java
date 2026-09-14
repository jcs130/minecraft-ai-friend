import dev.god.botgate.RconCommandTransaction;
import net.minecraft.network.chat.Component;
import net.minecraft.server.rcon.RconConsoleSource;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/** Uses the actual MC console buffer and a distinct simulated server thread. */
public class RconCommandTransactionTest {
    private static int assertions;

    public static void main(String[] args) throws Exception {
        reproduceOriginalInterleaving();
        serializesAllClientsAndKeepsExactReplies();
        releasesAfterFailure(false);
        releasesAfterFailure(true);
        System.out.println("RconCommandTransaction: " + assertions + " assertions passed");
    }

    private static void reproduceOriginalInterleaving() throws Exception {
        var console = new RconConsoleSource(null);
        var prepared = new CyclicBarrier(2);
        var executed = new CyclicBarrier(2);
        try (var server = Executors.newSingleThreadExecutor();
             var clients = Executors.newFixedThreadPool(2)) {
            List<Future<String>> replies = new ArrayList<>();
            for (String token : List.of("old-a", "old-b")) {
                replies.add(clients.submit(() -> {
                    // The deployed DedicatedServer does these three operations
                    // without a surrounding transaction; this is a legal order.
                    console.prepareForCommand();
                    prepared.await(5, TimeUnit.SECONDS);
                    server.submit(() -> console.sendSystemMessage(Component.literal(token)))
                            .get(5, TimeUnit.SECONDS);
                    executed.await(5, TimeUnit.SECONDS);
                    return console.getCommandResponse();
                }));
            }
            for (Future<String> reply : replies) {
                String raw = reply.get(5, TimeUnit.SECONDS);
                check(raw.contains("old-a") && raw.contains("old-b"),
                        "old independent sockets share both command replies");
            }
        }
    }

    private static void serializesAllClientsAndKeepsExactReplies() throws Exception {
        var console = new RconConsoleSource(null);
        var start = new CountDownLatch(1);
        var active = new AtomicInteger();
        var maxActive = new AtomicInteger();
        var executions = new AtomicInteger();
        try (var server = Executors.newSingleThreadExecutor();
             var clients = Executors.newFixedThreadPool(12)) {
            List<Future<Void>> replies = new ArrayList<>();
            for (int client = 0; client < 12; client++) {
                final int id = client;
                replies.add(clients.submit(() -> {
                    start.await(5, TimeUnit.SECONDS);
                    for (int turn = 0; turn < 16; turn++) {
                        String token = "client-" + id + "-turn-" + turn + "-中文";
                        String raw = RconCommandTransaction.run(() -> {
                            maxActive.accumulateAndGet(active.incrementAndGet(), Math::max);
                            try {
                                return nativeCommand(console, server, token, executions);
                            } finally {
                                active.decrementAndGet();
                            }
                        });
                        if (!raw.equals(token + "\n")) throw new AssertionError("mixed reply: " + raw);
                    }
                    return null;
                }));
            }
            start.countDown();
            for (Future<Void> reply : replies) reply.get(10, TimeUnit.SECONDS);
            check(maxActive.get() == 1, "only one complete native transaction at a time");
            check(executions.get() == 192, "every command executes exactly once");
            check(active.get() == 0, "all transactions release the lock");
            check(true, "192 exact Unicode replies across 12 concurrent clients");
        }
    }

    private static String nativeCommand(RconConsoleSource console, ExecutorService server,
                                        String token, AtomicInteger executions) {
        console.prepareForCommand();
        try {
            // It is essential that the caller can wait for the separate main
            // thread here: that thread must not need the RCON transaction lock.
            server.submit(() -> {
                executions.incrementAndGet();
                console.sendSystemMessage(Component.literal(token));
            }).get(5, TimeUnit.SECONDS);
        } catch (Exception error) {
            throw new AssertionError("server thread could not finish", error);
        }
        return console.getCommandResponse();
    }

    private static void releasesAfterFailure(boolean fatal) throws Exception {
        var console = new RconConsoleSource(null);
        var calls = new AtomicInteger();
        var failure = fatal ? new AssertionError("fixture-error") : new IllegalStateException("fixture-exception");
        try {
            RconCommandTransaction.run(() -> {
                calls.incrementAndGet();
                console.prepareForCommand();
                console.sendSystemMessage(Component.literal("partial"));
                if (failure instanceof Error e) throw e;
                throw (RuntimeException) failure;
            });
            throw new AssertionError("exception swallowed");
        } catch (Throwable actual) {
            check(actual == failure, "original failure propagates without replacement");
        }
        // A different client must acquire the released monitor; a same-thread
        // follow-up would miss a leaked reentrant lock.
        try (var server = Executors.newSingleThreadExecutor();
             var nextClient = Executors.newSingleThreadExecutor()) {
            String reply = nextClient.submit(() -> RconCommandTransaction.run(() ->
                    nativeCommand(console, server, "next", calls))).get(5, TimeUnit.SECONDS);
            check(reply.equals("next\n"), "next client does not inherit failed partial reply");
            check(calls.get() == 2, "failed command is not retried");
        }
    }

    private static void check(boolean condition, String name) {
        assertions++;
        if (!condition) throw new AssertionError(name);
    }
}
