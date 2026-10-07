package dev.qiandengji.auracache;

import java.io.InputStream;
import java.lang.instrument.ClassDefinition;
import java.lang.instrument.ClassFileTransformer;
import java.lang.instrument.Instrumentation;
import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.security.ProtectionDomain;
import java.time.Instant;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicInteger;

/** Strictly pinned, reversible hotfix for AuraSkills' message cache key equality. */
public final class CachePatchAgent {
    private static final String TARGET = "dev.aurelium.auraskills.common.message.LocalizedKey";
    private static final String INTERNAL = TARGET.replace('.', '/');
    private static final String KEY = "dev.aurelium.auraskills.common.message.MessageKey";
    private static final Object LOCK = new Object();
    private static volatile boolean transformerEnabled;
    private static volatile boolean startupTransformed;
    private static ClassFileTransformer startupTransformer;
    private static volatile int transformCount;
    private static volatile boolean rollbackRequested;
    private static byte[] original;
    private static byte[] patched;
    private static Properties pin;

    public static void agentmain(String options, Instrumentation instrumentation) {
        Path result = null;
        Map<String, Object> report = base("unknown", "attach");
        try {
            Map<String, String> arguments = parse(options);
            String mode = arguments.get("mode");
            if (!"fix".equals(mode) && !"rollback".equals(mode)) throw new IllegalArgumentException("mode=fix|rollback required");
            if (!arguments.keySet().equals(java.util.Set.of("mode", "result"))) throw new IllegalArgumentException("Only mode and result accepted");
            result = Path.of(arguments.get("result"));
            if (!result.isAbsolute() || result.toString().contains(";")) throw new IllegalArgumentException("Absolute local result path required");
            report.put("mode", mode);
            report.put("phase", "pending");
            writeResult(result, report); // Verify the receipt destination before touching the JVM.
            synchronized (LOCK) {
                resources();
                if (!instrumentation.isRedefineClassesSupported()) throw new IllegalStateException("JVM does not support class redefinition");
                Class<?> target = find(instrumentation, TARGET);
                if (target == null) throw new IllegalStateException("LocalizedKey is not loaded; no change applied");
                validateTarget(target);
                if (!instrumentation.isModifiableClass(target)) throw new IllegalStateException("LocalizedKey is not modifiable");
                Class<?> bukkit = find(instrumentation, "org.bukkit.Bukkit");
                if (bukkit == null) throw new IllegalStateException("Bukkit is not loaded");
                Object plugin = plugin(bukkit);
                if (plugin == null) throw new IllegalStateException("AuraSkills is not enabled");
                if (plugin.getClass().getClassLoader() != target.getClassLoader())
                    throw new IllegalStateException("AuraSkills plugin and target class have different loaders");
                if (mode.equals("rollback")) {
                    rollbackRequested = true;
                    transformerEnabled = false;
                    if (startupTransformer != null) {
                        instrumentation.removeTransformer(startupTransformer);
                        startupTransformer = null;
                    }
                }
                runOnMain(bukkit, plugin, () -> {
                    try {
                        Object provider = plugin.getClass().getMethod("getMessageProvider").invoke(plugin);
                        Field cacheField = field(provider.getClass(), "componentCache");
                        cacheField.setAccessible(true);
                        Object value = cacheField.get(provider);
                        if (!(value instanceof java.util.concurrent.ConcurrentHashMap<?, ?> cache))
                            throw new IllegalStateException("Expected AuraSkills ConcurrentHashMap componentCache");
                        report.put("cacheEntriesBefore", cache.mappingCount());
                        cache.clear();
                        // A second clear after redefine drops entries inserted during the transition.
                        instrumentation.redefineClasses(new ClassDefinition(target, mode.equals("fix") ? patched : original));
                        report.put("classRedefined", true);
                        cache.clear();
                        verifyBehavior(target, mode.equals("fix"));
                        report.put("cacheEntriesAfter", cache.mappingCount());
                        report.put("behaviorVerified", true);
                    } catch (Throwable failure) { throw new RuntimeException(failure); }
                });
                if (mode.equals("fix")) {
                    rollbackRequested = false;
                    installTransformer(instrumentation, defaultResult());
                }
                report.put("success", true);
                report.put("phase", "complete");
                report.put("version", pin.getProperty("aura.version"));
                report.put("targetJarSha256", pin.getProperty("aura.jar.sha256"));
                report.put("originalClassSha256", sha(original));
                report.put("patchedClassSha256", sha(patched));
            }
        } catch (Throwable failure) {
            report.put("success", false);
            report.put("phase", "failed");
            report.put("error", root(failure).toString());
        }
        try { if (result != null) writeResult(result, report); log(report); }
        catch (Throwable failure) { System.err.println("[AuraCachePatch] Could not write receipt: " + failure); }
    }

    public static void premain(String options, Instrumentation instrumentation) {
        Path result = defaultResult();
        Map<String, Object> report = base("fix", "startup-registration");
        try {
            Map<String, String> arguments = parse(options);
            if (!arguments.keySet().stream().allMatch(key -> key.equals("mode") || key.equals("result")))
                throw new IllegalArgumentException("Only mode and result accepted");
            if (!arguments.getOrDefault("mode", "fix").equals("fix"))
                throw new IllegalArgumentException("Startup only supports mode=fix; remove -javaagent to disable");
            if (arguments.containsKey("result")) {
                result = Path.of(arguments.get("result"));
                if (!result.isAbsolute()) throw new IllegalArgumentException("Absolute result path required");
            }
            resources();
            installTransformer(instrumentation, result);
            report.put("success", false);
            report.put("phase", "awaiting-target-load");
            report.put("transformApplied", false);
            writeResult(result, report);
            log(report);
            Path receipt = result;
            Thread verification = new Thread(() -> startupVerify(instrumentation, receipt), "auraskills-cache-startup-check");
            verification.setDaemon(true);
            verification.start();
        } catch (Throwable failure) {
            report.put("error", root(failure).toString());
            report.put("phase", "startup-skipped");
            try { writeResult(result, report); log(report); }
            catch (Throwable writeFailure) { System.err.println("[AuraCachePatch] Startup skipped: " + failure); }
            // Fail open for unrelated server startup; never substitute unmatched class bytes.
        }
    }

    private static void installTransformer(Instrumentation instrumentation, Path result) {
        transformerEnabled = true;
        if (startupTransformer != null) return;
        startupTransformer = new ClassFileTransformer() {
            @Override
            public byte[] transform(Module module, ClassLoader loader, String name, Class<?> redefining,
                                    ProtectionDomain domain, byte[] bytes) {
                if (!transformerEnabled || redefining != null || !INTERNAL.equals(name)) return null;
                Map<String, Object> report = base("fix", "startup-transform");
                try {
                    validateDomain(domain);
                    if (!sha(bytes).equals(pin.getProperty("original.class.sha256")))
                        throw new IllegalStateException("LocalizedKey bytes do not match pinned original SHA256");
                    startupTransformed = true;
                    transformCount++;
                    report.put("transformApplied", true);
                    report.put("count", transformCount);
                    report.put("phase", "transformed-awaiting-verification");
                    writeResult(result, report);
                    log(report);
                    return patched.clone();
                } catch (Throwable failure) {
                    report.put("phase", "startup-skipped");
                    report.put("error", root(failure).toString());
                    try { writeResult(result, report); log(report); }
                    catch (Throwable writeFailure) { System.err.println("[AuraCachePatch] Transform skipped: " + failure); }
                    return null;
                }
            }
        };
        instrumentation.addTransformer(startupTransformer, false);
    }

    private static void startupVerify(Instrumentation instrumentation, Path result) {
        long deadline = System.nanoTime() + TimeUnit.MINUTES.toNanos(5);
        while (System.nanoTime() < deadline && !rollbackRequested) {
            try {
                Thread.sleep(1000);
                if (!startupTransformed) continue;
                Class<?> target = find(instrumentation, TARGET);
                Class<?> bukkit = find(instrumentation, "org.bukkit.Bukkit");
                if (target == null || bukkit == null) continue;
                Object plugin = plugin(bukkit);
                if (plugin == null) continue;
                Map<String, Object> report = base("fix", "startup-verified");
                runOnMain(bukkit, plugin, () -> {
                    try { verifyBehavior(target, true); }
                    catch (Throwable failure) { throw new RuntimeException(failure); }
                });
                if (rollbackRequested) return;
                report.put("success", true);
                report.put("transformApplied", true);
                report.put("behaviorVerified", true);
                report.put("count", transformCount);
                writeResult(result, report);
                log(report);
                return;
            } catch (Throwable failure) {
                Map<String, Object> report = base("fix", "startup-verification-failed");
                report.put("error", root(failure).toString());
                try { writeResult(result, report); log(report); } catch (Throwable ignored) { }
                return;
            }
        }
        if (!rollbackRequested) {
            Map<String, Object> report = base("fix", "startup-target-not-verified");
            report.put("transformApplied", startupTransformed);
            report.put("count", transformCount);
            try { writeResult(result, report); log(report); } catch (Throwable ignored) { }
        }
    }

    private static synchronized void resources() throws Exception {
        if (pin != null) return;
        Properties loaded = new Properties();
        try (InputStream in = CachePatchAgent.class.getResourceAsStream("/pin.properties")) {
            if (in == null) throw new IllegalStateException("Missing pin.properties");
            loaded.load(in);
        }
        byte[] before = resource("/bytes/original.class"), after = resource("/bytes/patched.class");
        if (!sha(before).equals(loaded.getProperty("original.class.sha256"))
                || !sha(after).equals(loaded.getProperty("patched.class.sha256")))
            throw new IllegalStateException("Embedded bytecode checksum mismatch");
        if (!ClassShape.read(before).equals(ClassShape.read(after)))
            throw new IllegalStateException("HotSwap shape differs");
        original = before; patched = after; pin = loaded;
    }

    private static byte[] resource(String name) throws Exception {
        try (InputStream in = CachePatchAgent.class.getResourceAsStream(name)) {
            if (in == null) throw new IllegalStateException("Missing " + name);
            return in.readAllBytes();
        }
    }
    private static void validateTarget(Class<?> target) throws Exception {
        validateDomain(target.getProtectionDomain());
        try (InputStream in = target.getClassLoader().getResourceAsStream(INTERNAL + ".class")) {
            if (in == null || !sha(in.readAllBytes()).equals(pin.getProperty("original.class.sha256")))
                throw new IllegalStateException("Target loader's class resource differs from pinned original");
        }
    }
    private static void validateDomain(ProtectionDomain domain) throws Exception {
        if (domain == null || domain.getCodeSource() == null) throw new IllegalStateException("Missing target CodeSource");
        Path jar = Path.of(domain.getCodeSource().getLocation().toURI());
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = Files.newInputStream(jar)) {
            byte[] buffer = new byte[16384];
            int n;
            while ((n = in.read(buffer)) != -1) digest.update(buffer, 0, n);
        }
        String actual = HexFormat.of().formatHex(digest.digest());
        if (!actual.equals(pin.getProperty("aura.jar.sha256"))
                && !actual.equals(pin.getProperty("aura.remapped.jar.sha256")))
            throw new IllegalStateException("Target AuraSkills JAR differs from pinned 2.4.0 SHA256");
    }
    private static Class<?> find(Instrumentation instrumentation, String name) {
        Class<?> found = null;
        for (Class<?> candidate : instrumentation.getAllLoadedClasses()) {
            if (!candidate.getName().equals(name)) continue;
            if (found != null) throw new IllegalStateException("Multiple loaders contain " + name);
            found = candidate;
        }
        return found;
    }
    private static Object plugin(Class<?> bukkit) throws Exception {
        Object manager = bukkit.getMethod("getPluginManager").invoke(null);
        if (manager == null) return null;
        Object plugin = manager.getClass().getMethod("getPlugin", String.class).invoke(manager, "AuraSkills");
        if (plugin != null && Boolean.TRUE.equals(plugin.getClass().getMethod("isEnabled").invoke(plugin))) return plugin;
        return null;
    }
    private static Field field(Class<?> type, String name) throws NoSuchFieldException {
        for (Class<?> current = type; current != null; current = current.getSuperclass()) {
            try { return current.getDeclaredField(name); } catch (NoSuchFieldException ignored) { }
        }
        throw new NoSuchFieldException(name);
    }
    private static void runOnMain(Class<?> bukkit, Object plugin, Runnable operation) throws Exception {
        if (Boolean.TRUE.equals(bukkit.getMethod("isPrimaryThread").invoke(null))) { operation.run(); return; }
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<Throwable> failed = new AtomicReference<>();
        AtomicInteger state = new AtomicInteger(0); // pending, running, done, cancelled
        Object scheduler = bukkit.getMethod("getScheduler").invoke(null);
        Class<?> pluginInterface = Class.forName("org.bukkit.plugin.Plugin", false, bukkit.getClassLoader());
        scheduler.getClass().getMethod("runTask", pluginInterface, Runnable.class).invoke(scheduler, plugin, (Runnable) () -> {
            if (!state.compareAndSet(0, 1)) { done.countDown(); return; }
            try { operation.run(); } catch (Throwable failure) { failed.set(failure); }
            finally { state.set(2); done.countDown(); }
        });
        if (!done.await(30, TimeUnit.SECONDS)) {
            if (state.compareAndSet(0, 3)) throw new IllegalStateException("Main-thread operation timed out while queued; task cancelled, no change applied");
            // A started operation must finish before the receipt is returned: never leave an
            // untracked delayed mutation behind an attach failure.
            done.await();
        }
        if (failed.get() != null) throw new IllegalStateException("Main-thread operation failed", failed.get());
    }
    private static void verifyBehavior(Class<?> target, boolean fixed) throws Exception {
        Class<?> key = Class.forName(KEY, true, target.getClassLoader());
        Object a = key.getMethod("of", String.class).invoke(null, "auracache.probe.same");
        Object b = key.getMethod("of", String.class).invoke(null, "auracache.probe.same");
        Object c = key.getMethod("of", String.class).invoke(null, "auracache.probe.other");
        var constructor = target.getConstructor(key, Locale.class);
        Object left = constructor.newInstance(a, Locale.SIMPLIFIED_CHINESE);
        Object same = constructor.newInstance(b, Locale.SIMPLIFIED_CHINESE);
        Object other = constructor.newInstance(c, Locale.SIMPLIFIED_CHINESE);
        Object language = constructor.newInstance(a, Locale.ENGLISH);
        if (left.equals(same) != fixed || (fixed && left.hashCode() != same.hashCode())
                || left.equals(other) || left.equals(language))
            throw new IllegalStateException("Value equality/locale behavior did not match requested mode");
    }
    private static Map<String, String> parse(String options) {
        Map<String, String> parsed = new LinkedHashMap<>();
        if (options == null || options.isEmpty()) return parsed;
        for (String part : options.split(";", -1)) {
            int equals = part.indexOf('=');
            if (equals < 1 || equals == part.length() - 1 || parsed.put(part.substring(0, equals), part.substring(equals + 1)) != null)
                throw new IllegalArgumentException("Invalid agent options");
        }
        return parsed;
    }
    private static Path defaultResult() { return Path.of(System.getProperty("user.dir"), "logs", "auraskills-cache-patch.json").toAbsolutePath(); }
    private static Map<String, Object> base(String mode, String phase) {
        Map<String, Object> report = new LinkedHashMap<>();
        report.put("success", false); report.put("mode", mode); report.put("phase", phase);
        report.put("timestamp", Instant.now().toString()); report.put("pid", ProcessHandle.current().pid());
        return report;
    }
    private static void writeResult(Path path, Map<String, Object> report) throws Exception {
        Files.createDirectories(path.getParent());
        Files.writeString(path, json(report) + "\n");
        StringBuilder text = new StringBuilder();
        report.forEach((key, value) -> text.append(key).append("=").append(value).append('\n'));
        Files.writeString(Path.of(path + ".txt"), text);
    }
    private static synchronized void log(Map<String, Object> report) throws Exception {
        Path log = Path.of(System.getProperty("user.dir"), "logs", "auraskills-cache-patch.log").toAbsolutePath();
        Files.createDirectories(log.getParent());
        Files.writeString(log, json(report) + "\n", StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    }
    private static String json(Map<String, Object> report) {
        StringBuilder json = new StringBuilder("{");
        report.forEach((key, value) -> {
            if (json.length() > 1) json.append(',');
            json.append(quote(key)).append(':');
            json.append(value instanceof Boolean || value instanceof Number ? value : quote(String.valueOf(value)));
        });
        return json.append('}').toString();
    }
    static String quote(String value) {
        StringBuilder escaped = new StringBuilder("\"");
        for (char c : value.toCharArray()) {
            switch (c) {
                case '"' -> escaped.append("\\\"");
                case '\\' -> escaped.append("\\\\");
                case '\n' -> escaped.append("\\n");
                case '\r' -> escaped.append("\\r");
                case '\t' -> escaped.append("\\t");
                default -> { if (c < 32) escaped.append(String.format("\\u%04x", (int)c)); else escaped.append(c); }
            }
        }
        return escaped.append('"').toString();
    }
    private static String sha(byte[] bytes) throws Exception { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
    private static Throwable root(Throwable failure) {
        while (failure.getCause() != null) failure = failure.getCause();
        return failure;
    }
}
