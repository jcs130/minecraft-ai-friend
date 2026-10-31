import java.nio.file.*;
import org.objectweb.asm.*;
import org.objectweb.asm.tree.*;

/** Add one read-only party supplement to the deployed observation without importing other candidates. */
public final class PartyObservationPatch {
    public static void main(String[] args)throws Exception {
        ClassNode before=new ClassNode();new ClassReader(Files.readAllBytes(Path.of(args[0]))).accept(before,0);
        if(args.length==3&&args[2].equals("roster-label")) {
            if(!before.name.equals("org/afuhome/agentfriend/AgentFriendPlugin"))throw new IllegalStateException("Expected deployed roster owner");
            int labels=0;
            for(MethodNode method:before.methods)if(method.name.equals("locate"))for(AbstractInsnNode insn:method.instructions.toArray()) {
                if(insn instanceof LdcInsnNode literal&&"在线队友：".equals(literal.cst)){
                    literal.cst="在线伙伴（这份名单不等于已组队；真实队伍查 /mycli guild party status）：";labels++;
                }
                if(insn instanceof InvokeDynamicInsnNode concat)for(int i=0;i<concat.bsmArgs.length;i++)
                    if(concat.bsmArgs[i] instanceof String recipe&&recipe.contains("在线队友：")){
                        concat.bsmArgs[i]=recipe.replace("在线队友：","在线伙伴（这份名单不等于已组队；真实队伍查 /mycli guild party status）：");labels++;
                    }
            }
            if(labels!=1)throw new IllegalStateException("Expected one deployed online roster label");
            ClassWriter writer=new ClassWriter(0);before.accept(writer);Files.write(Path.of(args[1]),writer.toByteArray());
            System.out.println("{\"relabelledLists\":1,\"otherInstructionsPreserved\":true}");return;
        }
        int changed=0;
        for(MethodNode method:before.methods)if(method.name.equals("player")&&method.desc.equals("(Lcom/google/gson/JsonObject;Lcom/google/gson/JsonObject;Lorg/afuhome/agentfriend/GoddessObservation$Scan;)V")) {
            for(AbstractInsnNode instruction:method.instructions.toArray())if(instruction.getOpcode()==Opcodes.RETURN) {
                var add=new InsnList();add.add(new VarInsnNode(Opcodes.ALOAD,0));
                add.add(new FieldInsnNode(Opcodes.GETFIELD,before.name,"plugin","Lorg/afuhome/agentfriend/AgentFriendPlugin;"));
                add.add(new VarInsnNode(Opcodes.ALOAD,1));add.add(new VarInsnNode(Opcodes.ALOAD,2));
                add.add(new MethodInsnNode(Opcodes.INVOKESTATIC,"org/afuhome/agentfriend/PartyObservation","add",
                    "(Lorg/afuhome/agentfriend/AgentFriendPlugin;Lcom/google/gson/JsonObject;Lcom/google/gson/JsonObject;)V",false));
                method.instructions.insertBefore(instruction,add);method.maxStack=Math.max(method.maxStack,3);changed++;
            }
        }
        if(changed!=1)throw new IllegalStateException("Expected one deployed player-observation return");
        ClassWriter writer=new ClassWriter(0);before.accept(writer);Files.write(Path.of(args[1]),writer.toByteArray());
        System.out.println("{\"supplementedReturns\":1,\"existingInstructionsPreserved\":true}");
    }
}
