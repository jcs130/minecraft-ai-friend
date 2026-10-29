import java.nio.file.*;
import jdk.internal.org.objectweb.asm.*;
/** Adds one read-only method to the pinned live class, keeping its existing lifecycle. */
public final class AddViewerSnapshotABI {
    public static void main(String[] args)throws Exception{
        var reader=new ClassReader(Files.readAllBytes(Path.of(args[0])));var writer=new ClassWriter(reader,0);
        boolean[] field={false};
        reader.accept(new ClassVisitor(Opcodes.ASM8,writer){
            @Override public FieldVisitor visitField(int a,String n,String d,String s,Object v){
                if(n.equals("viewerStatePublisher")&&d.equals("Lorg/afuhome/agentfriend/ViewerStatePublisher;"))field[0]=true;
                return super.visitField(a,n,d,s,v);
            }
            @Override public MethodVisitor visitMethod(int a,String n,String d,String s,String[] e){
                if(n.equals("nativeViewerState"))throw new IllegalStateException("ABI already present; review baseline");
                return super.visitMethod(a,n,d,s,e);
            }
            @Override public void visitEnd(){
                if(!field[0])throw new IllegalStateException("viewer publisher field missing");
                var m=super.visitMethod(Opcodes.ACC_PUBLIC,"nativeViewerState","(Lorg/bukkit/entity/Player;)Ljava/lang/String;",null,null);
                m.visitCode();m.visitVarInsn(Opcodes.ALOAD,0);
                m.visitFieldInsn(Opcodes.GETFIELD,"org/afuhome/agentfriend/AgentFriendPlugin","viewerStatePublisher","Lorg/afuhome/agentfriend/ViewerStatePublisher;");
                m.visitVarInsn(Opcodes.ALOAD,1);m.visitMethodInsn(Opcodes.INVOKEVIRTUAL,"org/afuhome/agentfriend/ViewerStatePublisher","snapshot","(Lorg/bukkit/entity/Player;)Ljava/lang/String;",false);
                m.visitInsn(Opcodes.ARETURN);m.visitMaxs(2,2);m.visitEnd();super.visitEnd();
            }
        },0);
        Files.write(Path.of(args[1]),writer.toByteArray());
        if(args.length==4)patchHelp(Path.of(args[2]),Path.of(args[3]));
    }
    private static void patchHelp(Path input,Path output)throws Exception{
        var replacements=java.util.Map.of(
            "在真实建筑首室发起挑战，其他地点可同时开队","在首室发起挑战；原生队伍全员到场后由队长一次登记全队",
            "生存角色亲自到首室，未参加其他活动；10秒集结、每队最多8人","全员在线、生存模式、装备达标且未参加其他活动；最多8人，登记2人以上启用倒地救援");
        var counts=new java.util.HashMap<String,Integer>();var reader=new ClassReader(Files.readAllBytes(input));var writer=new ClassWriter(reader,0);
        reader.accept(new ClassVisitor(Opcodes.ASM8,writer){
            @Override public MethodVisitor visitMethod(int a,String n,String d,String s,String[] e){return new MethodVisitor(Opcodes.ASM8,super.visitMethod(a,n,d,s,e)){
                @Override public void visitLdcInsn(Object value){if(value instanceof String text&&replacements.containsKey(text)){counts.merge(text,1,Integer::sum);value=replacements.get(text);}super.visitLdcInsn(value);}
            };}
        },0);
        for(String key:replacements.keySet())if(counts.getOrDefault(key,0)!=1)throw new IllegalStateException("CLI help baseline changed");
        Files.write(output,writer.toByteArray());
    }
}
