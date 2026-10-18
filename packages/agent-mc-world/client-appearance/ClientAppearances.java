package org.agentmc.appearance;

import com.google.gson.Gson;
import com.elfmcys.yesstevemodel.oOoOOoO0Ooo00O00OO0OOooO;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.HashMap;
import java.util.Map;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;

/** Explicit UUID-scoped local display bindings for installed YSM 2.4.1 clients.
 * No server packets, gameplay input, credentials, broad default-model replacement or assets.
 */
public final class ClientAppearances implements ClientModInitializer {
    private static ClientAppearances instance;
    public static volatile String lastHudTargetUuid;
    public static volatile long hudFrames;
    private record Binding(String uuid, String model, String texture) {}
    private record Config(boolean enabled, String server, String observer, List<Binding> bindings, boolean followCameraInHud) {}
    private Config active;
    private int tick;
    private final Map<String, String> lastApplied = new HashMap<>();
    @Override public void onInitializeClient() {
        instance = this;
        ClientPlayConnectionEvents.JOIN.register((handler, sender, client) -> {
            active = null;
            lastApplied.clear();
            try {
                Path file = FabricLoader.getInstance().getConfigDir().resolve("agentmc-client-appearances.json");
                if (!Files.isRegularFile(file) || client.method_1558() == null) return;
                Config config = new Gson().fromJson(Files.readString(file), Config.class);
                if (config == null || !config.enabled || config.bindings == null
                        || !AppearancePolicy.matches(config.server, client.method_1558().field_3761,
                            config.observer, client.method_1548().method_1676())) return;
                for (Binding binding : config.bindings) {
                    if (binding == null || AppearancePolicy.uuid(binding.uuid) == null
                            || !AppearancePolicy.validAssetId(binding.model) || !AppearancePolicy.validAssetId(binding.texture))
                        throw new IllegalArgumentException("Invalid scoped appearance binding");
                }
                active = config;
                System.out.println("[AgentMCClientAppearances] Loaded " + config.bindings.size() + " explicit local display bindings");
            } catch (Exception error) {
                active = null;
                System.out.println("[AgentMCClientAppearances] Configuration unavailable; no override (" + error.getClass().getSimpleName() + ")");
            }
        });
        ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> { active = null; lastApplied.clear(); });
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            if (++tick % 20 != 0 || active == null || client.field_1687 == null) return;
            for (var player : client.field_1687.method_18456()) {
                String uuid = player.method_5667().toString();
                Binding binding = active.bindings.stream().filter(b -> AppearancePolicy.uuid(b.uuid).equals(uuid)).findFirst().orElse(null);
                if (binding == null || !(player instanceof oOoOOoO0Ooo00O00OO0OOooO ysm)
                        || !com.elfmcys.yesstevemodel.ooo00Oo0OoOo0o000O0oooOo.OOo0OOooo00OoO0oooooOOo0().containsKey(binding.model)) continue;
                // The client render capability is separate from the server's persisted model capability.
                ysm.OO0o0Oo000Oo00OoooO0OoOo().ifPresent(data -> {
                    String beforeModel = data.oOoo00OOo00OoOOo00o00000(), beforeTexture = data.Oo000Oo00OoOOooOOOO000oo();
                    if (!binding.model.equals(beforeModel) || !binding.texture.equals(beforeTexture)) {
                        data.OOo0OOooo00OoO0oooooOOo0(binding.model, binding.texture);
                        String receipt = beforeModel + "/" + beforeTexture + " -> " + data.oOoo00OOo00OoOOo00o00000() + "/" + data.Oo000Oo00OoOOooOOOO000oo();
                        if (!receipt.equals(lastApplied.put(uuid, receipt)))
                            System.out.println("[AgentMCClientAppearances] " + uuid + " local display " + receipt);
                    }
                });
            }
        });
    }

    /** Render the actual camera player's existing pose, equipment and animation capability.
     * Selecting a subject never mutates player state or copies observer flight/teleport flags.
     */
    public static net.minecraft.class_1297 hudTarget(net.minecraft.class_1297 original) {
        var client = net.minecraft.class_310.method_1551();
        if (instance == null || instance.active == null || !instance.active.followCameraInHud
                || !(client.method_1560() instanceof net.minecraft.class_742 target)) return original;
        return target;
    }

    public static net.minecraft.class_1297 recordHudTarget(net.minecraft.class_1297 original) {
        var target = hudTarget(original);
        lastHudTargetUuid = target == null ? null : target.method_5667().toString();
        hudFrames++;
        return target;
    }
}
