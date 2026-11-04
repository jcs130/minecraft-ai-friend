import java.nio.file.*;
import org.objectweb.asm.*;

public final class YouerChunkCallPatch {
    public static void main(String[] args)throws Exception {
        ClassReader reader=new ClassReader(Files.readAllBytes(Path.of(args[0])));
        ClassWriter writer=new ClassWriter(ClassWriter.COMPUTE_MAXS);int[] changed={0};
        reader.accept(new ClassVisitor(Opcodes.ASM9,writer){
            @Override public MethodVisitor visitMethod(int access,String name,String descriptor,String signature,String[] exceptions){
                MethodVisitor original=super.visitMethod(access,name,descriptor,signature,exceptions);
                if(!name.equals("lambda$snapshotAsync$22"))return original;
                return new MethodVisitor(Opcodes.ASM9,original){
                    @Override public void visitMethodInsn(int opcode,String owner,String method,String desc,boolean isInterface){
                        if(opcode==Opcodes.INVOKEINTERFACE&&owner.equals("org/bukkit/World")&&method.equals("getChunkAtAsync")&&desc.equals("(IIZ)Ljava/util/concurrent/CompletableFuture;")){
                            super.visitVarInsn(Opcodes.ALOAD,0);
                            super.visitFieldInsn(Opcodes.GETFIELD,"com/olencounters/location/LocationFinder$SearchContext","result","Ljava/util/concurrent/CompletableFuture;");
                            super.visitMethodInsn(Opcodes.INVOKESTATIC,"com/olencounters/compat/YouerChunks","load","(Lorg/bukkit/World;IIZLjava/util/concurrent/CompletableFuture;)Ljava/util/concurrent/CompletableFuture;",false);
                            changed[0]++;return;
                        }
                        super.visitMethodInsn(opcode,owner,method,desc,isInterface);
                    }
                };
            }
        },0);
        if(changed[0]!=1)throw new IllegalStateException("expected exactly one pinned asynchronous chunk call");
        Files.write(Path.of(args[1]),writer.toByteArray());System.out.println("Pinned OlEncounters asynchronous call replaced: 1");
    }
}
