import java.io.*;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import java.util.zip.*;
import org.objectweb.asm.*;

/** Reproducible local adapter, not an upstream release or a general remapper.
 * 1.2.2-alpha advertises 1.21 but uses post-1.21.1 Attribute field names.
 * Resolve only exact legacy field equivalents from the target API. Resources
 * and classes without a changed reference remain byte-for-byte identical.
 */
public final class Vortex1211Compat {
    static final String OWNER = "org/bukkit/attribute/Attribute";
    static final String HASH = "736888d27b7d5e1de2a039c276984ef67be50f47c4fc78f7e3db2973fb60c5e171801a3a9fdf8d2b8ae27ee7327d5240abcaa71e79120e7abd0592e75592d501";
    public static void main(String[] args) throws Exception {
        if (args.length != 3) throw new IllegalArgumentException("official.jar target-api.jar new-output.jar");
        Path input=Path.of(args[0]), api=Path.of(args[1]), output=Path.of(args[2]);
        if (Files.exists(output)) throw new IllegalArgumentException("Output must not exist");
        if (!HexFormat.of().formatHex(MessageDigest.getInstance("SHA-512").digest(Files.readAllBytes(input))).equals(HASH))
            throw new IllegalArgumentException("Requires pinned official 1.2.2-alpha artifact");
        Set<String> fields=new HashSet<>();
        try (ZipFile z=new ZipFile(api.toFile())) {
            new ClassReader(z.getInputStream(z.getEntry(OWNER+".class"))).accept(new ClassVisitor(Opcodes.ASM9) {
                @Override public void visit(int v,int a,String n,String s,String parent,String[] interfaces) {
                    if ((a & Opcodes.ACC_ENUM)==0) throw new IllegalArgumentException("Target must use the 1.21.1 Attribute enum");
                }
                @Override public FieldVisitor visitField(int a,String n,String d,String s,Object v) { fields.add(n); return null; }
            },ClassReader.SKIP_CODE);
        }
        int changed=0, references=0;
        try (ZipFile in=new ZipFile(input.toFile()); ZipOutputStream out=new ZipOutputStream(Files.newOutputStream(output,StandardOpenOption.CREATE_NEW))) {
            var entries=in.entries();
            while(entries.hasMoreElements()) {
                var entry=entries.nextElement();
                byte[] original=in.getInputStream(entry).readAllBytes(), bytes=original;
                if(entry.getName().startsWith("io/vortexcore/") && !entry.getName().startsWith("io/vortexcore/libs/") && entry.getName().endsWith(".class")) {
                    ClassReader reader=new ClassReader(original); ClassWriter writer=new ClassWriter(reader,0);
                    int[] count={0};
                    reader.accept(new ClassVisitor(Opcodes.ASM9,writer) {
                        @Override public MethodVisitor visitMethod(int a,String n,String d,String s,String[] ex) {
                            return new MethodVisitor(Opcodes.ASM9,super.visitMethod(a,n,d,s,ex)) {
                                @Override public void visitFieldInsn(int op,String owner,String name,String descriptor) {
                                    if(owner.equals(OWNER) && !fields.contains(name)) {
                                        List<String> found=new ArrayList<>();
                                        for(String prefix:List.of("GENERIC_","PLAYER_","ZOMBIE_")) if(fields.contains(prefix+name)) found.add(prefix+name);
                                        if(op!=Opcodes.GETSTATIC || found.size()!=1) throw new IllegalArgumentException("No exact 1.21.1 mapping: "+name);
                                        System.out.println(entry.getName()+" "+name+" -> "+found.getFirst());
                                        name=found.getFirst(); count[0]++;
                                    }
                                    super.visitFieldInsn(op,owner,name,descriptor);
                                }
                                @Override public void visitMethodInsn(int op,String owner,String name,String descriptor,boolean itf) {
                                    if(owner.equals(OWNER) && itf) {
                                        if(op==Opcodes.INVOKEINTERFACE)op=Opcodes.INVOKEVIRTUAL;
                                        itf=false;count[0]++;
                                    }
                                    super.visitMethodInsn(op,owner,name,descriptor,itf);
                                }
                            };
                        }
                    },0);
                    if(count[0]>0){bytes=writer.toByteArray();changed++;references+=count[0];}
                }
                ZipEntry target=new ZipEntry(entry.getName());target.setTime(entry.getTime());
                out.putNextEntry(target);out.write(bytes);out.closeEntry();
            }
        }
        if(changed==0)throw new IllegalStateException("Expected Attribute compatibility changes");
        System.out.println("Changed classes="+changed+" references="+references);
    }
}
