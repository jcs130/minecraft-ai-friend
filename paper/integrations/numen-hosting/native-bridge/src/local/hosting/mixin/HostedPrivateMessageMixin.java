package local.hosting.mixin;

import java.util.Collection;
import local.hosting.HostedNativeSpeech;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.network.chat.ChatType;
import net.minecraft.network.chat.OutgoingChatMessage;
import net.minecraft.network.chat.PlayerChatMessage;
import net.minecraft.server.commands.MsgCommand;
import net.minecraft.server.level.ServerPlayer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

@Mixin(value = MsgCommand.class, remap = false)
public abstract class HostedPrivateMessageMixin {
    @Redirect(method = "sendMessage(Lnet/minecraft/commands/CommandSourceStack;Ljava/util/Collection;Lnet/minecraft/network/chat/PlayerChatMessage;)V",
        at = @At(value = "INVOKE", target = "Lnet/minecraft/server/level/ServerPlayer;sendChatMessage(Lnet/minecraft/network/chat/OutgoingChatMessage;ZLnet/minecraft/network/chat/ChatType$Bound;)V"))
    private static void hosted$deliverPrivateMessage(ServerPlayer body, OutgoingChatMessage outgoing, boolean filter,
            ChatType.Bound type, CommandSourceStack source, Collection<ServerPlayer> targets, PlayerChatMessage message) {
        if (targets.size() != 1) {
            body.sendChatMessage(outgoing, filter, type);
            return;
        }
        HostedNativeSpeech.privateMessage(source, body, message, outgoing, filter, type);
    }
}
