import java.nio.file.*;
import org.objectweb.asm.*;
import org.objectweb.asm.tree.*;

/** Exact-shape bytecode patch; preserves every unrelated method and translated constant. */
public final class ProfileLifecyclePatch implements Opcodes {
    static final String OWNER="io/vortexcore/rpg/PlayerProfileService";
    static void guard(MethodNode method,int uuidSlot,boolean future){
        var proceed=new LabelNode();var code=new InsnList();
        code.add(new VarInsnNode(ALOAD,0));code.add(new FieldInsnNode(GETFIELD,OWNER,"loadingPlayers","Ljava/util/Set;"));
        code.add(new VarInsnNode(ALOAD,uuidSlot));code.add(new MethodInsnNode(INVOKEINTERFACE,"java/util/Set","contains","(Ljava/lang/Object;)Z",true));
        code.add(new JumpInsnNode(IFEQ,proceed));
        if(future){
            code.add(new TypeInsnNode(NEW,"java/lang/IllegalStateException"));code.add(new InsnNode(DUP));
            code.add(new LdcInsnNode("角色资料仍在加载，原存档保留；稍后查询status，不要重复保存。"));
            code.add(new MethodInsnNode(INVOKESPECIAL,"java/lang/IllegalStateException","<init>","(Ljava/lang/String;)V",false));
            code.add(new MethodInsnNode(INVOKESTATIC,"java/util/concurrent/CompletableFuture","failedFuture","(Ljava/lang/Throwable;)Ljava/util/concurrent/CompletableFuture;",false));code.add(new InsnNode(ARETURN));
        }else code.add(new InsnNode(RETURN));
        code.add(proceed);code.add(new FrameNode(F_SAME,0,null,0,null));method.instructions.insert(code);
    }
    public static void main(String[] args)throws Exception{
        byte[] original=Files.readAllBytes(Path.of(args[0]));var reader=new ClassReader(original);var tree=new ClassNode();reader.accept(tree,0);
        if(!tree.name.equals(OWNER))throw new IllegalArgumentException("wrong class");int joins=0,saves=0,drains=0;
        for(var method:tree.methods){
            if(method.name.equals("lambda$onPlayerJoin$11"))for(var instruction:method.instructions){
                if(instruction instanceof MethodInsnNode call&&call.owner.equals("io/vortexcore/scheduling/FoliaExecutionFacade")&&call.name.equals("runEntity")&&call.desc.equals("(Lorg/bukkit/entity/Entity;Ljava/lang/String;Ljava/lang/Runnable;)Z")){
                    call.setOpcode(INVOKESTATIC);call.owner="io/vortexcore/rpg/ProfileJoinDispatch";call.name="runWhenReady";call.desc="(Lio/vortexcore/scheduling/FoliaExecutionFacade;Lorg/bukkit/entity/Entity;Ljava/lang/String;Ljava/lang/Runnable;)Z";call.itf=false;joins++;
                }
            }
            if(method.name.equals("queueSave")&&method.desc.equals("(Ljava/util/UUID;Ljava/lang/String;Lio/vortexcore/player/UnifiedPlayer;)Ljava/util/concurrent/CompletableFuture;")){guard(method,1,true);saves++;}
            if(method.name.equals("lambda$flushAndClose$7")&&method.desc.equals("(Ljava/util/LinkedHashSet;Ljava/util/UUID;Lio/vortexcore/player/UnifiedPlayer;)V")){guard(method,2,false);drains++;}
        }
        if(joins!=1||saves!=1||drains!=1)throw new IllegalStateException("Unexpected native shape "+joins+"/"+saves+"/"+drains);
        var writer=new ClassWriter(reader,ClassWriter.COMPUTE_MAXS);tree.accept(writer);Files.write(Path.of(args[1]),writer.toByteArray());
        System.out.println("Native lifecycle patch: one join dispatch, one loading-save fence, one shutdown fence");
    }
}
