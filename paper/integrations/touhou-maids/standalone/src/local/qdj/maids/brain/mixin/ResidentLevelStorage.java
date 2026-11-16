package local.qdj.maids.brain.mixin;

import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.level.entity.PersistentEntitySectionManager;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(value=ServerLevel.class,remap=false)
public interface ResidentLevelStorage {
    @Accessor("entityManager") PersistentEntitySectionManager<Entity> residentEntityManager();
}
