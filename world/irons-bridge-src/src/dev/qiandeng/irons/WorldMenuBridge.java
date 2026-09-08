package dev.qiandeng.irons;

import com.google.gson.JsonObject;
import com.google.gson.JsonArray;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.inventory.FurnaceResultSlot;
import java.util.UUID;

/** Read the server menu's actual backing block; a menu class name is not an identity. */
public final class WorldMenuBridge {
    private WorldMenuBridge() {}
    private static final String EPOCH = UUID.randomUUID().toString();
    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("qdworld").requires(s -> s.hasPermission(2))
            .then(Commands.literal("gui").then(Commands.argument("actor", StringArgumentType.string())
                .executes(c -> inspect(c.getSource(), StringArgumentType.getString(c, "actor"), 0))
                .then(Commands.argument("offset", IntegerArgumentType.integer(0, 127)).executes(c -> inspect(c.getSource(),
                    StringArgumentType.getString(c, "actor"), IntegerArgumentType.getInteger(c, "offset")))))));
    }
    private static int inspect(CommandSourceStack source, String query, int offset) {
        var out = new JsonObject();
        out.addProperty("schema", 1);
        out.addProperty("capability", "physical_menu_v1");
        out.addProperty("ok", false);
        try {
            var actor = QiandengIronsBridge.resolve(source.getServer(), query);
            var menu = actor.containerMenu;
            out.addProperty("actorUuid", actor.getStringUUID());
            out.addProperty("dimension", actor.level().dimension().location().toString());
            out.addProperty("menu", menu.getClass().getSimpleName());
            out.addProperty("containerId", menu.containerId);
            out.addProperty("epoch", EPOCH);
            out.addProperty("cursorEmpty", menu.getCarried().isEmpty());
            out.addProperty("stillValid", menu.stillValid(actor));
            if (menu != actor.inventoryMenu && !menu.slots.isEmpty() && menu.getSlot(0).container instanceof BlockEntity block) {
                var pos = block.getBlockPos();
                var point = new JsonObject();
                point.addProperty("x", pos.getX()); point.addProperty("y", pos.getY()); point.addProperty("z", pos.getZ());
                out.add("position", point);
                out.addProperty("physicalBlockKnown", block.getLevel() == actor.level());
            } else {
                // Double chests, portable/mod menus and merchant inventories need separate audited adapters.
                out.addProperty("physicalBlockKnown", false);
            }
            out.addProperty("slotCount", menu.slots.size());
            out.addProperty("offset", offset);
            var slots = new JsonArray();
            int end = Math.min(menu.slots.size(), offset + 12);
            for (int i = offset; i < end; i++) {
                var slot = menu.getSlot(i);
                var item = slot.getItem();
                var row = new JsonObject();
                row.addProperty("index", i);
                row.addProperty("playerSide", slot.container == actor.getInventory());
                row.addProperty("id", BuiltInRegistries.ITEM.getKey(item.getItem()).toString());
                row.addProperty("count", item.getCount());
                row.addProperty("output", slot instanceof FurnaceResultSlot);
                slots.add(row);
            }
            out.add("slots", slots);
            out.addProperty("nextOffset", end < menu.slots.size() ? end : -1);
            out.addProperty("ok", true);
            out.addProperty("code", "ok");
        } catch (Exception e) { out.addProperty("code", "menu_binding_unavailable"); }
        source.sendSuccess(() -> Component.literal("QD_WORLD_JSON " + out), false);
        return out.get("ok").getAsBoolean() ? 1 : 0;
    }
}
