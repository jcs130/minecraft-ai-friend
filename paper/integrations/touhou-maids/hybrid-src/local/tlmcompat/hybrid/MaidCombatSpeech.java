package local.tlmcompat.hybrid;

import java.util.LinkedHashMap;

/** Low-priority dialogue about material changes in a confirmed fight. */
final class MaidCombatSpeech {
    static final long GAP = 50_000_000_000L, MAX_AGE = 12_000_000_000L;
    private static final long REPEAT_GAP = 180_000_000_000L, FIGHT_BREAK = 20_000_000_000L;
    private enum Topic { PARTNER_HURT, SELF_HURT, DEFEATED, WEAKENED, ENGAGED, CHANGED_ATTACK }
    record Hit(String dimension, String targetType, String mode, float damage, double targetHealth,
               double partnerHealth, double selfHealth, boolean close) {}

    private long next = Long.MIN_VALUE;
    private long lastHit = Long.MIN_VALUE, encounter, spokenEncounter = -1;
    private String observedDimension = "", spokenTarget = "", spokenMode = "";
    private final LinkedHashMap<String, Long> recentlySpoken = new LinkedHashMap<>();

    String hit(long now, Hit hit, boolean audience, boolean busy) {
        if (!Float.isFinite(hit.damage()) || hit.damage() <= 0) return null;
        if (lastHit == Long.MIN_VALUE || now - lastHit >= FIGHT_BREAK || !observedDimension.equals(hit.dimension())) {
            encounter++;
            observedDimension = hit.dimension();
        }
        lastHit = now;
        if (!audience || busy || now < next) return null;

        String target = targetName(hit.targetType());
        Topic topic;
        if (low(hit.partnerHealth(), .4)) topic = Topic.PARTNER_HURT;
        else if (low(hit.selfHealth(), .4)) topic = Topic.SELF_HURT;
        else if (hit.targetHealth() == 0) topic = Topic.DEFEATED;
        else if (low(hit.targetHealth(), .2)) topic = Topic.WEAKENED;
        else if (spokenEncounter != encounter || !spokenTarget.equals(target)) topic = Topic.ENGAGED;
        else if (!spokenMode.equals(hit.mode())) topic = Topic.CHANGED_ATTACK;
        else return null;

        String subject = topic == Topic.PARTNER_HURT || topic == Topic.SELF_HURT ? "" : target;
        String key = topic.name() + ":" + subject;
        Long previous = recentlySpoken.get(key);
        if (previous != null && now - previous < REPEAT_GAP) return null;

        String text = switch (topic) {
            case PARTNER_HURT -> "你的血线有点悬，先缓口气，留意那只" + target + "。";
            case SELF_HURT -> "我有点吃不消了，能给我留条退路吗？";
            case DEFEATED -> "这只" + target + "倒下了，听听旁边还有没有动静。";
            case WEAKENED -> "那只" + target + "没剩多少血了，小心最后一下。";
            case ENGAGED -> hit.close() ? "那只" + target + "贴得真近，留两步给我转身呀！"
                : "我打到那只" + target + "了，走位的时候留个心眼。";
            case CHANGED_ATTACK -> switch (hit.mode()) {
                case "MAGIC" -> "我改拿法术招呼" + target + "了，你留意脚下。";
                case "RANGED" -> "换远程也够得到" + target + "，先留点距离。";
                case "MELEE" -> "现在能近身打到" + target + "了，小心和它迎面撞上。";
                default -> null;
            };
        };
        if (text == null) return null;
        recentlySpoken.remove(key);
        recentlySpoken.put(key, now);
        if (recentlySpoken.size() > 32) recentlySpoken.pollFirstEntry();
        spokenEncounter = encounter;
        spokenTarget = target;
        spokenMode = hit.mode();
        next = now + GAP;
        return text;
    }

    private static boolean low(double fraction, double threshold) {
        return fraction > 0 && fraction <= threshold;
    }

    private static String targetName(String type) {
        return switch (type) {
            case "minecraft:zombie" -> "僵尸";
            case "minecraft:husk" -> "尸壳";
            case "minecraft:drowned" -> "溺尸";
            case "minecraft:skeleton" -> "骷髅";
            case "minecraft:stray" -> "流浪者";
            case "minecraft:bogged" -> "沼骸";
            case "minecraft:wither_skeleton" -> "凋灵骷髅";
            case "minecraft:spider", "minecraft:cave_spider" -> "蜘蛛";
            case "minecraft:creeper" -> "苦力怕";
            case "minecraft:witch" -> "女巫";
            case "minecraft:pillager" -> "掠夺者";
            case "minecraft:vindicator" -> "卫道士";
            case "minecraft:evoker" -> "唤魔者";
            case "minecraft:slime" -> "史莱姆";
            case "minecraft:blaze" -> "烈焰人";
            case "minecraft:enderman" -> "末影人";
            case "minecraft:warden" -> "监守者";
            case "minecraft:ravager" -> "劫掠兽";
            case "minecraft:guardian", "minecraft:elder_guardian" -> "守卫者";
            default -> "怪物";
        };
    }

    static boolean fresh(long created, long now) { return now - created >= 0 && now - created <= MAX_AGE; }
    static boolean lowPriority(String kind) { return kind.equals("ambient") || kind.equals("combat"); }
}
