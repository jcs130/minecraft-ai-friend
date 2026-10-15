package dev.qiandeng.maw;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.arguments.coordinates.BlockPosArgument;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.Block;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/** Private, read-only Agent entry points. MixAuth remains the sole authority. */
final class FomAgentAccess {
    private static final Map<UUID, String> AUTH_SENT = new HashMap<>();
    private FomAgentAccess() {}

    static void register() {
        NeoForge.EVENT_BUS.addListener(FomAgentAccess::tick);
        NeoForge.EVENT_BUS.addListener((PlayerEvent.PlayerLoggedOutEvent e) -> AUTH_SENT.remove(e.getEntity().getUUID()));
        NeoForge.EVENT_BUS.addListener((RegisterCommandsEvent event) -> event.getDispatcher().register(
            Commands.literal("fom")
                .then(Commands.literal("help").executes(c -> help(c.getSource())))
                .then(Commands.literal("inventory").executes(c -> inventory(c.getSource())))
                .then(Commands.literal("nearby").executes(c -> nearby(c.getSource())))
                .then(Commands.literal("inspect").then(Commands.argument("pos", BlockPosArgument.blockPos())
                    .executes(c -> inspect(c.getSource(), BlockPosArgument.getBlockPos(c, "pos")))))));
    }

    private static boolean passwordSet(ServerPlayer player) throws ReflectiveOperationException {
        return (Boolean) Class.forName("io.github.truscdo.mixauth.offline.OfflineAuthService")
            .getMethod("isOfflineRegistered", UUID.class).invoke(null, player.getUUID());
    }

    private static void tick(ServerTickEvent.Post event) {
        if (event.getServer().getTickCount() % 20 != 0) return;
        for (ServerPlayer p : event.getServer().getPlayerList().getPlayers()) {
            if (!p.getGameProfile().getName().toLowerCase(Locale.ROOT).startsWith("ag_")) continue;
            boolean registered;
            try { registered = passwordSet(p); }
            catch (ReflectiveOperationException unavailable) { continue; } // Fail closed; never invent success.
            boolean authorized = PlayerAuthBridge.authenticated(p);
            String key = authorized + ":" + registered;
            String previous = AUTH_SENT.get(p.getUUID());
            if (key.equals(previous)) continue;
            AUTH_SENT.put(p.getUUID(), key);
            JsonObject out = new JsonObject();
            out.addProperty("schemaVersion", 1);
            out.addProperty("playerUuid", p.getUUID().toString());
            out.addProperty("username", p.getGameProfile().getName());
            out.addProperty("authorized", authorized);
            out.addProperty("status", authorized ? "authenticated" : "awaiting_login");
            out.addProperty("passwordSet", registered);
            out.addProperty("nextCommand", authorized ? "/fom status" : "/login <密码>");
            out.addProperty("authority", "MixAuth/PlayerAuthBridge");
            out.addProperty("observedAt", java.time.Instant.now().toString());
            // These are unicast system messages, never a public broadcast or
            // an authentication bypass. Guest access follows existing policy;
            // authorized=true means actions are allowed, not verified premium.
            p.sendSystemMessage(Component.literal("MC_AUTH_STATE " + out));
            if (authorized && (previous == null || previous.startsWith("false:"))) {
                p.sendSystemMessage(Component.literal("MC_AUTH_SUCCESS"));
                p.sendSystemMessage(Component.literal(
                    "这里是FOM模组服。/fom help 查看入口；status 查本人状态，inventory 查真实原生物品，inspect <x> <y> <z> 查8格内方块。兼容显示的基础物品类型不是模组真实身份，请核对原生ID。所有这些查询免费且只读。"));
            } else if (!authorized && (previous == null || previous.startsWith("true:"))) {
                p.sendSystemMessage(Component.literal("MC_AUTH_LOGIN"));
            }
        }
    }

    private static ServerPlayer ready(CommandSourceStack source) {
        if (!(source.getEntity() instanceof ServerPlayer p)) {
            source.sendFailure(Component.literal("请由已登录的玩家查询自己的现场；控制台使用既有管理命令。")); return null;
        }
        if (!PlayerAuthBridge.authenticated(p)) {
            source.sendFailure(Component.literal("正在等待服务器登录；请先 /login <密码>，成功后再查询。")); return null;
        }
        return p;
    }

    private static int send(CommandSourceStack source, String kind, JsonObject value) {
        source.sendSuccess(() -> Component.literal(kind + " " + value), false); return 1;
    }

    private static int help(CommandSourceStack source) {
        ServerPlayer p = ready(source); if (p == null) return 0;
        JsonObject out = base(p); JsonArray commands = new JsonArray();
        for (String[] row : new String[][] {
            {"/fom status", "本人实际认证与坐标"},
            {"/fom inventory", "本人原生物品ID、数量、所选快捷栏和光标"},
            {"/fom nearby", "16格内真实生物的原生ID、坐标；最多24项，部分模组生物在兼容画面不可见"},
            {"/fom inspect <x> <y> <z>", "同维度8格内已加载方块的原生ID、状态与硬度"},
            {"/fom help", "阅读本目录；查询不报名、不消耗物品"}}) {
            JsonObject c = new JsonObject(); c.addProperty("command", row[0]); c.addProperty("description", row[1]);
            c.addProperty("effect", "read"); c.addProperty("cost", 0); c.addProperty("permission", "authenticated_self"); commands.add(c);
        }
        out.add("commands", commands);
        out.addProperty("note", "原版协议兼容显示与模组原生身份不同；专用界面和复杂载具使用完整Java客户端桥接。");
        return send(source, "MC_FOM_HELP", out);
    }

    private static JsonObject base(ServerPlayer p) {
        JsonObject out = new JsonObject(); out.addProperty("schemaVersion", 1);
        out.addProperty("playerUuid", p.getUUID().toString()); out.addProperty("world", p.serverLevel().dimension().location().toString());
        out.addProperty("observedAt", java.time.Instant.now().toString()); return out;
    }

    private static JsonObject item(ItemStack stack) {
        JsonObject out = new JsonObject(); out.addProperty("nativeId", BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
        out.addProperty("count", stack.getCount()); out.addProperty("displayName", stack.getHoverName().getString());
        out.addProperty("translationKey", stack.getDescriptionId()); return out;
    }

    private static int inventory(CommandSourceStack source) {
        ServerPlayer p = ready(source); if (p == null) return 0;
        JsonObject out = base(p); JsonArray items = new JsonArray();
        for (int slot = 0; slot < p.getInventory().getContainerSize(); slot++) {
            ItemStack stack = p.getInventory().getItem(slot); if (stack.isEmpty()) continue;
            JsonObject row = item(stack); row.addProperty("slot", slot); items.add(row);
        }
        out.addProperty("slotSpace", "player_inventory_0_40"); out.addProperty("selectedHotbar", p.getInventory().selected);
        out.add("items", items); out.add("cursor", item(p.containerMenu.getCarried()));
        return send(source, "MC_FOM_INVENTORY", out);
    }

    private static int inspect(CommandSourceStack source, BlockPos pos) {
        ServerPlayer p = ready(source); if (p == null) return 0;
        JsonObject out = base(p); JsonArray coordinates = new JsonArray();
        coordinates.add(pos.getX()); coordinates.add(pos.getY()); coordinates.add(pos.getZ()); out.add("position", coordinates);
        if (p.distanceToSqr(pos.getX() + .5, pos.getY() + .5, pos.getZ() + .5) > 64 || !p.serverLevel().hasChunkAt(pos)) {
            out.addProperty("status", "unavailable"); out.addProperty("reason", "outside_loaded_8_block_range");
            out.addProperty("nextAction", "移动到目标8格内，等待区块加载后重查；本查询不会加载远方区块。");
        } else {
            var state = p.serverLevel().getBlockState(pos);
            out.addProperty("status", "ok"); out.addProperty("nativeId", BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString());
            out.addProperty("nativeStateId", Block.getId(state)); out.addProperty("state", state.toString());
            out.addProperty("destroySpeed", state.getDestroySpeed(p.serverLevel(), pos));
            out.addProperty("air", state.isAir()); out.addProperty("hasBlockEntity", state.hasBlockEntity());
        }
        return send(source, "MC_FOM_BLOCK", out);
    }

    private static int nearby(CommandSourceStack source) {
        ServerPlayer p = ready(source); if (p == null) return 0;
        var entities = p.serverLevel().getEntities(p, p.getBoundingBox().inflate(16), e -> e.distanceToSqr(p) <= 256);
        entities.sort(java.util.Comparator.comparingDouble(e -> e.distanceToSqr(p)));
        JsonObject out = base(p); JsonArray rows = new JsonArray();
        for (var e : entities.subList(0, Math.min(24, entities.size()))) {
            JsonObject row = new JsonObject();
            row.addProperty("nativeId", BuiltInRegistries.ENTITY_TYPE.getKey(e.getType()).toString());
            row.addProperty("entityId", e.getId()); row.addProperty("uuid", e.getUUID().toString());
            row.addProperty("name", e.getName().getString()); row.addProperty("distance", Math.sqrt(e.distanceToSqr(p)));
            row.addProperty("invisible", e.isInvisible());
            JsonArray pos = new JsonArray(); pos.add(e.getX()); pos.add(e.getY()); pos.add(e.getZ()); row.add("position", pos);
            rows.add(row);
        }
        out.add("entities", rows); out.addProperty("range", 16); out.addProperty("total", entities.size());
        out.addProperty("truncated", entities.size() > 24);
        return send(source, "MC_FOM_NEARBY", out);
    }
}
