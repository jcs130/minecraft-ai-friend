package local.tlmcompat.numen;

import com.mojang.datafixers.util.Pair;
import net.minecraft.advancements.*;
import java.util.*;
import net.minecraft.core.NonNullList;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.game.*;
import net.minecraft.network.syncher.EntityDataSerializers;
import net.minecraft.network.syncher.SynchedEntityData;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.*;
import net.minecraft.world.item.*;
import net.minecraft.world.phys.Vec3;

/** A per-recipient wire view. No authoritative entity, item, handler or component is mutated. */
public final class NativeClientProjection {
    private static boolean vanilla(net.minecraft.resources.ResourceLocation key){return key!=null&&key.getNamespace().equals("minecraft");}
    private static boolean maidEntity(Entity entity){return entity!=null&&BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).getNamespace().equals("touhou_little_maid");}
    public static ItemStack item(ItemStack source){
        if(source.isEmpty())return source;
        if(!vanilla(BuiltInRegistries.ITEM.getKey(source.getItem()))){var mapped=VanillaMaidView.item(source);if(mapped!=null)return mapped;var result=new ItemStack(Items.BARRIER,Math.min(64,source.getCount()));result.set(DataComponents.CUSTOM_NAME,source.getHoverName());return result;}
        var patch=source.getComponentsPatch().forget(type->!vanilla(BuiltInRegistries.DATA_COMPONENT_TYPE.getKey(type)));
        return patch.equals(source.getComponentsPatch())?source:new ItemStack(source.getItemHolder(),source.getCount(),patch);
    }
    private static Entity entity(ServerPlayer viewer,int id){return viewer==null?null:viewer.level().getEntity(id);}
    public static boolean hidden(Packet<?> packet){
        if(packet instanceof ClientboundSoundPacket sound)return !vanilla(sound.getSound().value().getLocation())&&!MaidCosmetics.transportSound(sound.getSound().value().getLocation().toString());
        if(packet instanceof ClientboundSoundEntityPacket sound)return !vanilla(sound.getSound().value().getLocation());
        if(packet instanceof ClientboundLevelParticlesPacket particles)return !vanilla(BuiltInRegistries.PARTICLE_TYPE.getKey(particles.getParticle().getType()));
        return false;
    }
    @SuppressWarnings({"unchecked","rawtypes"})
    public static Packet<?> project(Packet<?> packet,ServerPlayer viewer,MinecraftServer server){
        return project(packet,viewer,server,false);
    }
    /** Read-only Web snapshots use the same Java compatibility view even for a Bedrock subject. */
    public static Packet<?> forObserver(Packet<?> packet,ServerPlayer subject,MinecraftServer server){
        return hidden(packet)?null:project(packet,subject,server,true);
    }
    @SuppressWarnings({"unchecked","rawtypes"})
    private static Packet<?> project(Packet<?> packet,ServerPlayer viewer,MinecraftServer server,boolean observer){
        if(packet instanceof ClientboundBundlePacket bundle){
            List<Packet<? super ClientGamePacketListener>> children=new ArrayList<>();
            for(var child:bundle.subPackets())if(!hidden(child)){
                Packet<?> projected=project(child,viewer,server,observer);
                if(projected instanceof ClientboundBundlePacket nested)for(var part:nested.subPackets())children.add((Packet)part);
                else children.add((Packet)projected);
            }
            return new ClientboundBundlePacket(children);
        }
        if(packet instanceof ClientboundUpdateRecipesPacket recipes)return NativeClientRecipes.project(recipes,server.registryAccess());
        if(packet instanceof ClientboundUpdateAdvancementsPacket advancements){
            var entries=advancements.getAdded().stream().map(holder->{
                var value=holder.value();var display=value.display().map(original->{
                    var result=new DisplayInfo(item(original.getIcon()),original.getTitle(),original.getDescription(),original.getBackground().filter(NativeClientProjection::vanilla),original.getType(),original.shouldShowToast(),original.shouldAnnounceChat(),original.isHidden());
                    result.setLocation(original.getX(),original.getY());return result;
                });
                return new AdvancementHolder(holder.id(),new Advancement(value.parent(),display,value.rewards(),value.criteria(),value.requirements(),value.sendsTelemetryEvent(),value.name()));
            }).toList();
            return new ClientboundUpdateAdvancementsPacket(advancements.shouldReset(),entries,advancements.getRemoved(),advancements.getProgress());
        }
        if(packet instanceof ClientboundContainerSetSlotPacket slot){var safe=item(slot.getItem());return safe==slot.getItem()?packet:new ClientboundContainerSetSlotPacket(slot.getContainerId(),slot.getStateId(),slot.getSlot(),safe);}
        if(packet instanceof ClientboundContainerSetContentPacket content){
            var items=NonNullList.<ItemStack>create();boolean changed=false;for(var source:content.getItems()){var safe=item(source);items.add(safe);changed|=safe!=source;}
            var carried=item(content.getCarriedItem());return !changed&&carried==content.getCarriedItem()?packet:new ClientboundContainerSetContentPacket(content.getContainerId(),content.getStateId(),items,carried);
        }
        if(packet instanceof ClientboundSetEquipmentPacket equipment){
            var slots=equipment.getSlots().stream().map(pair->Pair.of(pair.getFirst(),item(pair.getSecond()))).toList();return new ClientboundSetEquipmentPacket(equipment.getEntity(),slots);
        }
        if(packet instanceof ClientboundAddEntityPacket spawn&&BuiltInRegistries.ENTITY_TYPE.getKey(spawn.getType()).getNamespace().equals("touhou_little_maid")){
            Entity actual=entity(viewer,spawn.getId());var type=VanillaMaidView.type(actual,observer?null:viewer);
            MaidVisualRegistry.capture(actual);
            var projected=new ClientboundAddEntityPacket(spawn.getId(),spawn.getUUID(),spawn.getX(),spawn.getY(),spawn.getZ(),spawn.getXRot(),spawn.getYRot(),type,0,new Vec3(spawn.getXa(),spawn.getYa(),spawn.getZa()),spawn.getYHeadRot());
            var name=VanillaMaidView.name(actual);
            return name==null?projected:new ClientboundBundlePacket(List.of(projected,new ClientboundSetEntityDataPacket(spawn.getId(),List.of(
                new SynchedEntityData.DataValue<>(2,EntityDataSerializers.OPTIONAL_COMPONENT,Optional.of(name)),
                new SynchedEntityData.DataValue<>(3,EntityDataSerializers.BOOLEAN,true)))));
        }
        if(packet instanceof ClientboundSetEntityDataPacket metadata){
            var actual=entity(viewer,metadata.id());boolean mod=maidEntity(actual);int prefix=VanillaMaidView.metadataPrefix(actual);var name=mod?VanillaMaidView.name(actual):null;
            List<SynchedEntityData.DataValue<?>> values=new ArrayList<>();boolean changed=false;
            for(var value:metadata.packedItems()){
                if(mod&&value.id()>prefix){changed=true;continue;}
                if(name!=null&&(value.id()==2||value.id()==3)){changed=true;continue;}
                if(value.serializer()==EntityDataSerializers.ITEM_STACK){var source=(ItemStack)value.value();var safe=item(source);if(source!=safe){values.add(new SynchedEntityData.DataValue<>(value.id(),EntityDataSerializers.ITEM_STACK,safe));changed=true;continue;}}
                values.add(value);
            }
            if(name!=null){values.add(new SynchedEntityData.DataValue<>(2,EntityDataSerializers.OPTIONAL_COMPONENT,Optional.of(name)));values.add(new SynchedEntityData.DataValue<>(3,EntityDataSerializers.BOOLEAN,true));changed=true;}
            return changed?new ClientboundSetEntityDataPacket(metadata.id(),values):packet;
        }
        if(packet instanceof ClientboundUpdateAttributesPacket attributes){
            var values=attributes.getValues().stream().filter(value->vanilla(BuiltInRegistries.ATTRIBUTE.getKey(value.attribute().value()))).toList();
            if(values.size()!=attributes.getValues().size()){var result=new ClientboundUpdateAttributesPacket(attributes.getEntityId(),List.of());result.getValues().addAll(values);return result;}
        }
        return packet;
    }
}
