// SPDX-License-Identifier: AGPL-3.0-only
// One field-reference correction in the pinned, externally obtained LAC JAR.
import java.nio.file.*;
import org.objectweb.asm.*;

public final class PatchSlowFalling {
    public static void main(String[] args)throws Exception{
        ClassReader reader=new ClassReader(Files.readAllBytes(Path.of(args[0])));
        ClassWriter writer=new ClassWriter(reader,0);
        int[] references={0};
        reader.accept(new ClassVisitor(Opcodes.ASM9,writer){
            @Override public MethodVisitor visitMethod(int access,String name,String descriptor,String signature,String[] exceptions){
                MethodVisitor delegate=super.visitMethod(access,name,descriptor,signature,exceptions);
                if(!name.equals("onAsyncMovement"))return delegate;
                return new MethodVisitor(Opcodes.ASM9,delegate){
                    @Override public void visitFieldInsn(int opcode,String owner,String field,String type){
                        if(opcode==Opcodes.GETSTATIC&&owner.equals("org/bukkit/potion/PotionEffectType")&&field.equals("JUMP")){
                            references[0]++;
                            // The first read supplies slowFallingEffectAmplifier;
                            // the second supplies actual jump boost and stays intact.
                            if(references[0]==1)field="SLOW_FALLING";
                        }
                        super.visitFieldInsn(opcode,owner,field,type);
                    }
                };
            }
        },0);
        if(references[0]!=2)throw new IllegalArgumentException("Unexpected FlightA bytecode: "+references[0]);
        Files.write(Path.of(args[1]),writer.toByteArray(),StandardOpenOption.CREATE_NEW);
    }
}
