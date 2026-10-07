package fixture;
import java.util.concurrent.ConcurrentHashMap;
import org.bukkit.plugin.Plugin;
public final class AuraPlugin implements Plugin {
    private final Provider provider = new Provider();
    public boolean isEnabled() { return true; }
    public Provider getMessageProvider() { return provider; }
    public static final class Provider {
        private final ConcurrentHashMap<Object, Object> componentCache = new ConcurrentHashMap<>();
        public ConcurrentHashMap<Object, Object> cache() { return componentCache; }
    }
}
