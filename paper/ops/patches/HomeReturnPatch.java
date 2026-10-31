import java.nio.file.*;
import java.util.*;
import org.objectweb.asm.*;
import org.objectweb.asm.tree.*;

/** Refuse a home candidate if recompilation changes unrelated travel behavior. */
public final class HomeReturnPatch {
    public static void main(String[] args) throws Exception {
        if(args.length==4&&args[3].equals("guide")){
            ClassNode beforeGuide=new ClassNode(),compiledGuide=new ClassNode();
            new ClassReader(Files.readAllBytes(Path.of(args[0]))).accept(beforeGuide,0);
            new ClassReader(Files.readAllBytes(Path.of(args[1]))).accept(compiledGuide,0);
            if(!beforeGuide.name.equals("org/afuhome/agentfriend/SpellGuide")||!compiledGuide.name.equals(beforeGuide.name))throw new IllegalStateException("Expected guide class");
            java.util.function.Function<ClassNode,List<LdcInsnNode>> literals=c->{
                List<LdcInsnNode> list=new ArrayList<>();for(MethodNode m:c.methods)if(m.name.equals("<clinit>"))for(AbstractInsnNode i:m.instructions.toArray())if(i instanceof LdcInsnNode d&&d.cst instanceof String)list.add(d);return list;};
            var old=literals.apply(beforeGuide);var current=literals.apply(compiledGuide);
            if(old.size()!=current.size())throw new IllegalStateException("Guide catalogue changed");
            int start=-1,end=-1,changed=0;
            for(int i=0;i<old.size();i++){if(old.get(i).cst.equals("home"))start=i;if(start>=0&&old.get(i).cst.equals("travel")){end=i;break;}}
            // The home category itself is 'travel'; use the following entry's literal 'travel'.
            if(start<0)throw new IllegalStateException("Home entry missing");
            end=-1;for(int i=start+3;i<old.size();i++)if(old.get(i).cst.equals("travel")){end=i;break;}
            for(int i=0;i<old.size();i++)if(!old.get(i).cst.equals(current.get(i).cst)){
                if(i<=start||i>=end)throw new IllegalStateException("Unrelated guide text changed");old.get(i).cst=current.get(i).cst;changed++;
            }
            if(changed!=4)throw new IllegalStateException("Expected exactly four home guide strings");
            ClassWriter writer=new ClassWriter(0);beforeGuide.accept(writer);Files.write(Path.of(args[2]),writer.toByteArray());
            System.out.println("{\"homeGuideStringsChanged\":4,\"otherInstructionsPreserved\":true}");return;
        }
        ClassNode before=new ClassNode(),after=new ClassNode();
        new ClassReader(Files.readAllBytes(Path.of(args[0]))).accept(before,ClassReader.SKIP_DEBUG);
        new ClassReader(Files.readAllBytes(Path.of(args[1]))).accept(after,ClassReader.SKIP_DEBUG);
        if(!before.name.equals("org/afuhome/agentfriend/TravelMagic")||!after.name.equals(before.name))throw new IllegalStateException("Expected travel class");
        Set<String> allowed=Set.of("<init>","teleport","command","onTeleportCheck","onQuit");
        Map<String,MethodNode> old=new HashMap<>();for(MethodNode m:before.methods)old.put(m.name+m.desc,m);
        int preserved=0,changed=0;
        for(MethodNode m:after.methods){
            MethodNode original=old.remove(m.name+m.desc);
            if(original==null)throw new IllegalStateException("Unexpected added method: "+m.name);
            if(allowed.contains(m.name)){changed++;continue;}
            if(!CompassMethodPatch.trace(original).equals(CompassMethodPatch.trace(m)))throw new IllegalStateException("Unrelated travel method changed: "+m.name);
            preserved++;
        }
        if(old.size()!=1||!old.values().iterator().next().name.equals("safeHome")||changed!=5)throw new IllegalStateException("Unexpected method boundary");
        Set<String> oldFields=new HashSet<>();for(FieldNode f:before.fields)oldFields.add(f.name+":"+f.desc);
        Set<String> newFields=new HashSet<>();for(FieldNode f:after.fields)newFields.add(f.name+":"+f.desc);
        if(!newFields.remove("homeLandings:Ljava/util/Map;")||!newFields.equals(oldFields))throw new IllegalStateException("Unexpected travel fields");
        System.out.println("{\"reviewedTravelMethods\":"+changed+",\"unrelatedTravelMethodsPreserved\":"+preserved+",\"removed\":\"safeHome\",\"addedField\":\"homeLandings\"}");
    }
}
