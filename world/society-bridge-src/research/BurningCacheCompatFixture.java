import com.github.tartaricacid.touhoulittlemaid.api.mixin.IBlockBurningCacheMixin;

import java.io.IOException;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import javax.tools.ToolProvider;

/**
 * Isolated JVM reproduction of TLM's getDeclaredMethod failure, using the
 * installed TLM API. No Minecraft bootstrap, server connection, or mod edit.
 * Usage: java --class-path <installed-TLM.jar> BurningCacheCompatFixture.java <installed-TLM.jar>
 */
public final class BurningCacheCompatFixture {
    private static final class ServerOnlyLoader extends URLClassLoader {
        int clientLoads;

        ServerOnlyLoader(Path classes) throws IOException {
            super(new URL[]{classes.toUri().toURL()}, BurningCacheCompatFixture.class.getClassLoader());
        }

        @Override protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
            if (name.equals("qa.ClientOnly")) {
                clientLoads++;
                throw new ClassNotFoundException("Dedicated-server fixture refuses " + name);
            }
            return super.loadClass(name, resolve);
        }
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("Expected the installed TLM JAR path");
        Path temporary = Files.createTempDirectory("tlm-burning-reflection-fixture-");
        try {
            Path source = Files.createDirectories(temporary.resolve("qa"));
            Path base = source.resolve("Block.java");
            Path client = source.resolve("ClientOnly.java");
            Path hut = source.resolve("Hut.java");
            Files.writeString(base, "package qa; public class Block { public boolean is(Block other) { return this == other; } }", StandardCharsets.UTF_8);
            Files.writeString(client, "package qa; public class ClientOnly {}", StandardCharsets.UTF_8);
            Files.writeString(hut, """
                    package qa;
                    import com.github.tartaricacid.touhoulittlemaid.api.mixin.IBlockBurningCacheMixin;
                    public class Hut extends Block implements IBlockBurningCacheMixin {
                        private Boolean burning;
                        private Boolean cannotCache;
                        public void getRequirements(ClientOnly client) {}
                        public Boolean touhou_little_maid$isBurning() { return burning; }
                        public void touhou_little_maid$setBurning(boolean value) { burning = value; }
                        public Boolean touhou_little_maid$cannotCache() { return cannotCache; }
                        public void touhou_little_maid$setCannotCache(boolean value) { cannotCache = value; }
                    }
                    """, StandardCharsets.UTF_8);
            int result = ToolProvider.getSystemJavaCompiler().run(null, null, null,
                    "-proc:none", "--release", "21", "-classpath", args[0], "-d", temporary.toString(),
                    base.toString(), client.toString(), hut.toString());
            require(result == 0, "Fixture compilation failed");

            try (ServerOnlyLoader loader = new ServerOnlyLoader(temporary)) {
                Class<?> blockClass = loader.loadClass("qa.Block");
                Class<?> hutClass = loader.loadClass("qa.Hut");
                Object block = hutClass.getDeclaredConstructor().newInstance();
                require(loader.clientLoads == 0, "Ordinary block construction loaded a client class");
                boolean failed = false;
                try {
                    // Exactly the risky operation in NodeEvaluatorBurningCacher:
                    // even though is(Block) is unrelated, all declared method
                    // signatures are resolved, including getRequirements(ClientOnly).
                    block.getClass().getDeclaredMethod("is", blockClass);
                } catch (NoClassDefFoundError expected) {
                    failed = true;
                    require(expected.getMessage().contains("qa/ClientOnly"), "Unexpected missing class");
                }
                require(failed && loader.clientLoads > 0, "Did not reproduce client-only signature resolution");
            }

            try (ServerOnlyLoader loader = new ServerOnlyLoader(temporary)) {
                Object block = loader.loadClass("qa.Hut").getDeclaredConstructor().newInstance();
                IBlockBurningCacheMixin cache = (IBlockBurningCacheMixin) block;
                cache.touhou_little_maid$setCannotCache(true);
                require(Boolean.TRUE.equals(cache.touhou_little_maid$cannotCache()), "Opt-out was not retained");
                require(cache.touhou_little_maid$isBurning() == null, "Opt-out invented a burning classification");
                // TLM's RETURN hook exits here, before reflective scanning.
                require(cache.touhou_little_maid$cannotCache(), "TLM cannot skip its reflection branch");
                require(loader.clientLoads == 0, "Public compatibility API loaded a client class");
            }
            System.out.println("PASS: baseline reflection resolves blocked client signature; native TLM opt-out avoids resolution and leaves burning unknown");
        } finally {
            // Every cleanup target comes solely from our own fresh temp root.
            try (var paths = Files.walk(temporary)) {
                for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.delete(path);
            }
        }
    }
}
