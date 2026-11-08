package local.tlmcompat.geyser;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import local.tlmcompat.numen.MaidVisualRegistry;
import local.tlmcompat.numen.MaidVoiceTransport;
import local.tlmcompat.numen.MaidVisualRegistry.State;
import org.geysermc.geyser.api.GeyserApi;
import org.geysermc.geyser.api.entity.custom.CustomEntityDefinition;
import org.geysermc.geyser.api.entity.definition.GeyserEntityDefinition;
import org.geysermc.geyser.api.entity.data.GeyserEntityDataTypes;
import org.geysermc.geyser.api.entity.type.GeyserEntity;
import org.geysermc.geyser.api.entity.property.type.*;
import org.geysermc.geyser.api.event.bedrock.*;
import org.geysermc.geyser.api.event.java.ServerSpawnEntityEvent;
import org.geysermc.geyser.api.event.lifecycle.*;
import org.geysermc.geyser.api.extension.Extension;
import org.geysermc.geyser.api.pack.*;
import org.geysermc.geyser.api.util.Identifier;

/** Geyser 2.11 API adapter. Main-thread native state -> immutable snapshots -> per-viewer API updates. */
public final class MaidGeyserExtension implements Extension {
    private record Model(int index, float scale) {}
    private final Identifier maidType = Identifier.of("qiandengji:maid");
    private CustomEntityDefinition definition;
    private final Map<String, Model> models = new HashMap<>();
    private final Set<org.geysermc.geyser.api.connection.GeyserConnection> connections = ConcurrentHashMap.newKeySet();
    private final Set<org.geysermc.geyser.api.connection.GeyserConnection> offered = ConcurrentHashMap.newKeySet();
    private final Consumer<State> observer = this::changed;
    private ResourcePack pack;
    private boolean enabled, packRegistered;
    private GeyserIntEntityProperty model;
    private GeyserBooleanEntityProperty sitting, sleeping, aiming, working, mainHand, offHand, usingItem, usingOffHand;
    private GeyserFloatEntityProperty attack, health, speed, renderScale;

    public MaidGeyserExtension() {
        // The public consumer API avoids lmbda-generated annotation handlers under Youer's loader.
        var bus = GeyserApi.api().eventBus();
        bus.subscribe(this, GeyserPreInitializeEvent.class, this::initialize);
        bus.subscribe(this, GeyserDefineEntitiesEvent.class, this::define);
        bus.subscribe(this, GeyserDefineEntityPropertiesEvent.class, this::defineProperties);
        bus.subscribe(this, GeyserDefineResourcePacksEvent.class, this::packs);
        bus.subscribe(this, SessionJoinEvent.class, this::joined);
        bus.subscribe(this, SessionLoadResourcePacksEvent.class, this::offeredPacks, org.geysermc.event.PostOrder.LAST);
        bus.subscribe(this, SessionDisconnectEvent.class, this::disconnected);
        bus.subscribe(this, GeyserShutdownEvent.class, this::shutdown);
        bus.subscribe(this, ServerSpawnEntityEvent.class, this::spawn);
    }

    public void initialize(GeyserPreInitializeEvent event) {
        try {
            Files.createDirectories(dataFolder());
            Path config = dataFolder().resolve("appearance.properties");
            if (!Files.exists(config)) Files.writeString(config, "# Set false and restart to retain the vanilla allay fallback.\nappearance-enabled=true\n", StandardCharsets.UTF_8);
            Properties properties = new Properties();
            try (var reader = Files.newBufferedReader(config)) { properties.load(reader); }
            String setting = properties.getProperty("appearance-enabled", "false");
            if (!setting.equals("true") && !setting.equals("false")) throw new IOException("appearance-enabled must be true or false");
            if (!Boolean.parseBoolean(setting)) { logger().info("Maid appearance disabled; vanilla projection retained"); return; }
            try (var reader = new BufferedReader(new InputStreamReader(Objects.requireNonNull(getClass().getResourceAsStream("/maid-models.tsv")), StandardCharsets.UTF_8))) {
                for (String line; (line = reader.readLine()) != null;) {
                    String[] parts = line.split("\t");
                    if (parts.length != 3) throw new IOException("Invalid model manifest");
                    var row = new Model(Integer.parseInt(parts[1]), Float.parseFloat(parts[2]));
                    if (row.index() != models.size() + 1 || row.scale() <= 0 || row.scale() > 8 || models.putIfAbsent(parts[0], row) != null) throw new IOException("Invalid model registry");
                }
            }
            byte[] content;
            try (var input = Objects.requireNonNull(getClass().getResourceAsStream("/maid.mcpack"))) { content = input.readAllBytes(); }
            Path path = dataFolder().resolve("original-maids.mcpack");
            // Our owned generated file only. Publish atomically so Geyser cannot stream a partial pack.
            if (!Files.exists(path) || !Arrays.equals(Files.readAllBytes(path), content)) {
                Path temporary = Files.createTempFile(dataFolder(), "maid-pack-", ".tmp");
                Files.write(temporary, content);
                Files.move(temporary, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            }
            pack = ResourcePack.create(PackCodec.path(path));
            definition = CustomEntityDefinition.of(maidType);
            enabled = true;
            MaidVisualRegistry.subscribe(observer);
            logger().info("Maid appearance initialized: " + models.size() + " original model/texture mappings; Geyser 2.11 API");
        } catch (Exception error) {
            enabled = false;
            logger().error("Maid appearance unavailable; vanilla entity projection retained", error);
        }
    }

    public void define(GeyserDefineEntitiesEvent event) { if (enabled) event.register(definition); }
    public void defineProperties(GeyserDefineEntityPropertiesEvent event) {
        if (!enabled) return;
        model = event.registerIntegerProperty(maidType, id("model"), 0, models.size(), 0);
        sitting = event.registerBooleanProperty(maidType, id("sitting"), false);
        sleeping = event.registerBooleanProperty(maidType, id("sleeping"), false);
        aiming = event.registerBooleanProperty(maidType, id("aiming"), false);
        working = event.registerBooleanProperty(maidType, id("working"), false);
        mainHand = event.registerBooleanProperty(maidType, id("main_hand"), false);
        offHand = event.registerBooleanProperty(maidType, id("off_hand"), false);
        usingItem = event.registerBooleanProperty(maidType, id("using_item"), false);
        usingOffHand = event.registerBooleanProperty(maidType, id("using_off_hand"), false);
        attack = event.registerFloatProperty(maidType, id("attack"), 0f, 1f, 0f);
        health = event.registerFloatProperty(maidType, id("health"), 0f, 1f, 1f);
        speed = event.registerFloatProperty(maidType, id("speed"), 0f, 1f, 0f);
        renderScale = event.registerFloatProperty(maidType, id("render_scale"), 0.01f, 8f, 1f);
    }
    private static Identifier id(String key) { return Identifier.of("qiandengji:" + key); }
    public void packs(GeyserDefineResourcePacksEvent event) {
        if (!enabled) return;
        try { event.register(pack); packRegistered = true; }
        catch (RuntimeException error) { packRegistered = false; logger().error("Maid resource pack registration failed; vanilla projection retained", error); }
    }
    public void joined(SessionJoinEvent event) { connections.add(event.connection());MaidVoiceTransport.ready(event.connection().javaUuid(),enabled&&packRegistered&&offered.contains(event.connection())); }
    public void offeredPacks(SessionLoadResourcePacksEvent event) {
        if (packRegistered && event.resourcePacks().stream().anyMatch(value -> value.uuid().equals(pack.uuid()))) offered.add(event.connection());
        else offered.remove(event.connection());
    }
    public void disconnected(SessionDisconnectEvent event) { connections.remove(event.connection()); offered.remove(event.connection()); MaidVisualRegistry.disconnect(event.connection().javaUuid());MaidVoiceTransport.ready(event.connection().javaUuid(),false); }
    public void shutdown(GeyserShutdownEvent event) {
        MaidVisualRegistry.unsubscribe(observer);
        for (var connection : connections) {MaidVisualRegistry.disconnect(connection.javaUuid());MaidVoiceTransport.ready(connection.javaUuid(),false);}
        connections.clear(); offered.clear(); packRegistered = false;
    }
    public void spawn(ServerSpawnEntityEvent event) {
        if (!event.entityType().is(Identifier.of("minecraft:allay")) && !event.entityType().is(Identifier.of("minecraft:villager"))) return;
        State state = MaidVisualRegistry.get(event.uuid());
        // Exact native UUID is mandatory: a name, entity number or an ordinary villager never qualifies.
        if (state == null) return;
        MaidVisualRegistry.rendered(event.connection().javaUuid(), state.uuid(), false);
        if (!enabled || !packRegistered || !offered.contains(event.connection()) || !models.containsKey(state.modelId())) {
            event.definition(GeyserEntityDefinition.of(Identifier.of("minecraft:allay")));
            return;
        }
        event.definition(definition);
        event.preSpawnConsumer(entity -> {
            entity.override(GeyserEntityDataTypes.VERTICAL_OFFSET, 0f);
            entity.override(GeyserEntityDataTypes.WIDTH, state.width());
            entity.override(GeyserEntityDataTypes.HEIGHT, state.height());
            apply(entity, state, false);
            MaidVisualRegistry.rendered(event.connection().javaUuid(), state.uuid(), true);
        });
    }
    private void changed(State state) {
        if (!enabled || !packRegistered) return;
        for (var connection : connections) {
            GeyserEntity entity = connection.entities().byUuid(state.uuid());
            if (entity != null && entity.definition().identifier().equals(maidType)) {
                apply(entity, state, true);
                MaidVisualRegistry.rendered(connection.javaUuid(),state.uuid(),models.containsKey(state.modelId()));
            }
        }
    }
    private void apply(GeyserEntity entity, State state, boolean immediate) {
        Model visual = models.get(state.modelId());
        // An unsupported runtime model change gets an explicit marker, never a different character.
        int modelIndex = visual == null ? 0 : visual.index();
        float scale = visual == null ? 1 : visual.scale();
        entity.updatePropertiesBatched(values -> {
            values.update(model, modelIndex); values.update(renderScale, scale);
            values.update(sitting, state.sitting()); values.update(sleeping, state.sleeping());
            values.update(aiming, state.aiming()); values.update(working, state.working());
            values.update(mainHand, state.mainHand()); values.update(offHand, state.offHand());
            values.update(usingItem, state.usingItem()); values.update(usingOffHand, state.usingOffHand());
            values.update(attack, state.attack()); values.update(health, state.health()); values.update(speed, state.speed());
        }, immediate);
    }
}
