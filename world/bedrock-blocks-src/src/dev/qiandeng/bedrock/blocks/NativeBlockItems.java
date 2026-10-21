package dev.qiandeng.bedrock.blocks;

import java.util.*;
import org.geysermc.mcprotocollib.protocol.data.game.item.*;
import org.geysermc.mcprotocollib.protocol.data.game.item.component.DataComponentTypes;
import org.geysermc.mcprotocollib.protocol.data.game.entity.metadata.*;
import org.geysermc.mcprotocollib.protocol.data.game.entity.metadata.type.ObjectEntityMetadata;
import org.geysermc.mcprotocollib.protocol.packet.ingame.clientbound.inventory.*;
import org.geysermc.mcprotocollib.protocol.packet.ingame.clientbound.entity.*;
import org.geysermc.mcprotocollib.protocol.packet.ingame.serverbound.inventory.*;

/** Connection-local presentation IDs. The version translator's original item
 * IDs and complete component/hash patches are restored on every outbound path.
 * A virtual item cannot be injected unless this connection first received it. */
final class NativeBlockItems {
    private final Map<Integer,Integer> markers;
    private final Set<Integer> virtuals;
    private final Map<Integer,Integer> aliases=new HashMap<>();
    NativeBlockItems(Map<Integer,Integer> markers){this.markers=markers;this.virtuals=new HashSet<>(markers.values());}
    ItemStack forward(ItemStack item){
        if(item==null||item.getDataComponentsPatch()==null)return item;
        var model=item.getDataComponentsPatch().get(DataComponentTypes.CUSTOM_MODEL_DATA);
        if(model==null||model.floats().isEmpty())return item;
        float marker=model.floats().get(0);if(marker!=(int)marker)return item;
        Integer id=markers.get((int)marker);if(id==null)return item;
        if(virtuals.contains(item.getId()))return item;
        Integer prior=aliases.putIfAbsent(id,item.getId());if(prior!=null&&prior!=item.getId())throw new IllegalStateException("native_item_base_changed");
        return new ItemStack(id,item.getAmount(),item.getDataComponentsPatch());
    }
    ItemStack restore(ItemStack item){if(item==null||!virtuals.contains(item.getId()))return item;Integer base=aliases.get(item.getId());if(base==null)throw new IllegalStateException("unobserved_virtual_item");return new ItemStack(base,item.getAmount(),item.getDataComponentsPatch());}
    HashedStack restore(HashedStack item){if(item==null||!virtuals.contains(item.id()))return item;Integer base=aliases.get(item.id());if(base==null)throw new IllegalStateException("unobserved_virtual_item");return new HashedStack(base,item.count(),item.addedComponents(),item.removedComponents());}
    @SuppressWarnings("unchecked") Object incoming(Object packet){
        if(packet instanceof ClientboundContainerSetContentPacket p){ItemStack[] items=Arrays.stream(p.getItems()).map(this::forward).toArray(ItemStack[]::new);return p.withItems(items).withCarriedItem(forward(p.getCarriedItem()));}
        if(packet instanceof ClientboundContainerSetSlotPacket p)return p.withItem(forward(p.getItem()));
        if(packet instanceof ClientboundSetPlayerInventoryPacket p)return p.withContents(forward(p.getContents()));
        if(packet instanceof ClientboundSetCursorItemPacket p)return p.withContents(forward(p.getContents()));
        if(packet instanceof ClientboundSetEquipmentPacket p){var old=p.getEquipment();var values=new Equipment[old.length];for(int i=0;i<old.length;i++)values[i]=new Equipment(old[i].getSlot(),forward(old[i].getItem()));return p.withEquipment(values);}
        if(packet instanceof ClientboundSetEntityDataPacket p){var values=p.getMetadata().clone();for(int i=0;i<values.length;i++){var v=values[i];if(v.getValue() instanceof ItemStack item)values[i]=new ObjectEntityMetadata<>(v.getId(),(MetadataType<ItemStack>)v.getType(),forward(item));}return p.withMetadata(values);}
        return packet;
    }
    Object outgoing(Object packet){
        if(packet instanceof ServerboundContainerClickPacket p){Map<Integer,HashedStack> slots=new HashMap<>();p.getChangedSlots().forEach((slot,item)->slots.put(slot,restore(item)));return new ServerboundContainerClickPacket(p.getContainerId(),p.getStateId(),p.getSlot(),p.getAction(),p.getParam(),restore(p.getCarriedItem()),slots);}
        if(packet instanceof ServerboundSetCreativeModeSlotPacket p)return p.withClickedItem(restore(p.getClickedItem()));
        return packet;
    }
}
