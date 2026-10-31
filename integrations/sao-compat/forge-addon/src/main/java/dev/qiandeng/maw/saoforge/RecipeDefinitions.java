package dev.qiandeng.maw.saoforge;

import com.google.gson.JsonObject;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.crafting.Recipe;

/** Read-only source from the actual successful Forge decoder, never a guessed
 * reconstruction or an unfiltered datapack file. Object identity rejects stale
 * sources if KubeJS or another mod replaces a recipe after deserialization. */
public final class RecipeDefinitions {
    private record Entry(Recipe<?> recipe, JsonObject definition, int bytes, String decoder) {}
    private static final Map<ResourceLocation,Entry> SOURCES=new HashMap<>();
    private static final int MAX_ROWS=100000, MAX_BYTES=64*1024*1024, ROW_BYTES=8192;
    private static int bytes;
    private static long generation;
    private RecipeDefinitions() {}
    public static synchronized void beginReload() { SOURCES.clear();bytes=0;generation++; }
    public static synchronized void record(ResourceLocation id,JsonObject json,Recipe<?> recipe) {
        record(id,json,recipe,"forge_recipe_manager_from_json");
    }
    public static synchronized void record(ResourceLocation id,JsonObject json,Recipe<?> recipe,String decoder) {
        // Observation must not break an otherwise successful third-party decoder.
        try {
            if(id==null||json==null||recipe==null||!id.equals(recipe.getId()))return;
            Entry prior=SOURCES.remove(id);if(prior!=null)bytes-=prior.bytes;
            int size=json.toString().getBytes(StandardCharsets.UTF_8).length;
            if(size>ROW_BYTES||SOURCES.size()>=MAX_ROWS||bytes+size>MAX_BYTES)return;
            SOURCES.put(id,new Entry(recipe,json.deepCopy(),size,decoder));bytes+=size;
        }catch(RuntimeException unavailable){/* The query retains definitionAvailable=false. */}
    }
    public static synchronized JsonObject definition(Recipe<?> recipe) {
        try {Entry entry=SOURCES.get(recipe.getId());return entry!=null&&entry.recipe==recipe?entry.definition.deepCopy():null;}
        catch(RuntimeException unavailable){return null;}
    }
    public static synchronized long generation() { return generation; }
    public static synchronized String decoder(Recipe<?> recipe) {
        try {Entry entry=SOURCES.get(recipe.getId());return entry!=null&&entry.recipe==recipe?entry.decoder:null;}
        catch(RuntimeException unavailable){return null;}
    }
}
