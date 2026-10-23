package org.agentmc.appearance;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.HashMap;
import java.util.Map;
import java.util.LinkedHashMap;
import java.util.ArrayList;
import org.lwjgl.opengl.GL11;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;

/** Explicit UUID-scoped local display bindings for a verified, version-specific YSM adapter.
 * No server packets, gameplay input, credentials, broad default-model replacement or assets.
 */
public final class ClientAppearances implements ClientModInitializer {
    private static ClientAppearances instance;
    public static volatile String lastHudTargetUuid;
    public static volatile long hudFrames;
    private record Binding(String uuid, String model, String texture) {}
    private record Config(boolean enabled, String server, String observer, List<Binding> bindings, boolean followCameraInHud, boolean writeDiagnostics) {}
    record DisplaySelection(String model, String texture) {}
    private Config active;
    private int tick;
    private final Map<String, String> lastApplied = new HashMap<>();
    private boolean diagnosticFailureReported;
    @Override public void onInitializeClient() {
        instance = this;
        ClientPlayConnectionEvents.JOIN.register((handler, sender, client) -> {
            active = null;
            lastApplied.clear();
            diagnosticFailureReported = false;
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
        ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> {
            if (active != null && active.writeDiagnostics) writeDiagnostics(client, false);
            active = null; lastApplied.clear();
        });
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            if (++tick % 20 != 0 || active == null || client.field_1687 == null) return;
            for (var player : client.field_1687.method_18456()) {
                String uuid = player.method_5667().toString();
                Binding binding = active.bindings.stream().filter(b -> AppearancePolicy.uuid(b.uuid).equals(uuid)).findFirst().orElse(null);
                if (binding == null) continue;
                String receipt = YsmAccess.enforce(player, binding.model, binding.texture);
                if (receipt != null && !receipt.equals(lastApplied.put(uuid, receipt)))
                    System.out.println("[AgentMCClientAppearances] " + uuid + " local display " + receipt);
            }
            if (active.writeDiagnostics && tick % 100 == 0) writeDiagnostics(client, true);
        });
    }

    /** Opt-in, local latest-state telemetry; timestamps must be checked by consumers. */
    private void writeDiagnostics(net.minecraft.class_310 client, boolean connected) {
        try {
            Map<String,Object> output = new LinkedHashMap<>();
            output.put("schema", "agent-mc-client-appearance/v1");
            output.put("recordedAt", java.time.Instant.now().toString());
            output.put("connected", connected);
            output.put("fps", client.method_47599());
            output.put("renderer", GL11.glGetString(GL11.GL_RENDERER));
            output.put("openglVersion", GL11.glGetString(GL11.GL_VERSION));
            output.put("catalogueSize", YsmAccess.catalogueSize());
            var camera = client.method_1560();
            output.put("cameraUuid", camera == null ? null : camera.method_5667().toString());
            output.put("hudTargetUuid", lastHudTargetUuid);
            output.put("hudFrames", hudFrames);
            var observed = new ArrayList<Map<String,Object>>();
            if (connected && client.field_1687 != null) for (var player : client.field_1687.method_18456()) {
                String uuid = player.method_5667().toString();
                Binding binding = active.bindings.stream().filter(b -> AppearancePolicy.uuid(b.uuid).equals(uuid)).findFirst().orElse(null);
                if (binding == null) continue;
                Map<String,Object> row = new LinkedHashMap<>();
                row.put("uuid", uuid);
                row.put("requestedModelAvailable", YsmAccess.hasModel(binding.model));
                row.put("selection", YsmAccess.selection(player));
                observed.add(row);
            }
            output.put("bindingsObserved", observed);
            Path target = FabricLoader.getInstance().getGameDir().resolve("diagnostics/agentmc-client-appearances.json");
            Files.createDirectories(target.getParent());
            Files.writeString(target, new GsonBuilder().serializeNulls().create().toJson(output));
        } catch (Exception error) {
            if (!diagnosticFailureReported) System.out.println("[AgentMCClientAppearances] Diagnostics unavailable (" + error.getClass().getSimpleName() + ")");
            diagnosticFailureReported = true;
        }
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
