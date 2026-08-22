package dev.god.settlementsfix.mixin;

import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.npc.Villager;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import dev.breezes.settlements.infrastructure.minecraft.entities.villager.BaseVillager;

/**
 * 让 NPC 头顶名字显示中文（CustomName），而非 mod 的英文种族名。
 *
 * 根因：settlements 的 {@code BaseVillager} 覆写了 {@code Entity#getName()}，返回 UUID 派生的
 * 英文池名（聊天/GUI 用 getDisplayName() → CustomName=中文，但渲染头顶名用 getName()=英文）。
 * 注入：命中自定义名（CustomName 非空）时，让 getName() 返回 CustomName；无姓名则回落到原方法。
 */
@Mixin(BaseVillager.class)
public abstract class VillagerNameMixin {

    @Inject(method = "getName", at = @At("HEAD"), cancellable = true)
    private void settlementsfix$preferCustomName(CallbackInfoReturnable<Component> cir) {
        Component custom = ((Villager) (Object) this).getCustomName();
        // 仅当确有自定义名（我们的中文 NPC：铁匠·岳山、静水…）时才覆盖；无名（变体/幼年）回落原逻辑。
        if (custom != null && !custom.getString().isEmpty()) {
            cir.setReturnValue(custom);
        }
    }
}
