package dev.qiandeng.chatqa;

import com.google.gson.Gson;
import com.mojang.authlib.GameProfile;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.network.Connection;
import io.netty.channel.embedded.EmbeddedChannel;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.players.PlayerList;
import net.minecraft.world.entity.Entity;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.common.util.FakePlayer;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Only loaded in the disposable smoke world. No production actors or model clients. */
@Mod("qiandeng_chat_qa")
public final class PublicChatQa {
    private final List<String> heard = new ArrayList<>();
    private final List<Listener> actors = new ArrayList<>();
    public PublicChatQa() { NeoForge.EVENT_BUS.addListener(this::register); }
    final class Listener extends FakePlayer {
        Listener(ServerLevel level, String id, String name, double x) {
            super(level, new GameProfile(UUID.fromString(id), name));
            setPos(x, 70, 0); setNoGravity(true);
            try {
                var field = Connection.class.getDeclaredField("channel"); field.setAccessible(true);
                field.set(connection.getConnection(), new EmbeddedChannel());
            } catch (ReflectiveOperationException failure) { throw new IllegalStateException(failure); }
        }
        @Override public void sendSystemMessage(Component message) {
            heard.add(getName().getString() + ":" + message.getString());
        }
        @Override public void sendSystemMessage(Component message, boolean overlay) {
            heard.add(getName().getString() + ":" + message.getString());
        }
    }
    @SuppressWarnings("unchecked")
    List<ServerPlayer> roster(PlayerList players) {
        try {
            var field = PlayerList.class.getDeclaredField("players"); field.setAccessible(true);
            return (List<ServerPlayer>) field.get(players);
        } catch (ReflectiveOperationException failure) { throw new IllegalStateException(failure); }
    }
    @SuppressWarnings("unchecked")
    Map<UUID, ServerPlayer> ids(PlayerList players) {
        try {
            var field = PlayerList.class.getDeclaredField("playersByUUID"); field.setAccessible(true);
            return (Map<UUID, ServerPlayer>) field.get(players);
        } catch (ReflectiveOperationException failure) { throw new IllegalStateException(failure); }
    }
    void register(RegisterCommandsEvent event) {
        if (!"isolated-survivor-chat".equals(System.getenv("QD_QA_FIXTURE")))
            throw new IllegalStateException("isolated_fixture_required");
        event.getDispatcher().register(Commands.literal("qdchatqa")
            .requires(s -> s.getEntity() == null && s.hasPermission(4))
            .then(Commands.literal("status").executes(c -> {
                c.getSource().sendSuccess(() -> Component.literal("QD_CHAT_QA " +
                    new Gson().toJson(Map.of("heard", heard, "actors", actors.size()))), false);
                return 1;
            }))
            .then(Commands.literal("setup").executes(c -> {
                if (!actors.isEmpty()) throw new IllegalStateException("already_setup");
                var server = c.getSource().getServer(); var level = server.overworld();
                actors.add(new Listener(level, "11111111-1111-4111-8111-111111111111", "Kirito", 0));
                actors.add(new Listener(level, "22222222-2222-4222-8222-222222222222", "Observer", 1));
                actors.add(new Listener(level, "33333333-3333-4333-8333-333333333333", "FarObserver", 30));
                for (var actor : actors) {
                    level.addNewPlayer(actor);
                    roster(server.getPlayerList()).add(actor);
                    ids(server.getPlayerList()).put(actor.getUUID(), actor);
                }
                c.getSource().sendSuccess(() -> Component.literal("QD_CHAT_SETUP"), false);
                return 1;
            }))
            .then(Commands.literal("remove_viewers").executes(c -> {
                var server = c.getSource().getServer();
                for (var actor : List.copyOf(actors)) {
                    if (actor.getName().getString().equals("Kirito")) continue;
                    roster(server.getPlayerList()).remove(actor);
                    ids(server.getPlayerList()).remove(actor.getUUID());
                    server.overworld().removePlayerImmediately(actor, Entity.RemovalReason.DISCARDED);
                    actors.remove(actor);
                }
                c.getSource().sendSuccess(() -> Component.literal("QD_CHAT_VIEWERS_REMOVED"), false);
                return 1;
            })));
    }
}
