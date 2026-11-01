package org.afuhome.appearance;

/** Exact builds whose player/entity/pack API is covered by this adapter. */
final class BedrockBuildPolicy {
    private BedrockBuildPolicy() { }
    static boolean supported(String build,String git) {
        return "1249".equals(build)&&"git-master-f66329d".equals(git)
            || "1280".equals(build)&&"git-master-64bb399".equals(git);
    }
}
