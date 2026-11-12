package local.tlmcompat.qa;

import com.github.tartaricacid.touhoulittlemaid.api.event.MaidFishedEvent;
import com.google.gson.Gson;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;
import net.minecraft.core.registries.BuiltInRegistries;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.neoforge.common.NeoForge;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.ItemSpawnEvent;
import org.bukkit.plugin.java.JavaPlugin;

/** Observes original fishing and drops in the synthetic loopback fixture. */
public final class MaidFishingQa extends JavaPlugin implements Listener {
    private static final UUID FIXTURE = UUID.fromString("ff2b3f9b-0733-44e6-a990-16194f71470f");
    private final List<Map<String, Object>> events = new ArrayList<>();
    private final List<Map<String, Object>> drops = new ArrayList<>();
    private Location origin;
    private int catchTick = -10;
    private boolean registered;

    private final Consumer<MaidFishedEvent> retrieved = event -> {
        if (event.getMaid() == null || !FIXTURE.equals(event.getMaid().getUUID())) return;
        origin = event.getMaid().getBukkitEntity().getLocation();
        catchTick = Bukkit.getCurrentTick();
        var loot = event.getDrops().stream().map(item -> Map.of(
            "item", BuiltInRegistries.ITEM.getKey(item.getItem()).toString(), "count", item.getCount())).toList();
        events.add(Map.of("tick", catchTick, "hookId", event.getHook().getUUID().toString(), "loot", loot));
    };

    @Override public void onEnable() {
        if (Bukkit.getPort() != 25938 || !"127.0.0.1".equals(Bukkit.getIp())
                || !Files.isRegularFile(Path.of(".maid-lifecycle-qa"))) {
            Bukkit.getPluginManager().disablePlugin(this);
            return;
        }
        NeoForge.EVENT_BUS.addListener(EventPriority.LOWEST, false, retrieved);
        registered = true;
        Bukkit.getPluginManager().registerEvents(this, this);
        getCommand("maidfishqa").setExecutor((sender, command, label, args) -> {
            if (sender instanceof Player) return false;
            if (args.length == 1 && args[0].equals("clear")) {
                events.clear();
                drops.clear();
                origin = null;
            }
            sender.sendMessage("MAID_FISH_QA " + new Gson().toJson(Map.of("retrievals", events, "drops", drops)));
            return true;
        });
    }

    @EventHandler(priority = org.bukkit.event.EventPriority.MONITOR, ignoreCancelled = true)
    public void item(ItemSpawnEvent event) {
        Location at = event.getLocation();
        if (origin == null || Bukkit.getCurrentTick() != catchTick || !origin.getWorld().equals(at.getWorld())
                || origin.distanceSquared(at) > 1) return;
        var stack = event.getEntity().getItemStack();
        drops.add(Map.of("tick", catchTick, "item", stack.getType().getKey().toString(), "count", stack.getAmount(),
            "id", event.getEntity().getUniqueId().toString()));
    }

    @Override public void onDisable() {
        if (registered) NeoForge.EVENT_BUS.unregister(retrieved);
    }
}
