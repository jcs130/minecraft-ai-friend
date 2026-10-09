package dev.qiandeng.bedrock;

import java.awt.image.BufferedImage;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.zip.ZipFile;
import javax.imageio.ImageIO;
import org.geysermc.event.subscribe.Subscribe;
import org.geysermc.geyser.api.connection.GeyserConnection;
import org.geysermc.geyser.api.entity.custom.CustomEntityDefinition;
import org.geysermc.geyser.api.entity.data.GeyserEntityDataTypes;
import org.geysermc.geyser.api.event.bedrock.*;
import org.geysermc.geyser.api.event.java.ServerSpawnEntityEvent;
import org.geysermc.geyser.api.event.lifecycle.GeyserDefineEntitiesEvent;
import org.geysermc.geyser.api.event.lifecycle.GeyserDefineResourcePacksEvent;
import org.geysermc.geyser.api.extension.Extension;
import org.geysermc.geyser.api.skin.*;
import org.geysermc.geyser.api.util.Identifier;
import org.geysermc.geyser.session.GeyserSession;
import org.geysermc.mcprotocollib.network.Session;
import org.geysermc.mcprotocollib.network.event.session.SessionAdapter;
import org.geysermc.mcprotocollib.network.packet.Packet;
import org.geysermc.mcprotocollib.protocol.packet.common.clientbound.ClientboundCustomPayloadPacket;
import org.geysermc.mcprotocollib.protocol.packet.common.serverbound.ServerboundCustomPayloadPacket;
import org.geysermc.geyser.platform.viaproxy.shaded.net.kyori.adventure.key.Key;
import org.geysermc.mcprotocollib.protocol.packet.ingame.clientbound.entity.ClientboundRemoveEntitiesPacket;
import org.jose4j.json.internal.json_simple.parser.JSONParser;

/** Pinned to the hash-locked Geyser 2.11.3 ViaProxy distribution.
 * The public Entity/Skin APIs supply presentation. A passive downstream listener
 * observes only this connection's clientbound payloads; it sends no game action.
 */
public final class MawModelsExtension implements Extension {
    private record Model(CustomEntityDefinition definition, float scale, SkinData skin) {}
    private record Binding(UUID uuid, String identifier) {}
    private static final class State {
        final Map<Integer, Binding> bindings = new ConcurrentHashMap<>();
        final Map<UUID, SkinData> originalSkins = new ConcurrentHashMap<>();
        String selectedSkin = "";
    }
    private final Map<String, Model> definitions = new HashMap<>();
    private final Map<String, Model> skins = new HashMap<>();
    private final Map<GeyserConnection, State> states = Collections.synchronizedMap(new WeakHashMap<>());
    private static final Identifier ARMOR_STAND = Identifier.of("minecraft:armor_stand");

    @Subscribe
    public void packs(GeyserDefineResourcePacksEvent event) {
        try {
            var catalog = json(Files.readAllBytes(dataFolder().getParent().getParent().resolve("modpack-catalog.json")));
            var actual = new HashSet<UUID>();
            for (var pack : event.resourcePacks()) actual.add(pack.uuid());
            int expected = 0;
            for (Object raw : (List<?>)catalog.get("packs")) {
                if (!actual.contains(UUID.fromString(text(object(raw), "uuid")))) throw new IllegalStateException("Native pack missing from download stack");
                expected++;
            }
            logger().info("MAW_MODELS packsLoaded="+expected);
        } catch (Exception error) { throw new IllegalStateException("Native model resource pack stack rejected", error); }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> object(Object value) {
        if (!(value instanceof Map<?, ?>)) throw new IllegalArgumentException("Expected JSON object");
        return (Map<String, Object>) value;
    }
    private static String text(Map<String, Object> value, String key) {
        if (!(value.get(key) instanceof String result) || result.length() > 2048)
            throw new IllegalArgumentException("Invalid field: " + key);
        return result;
    }
    private static Map<String, Object> json(byte[] bytes) throws Exception {
        return object(new JSONParser().parse(new String(bytes, StandardCharsets.UTF_8)));
    }
    private static byte[] read(ZipFile zip, String path) throws Exception {
        if (path.startsWith("/") || path.contains("..") || path.contains("\\")) throw new IllegalArgumentException("Unsafe pack path");
        var entry = zip.getEntry(path);
        if (entry == null || entry.getSize() > 8 * 1024 * 1024) throw new IllegalArgumentException("Invalid pack entry");
        try (var stream = zip.getInputStream(entry)) { return stream.readAllBytes(); }
    }

    @Subscribe
    public void define(GeyserDefineEntitiesEvent event) {
        if (!definitions.isEmpty()) throw new IllegalStateException("Duplicate model registration");
        Path root = dataFolder().getParent().getParent();
        try {
            var catalog = json(Files.readAllBytes(root.resolve("modpack-catalog.json")));
            if (!Long.valueOf(1).equals(catalog.get("schemaVersion"))) throw new IllegalArgumentException("Invalid catalog schema");
            for (Object raw : (List<?>) catalog.get("models")) {
                var row = object(raw); String identifier = text(row, "bedrockIdentifier");
                var definition = CustomEntityDefinition.of(identifier);
                SkinData skin = null;
                if (text(row, "kind").equals("ysm") && Boolean.TRUE.equals(row.get("playerSkinEligible"))) {
                    String pack = text(row, "pack");
                    if (!pack.matches("maw-[a-z]+-models\\.mcpack")) throw new IllegalArgumentException("Invalid pack name");
                    try (var zip = new ZipFile(root.resolve("packs").resolve(pack).toFile())) {
                        byte[] texture = read(zip, text(row, "texture"));
                        BufferedImage image = ImageIO.read(new java.io.ByteArrayInputStream(texture));
                        if (image == null || image.getWidth() > 2048 || image.getHeight() > 2048) throw new IllegalArgumentException("Invalid skin PNG");
                        byte[] rgba = new byte[image.getWidth() * image.getHeight() * 4];
                        for (int y = 0, at = 0; y < image.getHeight(); y++) for (int x = 0; x < image.getWidth(); x++) {
                            int argb = image.getRGB(x, y);
                            rgba[at++] = (byte)(argb >> 16); rgba[at++] = (byte)(argb >> 8);
                            rgba[at++] = (byte)argb; rgba[at++] = (byte)(argb >> 24);
                        }
                        String name = "{\"geometry\":{\"default\":\""+text(row, "geometryIdentifier")+"\"}}";
                        skin = new SkinData(new Skin(identifier, rgba), new Cape("", "no-cape", new byte[0]),
                            new SkinGeometry(name, new String(read(zip, text(row, "geometry")), StandardCharsets.UTF_8)));
                    }
                }
                float scale = ((Number) row.get("scale")).floatValue();
                if (!Float.isFinite(scale) || scale <= 0 || scale > 8) throw new IllegalArgumentException("Invalid native scale");
                var model = new Model(definition, scale, skin);
                if (definitions.put(identifier, model) != null) throw new IllegalArgumentException("Duplicate native entity ID");
                if (skin != null) skins.put(text(row, "modelId")+"\n"+text(row, "textureId"), model);
                event.register(definition);
            }
            logger().info("MAW_MODELS registered="+definitions.size()+" ysmSkins="+skins.size());
        } catch (Exception error) { throw new IllegalStateException("Native Bedrock model resources rejected", error); }
    }

    @Subscribe
    public void join(SessionJoinEvent event) {
        if (!(event.connection() instanceof GeyserSession session) || session.getDownstream() == null)
            throw new IllegalStateException("Pinned Geyser downstream unavailable");
        State state = states.computeIfAbsent(event.connection(), ignored -> new State());
        session.getDownstream().getSession().addListener(new SessionAdapter() {
            @Override public void packetReceived(Session downstream, Packet packet) {
                try {
                    if (packet instanceof ClientboundRemoveEntitiesPacket removed) {
                        for (int id : removed.getEntityIds()) state.bindings.remove(id);
                    } else if (packet instanceof ClientboundCustomPayloadPacket payload && payload.getData().length <= 65536) {
                        String channel = payload.getChannel().asString();
                        if (channel.equals("mawbedrock:entity")) {
                            var body = json(payload.getData());
                            if (!Long.valueOf(1).equals(body.get("schemaVersion"))) return;
                            int id = ((Number)body.get("entityId")).intValue();
                            String identifier = text(body, "identifier");
                            if (!definitions.containsKey(identifier) || state.bindings.size() >= 4096) return;
                            state.bindings.put(id, new Binding(UUID.fromString(text(body, "uuid")), identifier));
                        } else if (channel.equals("maw_agent:menu_state")) {
                            var body = json(payload.getData());
                            if (!Long.valueOf(1).equals(body.get("schemaVersion")) || !(body.get("self") instanceof Map<?, ?>)) return;
                            var self = object(body.get("self"));
                            UUID uuid = UUID.fromString(text(self, "playerUuid"));
                            if (!uuid.equals(session.playerEntity().uuid()) || !(self.get("ysm") instanceof Map<?, ?>)) return;
                            var ysm = object(self.get("ysm"));
                            if (!uuid.toString().equals(ysm.get("playerUuid")) || !Boolean.TRUE.equals(ysm.get("available"))) return;
                            if (Boolean.TRUE.equals(ysm.get("enabled")) &&
                                !("2.6.5".equals(ysm.get("ysmVersion")) &&
                                  "b285c73d4ec010d9a9be3c53c1bee890cf269645be5f1bcf1c27a2e8e82807cb".equals(ysm.get("jarSha256")))) return;
                            String key = Boolean.TRUE.equals(ysm.get("enabled")) ? text(ysm,"modelId")+"\n"+text(ysm,"texture") : "";
                            Model model = skins.get(key);
                            SkinData desired = model == null ? state.originalSkins.get(uuid) : model.skin();
                            if (desired == null || key.equals(state.selectedSkin)) return;
                            state.selectedSkin = key;
                            session.executeInEventLoop(() -> session.sendSkin(uuid, desired));
                        }
                    }
                } catch (Exception error) { logger().warning("Native model payload rejected: "+error.getClass().getSimpleName()); }
            }
        });
        // The Gate retains early model/self snapshots until this observer is
        // attached, closing the login/initial-spawn scheduling race.
        session.sendDownstreamGamePacket(new ServerboundCustomPayloadPacket(Key.key("mawbedrock:ready"), new byte[] {1}));
    }

    @Subscribe
    public void skin(SessionSkinApplyEvent event) {
        State state = states.computeIfAbsent(event.connection(), ignored -> new State());
        // Never replace another player's skin with this connection's self state.
        if (event.uuid().equals(event.connection().playerEntity().uuid())) state.originalSkins.putIfAbsent(event.uuid(), event.originalSkin());
    }

    @Subscribe
    public void spawn(ServerSpawnEntityEvent event) {
        State state = states.get(event.connection());
        if (state == null || !event.entityType().is(ARMOR_STAND)) return;
        Binding binding = state.bindings.remove(event.entityId());
        if (binding == null || !binding.uuid().equals(event.uuid())) return;
        Model model = definitions.get(binding.identifier());
        if (model == null) return;
        event.definition(model.definition());
        event.preSpawnConsumer(entity -> {
            entity.override(GeyserEntityDataTypes.SCALE, model.scale());
            entity.override(GeyserEntityDataTypes.VERTICAL_OFFSET, 0f);
            entity.override(GeyserEntityDataTypes.WIDTH, .6f);
            entity.override(GeyserEntityDataTypes.HEIGHT, 1.8f);
        });
    }

    @Subscribe
    public void leave(SessionDisconnectEvent event) { states.remove(event.connection()); }
}
