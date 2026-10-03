package dev.qiandeng.maw;

import com.dwinovo.numen.agent.tool.NumenTool;
import com.dwinovo.numen.agent.tool.ToolRegistry;
import com.dwinovo.numen.entity.CompanionRegistry;
import com.dwinovo.numen.entity.Companions;
import com.dwinovo.numen.entity.NumenPlayer;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.phys.Vec3;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;

import java.util.UUID;
import java.util.Map;

/** Server-only, identity-neutral entry point for Numen bodies in My Agent World. */
@Mod("maw_agent_bridge")
public final class AgentBridge {
    private static final String PREFIX = "MAW_AGENT ";

    public AgentBridge(IEventBus eventBus, ModContainer container) {
        NeoForge.EVENT_BUS.addListener(AgentBridge::register);
    }

    private static void register(RegisterCommandsEvent event) {
        CommandDispatcher<CommandSourceStack> dispatcher = event.getDispatcher();
        dispatcher.register(Commands.literal("maw_agent")
                .requires(source -> source.hasPermission(4))
                .then(Commands.literal("list").executes(AgentBridge::list))
                .then(Commands.literal("summon")
                        .then(Commands.argument("owner", StringArgumentType.word())
                                .then(Commands.argument("name", StringArgumentType.string())
                                        .executes(AgentBridge::summon))))
                .then(Commands.literal("invoke")
                        .then(Commands.argument("bodyUuid", StringArgumentType.word())
                                .then(Commands.argument("tool", StringArgumentType.word())
                                        .then(Commands.argument("args", StringArgumentType.greedyString())
                                                .executes(AgentBridge::invoke)))))
                .then(Commands.literal("dismiss")
                        .then(Commands.argument("bodyUuid", StringArgumentType.word())
                                .executes(AgentBridge::dismiss))));
    }

    private static NumenPlayer find(MinecraftServer server, UUID bodyUuid) {
        for (ServerPlayer player : server.getPlayerList().getPlayers()) {
            if (player instanceof NumenPlayer body && player.getUUID().equals(bodyUuid)) {
                return body;
            }
        }
        return null;
    }

    private static int respond(CommandSourceStack source, JsonObject body) {
        body.addProperty("schemaVersion", 1);
        source.sendSuccess(() -> Component.literal(PREFIX + body), false);
        return body.has("ok") && !body.get("ok").getAsBoolean() ? 0 : 1;
    }

    private static int reject(CommandSourceStack source, String code) {
        JsonObject body = new JsonObject();
        body.addProperty("ok", false);
        body.addProperty("code", code);
        body.addProperty("retryAutomatically", false);
        return respond(source, body);
    }

    private static int list(CommandContext<CommandSourceStack> context) {
        JsonArray bodies = new JsonArray();
        for (ServerPlayer player : context.getSource().getServer().getPlayerList().getPlayers()) {
            if (player instanceof NumenPlayer body) {
                JsonObject entry = new JsonObject();
                entry.addProperty("name", body.getGameProfile().getName());
                entry.addProperty("bodyUuid", body.getUUID().toString());
                entry.addProperty("ownerUuid", body.getOwnerUuid().toString());
                entry.addProperty("dimension", body.level().dimension().location().toString());
                entry.addProperty("x", body.getX());
                entry.addProperty("y", body.getY());
                entry.addProperty("z", body.getZ());
                bodies.add(entry);
            }
        }
        JsonObject result = new JsonObject();
        result.addProperty("ok", true);
        result.add("bodies", bodies);
        return respond(context.getSource(), result);
    }

    private static int summon(CommandContext<CommandSourceStack> context) {
        CommandSourceStack source = context.getSource();
        String name = StringArgumentType.getString(context, "name");
        if (name.isBlank() || name.length() > 16) {
            return reject(source, "invalid_name");
        }
        UUID owner;
        try {
            owner = UUID.fromString(StringArgumentType.getString(context, "owner"));
        } catch (IllegalArgumentException error) {
            return reject(source, "invalid_owner_uuid");
        }
        for (Map.Entry<UUID, CompanionRegistry.Entry> row : CompanionRegistry.get(source.getServer()).all()) {
            if (row.getValue().name().equals(name) && !row.getValue().owner().equals(owner)) {
                return reject(source, "body_name_owned_by_another");
            }
        }
        var level = source.getServer().overworld();
        NumenPlayer body = Companions.summon(source.getServer(), owner, name,
                level, Vec3.atCenterOf(level.getSharedSpawnPos()));
        if (body == null) {
            return reject(source, "summon_failed");
        }
        JsonObject result = new JsonObject();
        result.addProperty("ok", true);
        result.addProperty("name", name);
        result.addProperty("bodyUuid", body.getUUID().toString());
        result.addProperty("ownerUuid", owner.toString());
        return respond(source, result);
    }

    private static int invoke(CommandContext<CommandSourceStack> context) {
        CommandSourceStack source = context.getSource();
        UUID bodyUuid;
        try {
            bodyUuid = UUID.fromString(StringArgumentType.getString(context, "bodyUuid"));
        } catch (IllegalArgumentException error) {
            return reject(source, "invalid_body_uuid");
        }
        String toolName = StringArgumentType.getString(context, "tool");
        String rawArgs = StringArgumentType.getString(context, "args");
        NumenPlayer body = find(source.getServer(), bodyUuid);
        if (body == null) {
            return reject(source, "body_offline");
        }
        NumenTool tool = ToolRegistry.get(toolName);
        if (tool == null) {
            return reject(source, "unknown_tool");
        }
        if (rawArgs.length() > 8192) {
            return reject(source, "args_too_large");
        }
        JsonObject args;
        try {
            args = JsonParser.parseString(rawArgs).getAsJsonObject();
        } catch (RuntimeException error) {
            return reject(source, "invalid_json_object");
        }
        String callId = com.dwinovo.numen.task.TaskRecord.EXTERNAL_CALL_PREFIX + UUID.randomUUID();
        String[] reply = new String[1];
        try {
            tool.onServerCall(callId, args, body, value -> reply[0] = value);
        } catch (RuntimeException error) {
            return reject(source, "tool_rejected");
        }
        JsonObject result = new JsonObject();
        result.addProperty("ok", true);
        result.addProperty("name", body.getGameProfile().getName());
        result.addProperty("bodyUuid", body.getUUID().toString());
        result.addProperty("tool", toolName);
        result.addProperty("callId", callId);
        result.addProperty("resultKnown", reply[0] != null);
        result.addProperty("retryAutomatically", false);
        if (reply[0] != null) {
            try {
                result.add("reply", JsonParser.parseString(reply[0]));
            } catch (RuntimeException error) {
                result.addProperty("reply", reply[0]);
            }
        }
        return respond(source, result);
    }

    private static int dismiss(CommandContext<CommandSourceStack> context) {
        CommandSourceStack source = context.getSource();
        UUID bodyUuid;
        try {
            bodyUuid = UUID.fromString(StringArgumentType.getString(context, "bodyUuid"));
        } catch (IllegalArgumentException error) {
            return reject(source, "invalid_body_uuid");
        }
        NumenPlayer body = find(source.getServer(), bodyUuid);
        if (body == null) {
            return reject(source, "body_offline");
        }
        String name = body.getGameProfile().getName();
        String bodyId = body.getUUID().toString();
        Companions.dismiss(source.getServer(), body);
        JsonObject result = new JsonObject();
        result.addProperty("ok", true);
        result.addProperty("name", name);
        result.addProperty("bodyUuid", bodyId);
        return respond(source, result);
    }
}
