package local.qdj.maids.brain;

import java.util.Set;

/** Empty Java model choices are legitimate for an externally controlled resident, not a missing brain to invent. */
public final class ResidentSettingsBrainTest {
    private static int checks;

    private static void check(String expected, String actual) {
        if (!expected.equals(actual)) throw new AssertionError("expected " + expected + ", got " + actual);
        checks++;
    }

    public static void main(String[] args) {
        check("unmanaged", ResidentSettings.defaultBrain("unmanaged", Set.of()));
        check("unmanaged", ResidentSettings.defaultBrain("", Set.of()));
        check("unmanaged", ResidentSettings.defaultBrain("old-model", Set.of()));
        check("qwen", ResidentSettings.defaultBrain("qwen", Set.of("deepseek", "qwen")));
        check("deepseek", ResidentSettings.defaultBrain("old-model", Set.of("qwen", "deepseek")));
        check("deepseek", ResidentSettings.defaultBrain("", Set.of("qwen", "deepseek")));
        System.out.println("Resident model selection: " + checks + " checks passed without creating a model or changing authority");
    }
}
