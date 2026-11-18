package local.hosting;

import net.bettercombat.logic.AnimatedHand;
import net.bettercombat.logic.PlayerAttackHelper;
import net.bettercombat.network.Packets;
import net.minecraft.network.protocol.common.ClientboundCustomPayloadPacket;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.damagesource.DamageTypes;

/** Presents an ordinary melee hit to nearby clients that support Better Combat. */
public final class CompatibleCombatAnimation {
    private CompatibleCombatAnimation() {}

    public static Packets.AttackAnimation capture(ServerPlayer player, DamageSource source) {
        if (player.connection == null || HostedBetterCombat.hosted(player)
                || player.connection.hasChannel(Packets.AttackAnimation.ID)
                || player.connection.hasChannel(Packets.C2S_AttackRequest.ID)
                || source.getEntity() != player || source.getDirectEntity() != player
                || !source.is(DamageTypes.PLAYER_ATTACK) || player.getMainHandItem().isEmpty()) {
            return null;
        }

        // The vanilla attack packet has no combo or off-hand strike. Resolve
        // the weapon's first applicable main-hand attack through Better Combat.
        var hand = PlayerAttackHelper.getCurrentAttack(player, 0);
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
        return new Packets.AttackAnimation(player.getId(), AnimatedHand.from(false, hand.attributes().isTwoHanded()),
                name, durationTicks, upswing, range, Math.max(1, Math.round(durationTicks * upswing)),
                Packets.SwingParticles.EMPTY);
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
