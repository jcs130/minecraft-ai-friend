import java.nio.file.*;
import org.objectweb.asm.*;
/** Exactly two old level accessors now consult the selected native authority. */
public final class PatchUnifiedRpg {
    public static void main(String[]args)throws Exception{
        byte[] input=Files.readAllBytes(Path.of(args[0]));ClassReader reader=new ClassReader(input);
        ClassWriter writer=new ClassWriter(ClassWriter.COMPUTE_MAXS);int[] changed={0};
        reader.accept(new ClassVisitor(Opcodes.ASM9,writer){
            @Override public MethodVisitor visitMethod(int access,String name,String desc,String sig,String[] errors){
                MethodVisitor mv=super.visitMethod(access,name,desc,sig,errors);
                if(!(name.equals("miningLevel")&&desc.equals("(Lorg/bukkit/entity/Player;)I")||name.equals("auraLevel")&&desc.equals("(Lorg/bukkit/entity/Player;Ldev/aurelium/auraskills/api/skill/Skills;)I")))return mv;
                changed[0]++;
                return new MethodVisitor(Opcodes.ASM9,mv){@Override public void visitCode(){
                    super.visitCode();String owner="org/afuhome/agentfriend/AgentFriendPlugin",type="org/afuhome/agentfriend/NativeRpg";
                    Label legacy=new Label();super.visitVarInsn(Opcodes.ALOAD,0);super.visitFieldInsn(Opcodes.GETFIELD,owner,"nativeRpg","L"+type+";");
                    super.visitMethodInsn(Opcodes.INVOKEVIRTUAL,type,"selected","()Z",false);super.visitJumpInsn(Opcodes.IFEQ,legacy);
                    super.visitVarInsn(Opcodes.ALOAD,0);super.visitFieldInsn(Opcodes.GETFIELD,owner,"nativeRpg","L"+type+";");super.visitVarInsn(Opcodes.ALOAD,1);
                    super.visitMethodInsn(Opcodes.INVOKEVIRTUAL,type,"level","(Lorg/bukkit/entity/Player;)I",false);super.visitInsn(Opcodes.IRETURN);
                    super.visitLabel(legacy);super.visitFrame(Opcodes.F_SAME,0,null,0,null);
                }};
            }
        },0);
        if(changed[0]!=2)throw new IllegalStateException("Expected two exact level accessors, found "+changed[0]);
        Files.write(Path.of(args[1]),writer.toByteArray());
    }
}
