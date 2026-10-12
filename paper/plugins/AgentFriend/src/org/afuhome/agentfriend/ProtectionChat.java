package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.List;

/** A short automatic notice; explicit protect queries retain every boundary
 * and the full nextAction. This only formats text and grants no permissions. */
final class ProtectionChat {
    private ProtectionChat() { }

    static List<String> summary(JsonObject data) {
        List<String> lines = new ArrayList<>();
        String reason = data.get("reason").getAsString();
        boolean unknown = reason.startsWith("unknown_");
        String target = "(" + data.get("x") + "," + data.get("y") + "," + data.get("z") + ")";
        String world = data.get("world").getAsString();
        String worldLabel = switch (world) {
            case "minecraft:overworld" -> "主世界";
            case "minecraft:the_nether" -> "下界";
            case "minecraft:the_end" -> "末地";
            default -> world;
        };
        lines.add("§c【操作未执行】" + data.get("actionLabel").getAsString()
                + (unknown ? "尚未确认权限" : "被保护规则拒绝") + "；" + worldLabel + " " + target
                + (data.has("owner") ? "，归属：" + data.get("owner").getAsString() : "") + "。");
        if (data.has("globalProtection") && data.get("globalProtection").getAsBoolean()) {
            lines.add("§e【保护范围】当前世界的全局权限限制，请联系服主确认可操作地点或授权。");
        } else if (data.has("areas") && !data.getAsJsonArray("areas").isEmpty()) {
            var areas = data.getAsJsonArray("areas");
            JsonObject area = areas.get(0).getAsJsonObject();
            var min = area.getAsJsonArray("min"); var max = area.getAsJsonArray("max");
            lines.add("§e【保护范围】" + area.get("name").getAsString() + " (" + min.get(0) + "," + min.get(1) + "," + min.get(2)
                    + ") 至 (" + max.get(0) + "," + max.get(1) + "," + max.get(2) + ")，含边界"
                    + (area.get("envelopeOnly").getAsBoolean() ? "；这是外包范围，具体按建筑或区域形状保护" : "")
                    + (areas.size() > 1 ? "；另有" + (areas.size() - 1) + "处重叠保护，详情请查询" : "") + "。");
        }
        String next;
        if (unknown || reason.endsWith("unavailable") || data.has("boundsIncomplete")) {
            next = "权限未确认；停止操作，先查询详情，服务异常请联系服主。";
        } else if (List.of("generated_structure", "village_structure", "life_guild_building").contains(reason)) {
            next = "沿原有门、楼梯或梯子通行；施工请选择保护范围外位置后重新查询。";
        } else if (reason.startsWith("guild_owner") || data.has("landId") && data.get("landId").getAsString().equals(LandManager.GUILD)) {
            next = "私产须主人授权；领公共物资请用 /mycli guild shared。";
        } else if (reason.equals("land_notice_board")) {
            next = "右键公告牌查看主人和协作者；调整公告牌位置请联系服主。";
        } else if (List.of("pickup", "display", "inventory").contains(data.get("action").getAsString())) {
            next = "请取得主人授权；移出保护区不会自动解除物品归属。";
        } else {
            next = "先确认主人授权或可施工位置，换目标后重新查询权限。";
        }
        String action = switch (data.get("action").getAsString()) {
            case "place", "bucket", "fertilize" -> "place";
            case "container", "inventory" -> "container";
            case "use", "interact" -> "use";
            default -> "break";
        };
        lines.add("§a【正确做法】" + next + "详情：/mycli protect " + action + " "
                + data.get("x") + " " + data.get("y") + " " + data.get("z"));
        return List.copyOf(lines);
    }
}
