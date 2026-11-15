import com.hpfxd.spectatorplus.paper.SpectatorPlugin;
import java.util.Objects;
import net.minecraft.network.protocol.game.ClientboundSoundEntityPacket;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

public final class ObserverPacketProbe extends JavaPlugin {
    @Override public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (sender instanceof Player || args.length < 2) return false;
        Player player = find(args[1]);
        switch (args[0]) {
            case "screen" -> {
                var plugin = (SpectatorPlugin) Bukkit.getPluginManager().getPlugin("SpectatorPlus");
                sender.sendMessage("synced=" + plugin.getSyncController().getScreenSyncHandler().isViewingSyncedScreen(player));
            }
            case "sound" -> {
                var handle = ((CraftPlayer) player).getHandle();
                handle.connection.send(new ClientboundSoundEntityPacket(SoundEvents.NOTE_BLOCK_PLING,
                        SoundSource.PLAYERS, handle, 0.625f, 1.25f, 412857L));
            }
            case "transition" -> {
                if (args.length < 4) return false;
                Player first = find(args[2]);
                player.setGameMode(GameMode.SPECTATOR);
                player.setSpectatorTarget(null);
                first.openInventory(Bukkit.createInventory(first, 27, "QA_CHEST_A"));
                player.setSpectatorTarget(first);
                switch (args[3]) {
                    case "detach" -> player.setSpectatorTarget(null);
                    case "close" -> first.closeInventory();
                    case "switch" -> {
                        Player second = find(args[4]);
                        second.openInventory(Bukkit.createInventory(second, 27, "QA_CHEST_B"));
                        player.setSpectatorTarget(second);
                    }
                    case "stable" -> { }
                    default -> throw new IllegalArgumentException("Unknown QA transition");
                }
            }
            default -> { return false; }
        }
        return true;
    }

    private static Player find(String name) {
        return Objects.requireNonNull(Bukkit.getPlayerExact(name), name);
    }
}
