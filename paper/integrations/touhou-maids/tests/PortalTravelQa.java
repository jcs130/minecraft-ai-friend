package local.tlmcompat.qa;

import com.google.gson.Gson;
import java.util.*;
import java.util.function.Consumer;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.EntityJoinLevelEvent;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityTeleportEvent;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerPortalEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.plugin.java.JavaPlugin;

/** Records native travel events for the synthetic loopback fixture. */
public final class PortalTravelQa extends JavaPlugin implements Listener {
    private final List<Map<String, Object>> events = new ArrayList<>();
    private UUID maid;
    private boolean cancelPortal;
    private boolean cancelMaid;
    private boolean rejectJoin;
    private boolean joinListenerRegistered;
    private final Consumer<EntityJoinLevelEvent> joinListener = event -> {
        if (!rejectJoin || !event.getEntity().getUUID().equals(maid)
                || !event.getLevel().dimension().location().toString().equals("minecraft:the_nether")) return;
        rejectJoin = false;
        event.setCanceled(true);
        events.add(Map.of("event", "maid_join_rejected", "cause", "synthetic", "tick", Bukkit.getCurrentTick()));
    };

    @Override public void onEnable() {
        if (Bukkit.getPort() != 25938 || !Bukkit.getIp().equals("127.0.0.1")) {
            Bukkit.getPluginManager().disablePlugin(this);
            return;
        }
        Bukkit.getPluginManager().registerEvents(this, this);
        NeoForge.EVENT_BUS.addListener(joinListener);
        joinListenerRegistered = true;
        Objects.requireNonNull(getCommand("portalqa")).setExecutor((sender, command, label, args) -> run(sender, args));
    }

    @Override public void onDisable() {
        if (joinListenerRegistered) NeoForge.EVENT_BUS.unregister(joinListener);
    }

    private boolean run(CommandSender sender, String[] args) {
        if (sender instanceof Player || args.length == 0) return false;
        switch (args[0]) {
            case "track" -> {
                if (args.length != 2) return false;
                maid = UUID.fromString(args[1]);
                events.clear();
                cancelPortal = false;
                cancelMaid = false;
                rejectJoin = false;
                sender.sendMessage("PORTAL_QA_READY");
            }
            case "cancel" -> cancelPortal = true;
            case "cancel-maid" -> cancelMaid = true;
            case "reject-join" -> rejectJoin = true;
            case "read" -> sender.sendMessage("PORTAL_QA " + new Gson().toJson(events));
            case "maid-world" -> {
                var entity = maid == null ? null : Bukkit.getEntity(maid);
                sender.sendMessage(entity == null ? "PORTAL_QA_MAID absent"
                        : "PORTAL_QA_MAID " + entity.getWorld().getKey() + " " + entity.isValid());
            }
            default -> { return false; }
        }
        return true;
    }

    private boolean tracked(Player player) {
        return maid != null && player.getName().equals("MaidBrainQA");
    }

    private void record(String kind, Player player, Location from, Location to, String cause, boolean cancelled) {
        if (!tracked(player) || events.size() >= 64) return;
        var row = new LinkedHashMap<String, Object>();
        row.put("event", kind);
        row.put("cause", cause);
        row.put("cancelled", cancelled);
        row.put("tick", Bukkit.getCurrentTick());
        row.put("from", from == null ? null : from.getWorld().getKey().toString());
        row.put("to", to == null ? null : to.getWorld().getKey().toString());
        if (from != null && !kind.equals("changed_world")) row.put("source", List.of(from.getX(), from.getY(), from.getZ()));
        if (to != null) row.put("target", List.of(to.getX(), to.getY(), to.getZ()));
        row.put("currentConnection", Bukkit.getPlayer(player.getUniqueId()) == player);
        var entity = Bukkit.getEntity(maid);
        if (!kind.equals("changed_world") && entity != null && from != null && entity.getWorld().equals(from.getWorld())) {
            row.put("maidDistanceFromDeparture", entity.getLocation().distance(from));
        }
        events.add(row);
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void cancel(PlayerPortalEvent event) {
        if (cancelPortal && tracked(event.getPlayer())) event.setCancelled(true);
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void cancelMaid(EntityTeleportEvent event) {
        if (cancelMaid && event.getEntity().getUniqueId().equals(maid)) {
            cancelMaid = false;
            event.setCancelled(true);
            events.add(Map.of("event", "maid_transfer_cancelled", "cause", "synthetic", "tick", Bukkit.getCurrentTick()));
        }
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void maidTransfer(EntityTeleportEvent event) {
        if (!event.getEntity().getUniqueId().equals(maid) || event.getTo() == null) return;
        var to = event.getTo();
        events.add(Map.of("event", "maid_transfer", "cause", "plugin",
                "cancelled", event.isCancelled(), "tick", Bukkit.getCurrentTick(),
                "from", event.getFrom().getWorld().getKey().toString(), "to", to.getWorld().getKey().toString(),
                "target", List.of(to.getX(), to.getY(), to.getZ())));
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void portal(PlayerPortalEvent event) {
        record("portal", event.getPlayer(), event.getFrom(), event.getTo(), event.getCause().name(), event.isCancelled());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void teleport(PlayerTeleportEvent event) {
        record("teleport", event.getPlayer(), event.getFrom(), event.getTo(), event.getCause().name(), event.isCancelled());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void arrived(PlayerChangedWorldEvent event) {
        record("changed_world", event.getPlayer(), new Location(event.getFrom(), 0, 0, 0),
                event.getPlayer().getLocation(), "", false);
    }
}
