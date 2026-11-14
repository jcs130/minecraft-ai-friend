import java.nio.file.Files;
import java.nio.file.Path;
import org.objectweb.asm.*;
import org.objectweb.asm.tree.*;

/** Pinned build-time overlay, not a runtime transformer. */
public final class HybridItemPatch implements Opcodes {
    public static void main(String[] args) throws Exception {
        var node = new ClassNode();
        new ClassReader(Files.readAllBytes(Path.of(args[0]))).accept(node, 0);
        if (!node.name.equals("com/fastasyncworldedit/bukkit/adapter/CachedBukkitAdapter")) throw new IllegalArgumentException("wrong class");
        var method = node.methods.stream().filter(m -> m.name.equals("asItemType")
                && m.desc.equals("(Lorg/bukkit/Material;)Lcom/sk89q/worldedit/world/item/ItemType;")).findFirst().orElseThrow();
        for (var instruction : method.instructions) if (instruction instanceof MethodInsnNode call
                && call.owner.equals("org/afuhome/compat/HybridItemTypes")) throw new IllegalStateException("already patched");
        var old = new LabelNode();
        var prefix = new InsnList();
        prefix.add(new VarInsnNode(ALOAD, 1));
        prefix.add(new MethodInsnNode(INVOKESTATIC, "org/afuhome/compat/HybridItemTypes", "resolve", method.desc, false));
        prefix.add(new InsnNode(DUP));
        prefix.add(new JumpInsnNode(IFNULL, old));
        prefix.add(new InsnNode(ARETURN));
        prefix.add(old);
        prefix.add(new FrameNode(F_SAME1, 0, null, 1, new Object[]{"com/sk89q/worldedit/world/item/ItemType"}));
        prefix.add(new InsnNode(POP));
        method.instructions.insert(prefix);
        var writer = new ClassWriter(ClassWriter.COMPUTE_MAXS);
        node.accept(writer);
        Files.write(Path.of(args[1]), writer.toByteArray());
    }
}
