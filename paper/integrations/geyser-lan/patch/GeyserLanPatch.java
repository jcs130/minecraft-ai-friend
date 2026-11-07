import java.nio.file.*;
import java.util.*;
import java.io.*;
import org.objectweb.asm.*;
import org.objectweb.asm.tree.*;
import org.objectweb.asm.util.*;

/** Three call-site changes only; exact class hashes are checked by build.py. */
public final class GeyserLanPatch {
    private static final String SUPPORT="org/qiandengji/geyserlan/LanDiscoverySupport";
    private static String trace(MethodNode m){var t=new Textifier();m.accept(new TraceMethodVisitor(t));var w=new StringWriter();t.print(new PrintWriter(w));return w.toString();}
    public static void main(String[] args)throws Exception {
        var reader=new ClassReader(Files.readAllBytes(Path.of(args[0])));var node=new ClassNode();reader.accept(node,0);
        var originals=new HashMap<String,String>();for(var m:node.methods)originals.put(m.name+m.desc,trace(m));
        Set<String> changed=new HashSet<>();
        if(node.name.equals("org/geysermc/geyser/network/bedrock/nethernet/NetherNetServer")) {
            for(var m:node.methods){
                if(m.name.equals("start")&&m.desc.equals("()V")){
                    var returns=new ArrayList<AbstractInsnNode>();for(var i:m.instructions)if(i.getOpcode()==Opcodes.RETURN)returns.add(i);
                    if(returns.size()!=4)throw new IllegalStateException("Changed upstream start");
                    m.instructions.insertBefore(returns.getLast(),call(node.name,"start"));changed.add(m.name+m.desc);
                }
                if(m.name.equals("shutdown")&&m.desc.equals("()V")){
                    var matches=new ArrayList<AbstractInsnNode>();for(var i:m.instructions)if(i instanceof MethodInsnNode c&&c.owner.equals(node.name)&&c.name.equals("closeInbuiltResources"))matches.add(i);
                    if(matches.size()!=1)throw new IllegalStateException("Changed upstream shutdown");
                    m.instructions.insertBefore(matches.getFirst(),call(node.name,"stop"));changed.add(m.name+m.desc);
                }
            }
            if(changed.size()!=2)throw new IllegalStateException("Missing lifecycle hooks");
        } else if(node.name.equals("org/geysermc/geyser/util/LoginEncryptionUtils")) {
            var m=node.methods.stream().filter(x->x.name.equals("encryptConnectionWithCert")).findFirst().orElseThrow();
            int result=local(m,"result","Lorg/cloudburstmc/protocol/bedrock/util/ChainValidationResult;"),payload=local(m,"clientDataPayload","[B");
            int count=0;
            for(var i:m.instructions.toArray())if(i instanceof MethodInsnNode c&&c.owner.equals("org/cloudburstmc/netty/util/nethernet/TransportIdentityBinding")&&c.name.equals("mismatch")){
                if(!c.desc.equals("(Lio/netty/channel/Channel;Ljava/security/PublicKey;)Ljava/lang/String;"))throw new IllegalStateException("Unexpected binding signature");
                var list=new InsnList();list.add(new VarInsnNode(Opcodes.ALOAD,0));list.add(new VarInsnNode(Opcodes.ALOAD,result));list.add(new MethodInsnNode(Opcodes.INVOKEVIRTUAL,"org/cloudburstmc/protocol/bedrock/util/ChainValidationResult","signed","()Z",false));list.add(new VarInsnNode(Opcodes.ALOAD,payload));
                m.instructions.insertBefore(c,list);c.owner=SUPPORT;c.desc="(Lio/netty/channel/Channel;Ljava/security/PublicKey;Lorg/geysermc/geyser/session/GeyserSession;Z[B)Ljava/lang/String;";count++;
            }
            if(count!=1)throw new IllegalStateException("Expected one binding call");changed.add(m.name+m.desc);
        } else throw new IllegalArgumentException("Unexpected class");
        var writer=new ClassWriter(reader,ClassWriter.COMPUTE_MAXS);node.accept(writer);byte[] output=writer.toByteArray();var after=new ClassNode();new ClassReader(output).accept(after,0);
        int kept=0;for(var m:after.methods)if(!changed.contains(m.name+m.desc)){if(!originals.get(m.name+m.desc).equals(trace(m)))throw new IllegalStateException("Unrelated method changed");kept++;}
        Files.write(Path.of(args[1]),output);System.out.println("{\"changedMethods\":"+changed.size()+",\"otherMethodsPreserved\":"+kept+"}");
    }
    private static int local(MethodNode m,String name,String desc){return m.localVariables.stream().filter(v->v.name.equals(name)&&v.desc.equals(desc)).findFirst().orElseThrow().index;}
    private static InsnList call(String owner,String name){var l=new InsnList();l.add(new VarInsnNode(Opcodes.ALOAD,0));l.add(new FieldInsnNode(Opcodes.GETFIELD,owner,"geyser","Lorg/geysermc/geyser/GeyserImpl;"));l.add(new MethodInsnNode(Opcodes.INVOKESTATIC,SUPPORT,name,"(Lorg/geysermc/geyser/GeyserImpl;)V",false));return l;}
}
