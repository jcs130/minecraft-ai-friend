import java.nio.file.*;
import java.util.*;
import java.util.jar.*;
import com.google.gson.*;
import org.objectweb.asm.*;

/** Translates reviewed presentation strings, never identifiers or bytecode flow. */
public final class VortexChineseConstants {
    static Map<String,String> exact,fragments;
    static String translate(String s){
        if(exact.containsKey(s))return exact.get(s);
        for(var e:fragments.entrySet())s=s.replace(e.getKey(),e.getValue());return s;
    }
    static Map<String,String> values(JsonObject o){
        var rows=new ArrayList<>(o.entrySet());rows.sort(Comparator.<Map.Entry<String,JsonElement>>comparingInt(e->e.getKey().length()).reversed());
        var m=new LinkedHashMap<String,String>();rows.forEach(e->m.put(e.getKey(),e.getValue().getAsString()));return m;
    }
    public static void main(String[] args)throws Exception{
        Path input=Path.of(args[0]),output=Path.of(args[1]);if(Files.exists(output))throw new IllegalArgumentException("output exists");
        var config=JsonParser.parseString(Files.readString(Path.of(args[2]))).getAsJsonObject();exact=values(config.getAsJsonObject("exact"));fragments=values(config.getAsJsonObject("fragments"));
        List<String> changed=new ArrayList<>();int[] literals={0};
        try(var jar=new JarFile(input.toFile());var out=new JarOutputStream(Files.newOutputStream(output))){
            for(var it=jar.entries();it.hasMoreElements();){var entry=it.nextElement();byte[] before=jar.getInputStream(entry).readAllBytes(),bytes=before;
                if(entry.getName().endsWith(".class")&&(entry.getName().startsWith("io/vortexcore/")||entry.getName().startsWith("com/l299l/npcspeak/"))){
                    int previous=literals[0];var reader=new ClassReader(bytes);var writer=new ClassWriter(reader,0);
                    reader.accept(new ClassVisitor(Opcodes.ASM9,writer){
                        @Override public MethodVisitor visitMethod(int access,String name,String descriptor,String signature,String[] exceptions){
                            return new MethodVisitor(Opcodes.ASM9,super.visitMethod(access,name,descriptor,signature,exceptions)){
                                Object localized(Object value){if(value instanceof String s){String t=translate(s);if(!s.equals(t))literals[0]++;return t;}return value;}
                                @Override public void visitLdcInsn(Object value){super.visitLdcInsn(localized(value));}
                                @Override public void visitInvokeDynamicInsn(String name,String descriptor,Handle bootstrap,Object... args){
                                    Object[] localized=args.clone();for(int i=0;i<localized.length;i++)localized[i]=localized(localized[i]);
                                    super.visitInvokeDynamicInsn(name,descriptor,bootstrap,localized);
                                }
                            };
                        }
                    },0);if(literals[0]!=previous)bytes=writer.toByteArray();
                }
                if(!Arrays.equals(before,bytes))changed.add(entry.getName());
                out.putNextEntry(new JarEntry(entry.getName()));out.write(bytes);out.closeEntry();
            }
        }
        System.out.println(new Gson().toJson(Map.of("classes",changed,"translatedLiterals",literals[0])));
    }
}
