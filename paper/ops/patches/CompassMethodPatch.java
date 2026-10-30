import java.nio.file.*;
import java.io.*;
import java.util.*;
import org.objectweb.asm.*;
import org.objectweb.asm.tree.*;
import org.objectweb.asm.util.*;

/** Replace only the reviewed null-safe compass method; keep every other deployed method. */
public final class CompassMethodPatch {
    static String trace(MethodNode method) {
        Textifier text = new Textifier(); method.accept(new TraceMethodVisitor(text));
        StringWriter out = new StringWriter(); text.print(new PrintWriter(out)); return out.toString();
    }
    public static void main(String[] args) throws Exception {
        ClassNode before = new ClassNode(), compiled = new ClassNode();
        new ClassReader(Files.readAllBytes(Path.of(args[0]))).accept(before, 0);
        new ClassReader(Files.readAllBytes(Path.of(args[1]))).accept(compiled, 0);
        String descriptor = "(Lorg/bukkit/entity/Player;Lorg/bukkit/Location;)V";
        MethodNode replacement = compiled.methods.stream().filter(m -> m.name.equals("syncCompass") && m.desc.equals(descriptor)).findFirst().orElseThrow();
        Map<String,String> original = new LinkedHashMap<>();
        for (MethodNode m : before.methods) original.put(m.name+m.desc, trace(m));
        int changed=0;
        for (int i=0;i<before.methods.size();i++) if (before.methods.get(i).name.equals("syncCompass") && before.methods.get(i).desc.equals(descriptor)) {before.methods.set(i,replacement);changed++;}
        if(changed!=1)throw new IllegalStateException("Expected one deployed compass method");
        ClassWriter writer = new ClassWriter(0); before.accept(writer); byte[] bytes=writer.toByteArray();
        ClassNode result=new ClassNode();new ClassReader(bytes).accept(result,0);
        int kept=0;
        for(MethodNode m:result.methods)if(!(m.name.equals("syncCompass")&&m.desc.equals(descriptor))){if(!original.get(m.name+m.desc).equals(trace(m)))throw new IllegalStateException("Unreviewed method changed: "+m.name);kept++;}
        Files.write(Path.of(args[2]),bytes);System.out.println("{\"changedMethods\":1,\"otherMethodsPreserved\":"+kept+"}");
    }
}
