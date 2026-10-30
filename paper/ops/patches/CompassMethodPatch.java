import java.nio.file.*;
import java.io.*;
import java.util.*;
import org.objectweb.asm.*;
import org.objectweb.asm.tree.*;
import org.objectweb.asm.util.*;

/** Replace reviewed method bodies; default to the pinned null-safe compass patch. */
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
        java.util.function.Predicate<MethodNode> selected = args.length > 3
            ? m -> java.util.regex.Pattern.matches(args[3], m.name)
            : m -> m.name.equals("syncCompass") && m.desc.equals(descriptor);
        Map<String,MethodNode> replacements = new LinkedHashMap<>();
        for (MethodNode m : compiled.methods) replacements.put(m.name+m.desc, m);
        Map<String,String> original = new LinkedHashMap<>();
        for (MethodNode m : before.methods) original.put(m.name+m.desc, trace(m));
        int changed=0;
        for (int i=0;i<before.methods.size();i++) if (selected.test(before.methods.get(i))) {
            MethodNode m=before.methods.get(i), replacement=replacements.get(m.name+m.desc);
            if(replacement==null)throw new IllegalStateException("Compiled replacement missing: "+m.name+m.desc);
            before.methods.set(i,replacement);changed++;
        }
        if(changed==0 || args.length<=3 && changed!=1)throw new IllegalStateException("Expected reviewed deployed methods");
        ClassWriter writer = new ClassWriter(0); before.accept(writer); byte[] bytes=writer.toByteArray();
        ClassNode result=new ClassNode();new ClassReader(bytes).accept(result,0);
        int kept=0;
        for(MethodNode m:result.methods)if(!selected.test(m)){if(!original.get(m.name+m.desc).equals(trace(m)))throw new IllegalStateException("Unreviewed method changed: "+m.name);kept++;}
        Files.write(Path.of(args[2]),bytes);System.out.println("{\"changedMethods\":"+changed+",\"otherMethodsPreserved\":"+kept+"}");
    }
}
