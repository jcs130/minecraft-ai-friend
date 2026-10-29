import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;
import org.objectweb.asm.*;

/** Backport the reviewed RPG/CLI cohort into the pinned live artifact. Resolve
 * internal member references in both directions before writing a release.
 * Existing world resources and unrelated guild/photo classes stay at baseline
 * unless an actual new member dependency requires the latter. Never installs. */
public final class BuildConquestRelease {
    static final String BASE="909b4d7b077ab601d36d4851f01a69fccbf0182bc2110e2352c2e24206761906";
    static final String PREFIX="org/afuhome/agentfriend/";
    static final Set<String> WITHHELD=Set.of("GuildHallManager","GuildStorageOwnership","LandManager","PhotoJournal");
    record Ref(String owner,String name,String descriptor,boolean field) {}
    record Symbol(String parent,List<String> interfaces,Set<String> fields,Set<String> methods,List<Ref> refs) {}
    static String outer(String entry){return entry.substring(PREFIX.length()).replaceFirst("(?:\\$.*)?\\.class$","");}
    static String sha(byte[] bytes)throws Exception{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));}
    static Map<String,byte[]> read(Path jar)throws Exception{
        var map=new TreeMap<String,byte[]>();
        try(var zip=new ZipFile(jar.toFile())){for(var e:Collections.list(zip.entries()))if(!e.isDirectory())map.put(e.getName(),zip.getInputStream(e).readAllBytes());}
        return map;
    }
    static Map<String,Symbol> index(Map<String,byte[]> files){
        var result=new HashMap<String,Symbol>();
        files.forEach((file,bytes)->{
            if(!file.startsWith(PREFIX)||!file.endsWith(".class"))return;
            var c=new ClassReader(bytes);var fields=new HashSet<String>();var methods=new HashSet<String>();var refs=new ArrayList<Ref>();
            c.accept(new ClassVisitor(Opcodes.ASM9){
                public FieldVisitor visitField(int access,String name,String desc,String sig,Object value){fields.add(name+":"+desc);return null;}
                public MethodVisitor visitMethod(int access,String name,String desc,String sig,String[] exceptions){
                    methods.add(name+":"+desc);
                    return new MethodVisitor(Opcodes.ASM9){
                        public void visitFieldInsn(int op,String owner,String member,String desc){refs.add(new Ref(owner,member,desc,true));}
                        public void visitMethodInsn(int op,String owner,String member,String desc,boolean itf){refs.add(new Ref(owner,member,desc,false));}
                        public void visitInvokeDynamicInsn(String name,String desc,Handle bootstrap,Object...args){
                            handle(bootstrap);for(Object a:args)if(a instanceof Handle h)handle(h);
                        }
                        void handle(Handle h){refs.add(new Ref(h.getOwner(),h.getName(),h.getDesc(),h.getTag()<=Opcodes.H_PUTSTATIC));}
                    };
                }
            },ClassReader.SKIP_DEBUG|ClassReader.SKIP_FRAMES);
            result.put(c.getClassName(),new Symbol(c.getSuperName(),List.of(c.getInterfaces()),fields,methods,refs));
        });return result;
    }
    static boolean resolves(Map<String,Symbol> index,Ref ref){return resolves(index,ref,new HashSet<>());}
    static boolean resolves(Map<String,Symbol> index,Ref ref,Set<String> seen){
        if(!seen.add(ref.owner))return false;var symbol=index.get(ref.owner);if(symbol==null)return false;
        if((ref.field?symbol.fields:symbol.methods).contains(ref.name+":"+ref.descriptor))return true;
        if(ref.name.equals("<init>"))return false;
        for(String parent:symbol.interfaces)if(resolves(index,new Ref(parent,ref.name,ref.descriptor,ref.field),seen))return true;
        return symbol.parent!=null&&resolves(index,new Ref(symbol.parent,ref.name,ref.descriptor,ref.field),seen);
    }
    static String quote(String text){return "\""+text.replace("\\","\\\\").replace("\"","\\\"")+"\"";}
    public static void main(String[] args)throws Exception{
        if(args.length!=4)throw new IllegalArgumentException("base.jar compiled.jar compiled-sha256 output.jar");
        var base=Path.of(args[0]);var compiled=Path.of(args[1]);var out=Path.of(args[3]);
        if(!sha(Files.readAllBytes(base)).equals(BASE)||!sha(Files.readAllBytes(compiled)).equals(args[2])||Files.exists(out))throw new IllegalArgumentException("artifact mismatch or output exists");
        var old=read(base);var next=read(compiled);var oldIndex=index(old);var newIndex=index(next);var selected=new TreeSet<String>();
        for(var e:next.entrySet())if(e.getKey().startsWith(PREFIX)&&e.getKey().endsWith(".class")&&!Arrays.equals(old.get(e.getKey()),e.getValue())&&!WITHHELD.contains(outer(e.getKey())))selected.add(outer(e.getKey()));
        Map<String,byte[]> target=null;int checks=0;
        for(int pass=0;pass<64;pass++){
            target=new TreeMap<>(old);for(var e:next.entrySet())if(e.getKey().startsWith(PREFIX)&&e.getKey().endsWith(".class")&&selected.contains(outer(e.getKey())))target.put(e.getKey(),e.getValue());
            var linked=index(target);var include=new TreeSet<String>();checks=0;
            for(var entry:linked.entrySet())for(Ref ref:entry.getValue().refs){
                if(!ref.owner.startsWith(PREFIX))continue;
                boolean oldMember=resolves(oldIndex,ref),newMember=resolves(newIndex,ref);
                // Inherited external Bukkit/Object members are not owned here.
                if(!oldMember&&!newMember)continue;checks++;
                if(resolves(linked,ref))continue;
                String owner=outer(ref.owner+".class"),caller=outer(entry.getKey()+".class");
                if(newMember&&!selected.contains(owner))include.add(owner);
                else if(next.containsKey(entry.getKey()+".class")&&!selected.contains(caller))include.add(caller);
                else throw new IllegalStateException("unresolved internal member: "+entry.getKey()+" -> "+ref);
            }
            if(include.isEmpty())break;selected.addAll(include);if(pass==63)throw new IllegalStateException("dependency closure did not converge");
        }
        // Only these reviewed defaults change. Live config is merged separately
        // with exact preimage hashes, preserving existing players and worlds.
        for(String name:List.of("professions.yml","skills.yml","skill-points.yml","onboarding.yml"))target.put(name,next.get(name));
        String metadata=new String(old.get("plugin.yml"),java.nio.charset.StandardCharsets.UTF_8);
        if(!metadata.contains("version: '0.4.47.17'"))throw new IllegalArgumentException("unexpected baseline descriptor");
        metadata=metadata.replace("version: '0.4.47.17'","version: '0.4.47.18'");
        if(!metadata.matches("(?s).*softdepend: \\[[^\\]]*\\bTAB\\b.*"))metadata=metadata.replace("softdepend: [","softdepend: [TAB, ");
        target.put("plugin.yml",metadata.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        Files.createDirectories(out.toAbsolutePath().getParent());
        try(var zip=new ZipOutputStream(Files.newOutputStream(out,StandardOpenOption.CREATE_NEW))){for(var e:target.entrySet()){var z=new ZipEntry(e.getKey());z.setTime(315532800000L);zip.putNextEntry(z);zip.write(e.getValue());zip.closeEntry();}}
        int unchanged=0;var changed=new ArrayList<String>();for(var e:target.entrySet())if(Arrays.equals(old.get(e.getKey()),e.getValue()))unchanged++;else changed.add(e.getKey());
        String report="{\"version\":\"0.4.47.18\",\"baselineSha256\":"+quote(BASE)+",\"compiledSha256\":"+quote(args[2])+",\"sha256\":"+quote(sha(Files.readAllBytes(out)))+",\"internalMemberChecks\":"+checks+",\"unchangedEntries\":"+unchanged+",\"cohort\":["+String.join(",",selected.stream().map(BuildConquestRelease::quote).toList())+"],\"changedEntries\":["+String.join(",",changed.stream().map(BuildConquestRelease::quote).toList())+"]}\n";
        Files.writeString(out.resolveSibling(out.getFileName()+".build.json"),report);System.out.println(report);
    }
}
