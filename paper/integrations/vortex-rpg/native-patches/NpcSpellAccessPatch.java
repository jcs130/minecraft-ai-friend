import java.nio.file.Files;
import java.nio.file.Path;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Label;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.*;

/** Exposes a read-only spell handle and shares the native damage formula. */
public final class NpcSpellAccessPatch implements Opcodes {
    private static final String SPELLBOOK = "io/vortexcore/rpg/SpellbookService";
    private static final String ENTRY = SPELLBOOK + "$RegisteredSpell";
    private static final String ACCESS = "io/vortexcore/rpg/NpcSpellAccess";
    private static final String COMPILED = "Lio/vortexcore/magic/CompiledSpell;";
    private static final String SNAPSHOT = "L" + SPELLBOOK + "$EditorSpellSnapshot;";
    private static final String CONTEXT = "Lio/vortexcore/magic/SpellContext;";
    private static final String AMOUNT = "(" + CONTEXT + ")D";

    public static void main(String[] args) throws Exception {
        Path classes = Path.of(args[0]);
        patch(classes, SPELLBOOK, NpcSpellAccessPatch::addLookup);
        patch(classes, SPELLBOOK + "$DamageMechanic", NpcSpellAccessPatch::shareDamage);
        patch(classes, SPELLBOOK + "$ScopedMechanic", NpcSpellAccessPatch::exposeScopeDelegate);
        patch(classes, SPELLBOOK + "$SpellVisuals", type -> type.interfaces.add(ACCESS + "$Visuals"));
    }

    private static void patch(Path classes, String name, java.util.function.Consumer<ClassNode> edit) throws Exception {
        Path path = classes.resolve(name + ".class");
        ClassNode type = new ClassNode();
        new ClassReader(Files.readAllBytes(path)).accept(type, 0);
        edit.accept(type);
        ClassWriter output = new ClassWriter(ClassWriter.COMPUTE_MAXS);
        type.accept(output);
        Files.write(path, output.toByteArray());
    }

    private static void addLookup(ClassNode type) {
        MethodVisitor code = new MethodNode(ACC_PUBLIC, "qiandengjiNpcSpell", "(Ljava/lang/String;)L" + ACCESS + ";", null, null);
        type.methods.add((MethodNode) code);
        code.visitCode();
        readMap(code, "spells");
        code.visitTypeInsn(CHECKCAST, ENTRY);
        code.visitVarInsn(ASTORE, 2);
        code.visitVarInsn(ALOAD, 2);
        Label present = new Label();
        code.visitJumpInsn(IFNONNULL, present);
        code.visitInsn(ACONST_NULL);
        code.visitInsn(ARETURN);
        code.visitLabel(present);
        code.visitFrame(F_APPEND, 1, new Object[]{ENTRY}, 0, null);
        code.visitTypeInsn(NEW, ACCESS);
        code.visitInsn(DUP);
        code.visitVarInsn(ALOAD, 0);
        code.visitVarInsn(ALOAD, 2);
        code.visitMethodInsn(INVOKEVIRTUAL, SPELLBOOK, "editorSnapshot", "(L" + ENTRY + ";)" + SNAPSHOT, false);
        code.visitVarInsn(ALOAD, 2);
        code.visitMethodInsn(INVOKEVIRTUAL, ENTRY, "compiledSpell", "()" + COMPILED, false);
        readMap(code, "spellVisuals");
        code.visitTypeInsn(CHECKCAST, ACCESS + "$Visuals");
        code.visitMethodInsn(INVOKESPECIAL, ACCESS, "<init>", "(" + SNAPSHOT + COMPILED + "L" + ACCESS + "$Visuals;)V", false);
        code.visitInsn(ARETURN);
        code.visitMaxs(0, 0);
        code.visitEnd();
    }

    private static void readMap(MethodVisitor code, String name) {
        code.visitVarInsn(ALOAD, 0);
        code.visitFieldInsn(GETFIELD, SPELLBOOK, name, "Ljava/util/Map;");
        code.visitVarInsn(ALOAD, 1);
        code.visitMethodInsn(INVOKEINTERFACE, "java/util/Map", "get", "(Ljava/lang/Object;)Ljava/lang/Object;", true);
    }

    private static void shareDamage(ClassNode type) {
        type.interfaces.add(ACCESS + "$Damage");
        MethodNode apply = type.methods.stream().filter(method -> method.name.equals("apply")).findFirst().orElseThrow();
        for (var instruction : apply.instructions.toArray()) {
            if (!(instruction instanceof FieldInsnNode field) || !field.name.equals("baseDamage")) continue;
            var receiver = field.getPrevious();
            var scaleReceiver = field.getNext();
            var context = scaleReceiver.getNext();
            var scale = context.getNext();
            var sum = scale.getNext();
            if (!(receiver instanceof VarInsnNode first) || first.getOpcode() != ALOAD || first.var != 0
                    || !(scaleReceiver instanceof VarInsnNode second) || second.getOpcode() != ALOAD || second.var != 0
                    || !(context instanceof VarInsnNode source) || source.getOpcode() != ALOAD || source.var != 1
                    || !(scale instanceof MethodInsnNode call) || !call.name.equals("scalingAmount") || !call.desc.equals(AMOUNT)
                    || sum.getOpcode() != DADD) throw new IllegalStateException("Unexpected native damage calculation");
            MethodNode amount = new MethodNode(ACC_PUBLIC, "amount", AMOUNT, null, null);
            amount.instructions.add(new VarInsnNode(ALOAD, 0));
            amount.instructions.add(field.clone(null));
            amount.instructions.add(new VarInsnNode(ALOAD, 0));
            amount.instructions.add(new VarInsnNode(ALOAD, 1));
            amount.instructions.add(call.clone(null));
            amount.instructions.add(new InsnNode(DADD));
            amount.instructions.add(new InsnNode(DRETURN));
            type.methods.add(amount);
            apply.instructions.insertBefore(receiver, new VarInsnNode(ALOAD, 0));
            apply.instructions.insertBefore(receiver, new VarInsnNode(ALOAD, 1));
            apply.instructions.insertBefore(receiver, new MethodInsnNode(INVOKEVIRTUAL, type.name, "amount", AMOUNT, false));
            for (var old : new AbstractInsnNode[]{receiver, field, scaleReceiver, context, scale, sum}) apply.instructions.remove(old);
            return;
        }
        throw new IllegalStateException("Missing native damage calculation");
    }

    private static void exposeScopeDelegate(ClassNode type) {
        type.interfaces.add(ACCESS + "$Scoped");
        String mechanic = "Lio/vortexcore/magic/SpellMechanic;";
        MethodNode accessor = new MethodNode(ACC_PUBLIC, "delegate", "()" + mechanic, null, null);
        accessor.visitCode();
        accessor.visitVarInsn(ALOAD, 0);
        accessor.visitFieldInsn(GETFIELD, type.name, "delegate", mechanic);
        accessor.visitInsn(ARETURN);
        accessor.visitMaxs(0, 0);
        accessor.visitEnd();
        type.methods.add(accessor);
    }
}
