package org.afuhome.agentfriend;

import com.google.gson.JsonObject;

/** The field survey and the long walk share one departure point and one delivery. */
final class PilgrimageRoute {
    static final int SURVEY = 160, LONG_WALK = 500, RETURN = 50;
    static final String DESCRIPTION = "从接单点徒步出发。沿途跨一次真实群系边界，向东、西、南或北走出160格，或任选方向走出500格，再返回起点X、Z各50格内。";

    private PilgrimageRoute() {}

    static boolean reachedTurn(int distance, boolean surveyed) {
        return distance >= LONG_WALK || (surveyed && distance >= SURVEY);
    }

    static JsonObject guide(String world, int x, int y, int z, boolean sameWorld, int distance,
                            boolean restart, boolean far, String biome, boolean ready) {
        var out = new JsonObject();
        String origin = world + " (" + x + ", " + y + ", " + z + ")";
        out.addProperty("originWorld", world);
        out.addProperty("originX", x); out.addProperty("originY", y); out.addProperty("originZ", z);
        if (sameWorld) out.addProperty("distanceFromOrigin", distance);
        out.addProperty("surveyDistance", SURVEY); out.addProperty("longDistance", LONG_WALK);
        out.addProperty("returnRadius", RETURN); out.addProperty("surveyedBiome", biome);
        String phase, action;
        if (ready) {
            phase="ready_to_submit"; action="徒步往返已记录，回公会点交付或使用 /mycli guild claim。";
        } else if (!sameWorld || restart) {
            phase="restart_at_origin"; action="回到起点 " + origin + " 附近50格，在地面走一步重新出发。";
        } else if (far) {
            phase="return"; action="去程已记。返回起点 " + origin + "，X、Z各50格内完成；当前距起点" + distance + "格。";
        } else {
            phase="outbound"; action="起点 " + origin + "，当前距起点" + distance + "格。"
                    + (biome.isEmpty() ? "跨一条群系边界后走够160格，或直接徒步走够500格。"
                    : "已调查 " + biome + "，再远离起点" + Math.max(0, SURVEY-distance) + "格即可折返。");
        }
        out.addProperty("phase", phase); out.addProperty("nextAction", action);
        return out;
    }
}
