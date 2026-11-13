import java.nio.file.Files;
import java.nio.file.Path;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;

/** Replaces only the native nearby-player targeter's acquisition method. */
public final class PatchPartySpellTargets implements Opcodes {
    public static void main(String[] args) throws Exception {
        var reader = new ClassReader(Files.readAllBytes(Path.of(args[0])));
        var writer = new ClassWriter(reader, 0);
        String descriptor = "(Lio/vortexcore/magic/SpellContext;)Ljava/util/Collection;";
        int[] changed = {0};
        reader.accept(new ClassVisitor(ASM9, writer) {
            @Override public MethodVisitor visitMethod(int access, String name, String desc, String signature, String[] exceptions) {
                MethodVisitor out = super.visitMethod(access, name, desc, signature, exceptions);
                if (!name.equals("acquireTargets") || !desc.equals(descriptor)) return out;
                changed[0]++;
                out.visitCode();
                out.visitVarInsn(ALOAD, 1);
                out.visitVarInsn(ALOAD, 0);
                out.visitFieldInsn(GETFIELD, reader.getClassName(), "range", "D");
                out.visitMethodInsn(INVOKESTATIC, "io/vortexcore/combat/PartySpellTargets", "acquire",
                        "(Lio/vortexcore/magic/SpellContext;D)Ljava/util/Collection;", false);
                out.visitInsn(ARETURN);
                out.visitMaxs(3, 2);
                out.visitEnd();
                return null;
            }
        }, 0);
        if (changed[0] != 1) throw new IllegalStateException("Expected one reviewed nearby-player targeter");
        Files.write(Path.of(args[1]), writer.toByteArray());
    }
}
