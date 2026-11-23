import java.nio.file.Files;
import java.nio.file.Path;
import org.objectweb.asm.AnnotationVisitor;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Label;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;

/** Adapt the pinned upstream handler without copying third-party source. */
public final class PatchStaffClicks implements Opcodes {
    private static final String EVENT = "org/bukkit/event/player/PlayerInteractEvent";
    private static final String RUNTIME = "io/vortexcore/item/CustomItemRuntimeService";
    private static final String ITEM = "io/vortexcore/item/CustomItemDefinition";
    private static final String HANDLER_ANNOTATION = "Lorg/bukkit/event/EventHandler;";

    public static void main(String[] args) throws Exception {
        var original = new ClassReader(Files.readAllBytes(Path.of(args[0])));
        if (!original.getClassName().equals(RUNTIME)) throw new IllegalArgumentException("unexpected class");
        var output = new ClassWriter(original, ClassWriter.COMPUTE_MAXS);
        int[] changed = {0, 0};
        original.accept(new ClassVisitor(ASM9, output) {
            @Override
            public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
                var method = super.visitMethod(access, name, descriptor, signature, exceptions);
                if (!name.equals("onInteract") || !descriptor.equals("(L" + EVENT + ";)V")) return method;
                return new MethodVisitor(ASM9, method) {
                    @Override
                    public AnnotationVisitor visitAnnotation(String descriptor, boolean visible) {
                        var annotation = super.visitAnnotation(descriptor, visible);
                        if (!descriptor.equals(HANDLER_ANNOTATION)) return annotation;
                        return new AnnotationVisitor(ASM9, annotation) {
                            @Override
                            public void visit(String key, Object value) {
                                if (key.equals("ignoreCancelled") && Boolean.TRUE.equals(value)) {
                                    changed[0]++;
                                    super.visit(key, false);
                                } else {
                                    super.visit(key, value);
                                }
                            }
                        };
                    }

                    @Override
                    public void visitVarInsn(int opcode, int var) {
                        super.visitVarInsn(opcode, var);
                        if (opcode != ASTORE || var != 4) return;
                        changed[1]++;
                        var accepted = new Label();
                        super.visitVarInsn(ALOAD, 1);
                        super.visitVarInsn(ALOAD, 4);
                        super.visitMethodInsn(INVOKESTATIC, "io/vortexcore/item/StaffAirInput", "accepted",
                                "(L" + EVENT + ";L" + ITEM + ";)Z", false);
                        super.visitJumpInsn(IFNE, accepted);
                        super.visitInsn(RETURN);
                        super.visitLabel(accepted);
                        super.visitFrame(F_NEW, 5, new Object[] { RUNTIME, EVENT, "org/bukkit/entity/Player",
                                "org/bukkit/inventory/ItemStack", ITEM }, 0, new Object[0]);
                    }
                };
            }
        }, ClassReader.EXPAND_FRAMES);
        if (changed[0] != 1 || changed[1] != 1) throw new IllegalStateException("handler shape changed");
        Files.write(Path.of(args[1]), output.toByteArray());
    }
}
