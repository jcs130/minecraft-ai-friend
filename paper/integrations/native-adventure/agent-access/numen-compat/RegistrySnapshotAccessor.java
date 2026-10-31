package dev.qiandeng.maw.numencompat.mixin;
import it.unimi.dsi.fastutil.ints.Int2ObjectSortedMap;
import net.minecraft.resources.ResourceLocation;
import net.neoforged.neoforge.registries.RegistrySnapshot;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;
@Mixin(value=RegistrySnapshot.class,remap=false)
public interface RegistrySnapshotAccessor {
    @Accessor("ids") Int2ObjectSortedMap<ResourceLocation> maw$mutableIds();
}
