package org.afuhome.agentfriend;

import com.google.gson.*;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

/** Read the enabled Essentials implementation's effective Settings, not a stale YAML copy. */
final class AgentChatPolicy {
    static JsonObject observe(AgentFriendPlugin owner,Player player) {
        var manager=owner.getServer().getPluginManager();
        Plugin essentials=manager.getPlugin("Essentials"),chat=manager.getPlugin("EssentialsChat");
        if(essentials==null||!essentials.isEnabled()||chat==null||!chat.isEnabled())return unknown();
        try {
            Object settings=essentials.getClass().getMethod("getSettings").invoke(essentials);
            int radius=((Number)settings.getClass().getMethod("getChatRadius").invoke(settings)).intValue();
            char shout=(Character)settings.getClass().getMethod("getChatShout").invoke(settings);
            boolean defaults=(Boolean)settings.getClass().getMethod("isShoutDefault").invoke(settings);
            boolean persist=(Boolean)settings.getClass().getMethod("isPersistShout").invoke(settings);
            var out=new Gson().toJsonTree(AgentCommunicationContract.chatPolicy("EssentialsXChat",
                chat.getPluginMeta().getVersion(),radius,shout,defaults,persist)).getAsJsonObject();
            var permissions=new JsonObject();
            for(String key:new String[]{"essentials.chat.shout","essentials.msg"})permissions.addProperty(key,player.hasPermission(key));
            out.add("permissionNodes",permissions); // Permission alone never certifies delivery or bypasses mute/ignore.
            out.addProperty("worldKey",player.getWorld().getKey().toString());
            out.addProperty("worldUuid",player.getWorld().getUID().toString());
            return out;
        } catch(ReflectiveOperationException|RuntimeException unavailable){return unknown();}
    }
    private static JsonObject unknown(){var out=new JsonObject();out.addProperty("schema","agent-mc/chat-policy/v1");
        out.addProperty("provider","unknown");out.addProperty("defaultChannel","unknown");out.addProperty("deliveryAcknowledged",false);return out;}
}
