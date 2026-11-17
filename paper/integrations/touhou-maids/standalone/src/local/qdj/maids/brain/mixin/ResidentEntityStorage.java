package local.qdj.maids.brain.mixin;

import java.util.function.Consumer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.level.entity.EntityPersistentStorage;
import net.minecraft.world.level.entity.PersistentEntitySectionManager;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;
import org.spongepowered.asm.mixin.gen.Invoker;

@Mixin(value=PersistentEntitySectionManager.class,remap=false)
public interface ResidentEntityStorage {
    @Invoker("storeChunkSections") boolean residentStoreChunk(long chunk,Consumer<Entity> callback);
    @Accessor("permanentStorage") EntityPersistentStorage<Entity> residentStorage();
}
