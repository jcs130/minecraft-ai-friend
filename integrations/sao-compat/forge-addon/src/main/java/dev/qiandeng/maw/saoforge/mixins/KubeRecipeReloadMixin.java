package dev.qiandeng.maw.saoforge.mixins;

import com.google.gson.JsonElement;
import dev.qiandeng.maw.saoforge.RecipeDefinitions;
import java.util.Map;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.crafting.RecipeManager;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Pseudo;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** KubeJS owns the reload when it cancels vanilla RecipeManager.apply. */
@Pseudo
@Mixin(targets="dev.latvian.mods.kubejs.recipe.RecipesEventJS",remap=false)
public abstract class KubeRecipeReloadMixin {
    @Inject(method="post(Lnet/minecraft/world/item/crafting/RecipeManager;Ljava/util/Map;)V",at=@At("HEAD"),remap=false)
    private void begin(RecipeManager manager,Map<ResourceLocation,JsonElement> input,CallbackInfo ci) {
        RecipeDefinitions.beginReload();
    }
}
