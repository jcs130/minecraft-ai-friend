import java.nio.file.Files;
import java.nio.file.Path;
import org.objectweb.asm.*;

/** Additive ABI + one save-queue body replacement; no recompile/localization of native classes. */
public final class PointMigrationApiPatch implements Opcodes {
    private static final String SERVICE = "io/vortexcore/rpg/PlayerProfileService";
    private static final String PROFILE = "io/vortexcore/player/UnifiedPlayer";
    private static final String HELPER = "io/vortexcore/rpg/NativeProfileSnapshots";
    private static final String SNAPSHOT = "io/vortexcore/persistence/model/PlayerSnapshot";
    private static final String FUTURE = "Ljava/util/concurrent/CompletableFuture;";

    public static void main(String[] args) throws Exception {
        Path input = Path.of(args[0]), output = Path.of(args[1]);
        if (Files.exists(output)) throw new IllegalArgumentException("fresh_output_required");
        var reader = new ClassReader(Files.readAllBytes(input));
        String owner = reader.getClassName();
        if (!owner.equals(SERVICE) && !owner.equals(PROFILE)) throw new IllegalArgumentException("wrong_class");
        // Passing untouched visitors through preserves their raw method_info bytes and constants.
        var writer = new ClassWriter(reader, 0);
        reader.accept(new ClassVisitor(ASM9, writer) {
            int replaced;
            @Override public MethodVisitor visitMethod(int access, String name, String desc, String signature, String[] exceptions) {
                if (name.equals("qiandengjiSaveMetadata") || name.equals("qiandengjiSavedRevision"))
                    throw new IllegalStateException("already_patched");
                if (owner.equals(SERVICE) && name.equals("queueSave")) {
                    if (!desc.equals("(Ljava/util/UUID;Ljava/lang/String;L" + PROFILE + ";)" + FUTURE))
                        throw new IllegalStateException("queue_shape_mismatch");
                    replaced++;
                    MethodVisitor m = super.visitMethod(access, name, desc, signature, exceptions);
                    m.visitCode();
                    field(m, "scheduler", "Lio/vortexcore/scheduling/FoliaExecutionFacade;");
                    field(m, "repository", "Lio/vortexcore/persistence/PlayerDataRepository;");
                    field(m, "pendingSaves", "Ljava/util/Map;");
                    field(m, "loadingPlayers", "Ljava/util/Set;");
                    field(m, "logger", "Ljava/util/logging/Logger;");
                    m.visitVarInsn(ALOAD, 1); m.visitVarInsn(ALOAD, 3);
                    m.visitMethodInsn(INVOKESTATIC, HELPER, "queue", "(Lio/vortexcore/scheduling/FoliaExecutionFacade;Lio/vortexcore/persistence/PlayerDataRepository;Ljava/util/Map;Ljava/util/Set;Ljava/util/logging/Logger;Ljava/util/UUID;L" + PROFILE + ";)" + FUTURE, false);
                    m.visitInsn(ARETURN); m.visitMaxs(7, 4); m.visitEnd();
                    return null;
                }
                return super.visitMethod(access, name, desc, signature, exceptions);
            }
            private void field(MethodVisitor m, String name, String desc) {
                m.visitVarInsn(ALOAD, 0); m.visitFieldInsn(GETFIELD, owner, name, desc);
            }
            @Override public void visitEnd() {
                if (owner.equals(SERVICE)) {
                    if (replaced != 1) throw new IllegalStateException("missing_queue");
                    String desc = "(Lorg/bukkit/entity/Player;L" + PROFILE + ";Ljava/util/Map;)" + FUTURE;
                    String sig = "(Lorg/bukkit/entity/Player;L" + PROFILE + ";Ljava/util/Map<Ljava/lang/String;Ljava/lang/String;>;)Ljava/util/concurrent/CompletableFuture<L" + SNAPSHOT + ";>;";
                    var m = super.visitMethod(ACC_PUBLIC, "qiandengjiSaveMetadata", desc, sig, null);
                    m.visitCode(); m.visitVarInsn(ALOAD, 0);
                    field(m, "repository", "Lio/vortexcore/persistence/PlayerDataRepository;");
                    m.visitVarInsn(ALOAD, 1); m.visitVarInsn(ALOAD, 2); m.visitVarInsn(ALOAD, 3);
                    m.visitMethodInsn(INVOKESTATIC, HELPER, "batch", "(L" + SERVICE + ";Lio/vortexcore/persistence/PlayerDataRepository;Lorg/bukkit/entity/Player;L" + PROFILE + ";Ljava/util/Map;)" + FUTURE, false);
                    m.visitInsn(ARETURN); m.visitMaxs(5, 4); m.visitEnd();
                } else {
                    var m = super.visitMethod(ACC_PUBLIC, "qiandengjiSavedRevision", "(J)V", null, null);
                    m.visitCode(); field(m, "snapshotRevision", "Ljava/util/concurrent/atomic/AtomicLong;");
                    m.visitVarInsn(LLOAD, 1);
                    m.visitMethodInsn(INVOKESTATIC, HELPER, "acknowledge", "(Ljava/util/concurrent/atomic/AtomicLong;J)V", false);
                    m.visitInsn(RETURN); m.visitMaxs(3, 3); m.visitEnd();
                }
                super.visitEnd();
            }
        }, 0);
        Files.write(output, writer.toByteArray());
    }
}
