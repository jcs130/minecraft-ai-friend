import java.nio.file.*;
import org.objectweb.asm.*;
import org.objectweb.asm.tree.*;

/** Replace only confirmed client-only display-title calls in server FTB paths. */
public final class PatchNumenQuestTitles {
    public static void main(String[] args)throws Exception{
        ClassNode node=new ClassNode();new ClassReader(Files.readAllBytes(Path.of(args[0]))).accept(node,0);
        if(!node.name.equals("com/dwinovo/numen/plugins/ftbquests/QuestWatch")&&!node.name.equals("com/dwinovo/numen/plugins/ftbquests/QuestSubmit"))throw new IllegalArgumentException("unexpected_class");
        int changed=0;
        for(var method:node.methods)for(var instruction:method.instructions)if(instruction instanceof MethodInsnNode call&&call.owner.startsWith("dev/ftb/mods/ftbquests/")&&call.name.equals("getTitle")&&call.desc.equals("()Lnet/minecraft/network/chat/Component;")){
            call.setOpcode(Opcodes.INVOKESTATIC);call.owner="dev/qiandeng/maw/saoforge/FtbServerTitles";call.name="title";
            call.desc="(Ljava/lang/Object;)Lnet/minecraft/network/chat/Component;";call.itf=false;changed++;
        }
        if(changed!=3)throw new IllegalArgumentException("review_changed_numen_title_calls:"+changed);
        ClassWriter output=new ClassWriter(0);node.accept(output);Files.write(Path.of(args[1]),output.toByteArray());System.out.println(node.name+" "+changed);
    }
}
