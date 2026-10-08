package dev.qiandeng.maw;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.minecolonies.api.colony.IColony;
import com.minecolonies.api.colony.IColonyManager;
import com.minecolonies.api.colony.ICitizenData;
import com.minecolonies.api.colony.buildings.IBuilding;
import com.minecolonies.api.colony.buildings.HiringMode;
import com.minecolonies.api.colony.buildings.modules.IAssignsCitizen;
import com.minecolonies.api.colony.buildings.modules.IAssignsJob;
import com.minecolonies.api.colony.permissions.Action;
import com.minecolonies.api.research.IGlobalResearch;
import com.minecolonies.api.research.IGlobalResearchTree;
import com.minecolonies.core.colony.buildings.workerbuildings.BuildingUniversity;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Set;

/** Native workforce/research operations. No fake citizens, completed builds or free research. */
final class ColonyManagement {
    static final Set<String> QUERIES = Set.of("management", "research");
    static final Set<String> ACTIONS = Set.of("assign_citizen", "hiring_mode", "pause_citizen", "start_research");

    private static IBuilding building(ServerPlayer player, JsonObject input, boolean mutation) {
        var p = ModRequest.position(input, "buildingPosition");
        if (!player.level().isLoaded(p) || player.distanceToSqr(p.getX() + .5, p.getY() + .5, p.getZ() + .5) > 64)
            ModRequest.fail("building_not_reachable");
        IBuilding building = IColonyManager.getInstance().getBuilding(player.level(), p);
        if (building == null || building.getTileEntity() == null) ModRequest.fail("building_missing");
        var permissions = building.getColony().getPermissions();
        if (!permissions.isColonyMember(player)) ModRequest.fail("not_colony_member");
        // Original AbstractColonyServerMessage uses MANAGE_HUTS for these GUI packets.
        if (mutation && !permissions.hasPermission(player, Action.MANAGE_HUTS)) ModRequest.fail("manage_huts_denied");
        return building;
    }
    private static IAssignsCitizen module(IBuilding building, JsonObject input) {
        int id = ModRequest.integer(input, "moduleId", 1, 65535);
        if (!(building.getModule(id) instanceof IAssignsCitizen)) ModRequest.fail("module_does_not_assign_citizens");
        var module = (IAssignsCitizen) building.getModule(id);
        if (!module.getProducer().key.equals(ModRequest.text(input, "expectedModuleKey", 256))) ModRequest.fail("module_identity_changed");
        return module;
    }
    private static JsonArray assigned(IAssignsCitizen module) {
        JsonArray ids = new JsonArray();
        module.getAssignedCitizen().stream().map(ICitizenData::getId).sorted().forEach(ids::add);
        return ids;
    }
    private static JsonObject workforce(IBuilding building) {
        JsonObject state = new JsonObject();
        state.add("buildingPosition", ModRequest.position(building.getPosition()));
        JsonArray modules = new JsonArray();
        for (int i = 0; i < building.getModules().size(); i++) {
            if (!(building.getModules().get(i) instanceof IAssignsCitizen module)) continue;
            if (modules.size() >= 24) break;
            JsonObject row = new JsonObject();
            row.addProperty("moduleId", module.getProducer().getRuntimeID());
            row.addProperty("moduleKey", module.getProducer().key);
            row.addProperty("role", module instanceof IAssignsJob ? "job" : "home");
            row.addProperty("capacity", module.getModuleMax()); row.addProperty("full", module.isFull());
            row.addProperty("hiringMode", module.getHiringMode().name().toLowerCase(Locale.ROOT));
            row.add("assignedCitizenIds", assigned(module)); modules.add(row);
        }
        state.add("modules", modules);
        JsonArray citizens = new JsonArray();
        for (var citizen : building.getColony().getCitizenManager().getCitizens().stream().sorted(Comparator.comparingInt(ICitizenData::getId)).limit(24).toList()) {
            JsonObject row = new JsonObject(); row.addProperty("id", citizen.getId()); row.addProperty("name", citizen.getName());
            row.addProperty("paused", citizen.isPaused());
            row.add("workBuilding", citizen.getWorkBuilding() == null ? JsonNull.INSTANCE : ModRequest.position(citizen.getWorkBuilding().getPosition()));
            row.add("homeBuilding", citizen.getHomeBuilding() == null ? JsonNull.INSTANCE : ModRequest.position(citizen.getHomeBuilding().getPosition()));
            citizens.add(row);
        }
        state.add("citizens", citizens); state.addProperty("citizenCount", building.getColony().getCitizenManager().getCitizens().size());
        return state;
    }
    private static void collect(IGlobalResearchTree tree, ResourceLocation branch, ResourceLocation id, LinkedHashMap<String, IGlobalResearch> rows) {
        if (rows.size() >= 4096 || rows.containsKey(id.toString())) return;
        var research = tree.getResearch(branch, id);
        if (research == null) return;
        rows.put(id.toString(), research);
        for (var child : research.getChildren()) collect(tree, branch, child, rows);
    }
    private static JsonObject researchRow(ServerPlayer player, IBuilding building, IGlobalResearch research) {
        var colony = building.getColony(); var tree = colony.getResearchManager().getResearchTree();
        var local = tree.getResearch(research.getBranch(), research.getId());
        JsonObject row = new JsonObject(); row.addProperty("id", research.getId().toString()); row.addProperty("branch", research.getBranch().toString());
        row.addProperty("name", MutableComponent.create(research.getName()).getString());
        row.addProperty("depth", research.getDepth()); row.addProperty("hidden", research.isHidden());
        row.addProperty("state", local == null ? "not_started" : local.getState().name().toLowerCase(Locale.ROOT));
        row.addProperty("progress", local == null ? 0 : local.getProgress());
        row.addProperty("canResearch", research.canResearch(building, tree));
        row.addProperty("requirementsMet", IGlobalResearchTree.getInstance().isResearchRequirementsFulfilled(research.getResearchRequirements(), colony));
        row.addProperty("hasResources", research.hasEnoughResources(player, building.getPosition()));
        JsonArray costs = new JsonArray();
        for (var cost : research.getCostList()) {
            JsonObject entry = new JsonObject(); entry.addProperty("count", cost.count()); JsonArray items = new JsonArray();
            for (var candidate : cost.getItems()) { if (items.size() >= 12) break; items.add(BuiltInRegistries.ITEM.getKey(candidate.getItem()).toString()); }
            entry.add("items", items); entry.addProperty("itemsTruncated", cost.getItems().length > 12); costs.add(entry);
        }
        row.add("costs", costs); return row;
    }
    static JsonObject query(ServerPlayer player, JsonObject input) {
        String kind = input.get("kind").getAsString(); JsonObject result = result(input);
        try {
            ModRequest.fields(input, "buildingPosition", "offset", "limit");
            IBuilding building = building(player, input, false);
            result.addProperty("manageHutsAllowed", building.getColony().getPermissions().hasPermission(player, Action.MANAGE_HUTS));
            if (kind.equals("management")) result.add("state", workforce(building));
            else {
                if (!(building instanceof BuildingUniversity)) ModRequest.fail("university_required");
                var tree = IGlobalResearchTree.getInstance(); var all = new LinkedHashMap<String, IGlobalResearch>();
                for (var branch : tree.getBranches()) for (var id : tree.getPrimaryResearch(branch)) collect(tree, branch, id, all);
                var rows = new ArrayList<>(all.values()); rows.sort(Comparator.comparing(r -> r.getId().toString()));
                int offset = input.has("offset") ? ModRequest.integer(input, "offset", 0, 10000) : 0;
                int limit = input.has("limit") ? ModRequest.integer(input, "limit", 1, 12) : 12;
                JsonArray page = new JsonArray();
                for (int i = offset; i < Math.min(rows.size(), offset + limit); i++) page.add(researchRow(player, building, rows.get(i)));
                result.add("research", page); result.addProperty("total", rows.size()); result.addProperty("offset", offset);
                result.addProperty("hasMore", offset + page.size() < rows.size());
            }
            result.addProperty("ok", true);
        } catch (ModRequest.Invalid e) { reject(result, e.getMessage()); }
        catch (RuntimeException e) { reject(result, "colony_management_query_failed"); }
        return result;
    }
    static JsonObject action(ServerPlayer player, JsonObject input) {
        String kind = input.get("kind").getAsString(); JsonObject result = result(input); boolean started = false;
        try {
            ModRequest.fields(input, "buildingPosition", "moduleId", "expectedModuleKey", "citizenId", "assign", "expectedAssignedCitizenIds", "mode", "expectedMode", "paused", "expectedPaused", "researchId");
            ModRequest.active(player); IBuilding building = building(player, input, true); IColony colony = building.getColony();
            result.add("before", workforce(building));
            if (kind.equals("hiring_mode")) {
                var module = module(building, input);
                if (!module.getHiringMode().name().equalsIgnoreCase(ModRequest.text(input, "expectedMode", 16))) ModRequest.fail("hiring_mode_changed");
                HiringMode mode;
                try { mode = HiringMode.valueOf(ModRequest.text(input, "mode", 16).toUpperCase(Locale.ROOT)); }
                catch (IllegalArgumentException e) { ModRequest.fail("invalid_hiring_mode"); return result; }
                started = true; module.setHiringMode(mode);
                result.addProperty("ok", module.getHiringMode() == mode);
            } else if (kind.equals("assign_citizen")) {
                var module = module(building, input);
                JsonArray expected = ModRequest.array(input, "expectedAssignedCitizenIds", 24);
                if (!assigned(module).equals(expected)) ModRequest.fail("assigned_citizens_changed");
                var citizen = colony.getCitizenManager().getCivilian(ModRequest.integer(input, "citizenId", 1, Integer.MAX_VALUE));
                if (citizen == null) ModRequest.fail("citizen_missing");
                boolean assign = ModRequest.bool(input, "assign");
                if (assign && module.isFull() && !module.hasAssignedCitizen(citizen)) ModRequest.fail("module_full");
                var existing = module instanceof IAssignsJob ? citizen.getWorkBuilding() : citizen.getHomeBuilding();
                if (assign && existing != null && existing != building) ModRequest.fail("citizen_assigned_elsewhere_unassign_first");
                if (!assign && !module.hasAssignedCitizen(citizen)) ModRequest.fail("citizen_not_assigned_here");
                started = true;
                if (assign) module.assignCitizen(citizen); else module.removeCitizen(citizen);
                if (module instanceof IAssignsJob) citizen.setPaused(false);
                result.addProperty("ok", module.hasAssignedCitizen(citizen) == assign);
            } else if (kind.equals("pause_citizen")) {
                var citizen = colony.getCitizenManager().getCivilian(ModRequest.integer(input, "citizenId", 1, Integer.MAX_VALUE));
                if (citizen == null) ModRequest.fail("citizen_missing");
                if (citizen.isPaused() != ModRequest.bool(input, "expectedPaused")) ModRequest.fail("citizen_pause_changed");
                boolean paused = ModRequest.bool(input, "paused"); started = true; citizen.setPaused(paused);
                result.addProperty("ok", citizen.isPaused() == paused);
            } else if (kind.equals("start_research")) {
                if (!(building instanceof BuildingUniversity)) ModRequest.fail("university_required");
                var id = ResourceLocation.tryParse(ModRequest.text(input, "researchId", 256));
                var research = id == null ? null : IGlobalResearchTree.getInstance().getResearch(id);
                if (research == null) ModRequest.fail("research_missing");
                var tree = colony.getResearchManager().getResearchTree();
                result.add("researchBefore", researchRow(player, building, research));
                if (tree.getResearch(research.getBranch(), research.getId()) != null) ModRequest.fail("research_already_started");
                if (!research.canResearch(building, tree)) ModRequest.fail("research_prerequisites_not_met");
                if (!IGlobalResearchTree.getInstance().isResearchRequirementsFulfilled(research.getResearchRequirements(), colony)) ModRequest.fail("research_requirements_not_met");
                if (!research.hasEnoughResources(player, building.getPosition())) ModRequest.fail("research_resources_missing");
                started = true;
                tree.attemptBeginResearch(player, colony, (BuildingUniversity) building, research);
                result.add("researchAfter", researchRow(player, building, research));
                result.addProperty("ok", tree.getResearch(research.getBranch(), research.getId()) != null);
            } else ModRequest.fail("unsupported_management_action");
            building.markDirty(); colony.markDirty(); player.containerMenu.broadcastChanges();
            result.add("after", workforce(building)); result.addProperty("code", result.get("ok").getAsBoolean() ? "native_management_verified" : "native_management_not_applied");
        } catch (ModRequest.Invalid e) { reject(result, e.getMessage()); }
        catch (RuntimeException e) { reject(result, started ? "colony_management_outcome_unknown" : "colony_management_failed"); result.addProperty("outcomeKnown", !started); }
        return result;
    }
    private static JsonObject result(JsonObject input) {
        JsonObject result = new JsonObject(); result.addProperty("schemaVersion", 1); result.addProperty("kind", "colony_receipt");
        result.addProperty("requestId", input.get("requestId").getAsString()); result.addProperty("action", input.get("kind").getAsString());
        result.addProperty("outcomeKnown", true); result.addProperty("retryAutomatically", false); return result;
    }
    private static void reject(JsonObject result, String code) { result.addProperty("ok", false); result.addProperty("code", code); }
}
