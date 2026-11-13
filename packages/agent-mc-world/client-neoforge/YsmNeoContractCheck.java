import java.util.zip.ZipFile;import org.objectweb.asm.*;
public final class YsmNeoContractCheck {
 public static void main(String[] args)throws Exception{
  String owner="com/elfmcys/yesstevemodel/Oo0OOO00o00oOOo0O0o000O0",method="oOo0OO0O0o000OO0O000oo0o";
  String draw="(Lnet/minecraft/client/renderer/entity/EntityRenderDispatcher;Lnet/minecraft/client/player/LocalPlayer;FLnet/minecraft/client/gui/GuiGraphics;)V",transform="(Lnet/minecraft/client/gui/GuiGraphics;Lnet/minecraft/client/player/LocalPlayer;FFFFIF)V";
  int[] counts={0,0,0};
  try(var jar=new ZipFile(args[0])){var entry=jar.getEntry(owner+".class");if(entry==null)throw new AssertionError("Original YSM native renderer absent");
   new ClassReader(jar.getInputStream(entry)).accept(new ClassVisitor(Opcodes.ASM9){@Override public MethodVisitor visitMethod(int access,String name,String desc,String sig,String[] exceptions){
    if(!name.equals(method)||!desc.equals(draw)&&!desc.equals(transform))return null;
    return new MethodVisitor(Opcodes.ASM9){@Override public void visitMethodInsn(int op,String o,String n,String d,boolean itf){if(desc.equals(draw)&&o.equals("net/minecraft/client/renderer/entity/EntityRenderDispatcher")&&n.equals("render")&&d.equals("(Lnet/minecraft/world/entity/Entity;DDDFFLcom/mojang/blaze3d/vertex/PoseStack;Lnet/minecraft/client/renderer/MultiBufferSource;I)V"))counts[0]++;}
     @Override public void visitFieldInsn(int op,String o,String n,String d){if(desc.equals(transform)&&op==Opcodes.GETFIELD&&o.equals("net/minecraft/client/player/LocalPlayer")&&d.equals("F")){if(n.equals("yBodyRot"))counts[1]++;if(n.equals("yBodyRotO"))counts[2]++;}}};
   }},ClassReader.SKIP_DEBUG|ClassReader.SKIP_FRAMES);
  }if(counts[0]!=1||counts[1]!=1||counts[2]!=1)throw new AssertionError("Original YSM hook contract mismatch: "+java.util.Arrays.toString(counts));
  System.out.println("Original NeoForge YSM 2.6.5: subject and two yaw hooks verified");
 }
}
