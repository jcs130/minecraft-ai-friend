package local.tlmcompat.hybrid;

import com.google.gson.JsonObject;

/** The automatic result is still delivered to the Agent, but is not a second visible chat line. */
final class MaidReplyPresentation {
    static boolean alreadyShown(String action,JsonObject data,String error){
        if(error!=null||!"chat-result".equals(action)||data==null)return false;
        var status=data.get("status");var observation=data.get("observation");
        if(status==null||!status.isJsonPrimitive()||!status.getAsJsonPrimitive().isString()||!"replied".equals(status.getAsString())||observation==null||!observation.isJsonObject())return false;
        var route=observation.getAsJsonObject().get("textPresentation");
        return route!=null&&route.isJsonPrimitive()&&route.getAsJsonPrimitive().isString()
            &&("nearby_canonical".equals(route.getAsString())||"original_tlm".equals(route.getAsString()));
    }
}
