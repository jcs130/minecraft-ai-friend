package dev.qiandeng.maw.saoforge.mixins;

import com.google.gson.JsonObject;
import dev.qiandeng.maw.saoforge.RecipeDefinitions;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.crafting.Recipe;
import net.minecraft.world.item.crafting.RecipeSerializer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Pseudo;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** KubeJS 2001.6.5-build.26 bypasses RecipeManager.fromJson. Observe its
 * successful Forge serializer result; never execute a second decode or modify it. */
@Pseudo
@Mixin(targets="dev.latvian.mods.kubejs.platform.forge.RecipeForgeHelper",remap=false)
public abstract class KubeRecipeDecodeMixin {
    @Inject(method="fromJson(Lnet/minecraft/world/item/crafting/RecipeSerializer;Lnet/minecraft/resources/ResourceLocation;Lcom/google/gson/JsonObject;)Lnet/minecraft/world/item/crafting/Recipe;",at=@At("RETURN"),remap=false)
    private void source(RecipeSerializer<?> serializer,ResourceLocation id,JsonObject json,CallbackInfoReturnable<Recipe<?>> ci) {
        RecipeDefinitions.record(id,json,ci.getReturnValue(),"kubejs_forge_recipe_serializer_from_json");
    }
}
