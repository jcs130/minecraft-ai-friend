package dev.qiandeng.maw.saoforge.mixins;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.qiandeng.maw.saoforge.RecipeDefinitions;
import java.util.Map;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.packs.resources.ResourceManager;
import net.minecraft.util.profiling.ProfilerFiller;
import net.minecraft.world.item.crafting.Recipe;
import net.minecraft.world.item.crafting.RecipeManager;
import net.minecraftforge.common.crafting.conditions.ICondition;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Forge 47.4.10: fromJson's 3-argument overload is Forge-added and unmapped.
 * apply's SRG descriptor is pinned to the reviewed 1.20.1 runtime. No cancellation,
 * argument replacement or serializer/network/condition changes. */
@Mixin(value=RecipeManager.class,remap=false,priority=2000)
public abstract class RecipeManagerMixin {
    @Inject(method="m_5787_(Ljava/util/Map;Lnet/minecraft/server/packs/resources/ResourceManager;Lnet/minecraft/util/profiling/ProfilerFiller;)V",at=@At("HEAD"),remap=false)
    private void begin(Map<ResourceLocation,JsonElement> json,ResourceManager resources,ProfilerFiller profiler,CallbackInfo ci) {
        RecipeDefinitions.beginReload();
    }
    @Inject(method="fromJson(Lnet/minecraft/resources/ResourceLocation;Lcom/google/gson/JsonObject;Lnet/minecraftforge/common/crafting/conditions/ICondition$IContext;)Lnet/minecraft/world/item/crafting/Recipe;",at=@At("RETURN"),remap=false)
    private static void source(ResourceLocation id,JsonObject json,ICondition.IContext context,CallbackInfoReturnable<Recipe<?>> ci) {
        RecipeDefinitions.record(id,json,ci.getReturnValue());
    }
}
