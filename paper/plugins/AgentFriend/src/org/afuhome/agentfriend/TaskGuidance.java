package org.afuhome.agentfriend;

/** Current instructions for existing goals; never changes stored terms or evidence. */
final class TaskGuidance {
    private TaskGuidance() { }

    static String photo() {
        return "从技能罗盘→女神相机或 /mycli photo menu 点击拍照；Agent可用 /mycli photo take <名字> [第一人称|第三人称|俯视] [1|2]。无需空地图或主背包空位，开始拍摄默认耗2魔力。站稳等成片自动存入个人奖励箱，/mycli photo status 查进度、/mycli arena stash pages 取照片；箱满保留在本人待入箱队列，腾位重开。无需截图、网页或上传文件。照片委托须先接单再拍，旧图和复制图不算；海报末尾加2。";
    }

    static String step(GuildManager.Goal goal, String original) {
        if(TrialGuide.goal(goal))return original.replace("地下城","试炼塔")+"（从第1层开始，清层自动下楼；非遗迹dungeon）";
        return switch (goal) {
            case PEAK -> "到达 Y≥120 的高处，天然山峰、建筑屋顶和高塔均可；不要求积雪或全程徒步。横向走过一格记录，再 guild status 查询、guild claim 交付。";
            case PHOTO -> photo();
            case MAP_HUNT -> original.replace("天然藏宝箱须亲自新开，旧空箱、自制箱或只到坐标不算。", "遗迹图需进入原目标走查，不要求开箱；仅埋藏宝藏须亲自新开天然箱。地表标记不是入口，旧空箱、自制箱或只到坐标不算。");
            default -> original;
        };
    }

    static String description(String original) {
        // These exact phrases came from the former built-in photo templates.
        return original.replace("用现有截图上传", "用女神相机 /mycli photo take <名字> 自动拍照，无需上传")
                .replace("截图上传流程 /photohelp", "女神相机流程 /photohelp");
    }

    static void validateStep(java.util.Map<?, ?> raw) {
        for (Object key : raw.keySet())
            if (!(key instanceof String text) || !text.matches("[a-z][a-z0-9-]*"))
                throw new IllegalArgumentException("step field: quote descriptions containing commas in YAML flow maps");
    }

    static String legacyDescription(String original, java.util.Map<?, ?> raw) {
        // Older unquoted world(x,y,z) descriptions were split into null YAML keys.
        // Recover their display text without rewriting the frozen definition.
        if (!original.matches(".*world\\(-?\\d+$")) return original;
        String y = null, tail = null;
        for (var entry : raw.entrySet()) {
            if (entry.getValue() != null) continue;
            String key = String.valueOf(entry.getKey());
            if (key.matches("-?\\d+")) {
                if (y != null) return original;
                y = key;
            } else if (key.matches("-?\\d+\\).+")) {
                if (tail != null) return original;
                tail = key;
            }
        }
        return y != null && tail != null ? original + "," + y + "," + tail : original;
    }
}
