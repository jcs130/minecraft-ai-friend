import java.nio.file.*;
import java.util.*;
import java.io.*;
import org.objectweb.asm.*;
import org.objectweb.asm.tree.*;
import org.objectweb.asm.util.*;
public final class VerifyDurableConfigPatch {
    private static ClassNode load(String path)throws Exception{ClassNode node=new ClassNode();new ClassReader(Files.readAllBytes(Path.of(path))).accept(node,0);return node;}
    private static String trace(MethodNode method){method.maxStack=method.maxLocals=0;Textifier text=new Textifier();method.accept(new TraceMethodVisitor(text));StringWriter out=new StringWriter();text.print(new PrintWriter(out));return out.toString();}
    public static void main(String[] args)throws Exception {
        ClassNode before=load(args[0]),after=load(args[1]);int hooks=0;
        Map<String,MethodNode> changed=new HashMap<>();
        for(MethodNode method:after.methods){
            if(Set.of("onEnable","onDisable").contains(method.name))for(AbstractInsnNode node=method.instructions.getFirst();node!=null;){
                AbstractInsnNode next=node.getNext();
                if(node instanceof MethodInsnNode call&&call.owner.equals("org/afuhome/agentfriend/DurableConfigStore")&&Set.of("onEnable","close").contains(call.name)){
                    AbstractInsnNode previous=node.getPrevious();
                    if(!(previous instanceof VarInsnNode variable)||variable.getOpcode()!=Opcodes.ALOAD||variable.var!=0)throw new AssertionError("unexpected hook input");
                    method.instructions.remove(previous);method.instructions.remove(node);hooks++;
                }
                node=next;
            }
            changed.put(method.name+method.desc,method);
        }
        if(hooks!=2)throw new AssertionError("exact lifecycle hooks required");int methods=0;
        for(MethodNode original:before.methods){MethodNode candidate=changed.remove(original.name+original.desc);if(candidate==null||!trace(original).equals(trace(candidate)))throw new AssertionError("unrelated method changed: "+original.name+original.desc);methods++;}
        if(!changed.keySet().equals(Set.of("saveConfig()V","reloadConfig()V")))throw new AssertionError("unexpected added methods");
        System.out.println("ORIGINAL_METHODS_PRESERVED count="+methods+" lifecycleHooks=2 persistenceOverrides=2");
    }
}
