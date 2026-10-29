import java.nio.file.Files;
import java.nio.file.Path;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.InsnNode;
import org.objectweb.asm.tree.MethodInsnNode;

/** Preserve the common animation interface; remove only its server-dead init. */
public final class PatchSidedInit {
    public static void main(String[] args) throws Exception {
        ClassNode node = new ClassNode();
        new ClassReader(Files.readAllBytes(Path.of(args[0]))).accept(node, 0);
        if (!node.name.equals("vzling/lib/mixin/PlayerMixin")) throw new IllegalArgumentException("unexpected_class");
        int changed = 0;
        for (var method : node.methods) {
            if (!method.name.equals("init") || !method.desc.equals("(Lorg/spongepowered/asm/mixin/injection/callback/CallbackInfo;)V")) continue;
            boolean clientRegistry = false, sidedGuard = false;
            for (var instruction : method.instructions) if (instruction instanceof MethodInsnNode call) {
                if (call.owner.equals("vzling/lib/client/registry/PlayerAnimationRegistry") && call.name.equals("getIds")) clientRegistry = true;
                if (call.owner.equals("net/minecraft/world/level/Level") && call.name.equals("m_5776_")) sidedGuard = true;
            }
            if (!clientRegistry || !sidedGuard) throw new IllegalArgumentException("review_changed_animation_initializer");
            // The original body only initializes render animations when
            // Level.isClientSide() is true. A dedicated server always skips it,
            // but Mixin resolves its client-only method references beforehand.
            method.instructions.clear();
            method.instructions.add(new InsnNode(Opcodes.RETURN));
            method.tryCatchBlocks.clear();
            method.localVariables = null;
            method.visibleLocalVariableAnnotations = null;
            method.invisibleLocalVariableAnnotations = null;
            method.maxStack = 0;
            method.maxLocals = 2;
            changed++;
        }
        if (changed != 1) throw new IllegalArgumentException("initializer_count_changed");
        ClassWriter writer = new ClassWriter(0);
        node.accept(writer);
        Files.write(Path.of(args[1]), writer.toByteArray());
    }
}
