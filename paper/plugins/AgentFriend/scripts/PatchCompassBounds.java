import java.nio.file.*;
import org.objectweb.asm.*;

/** Fix only the reviewed five-button compass bound; no gameplay or storage changes. */
public final class PatchCompassBounds {
    private static final String OWNER="org/afuhome/agentfriend/NativeRpg";
    public static byte[] patch(byte[] input) {
        ClassReader reader=new ClassReader(input);
        ClassWriter writer=new ClassWriter(reader,0);
        int[] replaced={0};
        reader.accept(new ClassVisitor(Opcodes.ASM9,writer){
            @Override public MethodVisitor visitMethod(int access,String name,String desc,String sig,String[] errors){
                MethodVisitor mv=super.visitMethod(access,name,desc,sig,errors);
                if(!name.equals("fillCompass")||!desc.equals("(Lorg/bukkit/entity/Player;Lorg/bukkit/inventory/Inventory;)V"))return mv;
                return new MethodVisitor(Opcodes.ASM9,mv){
                    boolean sizeExpected;
                    @Override public void visitFieldInsn(int opcode,String owner,String field,String type){
                        if(opcode==Opcodes.GETSTATIC&&owner.equals(OWNER)&&field.equals("COMMON")&&type.equals("Ljava/util/Set;")){
                            if(sizeExpected)throw new IllegalStateException("Unexpected compass bytecode");
                            sizeExpected=true;super.visitInsn(Opcodes.ICONST_5);
                        }else super.visitFieldInsn(opcode,owner,field,type);
                    }
                    @Override public void visitMethodInsn(int opcode,String owner,String method,String type,boolean itf){
                        if(sizeExpected){
                            if(opcode!=Opcodes.INVOKEINTERFACE||!owner.equals("java/util/Set")||!method.equals("size")||!type.equals("()I"))throw new IllegalStateException("Expected reviewed Set.size call");
                            sizeExpected=false;replaced[0]++;
                        }else super.visitMethodInsn(opcode,owner,method,type,itf);
                    }
                    @Override public void visitEnd(){if(sizeExpected)throw new IllegalStateException("Incomplete compass bound");super.visitEnd();}
                };
            }
        },0);
        if(replaced[0]!=1)throw new IllegalStateException("Expected exactly one compass bound; found "+replaced[0]);
        return writer.toByteArray();
    }
    public static void main(String[]args)throws Exception{
        if(args.length!=2)throw new IllegalArgumentException("input.class output.class");
        Path out=Path.of(args[1]);if(Files.exists(out))throw new IllegalArgumentException("New output required");
        Files.write(out,patch(Files.readAllBytes(Path.of(args[0]))));
    }
}
