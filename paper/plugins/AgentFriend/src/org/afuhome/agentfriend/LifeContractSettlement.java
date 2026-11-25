package org.afuhome.agentfriend;

import java.io.IOException;
import java.util.function.BooleanSupplier;
import org.bukkit.configuration.file.FileConfiguration;

/** Stage reward and completion together; failed writes restore the exact pre-claim image. */
final class LifeContractSettlement {
    private LifeContractSettlement() { }
    @FunctionalInterface interface Commit { void run() throws IOException; }
    static boolean retainedSkill(String skill) { return !skill.equals("angler") && !skill.equals("farmer"); }
    static boolean atomic(FileConfiguration config, BooleanSupplier stage, Commit commit) throws IOException {
        return atomic(config,stage,commit,()->false);
    }
    static boolean atomic(FileConfiguration config, BooleanSupplier stage, Commit commit, BooleanSupplier commitUnknown) throws IOException {
        String before = config.saveToString();
        try {
            if (!stage.getAsBoolean()) { restore(config, before); return false; }
            commit.run(); return true;
        } catch (IOException | RuntimeException failure) {
            if(!commitUnknown.getAsBoolean())
                try { restore(config, before); } catch (RuntimeException rollback) { failure.addSuppressed(rollback); }
            throw failure;
        }
    }
    private static void restore(FileConfiguration config, String before) {
        try { config.loadFromString(before); }
        catch (Exception failure) { throw new IllegalStateException("life_state_rollback_failed", failure); }
    }
}
