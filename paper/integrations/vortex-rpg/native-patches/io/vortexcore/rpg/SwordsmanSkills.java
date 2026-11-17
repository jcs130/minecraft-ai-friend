package io.vortexcore.rpg;

import io.vortexcore.player.UnifiedPlayer;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import org.bukkit.Material;

public final class SwordsmanSkills {
    public static final String CLASS_ID = "swordsman";
    public static final String SWORD_STEP = "sword_step";
    public static final String HORIZONTAL = "horizontal_square";
    public static final String DUAL_BLADES = "dual_blades";
    public static final String STARBURST = "starburst_stream";

    private SwordsmanSkills() {}

    public static VortexSkillDefinition horizontal() {
        return new VortexSkillDefinition(HORIZONTAL, VortexClass.SWORDSMAN, "水平方阵斩",
                "近身连续剑斩，需要主手剑。", Material.IRON_SWORD, 3, 1, Map.of(), HORIZONTAL);
    }

    public static VortexSkillDefinition dualBlades() {
        return new VortexSkillDefinition(DUAL_BLADES, VortexClass.SWORDSMAN, "二刀流",
                "专精。双手各持一把剑时可使用双剑奥义。", Material.DIAMOND_SWORD, 5, 2, Map.of(), null);
    }

    public static VortexSkillDefinition starburst() {
        return new VortexSkillDefinition(STARBURST, VortexClass.SWORDSMAN, "星爆气流斩",
                "需要先掌握水平方阵斩和二刀流。", Material.NETHERITE_SWORD, 8, 2, Map.of(), STARBURST);
    }

    public static boolean prerequisites(ClassSkillService service, UnifiedPlayer profile) {
        var learned = service.unlockedSkillIds(profile);
        return learned.contains(HORIZONTAL) && learned.contains(DUAL_BLADES);
    }

    public static boolean refuseLearning(ClassSkillService service, UnifiedPlayer profile, String id,
                                          CompletableFuture<ClassSkillService.SkillUnlockResult> result) {
        if (!STARBURST.equalsIgnoreCase(id) || prerequisites(service, profile)) return false;
        result.complete(new ClassSkillService.SkillUnlockResult(false, "先学习水平方阵斩和二刀流。"));
        return true;
    }

    public static boolean isArt(String id) {
        return SWORD_STEP.equalsIgnoreCase(id) || HORIZONTAL.equalsIgnoreCase(id) || STARBURST.equalsIgnoreCase(id);
    }

    public static CompletableFuture<Void> castRefusal(SpellbookService book, UnifiedPlayer profile, String requested) {
        String id = requested == null || requested.isBlank() ? book.activeSpellId(profile).orElse("") : requested.strip();
        if (!isArt(id)) return null;
        return CompletableFuture.failedFuture(new IllegalArgumentException("居民剑技请通过已授权的居民 cast 入口执行。"));
    }

    public static void setDeadline(Map<java.util.UUID, Map<String, Long>> cooldowns, java.util.UUID actor, String id, long until) {
        if (!isArt(id)) throw new IllegalArgumentException("unknown_sword_art");
        cooldowns.computeIfAbsent(actor, ignored -> new java.util.concurrent.ConcurrentHashMap<>()).put(id, until);
    }

    public static CompletableFuture<Void> classRefusal(ClassSkillService service, org.bukkit.entity.Player player, String id) {
        if (service.classProfile(id).map(ClassProfileDefinition::archetype).orElse(null) != VortexClass.SWORDSMAN) return null;
        var idOfActor = player.getUniqueId();
        var entity = org.bukkit.Bukkit.getEntity(idOfActor);
        if (org.bukkit.Bukkit.getPlayer(idOfActor) != null || !(entity instanceof org.bukkit.entity.LivingEntity)
                || entity instanceof org.bukkit.entity.Player) {
            return CompletableFuture.failedFuture(new IllegalArgumentException("剑士候选目前仅供原生居民使用。"));
        }
        return null;
    }
}
