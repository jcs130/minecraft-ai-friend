package org.qiandengji.villagerquests.core;

import java.util.Map;

/** Fixed Chinese lines. The only text a villager says that never passes through a model. */
public final class Templates {
    private static final Map<String, String> NAMES = Map.ofEntries(
            Map.entry("minecraft:zombie", "僵尸"), Map.entry("minecraft:skeleton", "骷髅"), Map.entry("minecraft:spider", "蜘蛛"),
            Map.entry("minecraft:creeper", "苦力怕"), Map.entry("minecraft:husk", "尸壳"), Map.entry("minecraft:drowned", "溺尸"),
            Map.entry("minecraft:wheat", "小麦"), Map.entry("minecraft:bread", "面包"), Map.entry("minecraft:carrot", "胡萝卜"),
            Map.entry("minecraft:potato", "马铃薯"), Map.entry("minecraft:cod", "生鳕鱼"), Map.entry("minecraft:oak_log", "橡木原木"));

    private Templates() {}

    public static String targetName(String target) {
        String n = NAMES.get(target);
        return n != null ? n : target.substring(target.indexOf(':') + 1);
    }

    public static String ask(Commission c) {
        return switch (c.type()) {
            case SLAY -> "讨伐 " + c.quantity() + " 只" + targetName(c.target());
            case GATHER -> "带来 " + c.quantity() + " 个" + targetName(c.target());
            case REACH -> "去看看" + (c.area() == null ? "那里" : String.format("(%.0f, %.0f, %.0f) 附近", c.area().x(), c.area().y(), c.area().z()));
        };
    }

    /** Used when the model is off, over budget, slow, or its reply fails {@link StoryParser}. */
    public static StoryParser.Story fallback(Commission c, String villagerName, String reason) {
        String title = switch (c.type()) {
            case SLAY -> "驱赶" + targetName(c.target());
            case GATHER -> "缺些" + targetName(c.target());
            case REACH -> "替我去看一眼";
        };
        String why = reason == null || reason.isBlank() ? "" : reason + "。";
        return new StoryParser.Story(title, Text.clean(why + villagerName + "想请人帮忙：" + ask(c) + "。", 300));
    }

    public static String offered(String villager, Commission c) {
        return "【委托】" + villager + "：" + c.title() + "——" + ask(c) + "（" + c.deadlineMinutes() + " 分钟内）";
    }

    public static String accepted(String villager, String who) { return villager + "：" + who + "愿意帮忙？太好了，拜托你了！"; }

    public static String progress(String villager, int progress, int quantity) { return villager + "：已经 " + progress + "/" + quantity + " 了，辛苦啦。"; }

    public static String completed(String villager, String who) { return villager + "：真的谢谢你，" + who + "！这是一点心意。"; }

    public static String abandoned(String villager) { return villager + "：没关系，我再等等别人。"; }

    public static String expired(String villager) { return villager + "：天色晚了，这件事就先放一放吧。"; }

    public static String handedToHeroes(String villager) { return villager + "：我去请村里的英雄们帮忙看看。"; }
}
