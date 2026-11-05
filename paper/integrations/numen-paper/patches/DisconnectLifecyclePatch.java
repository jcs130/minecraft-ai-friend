import java.nio.file.*;
import org.objectweb.asm.*;
import org.objectweb.asm.tree.*;
import org.objectweb.asm.tree.analysis.*;

/** Backport the normal disconnect callback without replacing the installed compatibility classes. */
public final class DisconnectLifecyclePatch implements Opcodes {
    public static void main(String[] args) throws Exception {
        ClassNode type = new ClassNode();
        new ClassReader(Files.readAllBytes(Path.of(args[0]))).accept(type, 0);
        if (!type.name.equals("com/dwinovo/numen/api/entity/CompanionFactory")) throw new IllegalStateException("Wrong class");
        int changes = 0;
        for (MethodNode method : type.methods) {
            if (!method.name.equals("despawn") || !method.desc.equals("(Lnet/minecraft/server/MinecraftServer;Lcom/dwinovo/numen/api/entity/NumenPlayer;)V")) continue;
            for (AbstractInsnNode instruction : method.instructions.toArray()) {
                if (!(instruction instanceof MethodInsnNode call) || call.getOpcode() != INVOKEVIRTUAL
                        || !call.owner.equals("net/minecraft/server/players/PlayerList") || !call.name.equals("remove")
                        || !call.desc.equals("(Lnet/minecraft/server/level/ServerPlayer;)V")) continue;
                // Keep the surrounding live-identity guard, REMOVE event and LEAVING try/finally.
                // Replace only the direct runtime-specific PlayerList call with its stable quit path.
                InsnList replacement = new InsnList();
                replacement.add(new InsnNode(POP2));
                replacement.add(new VarInsnNode(ALOAD, 1));
                replacement.add(new FieldInsnNode(GETFIELD, "net/minecraft/server/level/ServerPlayer", "connection", "Lnet/minecraft/server/network/ServerGamePacketListenerImpl;"));
                replacement.add(new TypeInsnNode(NEW, "net/minecraft/network/DisconnectionDetails"));
                replacement.add(new InsnNode(DUP));
                replacement.add(new LdcInsnNode("multiplayer.disconnect.quitting"));
                replacement.add(new MethodInsnNode(INVOKESTATIC, "net/minecraft/network/chat/Component", "translatable", "(Ljava/lang/String;)Lnet/minecraft/network/chat/MutableComponent;", true));
                replacement.add(new MethodInsnNode(INVOKESPECIAL, "net/minecraft/network/DisconnectionDetails", "<init>", "(Lnet/minecraft/network/chat/Component;)V", false));
                replacement.add(new MethodInsnNode(INVOKEVIRTUAL, "net/minecraft/server/network/ServerGamePacketListenerImpl", "onDisconnect", "(Lnet/minecraft/network/DisconnectionDetails;)V", false));
                method.instructions.insertBefore(call, replacement);
                method.instructions.remove(call);
                changes++;
            }
            method.maxStack = Math.max(method.maxStack, 5);
            new Analyzer<>(new BasicVerifier()).analyze(type.name, method);
        }
        if (changes != 1) throw new IllegalStateException("Expected one reviewed removal call, found " + changes);
        ClassWriter writer = new ClassWriter(ClassWriter.COMPUTE_MAXS);
        type.accept(writer);
        Files.write(Path.of(args[1]), writer.toByteArray(), StandardOpenOption.CREATE_NEW);
        System.out.println("Verified one disconnect callback; installed lifecycle guards preserved");
    }
}
