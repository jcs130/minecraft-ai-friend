import java.nio.file.*;
import org.objectweb.asm.*;
import org.objectweb.asm.tree.*;

/** Append only the current request's story to the two deployed journal delivery calls. */
public final class PhotoDeliveryPatch {
    public static void main(String[]args)throws Exception{
        ClassNode owner=new ClassNode();new ClassReader(Files.readAllBytes(Path.of(args[0]))).accept(owner,0);
        if(!owner.name.equals("org/afuhome/agentfriend/PhotoCameraManager"))throw new IllegalStateException("Expected camera class");
        String job=owner.name+"$Job";int changed=0;
        for(MethodNode m:owner.methods)for(AbstractInsnNode n:m.instructions.toArray())
            if(n instanceof MethodInsnNode call&&call.owner.equals("org/afuhome/agentfriend/PhotoJournal")&&call.name.equals("delivered")){
                if(!call.desc.endsWith("Ljava/lang/Object;)V"))throw new IllegalStateException("Unexpected delivery ABI");
                int local=-1;
                for(AbstractInsnNode previous=n.getPrevious();previous!=null;previous=previous.getPrevious())
                    if(previous instanceof FieldInsnNode field&&field.owner.equals(job)&&field.name.equals("name")){
                        if(!(field.getPrevious() instanceof VarInsnNode value)||value.getOpcode()!=Opcodes.ALOAD)throw new IllegalStateException("Expected request-local job");
                        local=value.var;break;
                    }
                if(local<0)throw new IllegalStateException("Request job not found");
                InsnList extra=new InsnList();extra.add(new VarInsnNode(Opcodes.ALOAD,local));extra.add(new FieldInsnNode(Opcodes.GETFIELD,job,"story","Ljava/lang/String;"));
                m.instructions.insertBefore(call,extra);m.maxStack+=1;call.desc=call.desc.substring(0,call.desc.length()-2)+"Ljava/lang/String;)V";changed++;
            }
        if(changed!=2)throw new IllegalStateException("Expected two native delivery sites, got "+changed);
        ClassWriter out=new ClassWriter(0);owner.accept(out);Files.write(Path.of(args[1]),out.toByteArray());
        System.out.println("{\"deliveryCalls\":2,\"unpublishedCameraFieldsImported\":false}");
    }
}
