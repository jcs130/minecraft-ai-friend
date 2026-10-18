import java.nio.file.Path;
import java.util.List;
import java.util.Arrays;
import java.util.zip.ZipFile;
import org.objectweb.asm.*;

/** Verify the original installed dependency's actual hook points before building the adapter. */
public final class YsmHudContractCheck {
    record Contract(String owner, String method, String draw, String transform, List<String> yawFields) {}
    static Contract contract(String version) {
        return switch (version) {
            case "2.4.1" -> new Contract("com/elfmcys/yesstevemodel/o0oooO00oO00O0O0OoOOOOoo",
                    "OOo0OOooo00OoO0oooooOOo0",
                    "(Lnet/minecraft/class_898;Lnet/minecraft/class_746;Lnet/minecraft/class_332;)V",
                    "(Lnet/minecraft/class_332;Lnet/minecraft/class_746;FFFFI)V", List.of("field_6283"));
            case "2.6.5" -> new Contract("com/elfmcys/yesstevemodel/Oo0oOOOoOO00ooooOo0OOOOo",
                    "OO0ooo0OooOoO0OoO0ooOO0o",
                    "(Lnet/minecraft/class_898;Lnet/minecraft/class_746;FLnet/minecraft/class_332;)V",
                    "(Lnet/minecraft/class_332;Lnet/minecraft/class_746;FFFFIF)V", List.of("field_6283", "field_6220"));
            default -> throw new IllegalArgumentException("Unverified YSM version: " + version);
        };
    }
    public static void main(String[] args) throws Exception {
        String version = args.length > 1 ? args[1] : "2.4.1";
        var contract = contract(version);
        try (ZipFile jar = new ZipFile(Path.of(args[0]).toFile())) {
            var entry = jar.getEntry(contract.owner + ".class");
            if (entry == null) throw new AssertionError("YSM extra-player renderer missing");
            verify(new ClassReader(jar.getInputStream(entry)), version);
        }
        System.out.println("Installed YSM " + version + " HUD contract: exact draw-subject and transform hooks verified");
    }
    static void verify(ClassReader reader, String version) {
        var contract = contract(version);
        int[] calls = {0}, fields = new int[contract.yawFields.size()];
        if (!reader.getClassName().equals(contract.owner)) throw new AssertionError("Incorrect YSM HUD owner");
        reader.accept(new ClassVisitor(Opcodes.ASM9) {
                @Override public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
                    if (!name.equals(contract.method)) return null;
                    boolean draw = descriptor.equals(contract.draw);
                    boolean transform = descriptor.equals(contract.transform);
                    return new MethodVisitor(Opcodes.ASM9) {
                        @Override public void visitMethodInsn(int opcode, String owner, String name, String descriptor, boolean isInterface) {
                            if (draw && owner.equals("net/minecraft/class_898") && name.equals("method_3954")
                                    && descriptor.equals("(Lnet/minecraft/class_1297;DDDFFLnet/minecraft/class_4587;Lnet/minecraft/class_4597;I)V")) calls[0]++;
                        }
                        @Override public void visitFieldInsn(int opcode, String owner, String name, String descriptor) {
                            if (transform && opcode == Opcodes.GETFIELD && owner.equals("net/minecraft/class_746")
                                    && descriptor.equals("F")) {
                                int index = contract.yawFields.indexOf(name);
                                if (index >= 0) fields[index]++;
                            }
                        }
                    };
                }
            }, ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);
        if (calls[0] != 1 || Arrays.stream(fields).anyMatch(count -> count != 1))
            throw new AssertionError("Installed YSM HUD contract mismatch: draw=" + calls[0] + ", yaw=" + Arrays.toString(fields));
    }
}
