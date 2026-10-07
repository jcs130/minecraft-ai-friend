import java.net.URLClassLoader;
import java.nio.file.Path;
public final class FixtureLauncher {
    public static void main(String[] args) throws Exception {
        try (URLClassLoader loader = new URLClassLoader(new java.net.URL[] {
                Path.of(args[0]).toUri().toURL(), Path.of(args[1]).toUri().toURL()
        }, ClassLoader.getPlatformClassLoader())) {
            Class.forName("fixture.Entry", true, loader).getMethod("run", String.class).invoke(null, args[2]);
        }
    }
}
