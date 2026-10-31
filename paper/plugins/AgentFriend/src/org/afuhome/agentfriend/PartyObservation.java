package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import org.bukkit.Bukkit;

/** Supplement the existing operator-only observation with the authoritative native party view. */
final class PartyObservation {
    static void add(AgentFriendPlugin plugin,JsonObject out,JsonObject request) {
        if(!plugin.nativeRpg().selected())return;
        var player=Bukkit.getPlayerExact(request.get("player").getAsString());
        if(player!=null)out.add("party",plugin.nativeRpg().party(player));
    }
}
