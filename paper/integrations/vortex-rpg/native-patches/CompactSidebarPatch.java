import java.nio.file.Files;
import java.nio.file.Path;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.*;

/** A presentation-only addition to the pinned native RPG board constructor. */
public final class CompactSidebarPatch implements Opcodes {
    public static void main(String[] args) throws Exception {
        ClassNode type = new ClassNode();
        new ClassReader(Files.readAllBytes(Path.of(args[0]))).accept(type, 0);
        int changes = 0;
        for (MethodNode method : type.methods) {
            if (!method.name.equals("createBoard")
                    || !method.desc.equals("(Lorg/bukkit/entity/Player;)V")) continue;
            for (AbstractInsnNode node : method.instructions.toArray()) {
                if (!(node instanceof MethodInsnNode call)
                        || !call.owner.equals("org/bukkit/scoreboard/Objective")
                        || !call.name.equals("setDisplaySlot")) continue;
                if (!(node.getPrevious() instanceof FieldInsnNode slot)
                        || !slot.name.equals("SIDEBAR")
                        || !(slot.getPrevious() instanceof VarInsnNode receiver)
                        || receiver.getOpcode() != ALOAD) {
                    throw new IllegalStateException("Unreviewed objective receiver");
                }
                InsnList blank = new InsnList();
                blank.add(new VarInsnNode(ALOAD, receiver.var));
                blank.add(new MethodInsnNode(INVOKESTATIC,
                        "io/papermc/paper/scoreboard/numbers/NumberFormat", "blank",
                        "()Lio/papermc/paper/scoreboard/numbers/NumberFormat;", true));
                blank.add(new MethodInsnNode(INVOKEINTERFACE,
                        "org/bukkit/scoreboard/Objective", "numberFormat",
                        "(Lio/papermc/paper/scoreboard/numbers/NumberFormat;)V", true));
                method.instructions.insert(node, blank);
                changes++;
            }
        }
        if (changes != 1) throw new IllegalStateException("Expected one native sidebar objective");
        ClassWriter output = new ClassWriter(ClassWriter.COMPUTE_MAXS);
        type.accept(output);
        Files.write(Path.of(args[1]), output.toByteArray());
        System.out.println("createBoardNumberFormatChanges=1");
    }
}
