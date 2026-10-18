import java.nio.file.Path;
import java.util.zip.ZipFile;
import org.objectweb.asm.*;

/** Verify the original installed dependency's actual hook points before building the adapter. */
public final class YsmHudContractCheck {
    public static void main(String[] args) throws Exception {
        int[] calls = {0}, fields = {0};
        try (ZipFile jar = new ZipFile(Path.of(args[0]).toFile())) {
            String owner = "com/elfmcys/yesstevemodel/o0oooO00oO00O0O0OoOOOOoo.class";
            var entry = jar.getEntry(owner);
            if (entry == null) throw new AssertionError("YSM extra-player renderer missing");
            new ClassReader(jar.getInputStream(entry)).accept(new ClassVisitor(Opcodes.ASM9) {
                @Override public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
                    if (!name.equals("OOo0OOooo00OoO0oooooOOo0")) return null;
                    boolean draw = descriptor.equals("(Lnet/minecraft/class_898;Lnet/minecraft/class_746;Lnet/minecraft/class_332;)V");
                    boolean transform = descriptor.equals("(Lnet/minecraft/class_332;Lnet/minecraft/class_746;FFFFI)V");
                    return new MethodVisitor(Opcodes.ASM9) {
                        @Override public void visitMethodInsn(int opcode, String owner, String name, String descriptor, boolean isInterface) {
                            if (draw && owner.equals("net/minecraft/class_898") && name.equals("method_3954")
                                    && descriptor.equals("(Lnet/minecraft/class_1297;DDDFFLnet/minecraft/class_4587;Lnet/minecraft/class_4597;I)V")) calls[0]++;
                        }
                        @Override public void visitFieldInsn(int opcode, String owner, String name, String descriptor) {
                            if (transform && opcode == Opcodes.GETFIELD && owner.equals("net/minecraft/class_746")
                                    && name.equals("field_6283") && descriptor.equals("F")) fields[0]++;
                        }
                    };
                }
            }, ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);
        }
        if (calls[0] != 1 || fields[0] != 1)
            throw new AssertionError("Installed YSM HUD contract mismatch: draw=" + calls[0] + ", yaw=" + fields[0]);
        System.out.println("Installed YSM HUD contract: exact draw-subject and transform hooks verified");
    }
}
