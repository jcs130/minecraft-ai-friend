package local.qa.combat;

import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelOutboundHandlerAdapter;
import io.netty.channel.ChannelPromise;
import java.nio.file.Files;
import java.nio.file.Path;
import net.minecraft.network.protocol.common.ClientboundCustomPayloadPacket;
import org.bukkit.Material;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.java.JavaPlugin;

/** Packet and damage observation for a disposable loopback test server. */
public final class CombatProbe extends JavaPlugin implements Listener {
    @Override
    public void onEnable() {
        if (!getServer().getIp().equals("127.0.0.1") || !Files.isRegularFile(Path.of(".better-combat-crossplay-test"))) {
            throw new IllegalStateException("Use a disposable loopback server");
        }
        getServer().getPluginManager().registerEvents(this, this);
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        var player = (CraftPlayer) event.getPlayer();
        var channel = player.getHandle().connection.connection.channel();
        String viewer = player.getName();
        int entityId = player.getEntityId();
        channel.eventLoop().execute(() -> {
            channel.pipeline().addAfter("encoder", "bcqa_packets", new ChannelOutboundHandlerAdapter() {
                @Override
                public void write(ChannelHandlerContext ctx, Object message, ChannelPromise promise) throws Exception {
                    if (message instanceof ClientboundCustomPayloadPacket custom &&
                            custom.payload().getClass().getName().equals("net.bettercombat.network.Packets$AttackAnimation")) {
                        var payload = custom.payload();
                        var kind = payload.getClass();
                        getLogger().info("BCQA_ANIMATION " + viewer + " " + kind.getMethod("playerId").invoke(payload)
                                + " " + kind.getMethod("animatedHand").invoke(payload)
                                + " " + kind.getMethod("animationName").invoke(payload)
                                + " " + kind.getMethod("length").invoke(payload));
                    }
                    ctx.write(message, promise);
                }
            });
            getLogger().info("BCQA_READY " + viewer + " " + entityId);
        });
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void arrangeCase(EntityDamageByEntityEvent event) {
        var tags = event.getEntity().getScoreboardTags();
        if (tags.contains("bcqa_cancel")) {
            event.setCancelled(true);
        }
        if (tags.contains("bcqa_swap") && event.getDamager() instanceof Player player) {
            player.getInventory().setItemInMainHand(new ItemStack(Material.IRON_AXE));
        }
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onDamage(EntityDamageByEntityEvent event) {
        for (String tag : event.getEntity().getScoreboardTags()) {
            if (tag.startsWith("bcqa_case_")) {
                getLogger().info("BCQA_DAMAGE " + tag + " " + event.getDamager().getName() + " " + event.getCause()
                        + " " + event.isCancelled() + " " + event.getFinalDamage());
            }
        }
    }
}
