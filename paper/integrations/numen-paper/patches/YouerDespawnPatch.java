import java.nio.file.*;
import org.objectweb.asm.*;
import org.objectweb.asm.tree.*;
import org.objectweb.asm.tree.analysis.*;

/** The pinned Youer PlayerList.remove returns void; Paper returns Component. */
public final class YouerDespawnPatch {
    public static void main(String[] args) throws Exception {
        ClassNode type = new ClassNode();
        new ClassReader(Files.readAllBytes(Path.of(args[0]))).accept(type, 0);
        if (!type.name.equals("com/dwinovo/numen/api/entity/CompanionFactory")) throw new IllegalStateException("Wrong class");
        int changes = 0;
        for (MethodNode method : type.methods) {
            if (!method.name.equals("despawn") || !method.desc.equals("(Lnet/minecraft/server/MinecraftServer;Lcom/dwinovo/numen/api/entity/NumenPlayer;)V")) continue;
            for (AbstractInsnNode instruction : method.instructions.toArray()) {
                if (!(instruction instanceof MethodInsnNode call)
                    || call.getOpcode() != Opcodes.INVOKEVIRTUAL
                    || !call.owner.equals("net/minecraft/server/players/PlayerList")
                    || !call.name.equals("remove")
                    || !call.desc.equals("(Lnet/minecraft/server/level/ServerPlayer;)Lnet/kyori/adventure/text/Component;")) continue;
                AbstractInsnNode discard = call.getNext();
                if (discard == null || discard.getOpcode() != Opcodes.POP) throw new IllegalStateException("Changed return-value use");
                call.desc = "(Lnet/minecraft/server/level/ServerPlayer;)V";
                method.instructions.set(discard, new InsnNode(Opcodes.NOP));
                changes++;
            }
            new Analyzer<>(new BasicVerifier()).analyze(type.name, method);
        }
        if (changes != 1) throw new IllegalStateException("Expected one exact call, found " + changes);
        ClassWriter output = new ClassWriter(0);
        type.accept(output);
        Files.write(Path.of(args[1]), output.toByteArray(), StandardOpenOption.CREATE_NEW);
        System.out.println("Verified one Youer despawn call and its JVM operand stack");
    }
}
