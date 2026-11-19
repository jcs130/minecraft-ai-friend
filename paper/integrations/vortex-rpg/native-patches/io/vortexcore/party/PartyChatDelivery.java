package io.vortexcore.party;

import com.google.gson.Gson;
import io.vortexcore.ui.MessageService;
import io.vortexcore.world.ExpeditionPartyManager.PartySnapshot;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

/** Delivers one native party message. A hosted body receives the channel facts in its own inbox. */
public final class PartyChatDelivery {
    private static final Gson JSON = new Gson();
    private record Message(int schema, UUID id, UUID partyId, UUID speakerId, String speaker,
                           UUID recipientId, String text) {}

    private PartyChatDelivery() {}

    public static void send(MessageService messages, PartySnapshot party, String formatted,
                            Player speaker, String text) {
        UUID id = UUID.randomUUID();
        for (UUID member : party.members()) {
            Player target = Bukkit.getPlayer(member);
            if (target == null || !target.isOnline()) continue;
            if (hosted(target)) {
                var event = new Message(1, id, party.partyId(), speaker.getUniqueId(), speaker.getName(), member, text);
                target.sendMessage("MC_PARTY_CHAT " + JSON.toJson(event));
            } else {
                messages.send(target, formatted);
            }
        }
    }

    private static boolean hosted(Player player) {
        try {
            Object handle = player.getClass().getMethod("getHandle").invoke(player);
            return handle.getClass().getName().equals("com.dwinovo.numen.hosted.api.entity.NumenPlayer");
        } catch (ReflectiveOperationException unavailable) {
            return false;
        }
    }
}
