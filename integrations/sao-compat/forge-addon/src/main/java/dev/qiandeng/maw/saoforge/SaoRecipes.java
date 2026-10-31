package dev.qiandeng.maw.saoforge;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.*;
import net.minecraftforge.registries.ForgeRegistries;

/** Actual loaded recipes + exact successful decoder inputs, bounded per query.
 * A recipe definition does not execute a machine or promise dynamic outputs. */
final class SaoRecipes {
    private static int bytes(JsonElement value){return value.toString().getBytes(StandardCharsets.UTF_8).length;}
    private static String field(JsonObject args,String key){return args.has(key)?args.get(key).getAsString():null;}
    private static String identity(Recipe<?> recipe) {try {var id=recipe.getId();return id==null?null:id.toString();}catch(RuntimeException unavailable){return null;}}
    private static String type(Recipe<?> recipe) {try {var id=ForgeRegistries.RECIPE_TYPES.getKey(recipe.getType());return id==null?null:id.toString();}catch(RuntimeException unavailable){return null;}}
    private static String serializer(Recipe<?> recipe) {try {var id=ForgeRegistries.RECIPE_SERIALIZERS.getKey(recipe.getSerializer());return id==null?null:id.toString();}catch(RuntimeException unavailable){return null;}}
    private static JsonElement item(ItemStack original) {
        if(original.isEmpty())return JsonNull.INSTANCE;
        ItemStack s=original.copy();var row=new JsonObject();row.addProperty("id",BuiltInRegistries.ITEM.getKey(s.getItem()).toString());
        row.addProperty("count",s.getCount());row.addProperty("maxStackSize",s.getMaxStackSize());row.addProperty("damage",s.getDamageValue());
        String raw=s.save(new CompoundTag()).toString();int size=raw.getBytes(StandardCharsets.UTF_8).length;
        row.addProperty("componentBytes",size);row.addProperty("componentFingerprint",NativePolicy.sha(raw));row.addProperty("componentsComplete",size<=4096);
        if(size<=4096)row.addProperty("snbt",raw);else row.add("snbt",JsonNull.INSTANCE);
        return row;
    }
    private static JsonObject describe(ServerPlayer p,Recipe<?> r) {
        var row=new JsonObject();row.addProperty("recipeId",identity(r));row.addProperty("type",type(r));
        row.addProperty("serializer",serializer(r));row.addProperty("machineExecutionVerified",false);
        if(type(r)==null)row.addProperty("typeUnavailableReason","native_type_not_registered_or_context_required");
        if(serializer(r)==null)row.addProperty("serializerUnavailableReason","native_serializer_not_registered_or_context_required");
        var definition=RecipeDefinitions.definition(r);row.addProperty("definitionAvailable",definition!=null);
        if(definition!=null){row.add("nativeDefinition",definition);row.addProperty("definitionSource","successful_native_recipe_decoder_same_loaded_instance");row.addProperty("decoder",RecipeDefinitions.decoder(r));}
        else {row.add("nativeDefinition",JsonNull.INSTANCE);row.addProperty("definitionUnavailableReason","source_not_captured_or_replaced_or_over_budget");}
        try {row.add("output",item(r.getResultItem(p.serverLevel().registryAccess())));row.addProperty("outputScope","declared_display_result_not_input_dependent_assembly_or_probabilistic_byproducts");}
        catch(RuntimeException unavailable){row.add("output",JsonNull.INSTANCE);row.addProperty("outputUnavailableReason","runtime_context_required");}
        if(r instanceof ShapedRecipe shaped){var grid=new JsonObject();grid.addProperty("width",shaped.getWidth());grid.addProperty("height",shaped.getHeight());grid.addProperty("order","row_major_including_empty_slots");row.add("craftingGrid",grid);}
        else if(r instanceof ShapelessRecipe)row.addProperty("craftingOrder","shapeless");
        if(r instanceof AbstractCookingRecipe cooking){row.addProperty("cookingTicks",cooking.getCookingTime());row.addProperty("experience",cooking.getExperience());}
        var ingredients=new JsonArray();row.add("ingredients",ingredients);boolean complete=true;
        try {
            var input=r.getIngredients();int count=Math.min(input.size(),64);row.addProperty("requestedIngredientCount",input.size());
            for(int i=0;i<count;i++){
                Ingredient ingredient=input.get(i);var in=new JsonObject();in.addProperty("index",i);in.addProperty("emptySlot",ingredient.isEmpty());
                try {in.add("nativeDefinition",ingredient.toJson());}catch(RuntimeException unavailable){in.add("nativeDefinition",JsonNull.INSTANCE);complete=false;}
                ItemStack[] choices=ingredient.getItems();var list=new JsonArray();for(int j=0;j<Math.min(choices.length,16);j++)list.add(item(choices[j]));
                in.add("choices",list);in.addProperty("alternativeCount",choices.length);in.addProperty("returnedAlternativeCount",list.size());in.addProperty("complete",choices.length==list.size());
                if(choices.length!=list.size())complete=false;ingredients.add(in);
            }
            if(count!=input.size())complete=false;
        }catch(RuntimeException unavailable){complete=false;row.addProperty("ingredientsUnavailableReason","native_ingredient_context_required");}
        row.addProperty("ingredientsComplete",complete);row.addProperty("alternativesAreChoicesNotSimultaneousInputs",true);
        if(bytes(row)>8192){row.remove("ingredients");row.addProperty("ingredientsComplete",false);row.addProperty("ingredientExpansionOmittedReason","recipe_row_budget");}
        if(bytes(row)>8192){row.remove("nativeDefinition");row.addProperty("definitionAvailable",false);row.addProperty("definitionUnavailableReason","recipe_row_budget");}
        if(bytes(row)>8192){row.remove("output");row.addProperty("outputUnavailableReason","recipe_row_budget");}
        return row;
    }
    static void query(ServerPlayer p,JsonObject args,JsonObject out) {
        String id=field(args,"recipeId"),type=field(args,"recipeType"),output=field(args,"outputId");
        int offset=args.has("offset")?args.get("offset").getAsInt():0,limit=args.has("limit")?args.get("limit").getAsInt():6;
        List<Recipe<?>> matched=new ArrayList<>();int unknownOutputs=0,unknownTypes=0,unknownIdentities=0;
        for(Recipe<?> recipe:p.serverLevel().getRecipeManager().getRecipes()) {
            String actualId=identity(recipe);if(actualId==null){unknownIdentities++;continue;}
            if(id!=null&&!id.equals(actualId))continue;
            if(type!=null){String actualType=type(recipe);if(actualType==null){unknownTypes++;continue;}if(!type.equals(actualType))continue;}
            if(output!=null){try{ItemStack result=recipe.getResultItem(p.serverLevel().registryAccess());if(result.isEmpty()||!output.equals(BuiltInRegistries.ITEM.getKey(result.getItem()).toString()))continue;}catch(RuntimeException unavailable){unknownOutputs++;continue;}}
            matched.add(recipe);
        }
        matched.sort(Comparator.comparing(SaoRecipes::identity));out.addProperty("source","loaded_server_recipe_manager_and_exact_decoder_inputs");
        out.addProperty("recipeGeneration",RecipeDefinitions.generation());out.addProperty("outputFilterScope","declared_display_result_only");
        int unknown=unknownOutputs+unknownTypes+unknownIdentities;
        out.addProperty("filterCoverageComplete",unknown==0);out.addProperty("unreadableRecipeCount",unknown);out.addProperty("unreadableTypeCount",unknownTypes);out.addProperty("unreadableOutputCount",unknownOutputs);out.addProperty("unreadableIdentityCount",unknownIdentities);out.addProperty("matchedCountIsLowerBound",unknown>0);
        out.addProperty("matchedCount",matched.size());out.addProperty("offset",offset);var rows=new JsonArray();out.add("recipes",rows);int next=Math.min(offset,matched.size());
        while(next<matched.size()&&rows.size()<limit){JsonObject row=describe(p,matched.get(next));if(bytes(out)+bytes(row)>15000)break;rows.add(row);next++;}
        out.addProperty("truncated",next<matched.size());out.addProperty("returnedCount",rows.size());out.addProperty("remainingCount",matched.size()-next);
        if(next<matched.size())out.addProperty("nextOffset",next);else out.add("nextOffset",JsonNull.INSTANCE);
        boolean definitionsComplete=true;for(var row:rows)if(!row.getAsJsonObject().get("definitionAvailable").getAsBoolean())definitionsComplete=false;
        boolean complete=next>=matched.size()&&definitionsComplete&&unknown==0;
        out.addProperty("definitionsComplete",definitionsComplete);out.addProperty("complete",complete);out.addProperty("status",complete?"ok":"partial");
        if(unknown>0)out.addProperty("partialReason","recipe_filter_context_incomplete");
        else if(!definitionsComplete)out.addProperty("partialReason","recipe_source_definition_incomplete");
        else if(!complete)out.addProperty("partialReason","recipe_page_or_byte_budget");
    }
}
