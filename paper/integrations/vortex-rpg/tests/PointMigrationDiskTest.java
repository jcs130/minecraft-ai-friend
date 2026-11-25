package org.qiandengji.vortex;

import io.vortexcore.math.ExperienceCurve;
import io.vortexcore.persistence.PlayerDataRepository;
import io.vortexcore.persistence.model.PlayerSnapshot;
import io.vortexcore.player.UnifiedPlayer;
import io.vortexcore.rpg.*;
import io.vortexcore.scheduling.FoliaExecutionFacade;
import java.lang.reflect.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.logging.Logger;
import org.bukkit.*;
import org.bukkit.entity.Player;

/** Additional real native repository/file/cold-load test, with no repository doubles. */
public final class PointMigrationDiskTest {
    static int checks;
    static void check(boolean value, String name) { if (!value) throw new AssertionError(name); checks++; }
    static Object empty(Class<?> type) {
        if (!type.isPrimitive()) return null;
        if (type == boolean.class) return false;
        if (type == double.class) return 0d;
        if (type == long.class) return 0L;
        return 0;
    }
    @SuppressWarnings("unchecked") static <T> T proxy(Class<T> type, InvocationHandler handler) {
        return (T) Proxy.newProxyInstance(PointMigrationDiskTest.class.getClassLoader(), new Class<?>[]{type}, handler);
    }
    @SuppressWarnings("unchecked") static void cache(PlayerProfileService service, UUID actor, UnifiedPlayer profile) throws Exception {
        var f = PlayerProfileService.class.getDeclaredField("profiles"); f.setAccessible(true);
        ((Map<UUID, UnifiedPlayer>) f.get(service)).put(actor, profile);
    }
    public static void main(String[] args) throws Exception {
        Path directory = Path.of(args[0]); if (Files.exists(directory)) throw new IllegalArgumentException("fresh_synthetic_directory_required");
        Logger log = Logger.getLogger("synthetic-native-disk"); Thread main = Thread.currentThread();
        Server server = proxy(Server.class, (p, m, a) -> switch (m.getName()) {
            case "isPrimaryThread" -> Thread.currentThread() == main;
            case "getLogger" -> log;
            case "getName", "getVersion", "getBukkitVersion" -> "synthetic-disk-test";
            default -> empty(m.getReturnType());
        });
        var serverField = Bukkit.class.getDeclaredField("server"); serverField.setAccessible(true); serverField.set(null, server);
        var scheduler = proxy(FoliaExecutionFacade.class, (p, m, a) -> {
            if (m.getName().equals("runEntity")) { ((Runnable) a[a.length - 1]).run(); return true; }
            if (m.getName().equals("runGlobal")) { ((Runnable) a[1]).run(); return null; }
            return empty(m.getReturnType());
        });
        UUID actor = UUID.randomUUID();
        Player player = proxy(Player.class, (p, m, a) -> switch (m.getName()) {
            case "getUniqueId" -> actor;
            case "getName" -> "synthetic-disk-actor";
            case "isOnline", "isValid" -> true;
            default -> empty(m.getReturnType());
        });
        var skills = new ClassSkillService(null, scheduler, null, null, null, 100);
        var curve = ExperienceCurve.cubic(100, 2);
        var source = new LegacyPointMigration.Source(actor, 14, 3, "b".repeat(64), LegacyPointMigration.transferId(actor, "b".repeat(64)));
        PlayerSnapshot persisted;
        try (var repository = new PlayerDataRepository(log, directory, Duration.ofMinutes(1))) {
            var profiles = new PlayerProfileService(null, log, scheduler, repository, skills, null, null, null, curve);
            var state = new UnifiedPlayer(actor, "synthetic-disk-actor");
            state.putMetadata("rpg.class", "knight"); state.putMetadata("rpg.skill_points", "5");
            state.putMetadata("unrelated_history", "keep"); cache(profiles, actor, state);
            var result = new NativeLegacyPoints().migrate(player, source, profiles, skills).join();
            check(result.get("confirmed").getAsBoolean(), "real repository future confirms actual atomic write");
            String file = Files.readString(directory.resolve(actor + ".json"));
            check(file.contains(LegacyPointMigration.RECEIPT_FIELD) && file.contains("rpg.skill_points"), "native JSON includes receipt and credit together");
            check(state.metadata().get("rpg.skill_points").equals("16"), "actual 1:1 credited native points");
            state.putMetadata("rpg.skill_points", "12"); state.grantExperience(10000, curve);
            int level = state.level(); long xp = state.experience();
            profiles.qiandengjiSave(player).join();
            check(state.level() == level && state.experience() == xp && state.metadata().get("rpg.skill_points").equals("12"), "actual save ack preserves later spend/XP");
            persisted = repository.loadPlayer(actor).join();
            check(source.receipt().equals(persisted.metadata().get(LegacyPointMigration.RECEIPT_FIELD)), "learning/spend retains durable migration receipt");
        }
        // A fresh real repository and UnifiedPlayer: no in-memory flight or cache can infer success.
        try (var repository = new PlayerDataRepository(log, directory, Duration.ofMinutes(1))) {
            var loaded = repository.loadPlayer(actor).join();
            check(loaded != null && loaded.metadata().equals(persisted.metadata()), "real cold file load has exact metadata");
            var state = new UnifiedPlayer(actor, "synthetic-disk-actor"); state.applySnapshot(loaded);
            var profiles = new PlayerProfileService(null, log, scheduler, repository, skills, null, null, null, curve);
            cache(profiles, actor, state);
            var reconciled = new NativeLegacyPoints().migrate(player, source, profiles, skills).join();
            check(reconciled.get("confirmed").getAsBoolean() && skills.unspentSkillPoints(state) == 12, "cold receipt reconciliation no second grant, balance NOT original credited total");
            check(state.level() == loaded.level() && state.experience() == loaded.experience(), "cold reconcile preserves XP/level");
            check(state.metadata().get("unrelated_history").equals("keep"), "cold reconcile preserves unrelated history");
        }
        System.out.println("PointMigrationDiskTest: " + checks + " passed; realRepository=true; realAtomicFileAndColdLoad=true; productionChanged=false");
    }
}
