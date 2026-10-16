import java.io.*;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import java.util.jar.*;
import org.objectweb.asm.*;
import org.objectweb.asm.tree.*;

public final class PatchVillagerLife {
    private static final String SOURCE_SHA256 = "ea9e00f7bb9ab414d51fbd0b1d29a2fec1c383c33bc0d4eef84e5606628e2fa4";
    private static final String HELPER = "qiandengji/villagerlife/Compatibility";
    private static int talk, routine, intent, rename, biome;

    public static void main(String[] args) throws Exception {
        if (args.length != 3) throw new IllegalArgumentException("input.jar output.jar helper-classes");
        Path source = Path.of(args[0]), target = Path.of(args[1]);
        String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(source)));
        if (!hash.equals(SOURCE_SHA256)) throw new IllegalArgumentException("Unreviewed VillagerLife binary: " + hash);
        if (Files.exists(target)) throw new IllegalArgumentException("Output must be new");
        Map<String, byte[]> entries = new TreeMap<>();
        try (JarFile jar = new JarFile(source.toFile())) {
            for (JarEntry entry : Collections.list(jar.entries())) {
                if (entry.isDirectory()) continue;
                byte[] bytes = jar.getInputStream(entry).readAllBytes();
                if (entry.getName().startsWith("de/tecca/villagerlife/") && entry.getName().endsWith(".class"))
                    bytes = patch(bytes);
                entries.put(entry.getName(), bytes);
            }
        }
        if (talk != 1 || routine != 1 || intent != 1 || rename != 1 || biome != 1) throw new IllegalStateException("Expected four pinned methods and one Biome ABI call");
        Path helper = Path.of(args[2]).resolve(HELPER + ".class");
        entries.put(HELPER + ".class", Files.readAllBytes(helper));
        try (JarOutputStream out = new JarOutputStream(Files.newOutputStream(target, StandardOpenOption.CREATE_NEW))) {
            for (var entry : entries.entrySet()) {
                JarEntry je = new JarEntry(entry.getKey()); je.setTime(1767225600000L);
                out.putNextEntry(je); out.write(entry.getValue()); out.closeEntry();
            }
        }
        System.out.println("Pinned VillagerLife compatibility patch: talk=1 routine=1 intent=1 rename=1 biome=1");
    }

    private static byte[] patch(byte[] raw) {
        ClassNode c = new ClassNode(); new ClassReader(raw).accept(c, 0);
        boolean changed = false;
        for (MethodNode m : c.methods) {
            for(AbstractInsnNode instruction:m.instructions.toArray())if(instruction instanceof MethodInsnNode call
                    && call.owner.equals("org/bukkit/block/Biome") && call.name.equals("getKey")
                    && call.desc.equals("()Lorg/bukkit/NamespacedKey;") && call.getOpcode()==Opcodes.INVOKEINTERFACE) {
                // The author's newer Paper API treats Biome as an interface.
                // In the pinned Paper 1.21.1 API it is still an enum class.
                call.setOpcode(Opcodes.INVOKEVIRTUAL);call.itf=false;biome++;changed=true;
            }
            if (c.name.endsWith("/listener/VillagerInteractListener") && m.name.equals("onPlayerInteractEntity")) {
                if (!m.desc.equals("(Lorg/bukkit/event/player/PlayerInteractEntityEvent;)V")) throw new IllegalStateException(m.desc);
                LabelNode proceed = new LabelNode(); InsnList code = new InsnList();
                code.add(new VarInsnNode(Opcodes.ALOAD, 1));
                code.add(new MethodInsnNode(Opcodes.INVOKESTATIC, HELPER, "mayTalk", "(Lorg/bukkit/event/player/PlayerInteractEntityEvent;)Z", false));
                code.add(new JumpInsnNode(Opcodes.IFNE, proceed)); code.add(new InsnNode(Opcodes.RETURN));
                code.add(proceed); code.add(new FrameNode(Opcodes.F_SAME, 0, null, 0, null));
                m.instructions.insert(code); talk++; changed = true;
                if(m.visibleAnnotations!=null)for(var annotation:m.visibleAnnotations)if(annotation.desc.equals("Lorg/bukkit/event/EventHandler;")) {
                    annotation.values=new ArrayList<>(List.of("priority",new String[]{"Lorg/bukkit/event/EventPriority;","HIGHEST"},"ignoreCancelled",true));
                }
            } else if (c.name.endsWith("/routine/RoutineManager") && m.name.equals("findVillager")) {
                if (!m.desc.equals("(Lorg/bukkit/World;Ljava/util/UUID;)Lorg/bukkit/entity/Villager;")) throw new IllegalStateException(m.desc);
                for (AbstractInsnNode instruction : m.instructions.toArray())
                    if (instruction.getOpcode() == Opcodes.ARETURN) m.instructions.insertBefore(instruction,
                        new MethodInsnNode(Opcodes.INVOKESTATIC, HELPER, "roamingVillager", "(Lorg/bukkit/entity/Villager;)Lorg/bukkit/entity/Villager;", false));
                routine++; changed = true;
            } else if (c.name.endsWith("/dialog/IntentParser") && m.name.equals("parse")) {
                if (!m.desc.startsWith("(Ljava/lang/String;)")) throw new IllegalStateException(m.desc);
                InsnList code = new InsnList(); code.add(new VarInsnNode(Opcodes.ALOAD, 1));
                code.add(new MethodInsnNode(Opcodes.INVOKESTATIC, HELPER, "chineseIntent", "(Ljava/lang/String;)Ljava/lang/String;", false));
                code.add(new VarInsnNode(Opcodes.ASTORE, 1)); m.instructions.insert(code); intent++; changed = true;
            } else if (c.name.endsWith("/dialog/DialogManager") && m.name.equals("handleNickname")) {
                if(!m.desc.equals("(Lde/tecca/villagerlife/dialog/IntentParser$ParsedIntent;Lorg/bukkit/entity/Villager;Lorg/bukkit/entity/Player;)V"))throw new IllegalStateException(m.desc);
                m.instructions.clear();m.tryCatchBlocks.clear();if(m.localVariables!=null)m.localVariables.clear();
                m.instructions.add(new VarInsnNode(Opcodes.ALOAD,3));
                m.instructions.add(new MethodInsnNode(Opcodes.INVOKESTATIC,HELPER,"rejectChatRename","(Lorg/bukkit/entity/Player;)V",false));
                m.instructions.add(new InsnNode(Opcodes.RETURN));rename++;changed=true;
            }
        }
        if (!changed) return raw;
        ClassWriter writer = new ClassWriter(ClassWriter.COMPUTE_MAXS); c.accept(writer); return writer.toByteArray();
    }
}
