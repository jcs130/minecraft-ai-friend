import org.objectweb.asm.*;

/** Fail closed on missing/duplicate hooks, including 2.6.5's interpolated yaw. */
public final class YsmHudContractCheckSelfTest {
    private static byte[] fixture(String version, int calls, int yaw, int previousYaw) {
        var contract = YsmHudContractCheck.contract(version);
        var writer = new ClassWriter(0);
        writer.visit(Opcodes.V21, Opcodes.ACC_PUBLIC, contract.owner(), null, "java/lang/Object", null);
        var draw = writer.visitMethod(Opcodes.ACC_PUBLIC | Opcodes.ACC_STATIC, contract.method(), contract.draw(), null, null);
        draw.visitCode();
        for (int i=0; i<calls; i++) draw.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "net/minecraft/class_898", "method_3954",
                "(Lnet/minecraft/class_1297;DDDFFLnet/minecraft/class_4587;Lnet/minecraft/class_4597;I)V", false);
        draw.visitInsn(Opcodes.RETURN); draw.visitMaxs(0,0); draw.visitEnd();
        var transform = writer.visitMethod(Opcodes.ACC_PUBLIC | Opcodes.ACC_STATIC, contract.method(), contract.transform(), null, null);
        transform.visitCode();
        for (int i=0; i<yaw; i++) transform.visitFieldInsn(Opcodes.GETFIELD,"net/minecraft/class_746","field_6283","F");
        for (int i=0; i<previousYaw; i++) transform.visitFieldInsn(Opcodes.GETFIELD,"net/minecraft/class_746","field_6220","F");
        transform.visitInsn(Opcodes.RETURN); transform.visitMaxs(0,0); transform.visitEnd(); writer.visitEnd();
        return writer.toByteArray();
    }
    private static void check(String version, int calls, int yaw, int previousYaw, boolean expected) {
        boolean accepted = true;
        try { YsmHudContractCheck.verify(new ClassReader(fixture(version,calls,yaw,previousYaw)),version); }
        catch (AssertionError error) { accepted=false; }
        if (accepted != expected) throw new AssertionError("Unexpected HUD contract result");
    }
    public static void main(String[] args) {
        for (String version : new String[]{"2.4.1","2.6.5"}) {
            int previous=version.equals("2.6.5")?1:0;
            check(version,1,1,previous,true);
            check(version,0,1,previous,false);
            check(version,2,1,previous,false);
            check(version,1,0,previous,false);
            check(version,1,2,previous,false);
        }
        check("2.6.5",1,1,0,false);
        check("2.6.5",1,1,2,false);
        try { YsmHudContractCheck.contract("2.7.0"); throw new AssertionError("Unknown dependency accepted"); }
        catch (IllegalArgumentException expected) {}
        System.out.println("YSM HUD contract validator: 13 checks passed");
    }
}
