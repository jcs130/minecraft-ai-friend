import java.nio.file.*;
import java.util.*;
import java.util.regex.Pattern;
import org.objectweb.asm.*;
import org.objectweb.asm.tree.*;

/** Keep the reviewed runtime class, replacing only selected photo/diary methods. */
public final class PhotoSocialPatch {
    public static void main(String[]args)throws Exception{
        ClassNode before=new ClassNode(),compiled=new ClassNode();
        new ClassReader(Files.readAllBytes(Path.of(args[0]))).accept(before,0);
        new ClassReader(Files.readAllBytes(Path.of(args[1]))).accept(compiled,0);
        if(!before.name.equals(compiled.name))throw new IllegalStateException("Class mismatch");
        Pattern selected=Pattern.compile(args[3]);Map<String,MethodNode> methods=new LinkedHashMap<>();
        for(MethodNode m:compiled.methods)methods.put(m.name+m.desc,m);
        Set<String> fields=new HashSet<>();for(FieldNode f:before.fields)fields.add(f.name+":"+f.desc);
        Map<String,String> preserved=new HashMap<>();int changed=0,added=0;
        for(int i=0;i<before.methods.size();i++){
            MethodNode original=before.methods.get(i);
            if(!selected.matcher(original.name).matches()){preserved.put(original.name+original.desc,CompassMethodPatch.trace(original));continue;}
            MethodNode replacement=methods.remove(original.name+original.desc);if(replacement==null)throw new IllegalStateException("Replacement missing: "+original.name);
            before.methods.set(i,replacement);changed++;
        }
        for(MethodNode m:methods.values())if(selected.matcher(m.name).matches()){
            if(!before.name.endsWith("/PhotoJournal")||!m.name.equals("delivered"))throw new IllegalStateException("Unexpected added method: "+m.name);
            before.methods.add(m);added++;
        }
        if(changed==0)throw new IllegalStateException("No reviewed methods");
        for(MethodNode m:before.methods)if(selected.matcher(m.name).matches())for(AbstractInsnNode i:m.instructions.toArray())
            if(i instanceof FieldInsnNode f&&f.owner.equals(before.name)&&!fields.contains(f.name+":"+f.desc))throw new IllegalStateException("Unreviewed runtime field: "+f.name);
        ClassWriter writer=new ClassWriter(0);before.accept(writer);byte[]bytes=writer.toByteArray();ClassNode result=new ClassNode();new ClassReader(bytes).accept(result,0);
        for(MethodNode m:result.methods)if(preserved.containsKey(m.name+m.desc)&&!preserved.get(m.name+m.desc).equals(CompassMethodPatch.trace(m)))throw new IllegalStateException("Unrelated method changed");
        Files.write(Path.of(args[2]),bytes);
        System.out.println("{\"changedMethods\":"+changed+",\"addedMethods\":"+added+",\"unrelatedMethodsPreserved\":"+preserved.size()+"}");
    }
}
