package dev.qiandeng.maw.numenmods;

import net.neoforged.fml.ModList;
import net.minecraft.core.registries.BuiltInRegistries;
import java.util.*;

/** Native interactivity is separate from validated full gameplay automation. */
final class ModCatalog {
    static final Map<String,String> WORKFLOWS=Map.ofEntries(
        Map.entry("minecolonies","colony.capabilities/status -> real hut materials -> colony.found/placeHut -> requestBuild -> resources/stockResource/deliver -> management. Real workers, requests, research and construction; no instant completion."),
        Map.entry("domum_ornamentum","Open the actual architect cutter; domum.state/choices/select; numen.gui.move/quick takes the real component-bearing output."),
        Map.entry("create","Inspect actual settings/fluids; hold the required wrench/filter; create.setValue/setFilter; use native Lua to place, turn and supply machines. Moving vehicle navigation requires separate validation."),
        Map.entry("curios","curios.state -> curios.open -> numen.gui.view/move -> curios.page. Equipment must exist in the same body's inventory."),
        Map.entry("irons_spellbooks","iron.list/status -> iron.cast from actually equipped book/scroll. Native mana, cooldown, cast duration and target rules apply; query status to verify effects."),
        Map.entry("farmersdelight","numen.inv.recipes -> numen.use.block -> numen.gui.view/move/quick; menu.snapshot reads native slots, components and progress. Cook using real ingredients and heat."),
        Map.entry("touhou_little_maid","Official tlm.maid.list/info/task/config/open and tlm.altar.recipes; tame with real cake via numen.use.entity. Ownership and native task prerequisites apply."),
        Map.entry("sophisticatedbackpacks","Use the actual backpack with numen.use.item; menu.snapshot and numen.gui move/quick operate the real storage/upgrade slots. Verify the actual menu after use."),
        Map.entry("functionalstorage","Native block use and the real storage handler/menu; use full item identity and actual slot rules. Drawer capacity and upgrades remain native."),
        Map.entry("toms_storage","Build the native connected storage network, open its actual terminal, inspect menu.snapshot and use native GUI slots. Client-only recipe-transfer widgets are not advertised as server APIs."),
        Map.entry("waystones","Native stone activation and unlocked destination rules. UI-only travel actions require the actual mod adapter; do not treat menu opening as verified teleportation."),
        Map.entry("smartnpc","Native entity interaction and actual menus; NPC autonomous model calls require their own configured model. No simulated NPC reply or task success."),
        Map.entry("openpartiesandclaims","Native claims and permissions remain authoritative for all normal body actions. No operator bypass or automatic territory changes."));
    static List<CatalogLua.ModInfo> rows() {
        return ModList.get().getMods().stream().sorted(Comparator.comparing(m->m.getModId())).map(m->row(m.getModId())).toList();
    }
    static CatalogLua.ModInfo row(String id) {
        if(id==null||!id.matches("[a-z][a-z0-9_]{0,127}"))throw new IllegalArgumentException("invalid_mod_id");
        var mod=ModList.get().getModContainerById(id).map(c->c.getModInfo()).orElse(null);
        if(mod==null)return new CatalogLua.ModInfo(id,id,"","not_installed",List.of(),"Install and validate the target mod before invoking its operations.");
        var ops=ModAccess.idsFor(id);boolean content=BuiltInRegistries.ITEM.keySet().stream().anyMatch(k->k.getNamespace().equals(id))
            ||BuiltInRegistries.BLOCK.keySet().stream().anyMatch(k->k.getNamespace().equals(id));
        String level=!ops.isEmpty()?"native_extension":content?"native_lua_interaction":"library_or_service";
        var all=new ArrayList<>(ops);if(content)all.addAll(List.of("numen.inv.recipes","numen.use.block","numen.use.item","numen.gui.view","numen.gui.move","menu.snapshot"));
        if(id.equals("touhou_little_maid"))all.addAll(List.of("tlm.maid.list","tlm.maid.info","tlm.maid.task","tlm.maid.config","tlm.maid.open","tlm.altar.recipes"));
        return new CatalogLua.ModInfo(id,mod.getDisplayName(),mod.getVersion().toString(),level,List.copyOf(new LinkedHashSet<>(all)),
            WORKFLOWS.getOrDefault(id,content?"Use actual native item IDs/recipes and block/entity/menu interactions. A specific workflow is not yet validated.":"Library, compatibility, rendering or service module; no player action is invented."));
    }
}
