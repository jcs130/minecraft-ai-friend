import java.nio.file.*;
import java.util.jar.*;
import org.objectweb.asm.*;

/** Adds narrowly typed accessors, without reflection over optional PAPI fields. */
public final class VortexApiAccess {
    public static void main(String[] args)throws Exception{
        Path input=Path.of(args[0]),output=Path.of(args[1]);if(Files.exists(output))throw new IllegalArgumentException("Output already exists");
        try(JarFile jar=new JarFile(input.toFile());JarOutputStream out=new JarOutputStream(Files.newOutputStream(output))){
            for(var it=jar.entries();it.hasMoreElements();){var entry=it.nextElement();byte[] bytes=jar.getInputStream(entry).readAllBytes();
                if(entry.getName().equals("io/vortexcore/VortexCorePlugin.class")||entry.getName().equals("io/vortexcore/rpg/PlayerProfileService.class")){
                    ClassReader reader=new ClassReader(bytes);ClassWriter writer=new ClassWriter(0);String owner=reader.getClassName();
                    reader.accept(new ClassVisitor(Opcodes.ASM9,writer){@Override public void visitEnd(){
                        if(owner.endsWith("VortexCorePlugin")){
                            accessor("qiandengjiQuests","questService","Lio/vortexcore/quest/QuestService;");
                            accessor("qiandengjiMana","manaManager","Lio/vortexcore/combat/ManaManager;");
                            accessor("qiandengjiItems","customItemService","Lio/vortexcore/item/CustomItemService;");
                            accessor("qiandengjiVault","vaultEconomyBridge","Lio/vortexcore/integration/vault/VaultEconomyBridge;");
                        }else{
                            var m=super.visitMethod(Opcodes.ACC_PUBLIC,"qiandengjiLoading","(Ljava/util/UUID;)Z",null,null);m.visitCode();m.visitVarInsn(Opcodes.ALOAD,0);m.visitFieldInsn(Opcodes.GETFIELD,owner,"loadingPlayers","Ljava/util/Set;");m.visitVarInsn(Opcodes.ALOAD,1);m.visitMethodInsn(Opcodes.INVOKEINTERFACE,"java/util/Set","contains","(Ljava/lang/Object;)Z",true);m.visitInsn(Opcodes.IRETURN);m.visitMaxs(2,2);m.visitEnd();
                            var save=super.visitMethod(Opcodes.ACC_PUBLIC,"qiandengjiSave","(Lorg/bukkit/entity/Player;)Ljava/util/concurrent/CompletableFuture;",null,null);save.visitCode();save.visitVarInsn(Opcodes.ALOAD,0);save.visitVarInsn(Opcodes.ALOAD,1);save.visitMethodInsn(Opcodes.INVOKEINTERFACE,"org/bukkit/entity/Player","getUniqueId","()Ljava/util/UUID;",true);save.visitVarInsn(Opcodes.ALOAD,1);save.visitMethodInsn(Opcodes.INVOKEINTERFACE,"org/bukkit/entity/Player","getName","()Ljava/lang/String;",true);save.visitVarInsn(Opcodes.ALOAD,0);save.visitVarInsn(Opcodes.ALOAD,1);save.visitMethodInsn(Opcodes.INVOKEVIRTUAL,owner,"profile","(Lorg/bukkit/entity/Player;)Lio/vortexcore/player/UnifiedPlayer;",false);save.visitMethodInsn(Opcodes.INVOKESPECIAL,owner,"queueSave","(Ljava/util/UUID;Ljava/lang/String;Lio/vortexcore/player/UnifiedPlayer;)Ljava/util/concurrent/CompletableFuture;",false);save.visitInsn(Opcodes.ARETURN);save.visitMaxs(5,2);save.visitEnd();
                        }super.visitEnd();
                    }
                    private void accessor(String method,String field,String type){var m=super.visitMethod(Opcodes.ACC_PUBLIC,method,"()"+type,null,null);m.visitCode();m.visitVarInsn(Opcodes.ALOAD,0);m.visitFieldInsn(Opcodes.GETFIELD,owner,field,type);m.visitInsn(Opcodes.ARETURN);m.visitMaxs(1,1);m.visitEnd();}
                    },0);bytes=writer.toByteArray();
                }
                out.putNextEntry(new JarEntry(entry.getName()));out.write(bytes);out.closeEntry();
            }
        }
    }
}
