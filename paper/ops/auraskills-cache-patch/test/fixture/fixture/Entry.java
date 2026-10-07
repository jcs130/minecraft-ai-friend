package fixture;
import dev.aurelium.auraskills.common.message.LocalizedKey;
import dev.aurelium.auraskills.common.message.MessageKey;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import org.bukkit.Bukkit;

public final class Entry {
    public static void run(String directory) throws Exception {
        Path dir = Path.of(directory);
        var cache = Bukkit.getPluginManager().aura().getMessageProvider().cache();
        // Ensure the actual official LocalizedKey is loaded before the live attach.
        LocalizedKey before = new LocalizedKey(MessageKey.of("same"), Locale.SIMPLIFIED_CHINESE);
        LocalizedKey beforeSame = new LocalizedKey(MessageKey.of("same"), Locale.SIMPLIFIED_CHINESE);
        Files.writeString(dir.resolve("ready.txt"), Long.toString(ProcessHandle.current().pid()));
        String last = "";
        while (true) {
            Bukkit.pump();
            Path command = dir.resolve("command.txt");
            if (Files.exists(command)) {
                String next = Files.readString(command).trim();
                if (!next.equals(last) && !next.isEmpty()) {
                    last = next;
                    String[] parts = next.split(":", 2);
                    if (parts[1].equals("stop")) return;
                    boolean fixed = parts[1].equals("fixed");
                    cache.clear();
                    int repeat = 10000;
                    for (int i = 0; i < repeat; i++) cache.put(new LocalizedKey(MessageKey.of("same"), Locale.SIMPLIFIED_CHINESE), "value");
                    cache.put(new LocalizedKey(MessageKey.of("different"), Locale.SIMPLIFIED_CHINESE), "value");
                    cache.put(new LocalizedKey(MessageKey.of("same"), Locale.ENGLISH), "value");
                    long expected = fixed ? 3 : repeat + 2;
                    boolean existingEquals = before.equals(beforeSame);
                    boolean passed = cache.mappingCount() == expected && existingEquals == fixed;
                    if (fixed) {
                        Thread[] writers = new Thread[4];
                        for (int i = 0; i < writers.length; i++) {
                            writers[i] = new Thread(() -> {
                                for (int n = 0; n < 10000; n++) cache.put(new LocalizedKey(MessageKey.of("same"), Locale.SIMPLIFIED_CHINESE), "value");
                            });
                            writers[i].start();
                        }
                        for (Thread writer : writers) writer.join();
                        passed &= cache.mappingCount() == expected;
                        passed &= new LocalizedKey(MessageKey.of("same"), Locale.SIMPLIFIED_CHINESE).hashCode()
                                == new LocalizedKey(MessageKey.of("same"), Locale.SIMPLIFIED_CHINESE).hashCode();
                    }
                    String receipt = "{\"success\":" + passed + ",\"phase\":\"" + parts[1]
                            + "\",\"entries\":" + cache.mappingCount() + ",\"expected\":" + expected
                            + ",\"existingInstancesEqual\":" + existingEquals + ",\"sameClassLoader\":"
                            + (before.getClass().getClassLoader() == Bukkit.getPluginManager().aura().getClass().getClassLoader()) + "}\n";
                    Files.writeString(dir.resolve("phase-" + parts[0] + ".json"), receipt);
                }
            }
            Thread.sleep(10);
        }
    }
}
