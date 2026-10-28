/* SPDX-License-Identifier: AGPL-3.0-only */
import org.objectweb.asm.*;import java.nio.file.*;
public final class PatchAttributeSnapshots {
 public static void main(String[] args)throws Exception {
  String target="me/vekster/multiversion/V1_20",helper="me/vekster/lightanticheat/qiandengji/AttributeSnapshots",desc="(Lorg/bukkit/entity/Player;)Ljava/util/Map;";
  ClassWriter writer=new ClassWriter(ClassWriter.COMPUTE_MAXS);int[] changed={0,0};
  new ClassReader(Files.readAllBytes(Path.of(args[0]))).accept(new ClassVisitor(Opcodes.ASM9,writer){
   @Override public MethodVisitor visitMethod(int access,String name,String d,String sig,String[] ex){
    if(name.equals("getAttributes")&&d.equals(desc)){changed[0]++;name="qiandengjiLiveAttributes";}
    MethodVisitor method=super.visitMethod(access,name,d,sig,ex);
    if(name.equals("<init>")&&d.equals("(Lorg/bukkit/plugin/java/JavaPlugin;)V"))return new MethodVisitor(Opcodes.ASM9,method){@Override public void visitInsn(int op){if(op==Opcodes.RETURN){changed[1]++;visitVarInsn(Opcodes.ALOAD,1);visitVarInsn(Opcodes.ALOAD,0);visitMethodInsn(Opcodes.INVOKESTATIC,helper,"attach","(Lorg/bukkit/plugin/java/JavaPlugin;L"+target+";)V",false);}super.visitInsn(op);}};
    return method;
   }
   @Override public void visitEnd(){MethodVisitor m=super.visitMethod(Opcodes.ACC_PUBLIC,"getAttributes",desc,"(Lorg/bukkit/entity/Player;)Ljava/util/Map<Ljava/lang/String;Ljava/lang/Double;>;",null);m.visitCode();m.visitVarInsn(Opcodes.ALOAD,0);m.visitVarInsn(Opcodes.ALOAD,1);m.visitMethodInsn(Opcodes.INVOKESTATIC,helper,"read","(L"+target+";Lorg/bukkit/entity/Player;)Ljava/util/Map;",false);m.visitInsn(Opcodes.ARETURN);m.visitMaxs(2,2);m.visitEnd();super.visitEnd();}
  },0);
  if(changed[0]!=1||changed[1]!=1)throw new IllegalStateException("Pinned LAC attribute method/constructor changed");
  Files.write(Path.of(args[1]),writer.toByteArray());
 }
}
