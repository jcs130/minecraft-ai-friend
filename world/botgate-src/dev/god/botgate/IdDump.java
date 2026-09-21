package dev.god.botgate;

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

/**
 * botgate 号表导出（2026-09-21 只读诊断）。
 *
 * /botgate dumpids
 *   导出服务端「真实网络号」↔「注册名」权威对照：
 *   - blocks.tsv:  name \t blockId \t stateBase \t stateCount
 *     （stateBase = Block.BLOCK_STATE_REGISTRY.getId(第一个状态) = chunk/block_update 线上号）
 *   - items.tsv:   name \t itemId
 *
 * 用途:为「原版客户端(mineflayer/Geyser)读错世界」生成
 * NeoForge 网络序 ↔ 原版序 映射表。纯读命令,不改任何行为。
 */
@EventBusSubscriber(modid = "botgate")
public final class IdDump {

    private IdDump() {}

    @SubscribeEvent
    public static void onRegisterCommands(RegisterCommandsEvent event) {
        register(event.getDispatcher());
        System.out.println("[ID-DUMP] /botgate dumpids registered");
    }

    private static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("botgate")
            .requires(s -> s.hasPermission(4))
            .then(Commands.literal("dumpids").executes(ctx -> {
                try {
                    Path dir = Path.of("dump", "botgate-ids").toAbsolutePath();
                    Files.createDirectories(dir);
                    int nb = dumpBlocks(dir.resolve("blocks.tsv"));
                    int ni = dumpItems(dir.resolve("items.tsv"));
                    ctx.getSource().sendSuccess(() -> net.minecraft.network.chat.Component.literal(
                        "botgate-ids: " + nb + " blocks + " + ni + " items -> " + dir), false);
                    System.out.println("[ID-DUMP] wrote " + dir + " blocks=" + nb + " items=" + ni);
                } catch (Exception e) {
                    System.out.println("[ID-DUMP] failed: " + e);
                    ctx.getSource().sendFailure(net.minecraft.network.chat.Component.literal("dump failed: " + e));
                    return 0;
                }
                return 1;
            })));
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
