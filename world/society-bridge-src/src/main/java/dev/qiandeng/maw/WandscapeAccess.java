package dev.qiandeng.maw;

import com.google.gson.*;
import net.minecraft.core.BlockPos;
import net.minecraft.core.HolderLookup;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.Container;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.levelgen.structure.BoundingBox;
import net.neoforged.fml.ModList;

import java.lang.reflect.InvocationTargetException;
import java.time.Instant;
import java.util.*;
import java.util.function.Supplier;

/** Optional, version-pinned adapter. Every write uses this connection's town and real native costs. */
final class WandscapeAccess {
    static final String VERSION = "2.1.3-1211";
    private static final String BASE = "com.wsteam.wandscape.";
    private static Class<?> type(String name) {
        try { return Class.forName(BASE + name); }
        catch (ClassNotFoundException e) { throw new IllegalStateException("wandscape_api_version_mismatch", e); }
    }
    private static Object call(Object target, String owner, String method, Class<?>[] signature, Object... args) {
        try { return type(owner).getMethod(method, signature).invoke(target, args); }
        catch (InvocationTargetException e) { throw new IllegalStateException("wandscape_native_call_failed", e.getCause()); }
        catch (ReflectiveOperationException e) { throw new IllegalStateException("wandscape_api_version_mismatch", e); }
    }
    private static Object get(Object value, String method) {
        try { return value.getClass().getMethod(method).invoke(value); }
        catch (InvocationTargetException e) { throw new IllegalStateException("wandscape_native_read_failed", e.getCause()); }
        catch (ReflectiveOperationException e) { throw new IllegalStateException("wandscape_api_version_mismatch", e); }
    }
    private static Object api(String name) { return call(null, "api.WandscapeApis", "get" + name + "Api", new Class<?>[0]); }
    private static Object invoke(String name, String method, Class<?>[] signature, Object... args) {
        return call(api(name), "api." + name + "Api", method, signature, args);
    }
    private static Object loader() { return call(null, "content.building.internal.BuildingConfigLoader", "getInstance", new Class<?>[0]); }
    private static Object config(String id) { return call(loader(), "content.building.internal.BuildingConfigLoader", "get", new Class<?>[]{String.class}, id); }
    private static Object government() { return call(loader(), "content.building.internal.BuildingConfigLoader", "getByCategory", new Class<?>[]{String.class}, "government"); }
    private static void available() {
        var mod = ModList.get().getModContainerById("wandscape");
        if (mod.isEmpty()) ModRequest.fail("optional_mod_not_installed:wandscape");
        if (!VERSION.equals(mod.orElseThrow().getModInfo().getVersion().toString())) ModRequest.fail("wandscape_version_not_supported:" + VERSION);
    }
    private static UUID own(ServerPlayer p) {
        return (UUID) invoke("Colony", "getColonyByFounder", new Class<?>[]{UUID.class}, p.getUUID());
    }
    private static UUID requiredTown(ServerPlayer p) {
        UUID id = own(p); if (id == null) ModRequest.fail("wandscape_town_not_founded"); return id;
    }
    private static void overworld(ServerPlayer p) {
        if (p.serverLevel() != p.getServer().overworld()) ModRequest.fail("wandscape_requires_overworld");
    }
    static boolean wizard(net.minecraft.world.entity.Entity entity) {
        return net.minecraft.core.registries.BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString().equals("wandscape:wandscape_npc") &&
                ModList.get().getModContainerById("wandscape").map(m -> VERSION.equals(m.getModInfo().getVersion().toString())).orElse(false);
    }
    static JsonObject visual(net.minecraft.world.entity.Entity entity) {
        if (!wizard(entity)) throw new IllegalArgumentException("wandscape_visual_entity_not_supported");
        JsonObject out = new JsonObject();
        for (String[] field : new String[][]{{"name","getNpcName"},{"status","getStatusText"},{"castSpellId","getCastSpellId"}})
            out.addProperty(field[0], get(entity,field[1]).toString());
        out.addProperty("hatColor", ((Number)get(entity,"getHatColor")).intValue() & 0xffffff);
        out.addProperty("skinVariant", (Number)get(entity,"getSkinVariant")); out.addProperty("casting", (Boolean)get(entity,"isCasting")); return out;
    }
    private static JsonObject base(ServerPlayer p) {
        JsonObject out = new JsonObject(); out.addProperty("available", true); out.addProperty("modVersion", VERSION);
        out.addProperty("bodyId", p.getUUID().toString()); out.addProperty("sampledAt", Instant.now().toString());
        out.addProperty("dimension", p.level().dimension().location().toString()); out.addProperty("townDimension", "minecraft:overworld");
        out.addProperty("authority", "native_town_founder"); return out;
    }
    private static JsonObject values(Map<?, ?> map) {
        JsonObject out = new JsonObject(); map.forEach((key, value) -> { if (value instanceof Number n) out.addProperty(key.toString().toLowerCase(Locale.ROOT), n); }); return out;
    }
    private static JsonObject bounds(BoundingBox box) {
        JsonObject out = new JsonObject(); out.add("min", ModRequest.position(new BlockPos(box.minX(), box.minY(), box.minZ())));
        out.add("max", ModRequest.position(new BlockPos(box.maxX(), box.maxY(), box.maxZ()))); return out;
    }
    private static JsonObject building(Object b) {
        JsonObject out = new JsonObject(); out.addProperty("id", get(b, "getBuildingId").toString());
        out.addProperty("typeId", get(b, "getBuildingTypeId").toString()); out.addProperty("name", get(b, "getDisplayName").toString());
        out.addProperty("category", get(b, "getCategory").toString()); out.add("position", ModRequest.position((BlockPos) get(b, "getAnchor")));
        out.addProperty("intact", (Boolean) get(b, "isStructureIntact")); out.addProperty("everCompleted", (Boolean) get(b, "hasEverCompleted"));
        out.addProperty("constructionStarted", (Boolean) get(b, "isConstructionStarted"));
        out.addProperty("queuedTasks", ((Collection<?>) get(b, "getTaskQueue")).size());
        Object task = get(b, "getCurrentTaskId"); out.add("currentTaskId", task == null ? JsonNull.INSTANCE : new JsonPrimitive(task.toString()));
        Object box = get(b, "getBounds"); if (box != null) out.add("bounds", bounds((BoundingBox) box)); return out;
    }
    private static JsonObject state(ServerPlayer p) {
        JsonObject out = base(p); UUID town = own(p);
        out.add("colonyId", town == null ? JsonNull.INSTANCE : new JsonPrimitive(town.toString()));
        if (town == null) { out.addProperty("nextAction", "wandscape.catalog then wandscape.found"); return out; }
        out.addProperty("name", invoke("Colony", "getColonyName", new Class<?>[]{UUID.class}, town).toString());
        for (String[] field : new String[][]{{"level", "getColonyLevel"}, {"xp", "getColonyExp"}, {"requiredXp", "getExpToNext"}})
            out.addProperty(field[0], (Number) invoke("Colony", field[1], new Class<?>[]{UUID.class}, town));
        out.addProperty("active", (Boolean) invoke("Colony", "isActive", new Class<?>[]{UUID.class}, town));
        var buildings = (List<?>) invoke("Building", "getColonyBuildings", new Class<?>[]{UUID.class}, town);
        JsonArray houses = new JsonArray(); buildings.stream().limit(32).forEach(b -> houses.add(building(b)));
        out.add("buildings", houses); out.addProperty("buildingCount", buildings.size()); out.addProperty("buildingsTruncated", buildings.size() > 32);
        var npcs = (List<?>) invoke("Npc", "getColonyNpcs", new Class<?>[]{UUID.class}, town);
        JsonArray people = new JsonArray();
        for (Object npc : npcs.stream().limit(32).toList()) {
            UUID id = (UUID) get(npc, "npcId"); JsonObject row = new JsonObject(); row.addProperty("uuid", id.toString());
            row.addProperty("name", get(npc, "name").toString()); row.addProperty("level", (Number) get(npc, "level"));
            row.addProperty("idle", (Boolean) get(npc, "isIdle")); row.addProperty("dead", (Boolean) get(npc, "isDead"));
            row.addProperty("mana", (Number) get(npc, "mana")); row.add("attributes", values((Map<?, ?>) get(npc, "attributes")));
            var entity = p.getServer().overworld().getEntity(id); row.addProperty("loaded", entity != null);
            if (entity != null) { row.add("position", ModRequest.position(entity.blockPosition())); row.addProperty("health", entity instanceof net.minecraft.world.entity.LivingEntity living ? living.getHealth() : 0); }
            row.addProperty("preset", invoke("Magic", "getStrategyPreset", new Class<?>[]{UUID.class}, id).toString());
            JsonArray spells = new JsonArray(); ((List<?>) get(npc, "spells")).forEach(s -> spells.add(s.toString())); row.add("spells", spells);
            Object task = get(npc, "currentTaskId"); row.add("currentTaskId", task == null ? JsonNull.INSTANCE : new JsonPrimitive(task.toString())); people.add(row);
        }
        out.add("mages", people); out.addProperty("mageCount", npcs.size()); out.addProperty("magesTruncated", npcs.size() > 32);
        out.add("elements", values((Map<?, ?>) invoke("Warehouse", "getAllElements", new Class<?>[]{UUID.class}, town)));
        out.addProperty("storageCapacity", (Number) invoke("Warehouse", "getItemCapacity", new Class<?>[]{UUID.class}, town));
        out.addProperty("storageUsed", (Number) invoke("Warehouse", "getUsedItemCapacity", new Class<?>[]{UUID.class}, town));
        var items = (Map<?, ?>) invoke("Warehouse", "getItemSnapshot", new Class<?>[]{UUID.class}, town); JsonArray stock = new JsonArray();
        for (var entry : items.entrySet().stream().limit(32).toList()) {
            ItemStack item = (ItemStack) call(entry.getKey(), "foundation.util.ItemKey", "toStack", new Class<?>[]{int.class, HolderLookup.Provider.class}, 1, p.registryAccess());
            if (item.isEmpty()) continue;
            JsonObject row = new JsonObject(); row.addProperty("itemId", net.minecraft.core.registries.BuiltInRegistries.ITEM.getKey(item.getItem()).toString());
            row.addProperty("name", item.getHoverName().getString()); row.addProperty("count", (Number) entry.getValue());
            String snbt = ModRequest.snbt(p, item);
            row.add("itemSnbt", snbt.getBytes(java.nio.charset.StandardCharsets.UTF_8).length <= 2048 ? new JsonPrimitive(snbt) : JsonNull.INSTANCE);
            row.addProperty("componentDataOmitted", row.get("itemSnbt").isJsonNull()); stock.add(row);
        }
        out.add("warehouse", stock); out.addProperty("warehouseTypes", items.size()); out.addProperty("warehouseTruncated", items.size() > 32);
        // Full item components can be large. Trim only the read projection,
        // never stored objects, before it reaches the transport's 64 KiB cap.
        for (String[] pair : new String[][]{{"warehouse", "warehouseTruncated"}, {"mages", "magesTruncated"}, {"buildings", "buildingsTruncated"}}) {
            JsonArray rows = out.getAsJsonArray(pair[0]);
            while (!rows.isEmpty() && out.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 58000) {
                rows.remove(rows.size() - 1); out.addProperty(pair[1], true);
            }
        }
        return out;
    }
    private static JsonObject catalog(ServerPlayer p, JsonObject input) {
        int offset = input.has("offset") ? ModRequest.integer(input, "offset", 0, 10000) : 0;
        int limit = input.has("limit") ? ModRequest.integer(input, "limit", 1, 24) : 24;
        var all = (Map<?, ?>) get(loader(), "getAll"); JsonArray rows = new JsonArray(); UUID town = own(p);
        var sorted = all.values().stream().filter(c -> !(Boolean) get(c, "deprecated")).sorted(Comparator.comparing(c -> get(c, "id").toString())).toList();
        for (Object c : sorted.stream().skip(offset).limit(limit).toList()) {
            JsonObject row = new JsonObject(); row.addProperty("id", get(c, "id").toString());
            row.addProperty("name", call(c, "content.building.data.BuildingConfig", "displayNameFor", new Class<?>[]{String.class}, "zh_cn").toString());
            row.addProperty("category", get(c, "category").toString()); row.addProperty("firstFree", (Boolean) get(c, "firstFree"));
            row.addProperty("patternBlocks", ((List<?>) get(c, "pattern")).size());
            BlockPos min = BlockPos.ZERO, max = BlockPos.ZERO;
            for (Object offsetValue : (List<?>) get(c, "pattern")) {
                BlockPos point = new BlockPos(((Number) get(offsetValue, "x")).intValue(), ((Number) get(offsetValue, "y")).intValue(), ((Number) get(offsetValue, "z")).intValue());
                min = BlockPos.min(min, point); max = BlockPos.max(max, point);
            }
            JsonObject footprint = new JsonObject(); footprint.add("minOffset", ModRequest.position(min)); footprint.add("maxOffset", ModRequest.position(max));
            row.add("footprint", footprint);
            row.addProperty("unlocked", (Boolean) call(null, "content.building.internal.BuildingUnlockChecker", "isUnlocked", new Class<?>[]{UUID.class, type("content.building.data.BuildingConfig")}, town, c));
            rows.add(row);
        }
        JsonObject out = base(p); out.add("buildings", rows); out.addProperty("total", sorted.size()); out.addProperty("offset", offset);
        out.add("nextOffset", offset + rows.size() < sorted.size() ? new JsonPrimitive(offset + rows.size()) : JsonNull.INSTANCE);
        JsonArray presets = new JsonArray(); for (Object preset : type("content.npc.component.CastStrategyComponent$Preset").getEnumConstants()) presets.add(preset.toString());
        out.add("strategyPresets", presets); out.addProperty("agentBuildRadius", 48); out.addProperty("agentBuildMaxVolume", 32768);
        out.addProperty("constructionIsAsynchronous", true); out.addProperty("programmaticSpellCastAvailable", false); return out;
    }
    static JsonObject query(ServerPlayer p, String kind, JsonObject input) {
        available();
        if (kind.equals("wandscape_catalog")) { ModRequest.fields(input, "offset", "limit"); return catalog(p, input); }
        ModRequest.fields(input); return state(p);
    }
    private static void site(ServerPlayer p, Object c, BlockPos anchor, int rotation) {
        overworld(p);
        if (anchor.distSqr(p.blockPosition()) > 48L * 48) ModRequest.fail("wandscape_build_site_too_far");
        var pattern = (List<?>) call(null, "content.building.projection.BuildingRotation", "rotateOffsets", new Class<?>[]{List.class, int.class}, get(c, "pattern"), rotation);
        if (pattern.isEmpty() || pattern.size() > 32768) ModRequest.fail("wandscape_build_pattern_too_large");
        BlockPos min = anchor, max = anchor;
        for (Object offset : pattern) {
            BlockPos pos = anchor.offset(((Number) get(offset, "x")).intValue(), ((Number) get(offset, "y")).intValue(), ((Number) get(offset, "z")).intValue());
            min = BlockPos.min(min, pos); max = BlockPos.max(max, pos);
        }
        long volume = ((long) max.getX() - min.getX() + 1) * ((long) max.getY() - min.getY() + 1) * ((long) max.getZ() - min.getZ() + 1);
        if (volume > 32768) ModRequest.fail("wandscape_build_volume_too_large");
        for (BlockPos pos : BlockPos.betweenClosed(min, max)) {
            if (p.level().isOutsideBuildHeight(pos) || !p.level().getWorldBorder().isWithinBounds(pos) || !p.level().isLoaded(pos)) ModRequest.fail("wandscape_site_not_loaded_or_outside_world");
            if (!RpgProtection.allowed(p, "place", pos) || !RpgProtection.allowed(p, "break", pos)) ModRequest.fail("wandscape_site_protected");
        }
    }
    private static Object place(Object config, BlockPos anchor, int rotation, UUID town) {
        return invoke("Building", "placeBuilding", new Class<?>[]{BlockPos.class, String.class, int.class, UUID.class, boolean.class}, anchor, get(config, "id"), rotation, town, false);
    }
    private static JsonObject placed(ServerPlayer p, Object result) {
        JsonObject out = base(p); boolean ok = (Boolean) get(result, "success"); out.addProperty("applied", ok);
        if (!ok) { Object error = get(result, "error"); out.addProperty("reason", error instanceof net.minecraft.network.chat.Component text ? text.getString() : String.valueOf(error)); return out; }
        out.addProperty("constructionComplete", false); out.addProperty("phase", "queued");
        out.addProperty("firstFree", (Boolean) get(result, "firstFree")); out.addProperty("buildingId", get(result, "buildingId").toString()); return out;
    }
    private static Object ownedBuilding(ServerPlayer p, UUID town, BlockPos pos, String category) {
        if (!p.level().isLoaded(pos) || pos.distSqr(p.blockPosition()) > 64) ModRequest.fail("wandscape_building_not_reachable");
        Object b = invoke("Building", "getBuildingAt", new Class<?>[]{BlockPos.class}, pos);
        if (b == null || !town.equals(get(b, "getColonyId"))) ModRequest.fail("wandscape_not_own_building");
        if (!(Boolean) get(b, "isStructureIntact")) ModRequest.fail("wandscape_building_not_complete");
        if (category != null && !category.equals(get(b, "getCategory"))) ModRequest.fail("wandscape_wrong_building_category");
        if (!RpgProtection.allowed(p, "use", pos)) ModRequest.fail("wandscape_building_protected"); return b;
    }
    static Supplier<JsonObject> prepare(ServerPlayer p, String kind, JsonObject input) {
        available(); ModRequest.active(p); overworld(p);
        if (kind.equals("wandscape_found")) {
            ModRequest.fields(input, "position", "name", "rotationSteps");
            if (own(p) != null) return () -> { JsonObject out = state(p); out.addProperty("alreadyFounded", true); return out; };
            String name = ModRequest.text(input, "name", 30).trim(); if (name.isEmpty() || name.chars().anyMatch(Character::isISOControl)) ModRequest.fail("invalid_town_name");
            BlockPos anchor = ModRequest.position(input, "position"); int rotation = ModRequest.integer(input, "rotationSteps", 0, 3);
            Object c = government(); if (c == null) ModRequest.fail("wandscape_government_definition_missing"); site(p, c, anchor, rotation);
            return () -> {
                Object result = place(c, anchor, rotation, null); JsonObject out = placed(p, result);
                if (!out.get("applied").getAsBoolean()) return out;
                Object packet;
                try { packet = type("content.colony.network.ColonyCreateRequestPacket").getConstructor(BlockPos.class, String.class).newInstance(anchor, name); }
                catch (ReflectiveOperationException e) { throw new IllegalStateException("wandscape_create_packet_version_mismatch", e); }
                call(null, "content.colony.network.ColonyCreateRequestPacket", "handleServer", new Class<?>[]{type("content.colony.network.ColonyCreateRequestPacket"), ServerPlayer.class}, packet, p);
                UUID town = own(p); if (town == null) throw new IllegalStateException("wandscape_founding_unconfirmed_do_not_replay");
                out.addProperty("colonyId", town.toString()); out.add("town", state(p)); return out;
            };
        }
        UUID town = requiredTown(p);
        if (kind.equals("wandscape_build")) {
            ModRequest.fields(input, "position", "typeId", "rotationSteps"); Object c = config(ModRequest.text(input, "typeId", 256));
            if (c == null || (Boolean) get(c, "deprecated")) ModRequest.fail("wandscape_unknown_building_type");
            if ("government".equals(get(c, "category"))) ModRequest.fail("wandscape_town_hall_already_exists");
            BlockPos pos = ModRequest.position(input, "position"); int rotation = ModRequest.integer(input, "rotationSteps", 0, 3); site(p, c, pos, rotation);
            return () -> placed(p, place(c, pos, rotation, town));
        }
        if (kind.equals("wandscape_recruit")) {
            ModRequest.fields(input, "position"); BlockPos pos = ModRequest.position(input, "position"); ownedBuilding(p, town, pos, "tavern");
            if (!(Boolean) invoke("Tavern", "canAffordRecruit", new Class<?>[]{UUID.class}, town)) ModRequest.fail("wandscape_recruit_insufficient_elements");
            return () -> { Object id = invoke("Tavern", "recruitForColony", new Class<?>[]{UUID.class, BlockPos.class}, town, pos);
                JsonObject out = state(p); out.addProperty("applied", id != null); out.add("recruitedUuid", id == null ? JsonNull.INSTANCE : new JsonPrimitive(id.toString())); return out; };
        }
        if (kind.equals("wandscape_strategy")) {
            ModRequest.fields(input, "npcUuid", "preset"); UUID npc;
            try { npc = UUID.fromString(ModRequest.text(input, "npcUuid", 36)); } catch (IllegalArgumentException e) { ModRequest.fail("invalid_npcUuid"); return null; }
            UUID id = npc; var people = (List<?>) invoke("Npc", "getColonyNpcs", new Class<?>[]{UUID.class}, town);
            if (people.stream().noneMatch(n -> id.equals(get(n, "npcId")))) ModRequest.fail("wandscape_not_own_mage");
            String preset = ModRequest.text(input, "preset", 16);
            if (!Set.of("BALANCED", "OFFENSIVE", "SUPPORT", "DEFENSIVE").contains(preset)) ModRequest.fail("invalid_strategy_preset");
            var spells = (List<?>) invoke("Magic", "getKnownSpells", new Class<?>[]{UUID.class}, npc);
            return () -> { invoke("Magic", "setEquippedAndStrategy", new Class<?>[]{UUID.class, String.class, List.class}, id, preset, spells); return state(p); };
        }
        if (kind.equals("wandscape_deposit")) {
            ModRequest.fields(input, "position", "inventorySlot", "expectedSnbt", "quantity");
            ownedBuilding(p, town, ModRequest.position(input, "position"), "government");
            int slot = ModRequest.integer(input, "inventorySlot", 0, 35), quantity = ModRequest.integer(input, "quantity", 1, 64);
            ItemStack stack = p.getInventory().getItem(slot); String expected = ModRequest.text(input, "expectedSnbt", 60000);
            if (stack.isEmpty() || stack.getCount() < quantity || !ModRequest.snbt(p, stack).equals(expected)) ModRequest.fail("inventory_item_changed");
            if (RpgStorage.bound(stack)) ModRequest.fail("bound_item_cannot_leave_inventory");
            ItemStack part = stack.copyWithCount(quantity);
            Object key = call(null, "foundation.util.ItemKey", "fromStack", new Class<?>[]{ItemStack.class, HolderLookup.Provider.class}, part, p.registryAccess());
            ItemStack restored = (ItemStack) call(key, "foundation.util.ItemKey", "toStack", new Class<?>[]{int.class, HolderLookup.Provider.class}, quantity, p.registryAccess());
            if (!ItemStack.isSameItemSameComponents(part, restored)) ModRequest.fail("wandscape_item_components_not_roundtrippable");
            return () -> { boolean accepted = (Boolean) invoke("Warehouse", "insertItems", new Class<?>[]{UUID.class, List.class}, town, List.of(part));
                if (accepted) { stack.shrink(quantity); p.getInventory().setChanged(); p.inventoryMenu.broadcastChanges(); }
                JsonObject out = state(p); out.addProperty("applied", accepted); out.addProperty("movedCount", accepted ? quantity : 0); return out; };
        }
        if (kind.equals("wandscape_withdraw")) {
            ModRequest.fields(input, "position", "itemSnbt", "quantity", "expectedAvailable");
            ownedBuilding(p, town, ModRequest.position(input, "position"), "government");
            int quantity = ModRequest.integer(input, "quantity", 1, 64), expected = ModRequest.integer(input, "expectedAvailable", 1, Integer.MAX_VALUE);
            String snbt = ModRequest.text(input, "itemSnbt", 60000); Object selected = null;
            var items = (Map<?, ?>) invoke("Warehouse", "getItemSnapshot", new Class<?>[]{UUID.class}, town);
            for (var entry : items.entrySet()) {
                var item = (ItemStack) call(entry.getKey(), "foundation.util.ItemKey", "toStack", new Class<?>[]{int.class, HolderLookup.Provider.class}, 1, p.registryAccess());
                if (ModRequest.snbt(p, item).equals(snbt)) { if (((Number) entry.getValue()).longValue() != expected) ModRequest.fail("warehouse_item_changed"); selected = entry.getKey(); break; }
            }
            if (selected == null) ModRequest.fail("warehouse_item_not_found"); Object key = selected;
            return () -> {
                // Native extractItem iterates every Container slot; a Player Inventory
                // also includes armour/offhand. Stage only the 36 main slots so loot
                // can never be placed into an invalid equipped slot.
                var main = new net.minecraft.world.SimpleContainer(36);
                for (int i = 0; i < 36; i++) main.setItem(i, p.getInventory().getItem(i).copy());
                long count = ((Number) invoke("Warehouse", "extractItem", new Class<?>[]{UUID.class, type("foundation.util.ItemKey"), long.class, Container.class}, town, key, (long) quantity, main)).longValue();
                if (count > 0) for (int i = 0; i < 36; i++) p.getInventory().setItem(i, main.getItem(i));
                p.getInventory().setChanged(); p.inventoryMenu.broadcastChanges(); JsonObject out = state(p); out.addProperty("applied", count > 0); out.addProperty("movedCount", count); return out;
            };
        }
        ModRequest.fail("unsupported_wandscape_operation"); return null;
    }
}
