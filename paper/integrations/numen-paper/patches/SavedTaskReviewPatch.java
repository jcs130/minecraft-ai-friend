import java.nio.file.*;
import org.objectweb.asm.*;
import org.objectweb.asm.tree.*;

/** Port PR58's saved-task review boundary to the installed Paper Lua task ABI. */
public final class SavedTaskReviewPatch implements Opcodes {
    static final String BASE="com/dwinovo/numen/api/";
    static final String BODY=BASE+"entity/NumenPlayer";
    static final String TASK=BASE+"task/TaskPersistence";
    static final String LEFT=TASK+"$LeftOver";
    static final String RESULT=BASE+"task/TaskResult";
    static final String REASON="saved_task_requires_review：身体已恢复，旧任务未重派；此前进度和效果仍未知。原任务记录已保留，请先核对实际状态，再明确下达后续任务。";
    static void call(InsnList out,int opcode,String owner,String name,String descriptor,boolean itf){
        out.add(new MethodInsnNode(opcode,owner,name,descriptor,itf));
    }
    public static void main(String[] args)throws Exception {
        ClassNode type=new ClassNode();new ClassReader(Files.readAllBytes(Path.of(args[0]))).accept(type,0);
        if(!type.name.equals(TASK))throw new IllegalStateException("Wrong reviewed class");
        var methods=type.methods.stream().filter(m->m.name.equals("replay")&&m.desc.equals("(L"+BODY+";L"+LEFT+";)V")).toList();
        if(methods.size()!=1)throw new IllegalStateException("Unexpected Paper task ABI");
        MethodNode replay=methods.getFirst();int launches=0;
        for(var i:replay.instructions)if(i instanceof MethodInsnNode m&&m.owner.equals(BASE+"program/ServerPrograms")&&m.name.equals("launch"))launches++;
        if(launches!=1)throw new IllegalStateException("Reviewed replay call was not found exactly once");
        replay.instructions.clear();replay.tryCatchBlocks.clear();if(replay.localVariables!=null)replay.localVariables.clear();
        InsnList out=replay.instructions;
        out.add(new FieldInsnNode(GETSTATIC,BASE+"Constants","LOG","Lorg/slf4j/Logger;"));
        out.add(new LdcInsnNode("[numen-task] {} saved task {} requires review; not replayed"));
        out.add(new VarInsnNode(ALOAD,0));call(out,INVOKEVIRTUAL,BODY,"getUUID","()Ljava/util/UUID;",false);
        out.add(new VarInsnNode(ALOAD,1));call(out,INVOKEVIRTUAL,LEFT,"taskName","()Ljava/lang/String;",false);
        call(out,INVOKEINTERFACE,"org/slf4j/Logger","warn","(Ljava/lang/String;Ljava/lang/Object;Ljava/lang/Object;)V",true);
        out.add(new VarInsnNode(ALOAD,0));out.add(new LdcInsnNode("restored-"));
        out.add(new VarInsnNode(ALOAD,1));call(out,INVOKEVIRTUAL,LEFT,"taskName","()Ljava/lang/String;",false);
        call(out,INVOKEVIRTUAL,"java/lang/String","concat","(Ljava/lang/String;)Ljava/lang/String;",false);
        out.add(new VarInsnNode(ALOAD,1));call(out,INVOKEVIRTUAL,LEFT,"taskName","()Ljava/lang/String;",false);
        out.add(new LdcInsnNode("stopped"));out.add(new LdcInsnNode(REASON));
        call(out,INVOKESTATIC,RESULT,"cancelled","(Ljava/lang/String;)L"+RESULT+";",false);
        out.add(new InsnNode(ACONST_NULL));
        call(out,INVOKESTATIC,BASE+"event/NumenEvents","taskFinished","(L"+BODY+";Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;L"+RESULT+";L"+BASE+"sdk/ApiFunction;)V",false);
        out.add(new InsnNode(RETURN));
        type.methods.removeIf(m->m.name.equals("abandon")||m.name.equals("lambda$replay$0"));
        type.innerClasses.removeIf(c->c.name.equals(TASK+"$1"));
        // Every remaining call is inspected, including unexercised private paths.
        for(var method:type.methods)for(var i:method.instructions)if(i instanceof MethodInsnNode m&&m.owner.equals(BASE+"program/ServerPrograms")&&m.name.equals("launch"))
            throw new IllegalStateException("A saved-task launch survived the patch");
        ClassWriter writer=new ClassWriter(ClassWriter.COMPUTE_MAXS);type.accept(writer);
        Files.write(Path.of(args[1]),writer.toByteArray());
        System.out.println("Paper saved task retained for review; automatic launch and failure-forget path removed");
    }
}
