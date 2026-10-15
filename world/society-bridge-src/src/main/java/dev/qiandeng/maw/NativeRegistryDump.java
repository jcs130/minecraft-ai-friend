package dev.qiandeng.maw;

import com.mojang.brigadier.CommandDispatcher;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.item.Item;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.RegisterCommandsEvent;

import java.io.BufferedWriter;
import java.nio.file.Files;
import java.nio.file.Path;

/** Read-only OP-4 registry export. Run once during empty-server maintenance.
 * Kept inside the existing bridge: adding a diagnostic mod can reorder network IDs.
 * No player inventory, world content or authentication data is exported. */

final class NativeRegistryDump {

    private NativeRegistryDump() {}

    static void register() { net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(NativeRegistryDump::onRegisterCommands); }

    private static void onRegisterCommands(RegisterCommandsEvent event) {
        register(event.getDispatcher());
        System.out.println("[ID-DUMP] /botgate dumpids registered");
    }

    private static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("maw_registry")
            .requires(s -> s.hasPermission(4))
            .then(Commands.literal("dumpids").executes(ctx -> {
                try {
                    Path dir = Path.of("dump", "maw-registry-ids").toAbsolutePath();
                    Files.createDirectories(dir);
                    Files.deleteIfExists(dir.resolve("complete.json"));
                    int nb = dumpBlocks(dir.resolve("blocks.tsv"));
                    int ni = dumpItems(dir.resolve("items.tsv"));
                    dumpComponents(dir.resolve("components.tsv"));
                    dumpStates(dir.resolve("block-states.jsonl"));
                    dumpEntities(dir.resolve("entities.tsv"));
                    dumpParticles(dir.resolve("particles.tsv"));
                    dumpEntitySerializers(dir.resolve("entity-data-serializers.tsv"));
                    dumpNetworkChannels(dir.resolve("network-channels.json"));
                    dumpSounds(dir.resolve("sounds.tsv"));
                    var complete = new com.google.gson.JsonObject();
                    complete.addProperty("schemaVersion", 1);
                    complete.addProperty("completedAt", java.time.Instant.now().toString());
                    complete.addProperty("processId", ProcessHandle.current().pid());
                    Files.writeString(dir.resolve("complete.json"), complete.toString());
                    ctx.getSource().sendSuccess(() -> net.minecraft.network.chat.Component.literal(
                        "maw-registry-ids: " + nb + " blocks + " + ni + " items -> " + dir), false);
                    System.out.println("[ID-DUMP] wrote " + dir + " blocks=" + nb + " items=" + ni);
                } catch (Exception e) {
                    System.out.println("[ID-DUMP] failed: " + e);
                    ctx.getSource().sendFailure(net.minecraft.network.chat.Component.literal("dump failed: " + e));
                    return 0;
                }
                return 1;
            })));
    }

    private static void dumpComponents(Path file) throws Exception {
        try (BufferedWriter w = Files.newBufferedWriter(file)) {
            for (var component : BuiltInRegistries.DATA_COMPONENT_TYPE) {
                w.write(BuiltInRegistries.DATA_COMPONENT_TYPE.getKey(component).toString() + "\t" +
                        BuiltInRegistries.DATA_COMPONENT_TYPE.getId(component));
                w.newLine();
            }
        }
    }

    /** Export the actual registrations, including version/flow and protocol.
     * Never infer a required mod channel by repeatedly reconnecting players.
     * This is an OP-only diagnostic of the pinned NeoForge 21.1 API. */
    private static void dumpNetworkChannels(Path file) throws Exception {
        var field = net.neoforged.neoforge.network.registration.NetworkRegistry.class
                .getDeclaredField("PAYLOAD_REGISTRATIONS");
        field.setAccessible(true);
        var registrations = (java.util.Map<?, ?>) field.get(null);
        var protocols = new com.google.gson.JsonObject();
        for (var protocolEntry : registrations.entrySet()) {
            var protocol = (net.minecraft.network.ConnectionProtocol) protocolEntry.getKey();
            if (protocol != net.minecraft.network.ConnectionProtocol.PLAY &&
                    protocol != net.minecraft.network.ConnectionProtocol.CONFIGURATION) continue;
            var rows = new com.google.gson.JsonArray();
            var entries = (java.util.Map<?, ?>) protocolEntry.getValue();
            for (var entry : entries.entrySet()) {
                Object registration = entry.getValue();
                Class<?> type = registration.getClass();
                var row = new com.google.gson.JsonObject();
                row.addProperty("id", entry.getKey().toString());
                row.addProperty("version", (String) type.getMethod("version").invoke(registration));
                row.addProperty("optional", (Boolean) type.getMethod("optional").invoke(registration));
                var flow = (java.util.Optional<?>) type.getMethod("flow").invoke(registration);
                if (flow.isPresent()) row.addProperty("flow", ((net.minecraft.network.protocol.PacketFlow) flow.get()).ordinal());
                rows.add(row);
            }
            protocols.add(Integer.toString(protocol.ordinal()), rows);
        }
        var out = new com.google.gson.JsonObject();
        out.addProperty("schemaVersion", 1);
        out.addProperty("minecraft", "1.21.1");
        out.addProperty("neoforge", "21.1.248");
        out.add("protocols", protocols);
        Files.writeString(file, out.toString());
    }

    private static void dumpSounds(Path file) throws Exception {
        try (BufferedWriter w = Files.newBufferedWriter(file)) {
            for (var sound : BuiltInRegistries.SOUND_EVENT) {
                w.write(BuiltInRegistries.SOUND_EVENT.getKey(sound) + "\t" + BuiltInRegistries.SOUND_EVENT.getId(sound));
                w.newLine();
            }
        }
    }

    private static <T extends Comparable<T>> String propertyValue(BlockState state,
            net.minecraft.world.level.block.state.properties.Property<T> property) {
        return property.getName(state.getValue(property));
    }

    private static void dumpStates(Path file) throws Exception {
        try (BufferedWriter w = Files.newBufferedWriter(file)) {
            for (Block block : BuiltInRegistries.BLOCK) {
                for (BlockState state : block.getStateDefinition().getPossibleStates()) {
                    var row = new com.google.gson.JsonObject();
                    row.addProperty("stateId", Block.BLOCK_STATE_REGISTRY.getId(state));
                    row.addProperty("name", BuiltInRegistries.BLOCK.getKey(block).toString());
                    row.addProperty("renderShape", state.getRenderShape().name());
                    row.addProperty("hasBlockEntity", state.hasBlockEntity());
                    row.addProperty("solid", state.isSolid());
                    row.addProperty("blocksMotion", state.blocksMotion());
                    row.addProperty("canOcclude", state.canOcclude());
                    row.addProperty("dynamicShape", block.hasDynamicShape());
                    row.addProperty("hasOffsetFunction", state.hasOffsetFunction());
                    var fluid = state.getFluidState();
                    var fluidRow = new com.google.gson.JsonObject();
                    fluidRow.addProperty("name", BuiltInRegistries.FLUID.getKey(fluid.getType()).toString());
                    fluidRow.addProperty("empty", fluid.isEmpty());
                    fluidRow.addProperty("amount", fluid.getAmount());
                    fluidRow.addProperty("source", fluid.isSource());
                    fluidRow.addProperty("height", fluid.getOwnHeight());
                    fluidRow.addProperty("falling", fluid.hasProperty(net.minecraft.world.level.material.FlowingFluid.FALLING)
                            && fluid.getValue(net.minecraft.world.level.material.FlowingFluid.FALLING));
                    row.add("fluid", fluidRow);
                    if (!block.hasDynamicShape()) {
                        try {
                            var shape = state.getOcclusionShape(net.minecraft.world.level.EmptyBlockGetter.INSTANCE,
                                    net.minecraft.core.BlockPos.ZERO);
                            var boxes = new com.google.gson.JsonArray();
                            for (var box : shape.toAabbs()) {
                                var coordinates = new com.google.gson.JsonArray();
                                for (double v : new double[]{box.minX,box.minY,box.minZ,box.maxX,box.maxY,box.maxZ})
                                    coordinates.add(v);
                                boxes.add(coordinates);
                            }
                            row.add("occlusionBoxes", boxes);
                        } catch (RuntimeException ignored) {
                            row.addProperty("occlusionUnavailable", true);
                        }
                    }
                    var properties = new com.google.gson.JsonObject();
                    for (var property : state.getProperties()) {
                        properties.addProperty(property.getName(), propertyValue(state, property));
                    }
                    row.add("properties", properties);
                    w.write(row.toString());
                    w.newLine();
                }
            }
        }
    }

    private static void dumpEntities(Path file) throws Exception {
        try (BufferedWriter w = Files.newBufferedWriter(file)) {
            for (var entity : BuiltInRegistries.ENTITY_TYPE) {
                w.write(BuiltInRegistries.ENTITY_TYPE.getKey(entity).toString() + "\t" +
                        BuiltInRegistries.ENTITY_TYPE.getId(entity));
                w.newLine();
            }
        }
    }

    private static void dumpParticles(Path file) throws Exception {
        try (BufferedWriter w = Files.newBufferedWriter(file)) {
            for (var particle : BuiltInRegistries.PARTICLE_TYPE) {
                w.write(BuiltInRegistries.PARTICLE_TYPE.getKey(particle).toString() + "\t" +
                        BuiltInRegistries.PARTICLE_TYPE.getId(particle));
                w.newLine();
            }
        }
    }

    private static void dumpEntitySerializers(Path file) throws Exception {
        var registry = net.neoforged.neoforge.registries.NeoForgeRegistries.ENTITY_DATA_SERIALIZERS;
        try (BufferedWriter w = Files.newBufferedWriter(file)) {
            for (var name : registry.keySet()) {
                var serializer = registry.get(name);
                int networkId = net.minecraft.network.syncher.EntityDataSerializers.getSerializedId(serializer);
                if (networkId < 0) throw new IllegalStateException("Unregistered entity serializer " + name);
                w.write(name.toString() + "\t" + networkId);
                w.newLine();
            }
        }
    }

    private static int dumpBlocks(Path file) throws Exception {
        int n = 0;
        try (BufferedWriter w = Files.newBufferedWriter(file)) {
            for (Block b : BuiltInRegistries.BLOCK) {
                var key = BuiltInRegistries.BLOCK.getKey(b);
                int blockId = BuiltInRegistries.BLOCK.getId(b);
                var states = b.getStateDefinition().getPossibleStates();
                int base = Block.BLOCK_STATE_REGISTRY.getId(states.getFirst());
                w.write(key.getNamespace() + ":" + key.getPath() + "\t" + blockId + "\t" + base + "\t" + states.size());
                w.newLine();
                n++;
            }
        }
        return n;
    }

    private static int dumpItems(Path file) throws Exception {
        int n = 0;
        try (BufferedWriter w = Files.newBufferedWriter(file)) {
            for (Item it : BuiltInRegistries.ITEM) {
                var key = BuiltInRegistries.ITEM.getKey(it);
                int id = BuiltInRegistries.ITEM.getId(it);
                w.write(key.getNamespace() + ":" + key.getPath() + "\t" + id);
                w.newLine();
                n++;
            }
        }
        return n;
    }
}
