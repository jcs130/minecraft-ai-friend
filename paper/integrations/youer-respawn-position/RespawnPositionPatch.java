import java.nio.file.Files;
import java.nio.file.Path;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.*;

public final class RespawnPositionPatch implements Opcodes {
    private static final String PLAYER = "net/minecraft/server/level/ServerPlayer";
    private static final String LISTENER = "net/minecraft/server/network/ServerGamePacketListenerImpl";
    private static final String PLAYER_DESC = "L" + PLAYER + ";";
    private static final String LISTENER_DESC = "L" + LISTENER + ";";
    private static final String RESPAWN_DESC = "(" + PLAYER_DESC
        + "ZLnet/minecraft/world/entity/Entity$RemovalReason;)" + PLAYER_DESC;

    public static void main(String[] args) throws Exception {
        var owner = new ClassNode();
        new ClassReader(Files.readAllBytes(Path.of(args[0]))).accept(owner, 0);
        if (!owner.name.equals("net/minecraft/server/players/PlayerList")) {
            throw new IllegalArgumentException("Wrong target class");
        }
        var method = owner.methods.stream()
            .filter(m -> m.name.equals("respawn") && m.desc.equals(RESPAWN_DESC))
            .findFirst().orElseThrow();
        MethodInsnNode teleport = null;
        boolean sentRespawn = false;
        for (AbstractInsnNode instruction : method.instructions) {
            if (instruction instanceof TypeInsnNode type && type.getOpcode() == NEW
                    && type.desc.equals("net/minecraft/network/protocol/game/ClientboundRespawnPacket")) {
                sentRespawn = true;
            }
            if (instruction instanceof MethodInsnNode call && call.owner.equals(LISTENER)
                    && call.name.equals("teleport") && call.desc.equals("(Lorg/bukkit/Location;)V")) {
                if (teleport != null || !sentRespawn) throw new IllegalStateException("Ambiguous respawn teleport");
                teleport = call;
            }
        }
        if (teleport == null) throw new IllegalStateException("Respawn teleport not found");
        AbstractInsnNode connection = teleport.getPrevious();
        while (connection != null && !(connection instanceof FieldInsnNode)) connection = connection.getPrevious();
        if (!(connection instanceof FieldInsnNode field) || field.getOpcode() != GETFIELD
                || !field.owner.equals(PLAYER) || !field.name.equals("connection") || !field.desc.equals(LISTENER_DESC)
                || !(field.getPrevious() instanceof VarInsnNode load) || load.getOpcode() != ALOAD || load.var != 7) {
            throw new IllegalStateException("Unexpected replacement player/connection shape");
        }
        // Keep the original teleport and its operands. Rebind the connection immediately
        // before it checks isRemoved(), once the replacement already has its spawn location.
        var rebind = new InsnList();
        rebind.add(new VarInsnNode(ALOAD, load.var));
        rebind.add(new FieldInsnNode(GETFIELD, PLAYER, "connection", LISTENER_DESC));
        rebind.add(new VarInsnNode(ALOAD, load.var));
        rebind.add(new FieldInsnNode(PUTFIELD, LISTENER, "player", PLAYER_DESC));
        method.instructions.insertBefore(teleport, rebind);
        var writer = new ClassWriter(ClassWriter.COMPUTE_MAXS);
        owner.accept(writer);
        Files.write(Path.of(args[1]), writer.toByteArray());
    }
}
