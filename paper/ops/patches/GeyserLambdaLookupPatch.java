import java.nio.file.*;
import java.util.*;
import java.io.*;
import org.objectweb.asm.*;
import org.objectweb.asm.tree.*;
import org.objectweb.asm.util.*;

/** Reproduce the already deployed Youer lookup fix in a pinned newer upstream class. */
public final class GeyserLambdaLookupPatch {
    private static String trace(MethodNode m) {
        var text=new Textifier();m.accept(new TraceMethodVisitor(text));var out=new StringWriter();text.print(new PrintWriter(out));return out.toString();
    }
    public static void main(String[] args)throws Exception {
        byte[] input=Files.readAllBytes(Path.of(args[0]));var reader=new ClassReader(input);var node=new ClassNode();reader.accept(node,0);
        if(!node.name.equals("org/lanternpowered/lmbda/InternalLambdaFactory"))throw new IllegalArgumentException("Unexpected class");
        var originals=new HashMap<String,String>();for(var m:node.methods)originals.put(m.name+m.desc,trace(m));
        var init=node.methods.stream().filter(m->m.name.equals("<clinit>")&&m.desc.equals("()V")).findFirst().orElseThrow();
        var instructions=new ArrayList<AbstractInsnNode>();for(var i:init.instructions)if(i.getOpcode()>=0)instructions.add(i);
        if(!(instructions.get(0)instanceof InvokeDynamicInsnNode) || !(instructions.get(1)instanceof MethodInsnNode call) || !call.owner.equals("java/security/AccessController") || !call.name.equals("doPrivileged") || instructions.get(2).getOpcode()!=Opcodes.CHECKCAST || !(instructions.get(3)instanceof FieldInsnNode field) || !field.name.equals("internalLookup"))throw new IllegalStateException("Unreviewed upstream initializer");
        init.instructions.insertBefore(instructions.get(0),new MethodInsnNode(Opcodes.INVOKESTATIC,"java/lang/invoke/MethodHandles","lookup","()Ljava/lang/invoke/MethodHandles$Lookup;",false));
        for(int i=0;i<3;i++)init.instructions.remove(instructions.get(i));
        var writer=new ClassWriter(reader,0);node.accept(writer);byte[] output=writer.toByteArray();var result=new ClassNode();new ClassReader(output).accept(result,0);
        int kept=0;for(var m:result.methods)if(!m.name.equals("<clinit>")){if(!originals.get(m.name+m.desc).equals(trace(m)))throw new IllegalStateException("Unrelated method changed");kept++;}
        Files.write(Path.of(args[1]),output);System.out.println("{\"changedMethods\":1,\"otherMethodsPreserved\":"+kept+"}");
    }
}
