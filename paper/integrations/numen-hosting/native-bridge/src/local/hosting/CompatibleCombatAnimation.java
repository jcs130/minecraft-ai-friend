package local.hosting;

import net.bettercombat.logic.AnimatedHand;
import net.bettercombat.logic.PlayerAttackHelper;
import net.bettercombat.network.Packets;
import net.minecraft.network.protocol.common.ClientboundCustomPayloadPacket;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.damagesource.DamageTypes;
import net.minecraft.resources.ResourceKey;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;

/** Presents an ordinary melee hit to nearby clients that support Better Combat. */
public final class CompatibleCombatAnimation {
    private CompatibleCombatAnimation() {}

    public record Combo(ItemStack main, ItemStack off, int slot, ResourceKey<Level> world, long at, long expires, int next) {
        int index(ServerPlayer p, long tick) {
            return tick >= at && tick <= expires && main == p.getMainHandItem() && off == p.getOffhandItem()
                    && slot == p.getInventory().selected && world.equals(p.level().dimension()) ? next : 0;
        }
    }
    public record Swing(Packets.AttackAnimation packet, Combo afterHit) {}

    public static Swing capture(ServerPlayer player, DamageSource source, Combo previous) {
        if (player.connection == null || HostedBetterCombat.hosted(player)
                || player.connection.hasChannel(Packets.AttackAnimation.ID)
                || player.connection.hasChannel(Packets.C2S_AttackRequest.ID)
                || source.getEntity() != player || source.getDirectEntity() != player
                || !source.is(DamageTypes.PLAYER_ATTACK) || player.getMainHandItem().isEmpty()) {
            return null;
        }

        // Ordinary input attacks with the main hand. Even indices select that
        // hand in Better Combat's dual-wield sequence. Only presentation advances.
        long tick = player.serverLevel().getGameTime();
        int index = previous == null ? 0 : previous.index(player, tick);
        boolean dual = PlayerAttackHelper.isDualWielding(player);
        var hand = PlayerAttackHelper.getCurrentAttack(player, dual ? index * 2 : index);
        if (hand == null || hand.isOffHand() || hand.attack() == null || hand.attributes() == null) {
            return null;
        }
        String name = hand.attack().animation();
        if (name == null || name.isBlank() || name.equals(Packets.AttackAnimation.StopSymbol)) {
            return null;
        }

        float durationTicks = PlayerAttackHelper.getAttackCooldownTicksCapped(player);
        float upswing = (float) hand.upswingRate();
        float range = (float) PlayerAttackHelper.getStaticRange(player, hand.itemStack());
        if (!Float.isFinite(durationTicks) || durationTicks <= 0
                || !Float.isFinite(upswing) || !Float.isFinite(range)) {
            return null;
        }
        var packet = new Packets.AttackAnimation(player.getId(), AnimatedHand.from(false, hand.attributes().isTwoHanded()),
                name, durationTicks, upswing, range, Math.max(1, Math.round(durationTicks * upswing)),
                Packets.SwingParticles.EMPTY);
        long window = Math.max(1, Math.round(durationTicks * net.bettercombat.BetterCombatMod.config.combo_reset_rate));
        int next = hand.combo().current() % hand.combo().total();
        return new Swing(packet, new Combo(player.getMainHandItem(), player.getOffhandItem(), player.getInventory().selected,
                player.level().dimension(), tick, tick + window, next));
    }

    public static void send(ServerPlayer attacker, ServerLevel level, Packets.AttackAnimation animation) {
        if (attacker.level() != level || attacker.isRemoved() || attacker.getId() != animation.playerId()) {
            return;
        }
        var tracker = level.getChunkSource().chunkMap.entityMap.get(attacker.getId());
        if (tracker == null) {
            return;
        }
        var packet = new ClientboundCustomPayloadPacket(animation);
        for (var trackingConnection : tracker.seenBy) {
            var viewer = trackingConnection.getPlayer();
            if (viewer != attacker && viewer.level() == level && viewer.connection == trackingConnection
                    && viewer.connection.isAcceptingMessages()
                    && viewer.connection.hasChannel(Packets.AttackAnimation.ID)) {
                viewer.connection.send(packet);
            }
        }
    }
}
