import java.nio.file.*;
import org.objectweb.asm.*;

/** Adds only the reviewed persistence boundary to a pinned deployed class. */
public final class DurableConfigPatch {
    public static void main(String[] args)throws Exception {
        ClassReader reader=new ClassReader(Files.readAllBytes(Path.of(args[0])));
        ClassWriter writer=new ClassWriter(ClassWriter.COMPUTE_MAXS);
        String store="org/afuhome/agentfriend/DurableConfigStore",plugin="org/bukkit/plugin/java/JavaPlugin";
        int[] hooks={0,0};
        reader.accept(new ClassVisitor(Opcodes.ASM9,writer){
            @Override public MethodVisitor visitMethod(int access,String name,String desc,String signature,String[] exceptions){
                if((name.equals("saveConfig")||name.equals("reloadConfig"))&&desc.equals("()V"))throw new IllegalStateException("existing persistence override requires review");
                MethodVisitor target=super.visitMethod(access,name,desc,signature,exceptions);
                if(name.equals("onEnable")&&desc.equals("()V"))return new MethodVisitor(Opcodes.ASM9,target){
                    @Override public void visitMethodInsn(int opcode,String owner,String method,String descriptor,boolean itf){
                        super.visitMethodInsn(opcode,owner,method,descriptor,itf);
                        if(method.equals("saveDefaultConfig")&&descriptor.equals("()V")){
                            super.visitVarInsn(Opcodes.ALOAD,0);super.visitMethodInsn(Opcodes.INVOKESTATIC,store,"onEnable","(L"+plugin+";)V",false);hooks[0]++;
                        }
                    }
                };
                if(name.equals("onDisable")&&desc.equals("()V"))return new MethodVisitor(Opcodes.ASM9,target){
                    @Override public void visitInsn(int opcode){
                        if(opcode==Opcodes.RETURN){super.visitVarInsn(Opcodes.ALOAD,0);super.visitMethodInsn(Opcodes.INVOKESTATIC,store,"close","(L"+plugin+";)V",false);hooks[1]++;}
                        super.visitInsn(opcode);
                    }
                };
                return target;
            }
            @Override public void visitEnd(){
                MethodVisitor save=super.visitMethod(Opcodes.ACC_PUBLIC,"saveConfig","()V",null,null);
                save.visitCode();save.visitVarInsn(Opcodes.ALOAD,0);save.visitMethodInsn(Opcodes.INVOKESTATIC,store,"save","(L"+plugin+";)V",false);save.visitInsn(Opcodes.RETURN);save.visitMaxs(0,0);save.visitEnd();
                MethodVisitor reload=super.visitMethod(Opcodes.ACC_PUBLIC,"reloadConfig","()V",null,null);
                reload.visitCode();reload.visitVarInsn(Opcodes.ALOAD,0);reload.visitMethodInsn(Opcodes.INVOKESTATIC,store,"beforeReload","(L"+plugin+";)Ljava/lang/String;",false);reload.visitVarInsn(Opcodes.ASTORE,1);
                reload.visitVarInsn(Opcodes.ALOAD,0);reload.visitMethodInsn(Opcodes.INVOKESPECIAL,plugin,"reloadConfig","()V",false);
                reload.visitVarInsn(Opcodes.ALOAD,0);reload.visitVarInsn(Opcodes.ALOAD,1);reload.visitMethodInsn(Opcodes.INVOKESTATIC,store,"afterReload","(L"+plugin+";Ljava/lang/String;)V",false);reload.visitInsn(Opcodes.RETURN);reload.visitMaxs(0,0);reload.visitEnd();
                super.visitEnd();
            }
        },0);
        if(hooks[0]!=1||hooks[1]!=1)throw new IllegalStateException("exact enable/disable boundaries did not match");
        Files.write(Path.of(args[1]),writer.toByteArray());System.out.println("PERSISTENCE_BOUNDARIES_ADDED enable=1 disable=1 overrides=2");
    }
}
