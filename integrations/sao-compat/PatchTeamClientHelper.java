import java.nio.file.*;
import org.objectweb.asm.*;
import org.objectweb.asm.tree.*;

/** Pack-added helper is client-only but verifier links LocalPlayer on a server. */
public final class PatchTeamClientHelper {
    public static void main(String[] args) throws Exception {
        ClassNode node=new ClassNode();new ClassReader(Files.readAllBytes(Path.of(args[0]))).accept(node,0);
        if(!node.name.equals("dev/ftb/mods/ftbteams/data/ClientTeamManagerImpl"))throw new IllegalArgumentException("unexpected_class");
        int changed=0;
        for(var m:node.methods)if(m.name.equals("saoConnectedPlayerId")&&m.desc.equals("(Lnet/minecraft/client/Minecraft;)Ljava/util/UUID;")){
            boolean local=false;
            for(var i:m.instructions)if(i instanceof FieldInsnNode f&&f.desc.equals("Lnet/minecraft/client/player/LocalPlayer;"))local=true;
            if(!local)throw new IllegalArgumentException("review_changed_pack_helper");
            m.instructions.clear();m.tryCatchBlocks.clear();m.localVariables=null;
            m.visibleLocalVariableAnnotations=null;m.invisibleLocalVariableAnnotations=null;
            m.instructions.add(new TypeInsnNode(Opcodes.NEW,"java/lang/IllegalStateException"));m.instructions.add(new InsnNode(Opcodes.DUP));
            m.instructions.add(new LdcInsnNode("client-only team UUID helper invoked on dedicated server"));
            m.instructions.add(new MethodInsnNode(Opcodes.INVOKESPECIAL,"java/lang/IllegalStateException","<init>","(Ljava/lang/String;)V",false));
            m.instructions.add(new InsnNode(Opcodes.ATHROW));m.maxLocals=1;m.maxStack=3;changed++;
        }
        if(changed!=1)throw new IllegalArgumentException("pack_helper_count_changed");
        ClassWriter out=new ClassWriter(0);node.accept(out);Files.write(Path.of(args[1]),out.toByteArray());
    }
}
