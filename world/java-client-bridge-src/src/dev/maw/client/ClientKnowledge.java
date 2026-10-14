package dev.maw.client;

import com.google.gson.*;
import com.mojang.serialization.JsonOps;
import net.minecraft.client.Minecraft;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;
import net.minecraft.world.item.crafting.*;
import java.time.Instant;
import java.util.*;
import static dev.maw.client.ClientState.object;

/** Reads this connection's real registries and synchronized recipes; no server counterpart. */
final class ClientKnowledge {
    private final ClientState state;
    ClientKnowledge(ClientState state){this.state=state;}
    private JsonObject base(Minecraft mc){return object("ok",true,"bodyId",mc.player.getUUID(),"connectionId",state.connectionId(),
        "capturedAt",Instant.now(),"capturedTick",state.tick(),"source","native_client_registry_and_synced_recipes","authority","client_observed");}
    private static String text(JsonObject a,String key,String fallback){
        if(!a.has(key))return fallback;
        if(!a.get(key).isJsonPrimitive()||!a.getAsJsonPrimitive(key).isString())throw new IllegalArgumentException("knowledge_string_required");
        String value=a.get(key).getAsString();if(value.length()>160)throw new IllegalArgumentException("knowledge_query_too_long");return value;
    }
    private static int integer(JsonObject a,String key,int fallback,int max){
        if(!a.has(key))return fallback;
        double n=a.get(key).getAsDouble();if(!Double.isFinite(n)||n!=Math.floor(n)||n<0||n>max)throw new IllegalArgumentException("knowledge_integer_range");return (int)n;
    }
    JsonObject read(Minecraft mc,String op,JsonObject args){return switch(op){
        case "knowledge.items"->items(mc,args);
        case "knowledge.item"->item(mc,args);
        case "knowledge.recipes"->recipes(mc,args);
        case "knowledge.recipe"->recipe(mc,args);
        default->throw new IllegalArgumentException("knowledge_operation_unavailable");};}
    private JsonObject items(Minecraft mc,JsonObject a){
        String query=text(a,"query","").toLowerCase(Locale.ROOT),namespace=text(a,"namespace","");
        int offset=integer(a,"offset",0,100000),limit=integer(a,"limit",16,32);if(limit==0)throw new IllegalArgumentException("knowledge_limit_required");
        JsonArray rows=new JsonArray();int matched=0;
        for(Item item:BuiltInRegistries.ITEM){var id=BuiltInRegistries.ITEM.getKey(item);var stack=item.getDefaultInstance();
            String name=stack.getHoverName().getString();
            if((!namespace.isEmpty()&&!id.getNamespace().equals(namespace))||(!query.isEmpty()&&!id.toString().toLowerCase(Locale.ROOT).contains(query)&&!name.toLowerCase(Locale.ROOT).contains(query)))continue;
            if(matched++>=offset&&rows.size()<limit)rows.add(object("id",id,"name",name,"maxStackSize",stack.getMaxStackSize()));
        }
        JsonObject out=base(mc);out.add("items",rows);out.addProperty("total",matched);out.add("nextOffset",offset+rows.size()<matched?new JsonPrimitive(offset+rows.size()):JsonNull.INSTANCE);return out;
    }
    private JsonObject item(Minecraft mc,JsonObject a){
        ItemStack stack;String origin;
        if(a.has("slot")){int slot=integer(a,"slot",0,45);stack=mc.player.inventoryMenu.slots.get(slot).getItem();origin=slot==0?"crafting_result_preview_not_owned":"owned_player_menu_slot";}
        else{var id=ResourceLocation.parse(text(a,"id",""));if(!BuiltInRegistries.ITEM.containsKey(id))return object("ok",false,"code","item_not_registered");stack=BuiltInRegistries.ITEM.get(id).getDefaultInstance();origin="registry_default_stack_not_owned";}
        JsonObject out=base(mc);out.addProperty("stackSource",origin);out.add("item",state.item(mc,stack));JsonArray tips=new JsonArray();
        for(var line:stack.getTooltipLines(Item.TooltipContext.of(mc.level),mc.player,TooltipFlag.ADVANCED)){
            if(tips.size()>=64)break;String text=line.getString();tips.add(text.length()>2000?text.substring(0,2000):text);
        }
        out.add("tooltip",tips);out.addProperty("tooltipSource","native_item_tooltip_untrusted_game_text");return out;
    }
    private JsonObject summary(Minecraft mc,RecipeHolder<?> holder){
        Recipe<?> recipe=holder.value();var result=recipe.getResultItem(mc.level.registryAccess());
        JsonObject row=object("id",holder.id(),"type",BuiltInRegistries.RECIPE_TYPE.getKey(recipe.getType()),
            "serializer",BuiltInRegistries.RECIPE_SERIALIZER.getKey(recipe.getSerializer()),"special",recipe.isSpecial(),"unlocked",mc.player.getRecipeBook().contains(holder));
        row.add("result",state.item(mc,result));
        if(recipe.getType()==RecipeType.CRAFTING)row.addProperty("workstation",recipe.canCraftInDimensions(2,2)?"player_crafting_2x2":"crafting_table_3x3");
        else row.add("workstation",JsonNull.INSTANCE);
        if(recipe instanceof ShapedRecipe shaped){row.addProperty("width",shaped.getWidth());row.addProperty("height",shaped.getHeight());}
        return row;
    }
    private JsonObject recipes(Minecraft mc,JsonObject a){
        String output=text(a,"outputId",""),query=text(a,"query","").toLowerCase(Locale.ROOT);
        int offset=integer(a,"offset",0,100000),limit=integer(a,"limit",16,32);if(limit==0)throw new IllegalArgumentException("knowledge_limit_required");
        JsonArray rows=new JsonArray();int matched=0,unreadable=0;
        for(var holder:mc.getConnection().getRecipeManager().getRecipes())try{
            var result=holder.value().getResultItem(mc.level.registryAccess());
            if((!output.isEmpty()&&(result.isEmpty()||!BuiltInRegistries.ITEM.getKey(result.getItem()).toString().equals(output)))||
                (!query.isEmpty()&&!holder.id().toString().toLowerCase(Locale.ROOT).contains(query)&&!result.getHoverName().getString().toLowerCase(Locale.ROOT).contains(query)))continue;
            if(matched++>=offset&&rows.size()<limit)rows.add(summary(mc,holder));
        }catch(RuntimeException unavailable){unreadable++;}
        JsonObject out=base(mc);out.add("recipes",rows);out.addProperty("total",matched);out.addProperty("unreadableRecipeCount",unreadable);
        out.add("nextOffset",offset+rows.size()<matched?new JsonPrimitive(offset+rows.size()):JsonNull.INSTANCE);return out;
    }
    private JsonObject recipe(Minecraft mc,JsonObject a){
        var holder=mc.getConnection().getRecipeManager().byKey(ResourceLocation.parse(text(a,"id","")));
        if(holder.isEmpty())return object("ok",false,"code","recipe_not_synced_to_this_client");
        JsonObject out=base(mc),description=summary(mc,holder.get());Recipe<?> recipe=holder.get().value();JsonArray ingredients=new JsonArray();
        for(var ingredient:recipe.getIngredients()){
            var options=ingredient.getItems();JsonArray alternatives=new JsonArray();
            for(int i=0;i<Math.min(options.length,16);i++)alternatives.add(state.item(mc,options[i]));
            ingredients.add(object("totalAlternatives",options.length,"alternatives",alternatives));
        }
        description.add("ingredients",ingredients);out.add("recipe",description);
        var encoded=Recipe.CODEC.encodeStart(mc.level.registryAccess().createSerializationContext(JsonOps.INSTANCE),recipe);
        if(encoded.result().isPresent()){
            JsonElement data=encoded.result().get();if(data.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length<=65536)out.add("nativeJson",data);
            else out.addProperty("nativeJsonUnavailable","recipe_json_over_64k");
        }else out.addProperty("nativeJsonUnavailable","recipe_codec_unavailable");
        out.addProperty("nativeJsonSource","actual_recipe_serializer_codec");return out;
    }
}
