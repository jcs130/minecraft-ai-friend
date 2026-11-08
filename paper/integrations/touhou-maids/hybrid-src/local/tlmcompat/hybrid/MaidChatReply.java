package local.tlmcompat.hybrid;

import com.google.gson.*;
import java.util.List;

/** Mineflayer/prismarine-chat truncates plain text at 4096 UTF-16 chars. */
final class MaidChatReply {
    static String text(JsonObject original) {
        String wire="QD_MAID "+original;
        if(wire.length()<=4000)return wire;
        JsonObject compact=original.deepCopy();
        JsonObject data=compact.has("data")&&compact.get("data").isJsonObject()?compact.getAsJsonObject("data"):null;
        JsonObject context=data!=null&&data.has("observation")&&data.get("observation").isJsonObject()?data.getAsJsonObject("observation"):data;
        if(context!=null&&context.has("hostKind")){
            // Facts, identities, life state, status and correlation IDs remain intact.
            for(String key:List.of("capabilities","dialogueCommand","helpCommand","equipmentCommand"))context.remove(key);
            for(String key:List.of("brain","speech","conversation","follow","companion"))if(context.has(key)&&context.get(key).isJsonObject()){
                JsonObject section=context.getAsJsonObject(key);
                for(String help:List.of("meaning","nextStep","nextCommand","ownerWorkCommand","choices"))section.remove(help);
            }
            context.addProperty("helpCommand","/qdmaid help");
            context.addProperty("compactHelp",true);
        }
        wire="QD_MAID "+compact;
        if(wire.length()<=4000)return wire;
        JsonObject unavailable=new JsonObject();
        for(String key:List.of("schema","protocol","recipientUuid","action","requestId","sampledAt"))if(original.has(key))unavailable.add(key,original.get(key));
        unavailable.addProperty("ok",false);unavailable.addProperty("error","response_requires_plugin_channel");
        unavailable.addProperty("nextStep","结果超过旧聊天通道容量。请使用 qiandengji:maids 插件通道查询原请求结果；不要换新请求 ID 重做动作。");
        return "QD_MAID "+unavailable;
    }
}
