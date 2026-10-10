package org.afuhome.agentfriend;

/** Current instructions for existing goals; never changes stored terms or evidence. */
final class TaskGuidance {
    private TaskGuidance() { }

    static String photo() {
        return "准备1张空地图和1个空主背包格，用 /mycli photo take <名字> [first|third|top] 拍照。站稳等地图入包，/mycli photo status 查进度；无需截图、网页或上传文件。照片委托须先接单再拍，旧图和复制图不算。海报末尾加2，需4张空地图和4个空格。";
    }

    static String step(GuildManager.Goal goal, String original) {
        return switch (goal) {
            case PEAK -> "到达 Y≥120 的高处，天然山峰、建筑屋顶和高塔均可；不要求积雪或全程徒步。横向走过一格记录，再 guild status 查询、guild claim 交付。";
            case PHOTO -> photo();
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
