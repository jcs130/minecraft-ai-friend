import java.nio.file.*;
import org.objectweb.asm.*;

/** Add only the shop button hooks. Preserve all other live main-class methods byte-for-byte semantically. */
public final class PatchShopCompass {
    public static void main(String[] args)throws Exception{
        if(args.length!=2||Files.exists(Path.of(args[1])))throw new IllegalArgumentException("fresh output required");
        ClassReader r=new ClassReader(Files.readAllBytes(Path.of(args[0])));
        ClassWriter w=new ClassWriter(r,ClassWriter.COMPUTE_MAXS);int[] counts={0,0,0,0};
        r.accept(new ClassVisitor(Opcodes.ASM9,w){
            @Override public MethodVisitor visitMethod(int a,String n,String d,String sig,String[] ex){
                MethodVisitor target=super.visitMethod(a,n,d,sig,ex);
                if(n.equals("onTabComplete")&&d.equals("(Lorg/bukkit/command/CommandSender;Lorg/bukkit/command/Command;Ljava/lang/String;[Ljava/lang/String;)Ljava/util/List;")){
                    counts[3]++;return new MethodVisitor(Opcodes.ASM9,target){
                        @Override public void visitCode(){super.visitCode();visitVarInsn(Opcodes.ALOAD,4);
                            visitMethodInsn(Opcodes.INVOKESTATIC,"org/afuhome/agentfriend/EconomyPresentation","complete","([Ljava/lang/String;)Ljava/util/List;",false);
                            visitInsn(Opcodes.DUP);Label pass=new Label();visitJumpInsn(Opcodes.IFNULL,pass);visitInsn(Opcodes.ARETURN);
                            visitLabel(pass);visitFrame(Opcodes.F_SAME1,0,null,1,new Object[]{"java/util/List"});visitInsn(Opcodes.POP);}
                    };
                }
                if(n.equals("fillCompass")&&d.equals("(Lorg/bukkit/entity/Player;Lorg/bukkit/inventory/Inventory;)V")){
                    counts[0]++;return new MethodVisitor(Opcodes.ASM9,target){
                        @Override public void visitCode(){super.visitCode();visitVarInsn(Opcodes.ALOAD,2);
                            visitMethodInsn(Opcodes.INVOKESTATIC,"org/afuhome/agentfriend/EconomyPresentation","decorateCompass","(Lorg/bukkit/inventory/Inventory;)V",false);}
                    };
                }
                if(n.equals("compassClick")&&d.equals("(Lorg/bukkit/entity/Player;IZ)V")){
                    counts[1]++;return new MethodVisitor(Opcodes.ASM9,target){
                        @Override public void visitCode(){super.visitCode();visitVarInsn(Opcodes.ALOAD,1);visitVarInsn(Opcodes.ILOAD,2);
                            visitMethodInsn(Opcodes.INVOKESTATIC,"org/afuhome/agentfriend/EconomyPresentation","compassClick","(Lorg/bukkit/entity/Player;I)Z",false);
                            Label pass=new Label();visitJumpInsn(Opcodes.IFEQ,pass);visitInsn(Opcodes.RETURN);visitLabel(pass);
                            visitFrame(Opcodes.F_SAME,0,null,0,null);}
                    };
                }
                if(n.equals("onMenuClick")&&d.equals("(Lorg/bukkit/event/inventory/InventoryClickEvent;)V")){
                    return new MethodVisitor(Opcodes.ASM9,target){
                        int slot=-1;boolean upperBound;
                        @Override public void visitVarInsn(int opcode,int variable){if(opcode==Opcodes.ILOAD)slot=variable;super.visitVarInsn(opcode,variable);}
                        @Override public void visitIntInsn(int opcode,int operand){
                            if(opcode==Opcodes.BIPUSH&&operand==35)upperBound=true;
                            super.visitIntInsn(opcode,operand);
                        }
                        @Override public void visitJumpInsn(int opcode,Label label){
                            super.visitJumpInsn(opcode,label);
                            if(upperBound){
                                if(opcode!=Opcodes.IF_ICMPGE||slot<0)throw new IllegalStateException("Changed compass separator guard");
                                super.visitVarInsn(Opcodes.ILOAD,slot);super.visitIntInsn(Opcodes.BIPUSH,30);
                                super.visitJumpInsn(Opcodes.IF_ICMPEQ,label);upperBound=false;counts[2]++;
                            }
                        }
                    };
                }
                return target;
            }
        },0);
        if(counts[0]!=1||counts[1]!=1||counts[2]!=1||counts[3]!=1)throw new IllegalStateException("Expected exactly four reviewed UI hooks");
        Files.write(Path.of(args[1]),w.toByteArray());
    }
}
