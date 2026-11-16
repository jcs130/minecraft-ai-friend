package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import java.util.UUID;
import java.util.function.Supplier;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.arguments.ResourceLocationArgument;
import net.minecraft.commands.arguments.UuidArgument;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;

final class MaidAgentCommands {
    private static final String MAID = "maid";

    @FunctionalInterface
    private interface Operation {
        String apply(MaidAgent agent, EntityMaid maid);
    }

    private MaidAgentCommands() {}

    static void register(CommandDispatcher<CommandSourceStack> dispatcher, Supplier<MaidAgentsServer> running) {
        dispatcher.register(Commands.literal("maidagent")
                .requires(source -> source.getEntity() instanceof ServerPlayer || source.hasPermission(2))
                .then(Commands.literal("list").executes(context -> list(context.getSource(), running.get())))
                .then(Commands.literal("nearby").executes(context -> nearby(context.getSource(), running.get())))
                .then(Commands.literal("say").then(Commands.argument(MAID, UuidArgument.uuid())
                        .then(Commands.argument("text", StringArgumentType.greedyString()).executes(context ->
                                visit(context, running.get())))))
                .then(Commands.literal("status").then(Commands.argument(MAID, UuidArgument.uuid())
                        .executes(context -> run(context, running.get(), false, (agent, maid) ->
                                "choices=" + agent.binding().choices().keySet() + " " + agent.observation(maid)))))
                .then(Commands.literal("brain").then(Commands.argument(MAID, UuidArgument.uuid())
                        .then(Commands.argument("choice", StringArgumentType.word()).executes(context ->
                                run(context, running.get(), true, (agent, maid) -> {
                                    agent.select(maid, StringArgumentType.getString(context, "choice"));
                                    return "brain=" + agent.brain(maid);
                                })))))
                .then(Commands.literal("mode").then(Commands.argument(MAID, UuidArgument.uuid())
                        .then(Commands.argument("mode", StringArgumentType.word()).executes(context ->
                                run(context, running.get(), true, (agent, maid) -> {
                                    MaidAgent.mode(maid, StringArgumentType.getString(context, "mode"));
                                    return agent.observation(maid);
                                })))))
                .then(Commands.literal("task").then(Commands.argument(MAID, UuidArgument.uuid())
                        .then(Commands.argument("task", ResourceLocationArgument.id()).executes(context ->
                                run(context, running.get(), true, (agent, maid) -> {
                                    MaidAgent.task(maid, ResourceLocationArgument.getId(context, "task"));
                                    return "selectedTask=" + maid.getTask().getUid();
                                })))))
                .then(Commands.literal("tasks").then(Commands.argument(MAID, UuidArgument.uuid())
                        .executes(context -> run(context, running.get(), false, (agent, maid) -> MaidAgent.tasks(maid)))))
                .then(Commands.literal("equip").then(Commands.argument(MAID, UuidArgument.uuid())
                        .then(Commands.argument("slot", StringArgumentType.word())
                                .then(Commands.argument("backpackSlot", IntegerArgumentType.integer(0)).executes(context ->
                                        run(context, running.get(), true, (agent, maid) -> {
                                            MaidAgent.equip(maid, StringArgumentType.getString(context, "slot"),
                                                    IntegerArgumentType.getInteger(context, "backpackSlot"));
                                            return agent.observation(maid);
                                        }))))))
                .then(Commands.literal("voice").then(Commands.argument(MAID, UuidArgument.uuid())
                        .executes(context -> run(context, running.get(), true, (agent, maid) -> {
                            agent.voice(maid);
                            return "nativeTts=" + agent.binding().voice().model();
                        })))));
    }

    private static int run(CommandContext<CommandSourceStack> context, MaidAgentsServer runtime,
                           boolean physical, Operation operation) {
        var source = context.getSource();
        if (runtime == null) return fail(source, "Maid agents are unavailable. Check the server configuration.");
        UUID id = UuidArgument.getUuid(context, MAID);
        MaidAgent agent = runtime.agent(id);
        if (agent == null || !authorized(source, agent)) return fail(source, "This maid is unavailable to you.");
        EntityMaid maid = runtime.loaded(agent);
        if (maid == null) return fail(source, "The registered live maid is currently unavailable.");
        if (physical && source.getEntity() instanceof ServerPlayer player &&
                (player.level() != maid.level() || player.distanceToSqr(maid) > 64)) {
            return fail(source, "Stand within 8 blocks of the maid in the same dimension.");
        }
        try {
            String result = operation.apply(agent, maid);
            source.sendSuccess(() -> Component.literal(result), false);
            return 1;
        } catch (IllegalArgumentException error) {
            return fail(source, error.getMessage());
        }
    }

    private static int list(CommandSourceStack source, MaidAgentsServer runtime) {
        if (runtime == null) return fail(source, "Maid agents are unavailable. Check the server configuration.");
        var owned = runtime.agents().stream().filter(agent -> authorized(source, agent)).toList();
        source.sendSuccess(() -> Component.literal(owned.isEmpty() ? "No maid agents assigned." :
                owned.stream().map(agent -> agent.binding().maidId() + " " +
                        (runtime.loaded(agent) != null ? "loaded" : "unavailable"))
                        .collect(java.util.stream.Collectors.joining("\n"))), false);
        return owned.size();
    }

    private static int nearby(CommandSourceStack source, MaidAgentsServer runtime) {
        if (runtime == null || !(source.getEntity() instanceof ServerPlayer player)) {
            return fail(source, "Use this command in game while NPC dialogue is available.");
        }
        var results = new java.util.ArrayList<String>();
        for (MaidAgent agent : runtime.agents()) {
            if (agent.binding().visitorPersona() == null) continue;
            EntityMaid maid = runtime.loaded(agent);
            if (maid != null && MaidVisitorDialogue.inReach(player, maid)) {
                results.add(maid.getName().getString() + "  /maidagent say " + maid.getUUID() + " <message>");
            }
        }
        source.sendSuccess(() -> Component.literal(results.isEmpty() ? "No public maid NPCs in reach." :
                String.join("\n", results)), false);
        return results.size();
    }

    private static int visit(CommandContext<CommandSourceStack> context, MaidAgentsServer runtime) {
        var source = context.getSource();
        if (runtime == null || !(source.getEntity() instanceof ServerPlayer player)) {
            return fail(source, "Use this command in game while NPC dialogue is available.");
        }
        MaidAgent agent = runtime.agent(UuidArgument.getUuid(context, MAID));
        EntityMaid maid = agent == null ? null : runtime.loaded(agent);
        if (maid == null || agent.binding().visitorPersona() == null) return fail(source, "This maid is unavailable.");
        try {
            runtime.visit(agent, maid, player, StringArgumentType.getString(context, "text"));
            source.sendSuccess(() -> Component.literal("The maid received your message."), false);
            return 1;
        } catch (IllegalArgumentException error) {
            return fail(source, error.getMessage());
        }
    }

    private static boolean authorized(CommandSourceStack source, MaidAgent agent) {
        if (source.getEntity() instanceof ServerPlayer player) {
            return player.getUUID().equals(agent.binding().ownerId());
        }
        return source.getEntity() == null && source.hasPermission(2);
    }

    private static int fail(CommandSourceStack source, String message) {
        source.sendFailure(Component.literal(message));
        return 0;
    }
}
