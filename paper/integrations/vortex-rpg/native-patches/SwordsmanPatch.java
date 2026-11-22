import java.nio.file.Files;
import java.nio.file.Path;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.*;

public final class SwordsmanPatch implements Opcodes {
    private static final String PREFIX = "io/vortexcore/rpg/";
    private static final String CLASS = PREFIX + "VortexClass";
    private static final String SERVICE = PREFIX + "ClassSkillService";
    private static final String SKILLS = PREFIX + "SwordsmanSkills";
    private static final String PROFILE = "Lio/vortexcore/player/UnifiedPlayer;";
    private static final String PLAYER = "Lorg/bukkit/entity/Player;";
    private static final String FUTURE = "Ljava/util/concurrent/CompletableFuture;";
    private static final String ENUM = "L" + CLASS + ";";

    public static void main(String[] args) throws Exception {
        Path root = Path.of(args[0]);
        addClass(root);
        if (args.length == 2 && args[1].equals("enum-only")) return;
        addSkills(root);
        addCooldownAccess(root);
    }

    private static ClassNode read(Path root, String owner) throws Exception {
        var node = new ClassNode();
        new ClassReader(Files.readAllBytes(root.resolve(owner + ".class"))).accept(node, 0);
        return node;
    }

    private static void write(Path root, ClassNode node) throws Exception {
        var writer = new ClassWriter(ClassWriter.COMPUTE_MAXS);
        node.accept(writer);
        Files.write(root.resolve(node.name + ".class"), writer.toByteArray());
    }

    private static MethodNode method(ClassNode type, String name, String descriptor) {
        return type.methods.stream().filter(m -> m.name.equals(name) && m.desc.equals(descriptor)).findFirst()
                .orElseThrow(() -> new IllegalStateException(type.name + "." + name + descriptor));
    }

    private static void addClass(Path root) throws Exception {
        var type = read(root, CLASS);
        if (type.fields.stream().filter(f -> (f.access & ACC_ENUM) != 0).count() != 6)
            throw new IllegalStateException("expected the original six Vortex archetypes");
        var array = method(type, "$values", "()[" + ENUM);
        var init = method(type, "<clinit>", "()V");
        var populate = java.util.Arrays.stream(init.instructions.toArray()).filter(i ->
                i instanceof MethodInsnNode call && call.owner.equals(CLASS) && call.name.equals(array.name))
                .findFirst().orElseThrow();

        // Preserve the original enum constant values, localized strings, and ordinals.
        type.fields.add(new FieldNode(ACC_PUBLIC | ACC_STATIC | ACC_FINAL | ACC_ENUM, "SWORDSMAN", ENUM, null, null));
        var create = new InsnList();
        create.add(new TypeInsnNode(NEW, CLASS));
        create.add(new InsnNode(DUP));
        create.add(new LdcInsnNode("SWORDSMAN"));
        create.add(new IntInsnNode(BIPUSH, 6));
        create.add(new LdcInsnNode("剑士"));
        create.add(new LdcInsnNode("敏捷优先的近战剑术，可学习二刀流专精。"));
        create.add(new FieldInsnNode(GETSTATIC, "org/bukkit/Material", "IRON_SWORD", "Lorg/bukkit/Material;"));
        create.add(new LdcInsnNode("sword_step"));
        for (double stat : new double[]{5, 4, 2, 8, 2, 2}) create.add(new LdcInsnNode(stat));
        create.add(new MethodInsnNode(INVOKESTATIC, CLASS, "stats", "(DDDDDD)Ljava/util/Map;", false));
        create.add(new MethodInsnNode(INVOKESPECIAL, CLASS, "<init>",
                "(Ljava/lang/String;ILjava/lang/String;Ljava/lang/String;Lorg/bukkit/Material;Ljava/lang/String;Ljava/util/Map;)V", false));
        create.add(new FieldInsnNode(PUTSTATIC, CLASS, "SWORDSMAN", ENUM));
        init.instructions.insertBefore(populate, create);

        array.instructions.clear();
        array.localVariables = null;
        array.instructions.add(new IntInsnNode(BIPUSH, 7));
        array.instructions.add(new TypeInsnNode(ANEWARRAY, CLASS));
        var constants = type.fields.stream().filter(f -> (f.access & ACC_ENUM) != 0).toList();
        for (int i = 0; i < constants.size(); i++) {
            array.instructions.add(new InsnNode(DUP));
            array.instructions.add(new IntInsnNode(BIPUSH, i));
            array.instructions.add(new FieldInsnNode(GETSTATIC, CLASS, constants.get(i).name, ENUM));
            array.instructions.add(new InsnNode(AASTORE));
        }
        array.instructions.add(new InsnNode(ARETURN));
        write(root, type);
    }

    private static void addSkills(Path root) throws Exception {
        var service = read(root, SERVICE);
        var register = method(service, "registerDefaults", "()V");
        var returns = java.util.Arrays.stream(register.instructions.toArray()).filter(i -> i.getOpcode() == RETURN).toList();
        if (returns.size() != 1) throw new IllegalStateException("unexpected skill registry");
        var additions = new InsnList();
        String definition = "L" + PREFIX + "VortexSkillDefinition;";
        for (String name : new String[]{"horizontal", "dualBlades", "starburst"}) {
            additions.add(new VarInsnNode(ALOAD, 0));
            additions.add(new MethodInsnNode(INVOKESTATIC, SKILLS, name, "()" + definition, false));
            additions.add(new MethodInsnNode(INVOKEVIRTUAL, SERVICE, "register", "(" + definition + ")V", false));
        }
        register.instructions.insertBefore(returns.getFirst(), additions);
        String operation = "(" + PLAYER + PROFILE + "Ljava/lang/String;)" + FUTURE;
        guardUnlock(service);
        for (String operationName : new String[]{"chooseClass", "forceSetClass", "playerRequestClassSwap"}) {
            addRefusal(method(service, operationName, operation), SERVICE, "classRefusal", PLAYER, 1);
        }
        // These exhaustive upstream switches only choose presentation. The new class gets its own fallback icon.
        returnForSword(method(service, "playClassSelectionCelebration", "(" + PLAYER + ENUM + ")V"), 2, RETURN);
        returnForSword(method(service, "classIconId", "(" + ENUM + ")Ljava/lang/String;"), 1, ARETURN);
        write(root, service);
        var menu = read(root, "io/vortexcore/ui/ProfileMenuService");
        returnForSword(method(menu, "classIconId", "(" + ENUM + ")Ljava/lang/String;"), 1, ARETURN);
        write(root, menu);
    }

    private static void guardUnlock(ClassNode service) {
        String descriptor = "(Ljava/lang/String;" + FUTURE + PROFILE + PLAYER + ")V";
        var unlock = service.methods.stream().filter(m -> m.name.startsWith("lambda$unlockSkill$") && m.desc.equals(descriptor))
                .findFirst().orElseThrow();
        var proceed = new LabelNode();
        var head = new InsnList();
        head.add(new VarInsnNode(ALOAD, 0));
        head.add(new VarInsnNode(ALOAD, 3));
        head.add(new VarInsnNode(ALOAD, 1));
        head.add(new VarInsnNode(ALOAD, 2));
        head.add(new MethodInsnNode(INVOKESTATIC, SKILLS, "refuseLearning",
                "(L" + SERVICE + ";" + PROFILE + "Ljava/lang/String;" + FUTURE + ")Z", false));
        head.add(new JumpInsnNode(IFEQ, proceed));
        head.add(new InsnNode(RETURN));
        head.add(proceed);
        head.add(new FrameNode(F_SAME, 0, null, 0, null));
        head.add(new InsnNode(NOP));
        unlock.instructions.insert(head);
    }

    private static void addRefusal(MethodNode method, String owner, String gate, String inputType, int input) {
        var proceed = new LabelNode();
        var head = new InsnList();
        head.add(new VarInsnNode(ALOAD, 0));
        head.add(new VarInsnNode(ALOAD, input));
        head.add(new VarInsnNode(ALOAD, 3));
        head.add(new MethodInsnNode(INVOKESTATIC, SKILLS, gate,
                "(L" + owner + ";" + inputType + "Ljava/lang/String;)" + FUTURE, false));
        head.add(new InsnNode(DUP));
        head.add(new JumpInsnNode(IFNULL, proceed));
        head.add(new InsnNode(ARETURN));
        head.add(proceed);
        head.add(new FrameNode(F_SAME1, 0, null, 1, new Object[]{"java/util/concurrent/CompletableFuture"}));
        head.add(new InsnNode(POP));
        method.instructions.insert(head);
    }

    private static void returnForSword(MethodNode method, int local, int returnOpcode) {
        var proceed = new LabelNode();
        var head = new InsnList();
        head.add(new VarInsnNode(ALOAD, local));
        head.add(new FieldInsnNode(GETSTATIC, CLASS, "SWORDSMAN", ENUM));
        head.add(new JumpInsnNode(IF_ACMPNE, proceed));
        if (returnOpcode == ARETURN) head.add(new InsnNode(ACONST_NULL));
        head.add(new InsnNode(returnOpcode));
        head.add(proceed);
        head.add(new FrameNode(F_SAME, 0, null, 0, null));
        head.add(new InsnNode(NOP));
        method.instructions.insert(head);
    }

    private static void addCooldownAccess(Path root) throws Exception {
        var book = read(root, PREFIX + "SpellbookService");
        if (book.fields.stream().noneMatch(f -> f.name.equals("cooldowns") && f.desc.equals("Ljava/util/Map;")))
            throw new IllegalStateException("native cooldown map missing");
        var access = new MethodNode(ACC_PUBLIC, "qiandengjiSetSwordDeadline", "(Ljava/util/UUID;Ljava/lang/String;J)V", null, null);
        access.instructions.add(new VarInsnNode(ALOAD, 0));
        access.instructions.add(new FieldInsnNode(GETFIELD, book.name, "cooldowns", "Ljava/util/Map;"));
        access.instructions.add(new VarInsnNode(ALOAD, 1));
        access.instructions.add(new VarInsnNode(ALOAD, 2));
        access.instructions.add(new VarInsnNode(LLOAD, 3));
        access.instructions.add(new MethodInsnNode(INVOKESTATIC, SKILLS, "setDeadline",
                "(Ljava/util/Map;Ljava/util/UUID;Ljava/lang/String;J)V", false));
        access.instructions.add(new InsnNode(RETURN));
        book.methods.add(access);
        addRefusal(method(book, "cast", "(" + PLAYER + PROFILE + "Ljava/lang/String;)" + FUTURE),
                book.name, "castRefusal", PROFILE, 2);
        write(root, book);
    }
}
