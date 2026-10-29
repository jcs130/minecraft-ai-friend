import java.nio.file.*;
import java.util.jar.*;
import org.objectweb.asm.*;

/** 1.21.1 needs the integer API; the upstream method calls a newer component API too. */
public final class VortexItemModel1211 {
    public static void main(String[] args)throws Exception{
        Path input=Path.of(args[0]),output=Path.of(args[1]);if(Files.exists(output))throw new IllegalArgumentException("new output required");
        int[] patched={0};
        try(JarFile jar=new JarFile(input.toFile());JarOutputStream out=new JarOutputStream(Files.newOutputStream(output))){
            for(var it=jar.entries();it.hasMoreElements();){var entry=it.nextElement();byte[] bytes=jar.getInputStream(entry).readAllBytes();
                if(entry.getName().equals("io/vortexcore/item/CustomItemService.class")){
                    var reader=new ClassReader(bytes);var writer=new ClassWriter(reader,0);
                    reader.accept(new ClassVisitor(Opcodes.ASM9,writer){@Override public MethodVisitor visitMethod(int access,String name,String desc,String signature,String[] exceptions){
                        var m=super.visitMethod(access,name,desc,signature,exceptions);
                        if(!name.equals("applyCustomModelData")||!desc.equals("(Lorg/bukkit/inventory/meta/ItemMeta;Ljava/lang/Integer;)V"))return m;
                        patched[0]++;m.visitCode();Label done=new Label();
                        m.visitVarInsn(Opcodes.ALOAD,0);m.visitJumpInsn(Opcodes.IFNULL,done);
                        m.visitVarInsn(Opcodes.ALOAD,1);m.visitJumpInsn(Opcodes.IFNULL,done);
                        m.visitVarInsn(Opcodes.ALOAD,0);m.visitVarInsn(Opcodes.ALOAD,1);
                        m.visitMethodInsn(Opcodes.INVOKEINTERFACE,"org/bukkit/inventory/meta/ItemMeta","setCustomModelData","(Ljava/lang/Integer;)V",true);
                        m.visitLabel(done);m.visitFrame(Opcodes.F_SAME,0,null,0,null);m.visitInsn(Opcodes.RETURN);m.visitMaxs(2,2);m.visitEnd();
                        return null;
                    }},0);bytes=writer.toByteArray();
                }
                out.putNextEntry(new JarEntry(entry.getName()));out.write(bytes);out.closeEntry();
            }
        }
        if(patched[0]!=1)throw new IllegalStateException("Expected exactly one reviewed method, found "+patched[0]);
    }
}
