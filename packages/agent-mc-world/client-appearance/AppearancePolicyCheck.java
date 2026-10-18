import org.agentmc.appearance.AppearancePolicy;
public final class AppearancePolicyCheck {
    private static int checks;
    private static void check(boolean value) { checks++; if (!value) throw new AssertionError("appearance policy #" + checks); }
    public static void main(String[] args) {
        check(AppearancePolicy.matches("example.test:25565", "example.test:25565", "camera", "CAMERA"));
        check(!AppearancePolicy.matches("example.test:25565", "another.test:25565", "camera", "camera"));
        check(!AppearancePolicy.matches("example.test:25565", "example.test:25565", "camera", "player"));
        check(!AppearancePolicy.matches("", "", "camera", "camera"));
        check(!AppearancePolicy.matches(null, null, null, null));
        check(AppearancePolicy.uuid("12345678-1234-1234-1234-1234567890AB").equals("12345678-1234-1234-1234-1234567890ab"));
        check(AppearancePolicy.uuid("1-1-1-1-1") == null);
        check(AppearancePolicy.uuid("other-player") == null);
        check(AppearancePolicy.validAssetId("custom-model"));
        check(AppearancePolicy.validAssetId("custom-texture.png"));
        check(AppearancePolicy.validAssetId("自定义模型"));
        check(AppearancePolicy.validAssetId("namespace:model/texture"));
        check(!AppearancePolicy.validAssetId("bad\nmodel"));
        check(!AppearancePolicy.validAssetId(null));
        System.out.println("Appearance policy: " + checks + " checks passed");
    }
}
