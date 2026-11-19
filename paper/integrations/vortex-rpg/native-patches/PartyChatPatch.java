import java.nio.file.Files;
import java.nio.file.Path;
import org.objectweb.asm.*;
import org.objectweb.asm.tree.*;

/** Change only the final delivery of successful party chat. Invitations and other broadcasts are untouched. */
public final class PartyChatPatch implements Opcodes {
    public static void main(String[] args) throws Exception {
        Path path = Path.of(args[0]);
        var type = new ClassNode();
        new ClassReader(Files.readAllBytes(path)).accept(type, 0);
        String player = "Lorg/bukkit/entity/Player;", string = "Ljava/lang/String;";
        String party = "Lio/vortexcore/world/ExpeditionPartyManager$PartySnapshot;";
        String service = "Lio/vortexcore/ui/MessageService;";
        int matches = 0;
        for (var method : type.methods) {
            if (!method.name.equals("sendPartyMessage") || !method.desc.equals("(" + player + string + ")V")) continue;
            for (var node : method.instructions.toArray()) {
                if (!(node instanceof MethodInsnNode call) || !call.owner.equals(type.name)
                        || !call.name.equals("broadcastToParty") || !call.desc.equals("(" + party + string + ")V")) continue;
                // Original stack contains this, snapshot, formatted. Preserve the native formatting instruction.
                int formatted = method.maxLocals++, snapshot = method.maxLocals++;
                var delivery = new InsnList();
                delivery.add(new VarInsnNode(ASTORE, formatted));
                delivery.add(new VarInsnNode(ASTORE, snapshot));
                delivery.add(new FieldInsnNode(GETFIELD, type.name, "messageService", service));
                delivery.add(new VarInsnNode(ALOAD, snapshot));
                delivery.add(new VarInsnNode(ALOAD, formatted));
                delivery.add(new VarInsnNode(ALOAD, 1));
                delivery.add(new VarInsnNode(ALOAD, 2));
                delivery.add(new MethodInsnNode(INVOKESTATIC, "io/vortexcore/party/PartyChatDelivery", "send",
                        "(" + service + party + string + player + string + ")V", false));
                method.instructions.insertBefore(call, delivery);
                method.instructions.remove(call);
                matches++;
            }
        }
        if (matches != 1) throw new IllegalStateException("Native chat delivery point changed: " + matches);
        var writer = new ClassWriter(ClassWriter.COMPUTE_MAXS);
        type.accept(writer);
        Files.write(path, writer.toByteArray());
    }
}
