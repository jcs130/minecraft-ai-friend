package dev.qiandeng.maw;

import com.google.gson.JsonObject;
import net.minecraft.commands.Commands;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.arguments.EntityArgument;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;

/** Reuses the existing mixed-login policy without importing the old gameplay bridge. */
@Mod(value="maw_fom_support",dist=Dist.DEDICATED_SERVER)
public final class FomSupport {
    public FomSupport(IEventBus bus) {
        PlayerAuthBridge.register(bus);
        NativeRegistryDump.register();
        FomAgentAccess.register();
        NeoForge.EVENT_BUS.addListener((RegisterCommandsEvent event)->event.getDispatcher().register(
            Commands.literal("fom").then(Commands.literal("status").executes(c->report(c.getSource(),c.getSource().getPlayerOrException())))
                .then(Commands.literal("auth").requires(s->s.hasPermission(4)).then(Commands.argument("player",EntityArgument.player())
                    .executes(c->report(c.getSource(),EntityArgument.getPlayer(c,"player")))))));
    }
    private static int report(CommandSourceStack source,ServerPlayer player) {
        boolean registered;
        try {registered=(Boolean)Class.forName("io.github.truscdo.mixauth.offline.OfflineAuthService")
            .getMethod("isOfflineRegistered",java.util.UUID.class).invoke(null,player.getUUID());}
        catch(ReflectiveOperationException unavailable){source.sendFailure(Component.literal("登录状态暂不可用"));return 0;}
        JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("kind","fom_login");
        out.addProperty("playerUuid",player.getUUID().toString());out.addProperty("username",player.getGameProfile().getName());
        out.addProperty("authenticated",PlayerAuthBridge.authenticated(player));out.addProperty("passwordRegistered",registered);
        JsonObject pos=new JsonObject();pos.addProperty("x",player.getX());pos.addProperty("y",player.getY());pos.addProperty("z",player.getZ());out.add("position",pos);
        source.sendSuccess(()->Component.literal("MC_FOM_AUTH "+out),false);return 1;
    }
}
