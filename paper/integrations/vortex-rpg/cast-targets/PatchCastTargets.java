import java.nio.file.*;import java.util.jar.*;import org.objectweb.asm.*;
public final class PatchCastTargets {
    public static void main(String[] args)throws Exception{
        Path input=Path.of(args[0]),output=Path.of(args[1]);if(Files.exists(output))throw new IllegalArgumentException("fresh output required");int[] patched={0};
        try(JarFile jar=new JarFile(input.toFile());JarOutputStream out=new JarOutputStream(Files.newOutputStream(output))){
            for(var it=jar.entries();it.hasMoreElements();){var entry=it.nextElement();byte[] bytes=jar.getInputStream(entry).readAllBytes();
                if(entry.getName().equals("io/vortexcore/rpg/SpellbookService$SimpleCompiledSpell.class")){
                    var reader=new ClassReader(bytes);var writer=new ClassWriter(reader,0);String owner=reader.getClassName();
                    reader.accept(new ClassVisitor(Opcodes.ASM9,writer){@Override public MethodVisitor visitMethod(int access,String name,String descriptor,String sig,String[] exceptions){var m=super.visitMethod(access,name,descriptor,sig,exceptions);if(!name.equals("execute"))return m;
                        return new MethodVisitor(Opcodes.ASM9,m){@Override public void visitMethodInsn(int opcode,String cls,String method,String desc,boolean itf){
                            if(cls.equals("io/vortexcore/magic/SpellContext")&&method.equals("origin")&&desc.equals("()Lorg/bukkit/Location;")){
                                patched[0]++;super.visitVarInsn(Opcodes.ALOAD,0);super.visitFieldInsn(Opcodes.GETFIELD,owner,"targeters","Ljava/util/List;");super.visitMethodInsn(Opcodes.INVOKESTATIC,"io/vortexcore/combat/NativeCastTargets","requireEntityWhenMonsterOnly","(Ljava/util/List;)V",false);
                            }super.visitMethodInsn(opcode,cls,method,desc,itf);
                        }@Override public void visitMaxs(int stack,int locals){super.visitMaxs(Math.max(stack,3),locals);}};
                    }},0);bytes=writer.toByteArray();
                }
                out.putNextEntry(new JarEntry(entry.getName()));out.write(bytes);out.closeEntry();
            }
            out.putNextEntry(new JarEntry("io/vortexcore/combat/NativeCastTargets.class"));out.write(Files.readAllBytes(Path.of(args[2])));out.closeEntry();
        }
        if(patched[0]!=1)throw new IllegalStateException("Expected one reviewed empty-target fallback, found "+patched[0]);
    }
}
