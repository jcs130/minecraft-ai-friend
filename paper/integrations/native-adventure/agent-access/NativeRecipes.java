package dev.qiandeng.maw.taunative;

import com.google.gson.*;
import com.mojang.serialization.JsonOps;
import java.nio.charset.StandardCharsets;
import java.util.*;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.RegistryOps;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.*;

/** Native recipe codecs keep this module independent of optional mod classes. */
final class NativeRecipes {
    private static String field(JsonObject args, String key) { return args.has(key) ? args.get(key).getAsString() : null; }
    private static int bytes(JsonElement value) { return value.toString().getBytes(StandardCharsets.UTF_8).length; }
    private static JsonElement item(ServerPlayer p, ItemStack stack) {
        if (stack.isEmpty()) return JsonNull.INSTANCE;
        JsonObject row=new JsonObject();row.addProperty("id",BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
        row.addProperty("count",stack.getCount());
        row.add("components",ItemStack.CODEC.encodeStart(RegistryOps.create(JsonOps.INSTANCE,p.registryAccess()),stack).getOrThrow());
        return row;
    }
    static void query(ServerPlayer p, JsonObject args, JsonObject out) {
        String id=field(args,"recipeId"),type=field(args,"recipeType"),output=field(args,"outputId");
        int offset=args.has("offset")?args.get("offset").getAsInt():0,limit=args.has("limit")?args.get("limit").getAsInt():6;
        List<RecipeHolder<?>> matched=p.serverLevel().getRecipeManager().getRecipes().stream()
            .filter(h->id==null||id.equals(h.id().toString()))
            .filter(h->type==null||type.equals(BuiltInRegistries.RECIPE_TYPE.getKey(h.value().getType()).toString()))
            .filter(h->{if(output==null)return true;var s=h.value().getResultItem(p.registryAccess());return !s.isEmpty()&&output.equals(BuiltInRegistries.ITEM.getKey(s.getItem()).toString());})
            .sorted(Comparator.comparing(h->h.id().toString())).toList();
        out.addProperty("source","server_recipe_manager_native_codec");
        out.addProperty("outputFilterScope","declared_display_result_only_not_probabilistic_byproducts");
        out.addProperty("matchedCount",matched.size());out.addProperty("offset",offset);
        JsonArray rows=new JsonArray();out.add("recipes",rows);int next=Math.min(offset,matched.size());
        while(next<matched.size()&&rows.size()<limit){
            var h=matched.get(next);var r=h.value();JsonObject row=new JsonObject();
            row.addProperty("recipeId",h.id().toString());row.addProperty("type",BuiltInRegistries.RECIPE_TYPE.getKey(r.getType()).toString());
            row.addProperty("serializer",BuiltInRegistries.RECIPE_SERIALIZER.getKey(r.getSerializer()).toString());
            row.addProperty("definitionAvailable",false);row.addProperty("machineExecutionVerified",false);
            try{
                row.add("nativeDefinition",Recipe.CODEC.encodeStart(RegistryOps.create(JsonOps.INSTANCE,p.registryAccess()),r).getOrThrow());
                row.add("output",item(p,r.getResultItem(p.registryAccess())));
                row.addProperty("definitionAvailable",true);
                if(bytes(row)>8192){row.remove("nativeDefinition");row.remove("output");row.addProperty("definitionAvailable",false);row.addProperty("code","recipe_definition_too_large");}
            }catch(RuntimeException unavailable){row.remove("nativeDefinition");row.remove("output");row.addProperty("definitionAvailable",false);row.addProperty("code","native_recipe_codec_unavailable");}
            if(bytes(out)+bytes(row)>15000)break;
            rows.add(row);next++;
        }
        out.addProperty("truncated",next<matched.size());
        if(next<matched.size())out.addProperty("nextOffset",next);else out.add("nextOffset",JsonNull.INSTANCE);
    }
}
