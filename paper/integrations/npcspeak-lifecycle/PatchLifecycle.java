import java.nio.file.*;
import org.objectweb.asm.*;
import org.objectweb.asm.tree.*;

/** Build-time only, exact class/method gates; no online transformation. */
public class PatchLifecycle implements Opcodes {
    public static void main(String[] args)throws Exception{
        ClassNode c=new ClassNode();new ClassReader(Files.readAllBytes(Path.of(args[0]))).accept(c,0);
        int changed=0;
        if(c.name.equals("net/minecraft/world/entity/Entity")){
            if(c.fields.stream().noneMatch(f->f.name.equals("persist")&&f.desc.equals("Z")))throw new IllegalStateException("Missing Bukkit persist field");
            for(MethodNode m:c.methods){
                if(!(m.name.equals("shouldBeSaved")&&m.desc.equals("()Z"))&&!(m.name.equals("saveAsPassenger")&&m.desc.equals("(Lnet/minecraft/nbt/CompoundTag;)Z")))continue;
                for(AbstractInsnNode n:m.instructions)if(n instanceof FieldInsnNode f&&f.name.equals("persist"))throw new IllegalStateException("Already patched");
                LabelNode proceed=new LabelNode();InsnList head=new InsnList();
                head.add(new VarInsnNode(ALOAD,0));head.add(new FieldInsnNode(GETFIELD,c.name,"persist","Z"));head.add(new JumpInsnNode(IFNE,proceed));head.add(new InsnNode(ICONST_0));head.add(new InsnNode(IRETURN));head.add(proceed);head.add(new FrameNode(F_SAME,0,null,0,null));
                m.instructions.insert(head);changed++;
            }
            if(changed!=2)throw new IllegalStateException("Entity method mismatch");
        }else if(c.name.equals("com/l299l/npcspeak/npc/NpcManager")){
            for(MethodNode m:c.methods)if(m.name.equals("getByEntityUUID")&&m.desc.equals("(Ljava/util/UUID;)Lcom/l299l/npcspeak/npc/NpcData;")){
                m.instructions.clear();m.tryCatchBlocks.clear();if(m.localVariables!=null)m.localVariables.clear();
                m.instructions.add(new VarInsnNode(ALOAD,0));m.instructions.add(new VarInsnNode(ALOAD,1));
                m.instructions.add(new MethodInsnNode(INVOKESTATIC,"com/l299l/npcspeak/npc/BuiltinNpcProvider","lookup","(Lcom/l299l/npcspeak/npc/NpcManager;Ljava/util/UUID;)Lcom/l299l/npcspeak/npc/NpcData;",false));
                m.instructions.add(new InsnNode(ARETURN));changed++;
            }
            if(changed!=1)throw new IllegalStateException("NPC index method mismatch");
        }else throw new IllegalStateException("Unexpected class");
        ClassWriter writer=new ClassWriter(ClassWriter.COMPUTE_MAXS);c.accept(writer);Files.write(Path.of(args[1]),writer.toByteArray());
        System.out.println(c.name+" changedMethods="+changed);
    }
}
