package local.qa.combat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import net.bettercombat.config.ServerConfig;
import net.bettercombat.logic.TargetHelper;
import net.bettercombat.logic.TargetHelper.Relation;
import net.minecraft.core.Holder;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import org.bukkit.craftbukkit.CraftServer;
import org.bukkit.plugin.java.JavaPlugin;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Isolated check of the installed, transformed handler with keyed and direct holders. */
public final class CombatRelationCheck extends JavaPlugin {
    @Override
    public void onEnable() {
        if (!getServer().getIp().equals("127.0.0.1") || !Files.isRegularFile(Path.of(".qdj-relation-qa"))) {
            throw new IllegalStateException("Expected a marked loopback fixture");
        }
        try {
            var handler = Arrays.stream(TargetHelper.class.getDeclaredMethods())
                    .filter(m -> m.getName().contains("qdj$unkeyedRelation")).findFirst().orElseThrow();
            handler.setAccessible(true);
            var defaults = new ServerConfig();
            defaults.player_relation_to_passives = Relation.FRIENDLY;
            defaults.player_relation_to_hostiles = Relation.NEUTRAL;
            defaults.player_relation_to_other = Relation.HOSTILE;
            var world = ((CraftServer) getServer()).getServer().overworld();
            for (var type : new EntityType<?>[]{EntityType.PIG, EntityType.ZOMBIE, EntityType.ARMOR_STAND}) {
                Entity entity = type.create(world);
                if (entity == null) throw new AssertionError("Expected a fixture entity");
                var normal = new CallbackInfoReturnable<Relation>("qa", true);
                handler.invoke(null, null, entity, normal, defaults, BuiltInRegistries.ENTITY_TYPE.wrapAsHolder(type));
                if (normal.isCancelled()) throw new AssertionError("Keyed target did not continue");
                var direct = new CallbackInfoReturnable<Relation>("qa", true);
                handler.invoke(null, null, entity, direct, defaults, Holder.direct(type));
                var expected = type == EntityType.PIG ? Relation.FRIENDLY : type == EntityType.ZOMBIE ? Relation.NEUTRAL : Relation.HOSTILE;
                if (!direct.isCancelled() || direct.getReturnValue() != expected) throw new AssertionError("Wrong category default");
                getLogger().info("QD_RELATION_VERIFIED " + BuiltInRegistries.ENTITY_TYPE.getKey(type) + " keyed=continue direct=" + expected);
            }
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException("Could not inspect the installed Better Combat handler", error);
        }
    }
}
