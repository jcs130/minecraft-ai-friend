package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import local.tlmcompat.core.CompatibilityException;
import local.tlmcompat.qiandengji.ReceiptJournal;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtIo;
import net.minecraft.world.item.ItemStack;
import net.neoforged.neoforge.items.IItemHandlerModifiable;
import org.bukkit.Bukkit;
import org.bukkit.Chunk;

/** Owner-authorized consolidation. No identity cloning, loot drops or replay of pending effects. */
final class PartnerConsolidation {
    private PartnerConsolidation() {}

    static JsonObject request(HybridMaidPlugin plugin, UUID owner, UUID keep, UUID remove, String request) throws Exception {
        if(!Bukkit.isPrimaryThread()||!plugin.singlePlayerPartner()||owner.equals(keep)||owner.equals(remove)||keep.equals(remove)
                ||!request.matches("[A-Za-z0-9_-]{8,48}"))throw new CompatibilityException("merge_invalid","合并身份或原请求无效。");
        Path folder=plugin.getDataFolder().toPath().resolve("partner-consolidation");
        Files.createDirectories(folder);
        Path receipt=folder.resolve(request+".json");
        if(Files.exists(receipt)) {
            JsonObject row=JsonParser.parseString(Files.readString(receipt)).getAsJsonObject();
            if(!owner.toString().equals(row.get("owner").getAsString())||!keep.toString().equals(row.get("keep").getAsString())
                    ||!remove.toString().equals(row.get("remove").getAsString()))throw new CompatibilityException("request_conflict","请查原合并回执。");
            return row; // Any interrupted acceptance stays unknown; never dispatch it again.
        }
        plugin.owned(owner,keep);plugin.owned(owner,remove);
        if(plugin.explicitUnifiedBody(remove)||!remove.equals(plugin.primaryPartner(owner)))
            throw new CompatibilityException("merge_invalid","待合并伙伴不是可更换的罗盘绑定。");
        Path ownerFence=folder.resolve("owner-"+owner+".fence");
        try{Files.createFile(ownerFence);}catch(java.nio.file.FileAlreadyExistsException pending){
            throw new CompatibilityException("merge_owner_fenced","已有合并记录，必须核对原回执，不能换编号重投。");
        }
        try(var channel=java.nio.channels.FileChannel.open(ownerFence,java.nio.file.StandardOpenOption.WRITE)){
            channel.write(java.nio.ByteBuffer.wrap(request.getBytes(java.nio.charset.StandardCharsets.US_ASCII)));
            channel.force(true);
        }
        JsonObject row=new JsonObject();row.addProperty("owner",owner.toString());row.addProperty("keep",keep.toString());
        row.addProperty("remove",remove.toString());row.addProperty("request",request);row.addProperty("status","pending");
        row.addProperty("retryAllowed",false);row.addProperty("terminal",false);
        ReceiptJournal.write(receipt,row,false);
        List<Chunk> tickets=new ArrayList<>();
        try {
            for(UUID id:List.of(keep,remove))if(Bukkit.getEntity(id)==null){
                var ticket=NativeMaidLocation.loadExisting(NativeMaidLocation.indexed(owner,id),plugin);
                if(ticket!=null)tickets.add(ticket);
            }
            NativeMaidLocation.whenTracked(plugin,List.of(keep,remove),plugin::isEnabled,()->{
                try{merge(plugin,owner,keep,remove,request,folder,row);}
                catch(Exception error){
                    row.addProperty("status",row.get("status").getAsString().equals("dispatching")?"unknown":"rejected");
                    row.addProperty("terminal",!row.get("status").getAsString().equals("unknown"));
                    row.addProperty("reason",error instanceof CompatibilityException compat?compat.code():error.getClass().getSimpleName());
                } finally {
                    try{ReceiptJournal.write(receipt,row,true);}catch(Exception failed){plugin.getLogger().severe("Original partner merge receipt unavailable; do not replay: "+request);}
                    tickets.forEach(chunk->NativeMaidLocation.release(chunk,plugin));
                }
            });
        } catch(Exception error) {
            tickets.forEach(chunk->NativeMaidLocation.release(chunk,plugin));
            row.addProperty("status","rejected");row.addProperty("terminal",true);row.addProperty("reason",error.getClass().getSimpleName());
            ReceiptJournal.write(receipt,row,true);
        }
        return row;
    }

    private static void merge(HybridMaidPlugin plugin,UUID owner,UUID keep,UUID remove,String request,Path folder,JsonObject row) throws Exception {
        EntityMaid kept=plugin.ownedLoaded(owner,keep), donor=plugin.ownedLoaded(owner,remove);
        if(plugin.explicitUnifiedBody(remove)||!remove.equals(plugin.primaryPartner(owner))||plugin.nativeControlled(keep)||plugin.nativeControlled(remove)
                ||plugin.editingMaidInventory(kept)||plugin.editingMaidInventory(donor)||kept.guiOpening||donor.guiOpening
                ||kept.fishing!=null||donor.fishing!=null)
            throw new CompatibilityException("merge_busy","伙伴动作或背包正在使用，尚未合并。");
        plugin.nativeReady(owner,keep);plugin.nativeReady(owner,remove);
        CompoundTag snapshot=donor.saveWithoutId(new CompoundTag());
        if(!snapshot.getCompound("MaidBackpackData").isEmpty()||!donor.getPassengers().isEmpty()||donor.isPassenger())
            throw new CompatibilityException("merge_extra_storage","有额外背包数据或骑乘对象，需人工交接。");
        List<IItemHandlerModifiable> sources=List.of(donor.getAllInv(),donor.getHideInv(),donor.getTaskInv());
        var originalSource=sourceItems(sources);
        List<ItemStack> offered=originalSource.stream().filter(stack->!stack.isEmpty()).toList();
        var equipment=net.minecraft.world.entity.EquipmentSlot.values();
        List<ItemStack> equipped=java.util.Arrays.stream(equipment).map(kept::getItemBySlot).map(ItemStack::copy).toList();
        var bag=kept.getMaidInv();int capacity=NativeMaidInventory.capacity(kept);
        List<ItemStack> planned=new ArrayList<>();
        for(int slot=0;slot<capacity;slot++)planned.add(bag.getStackInSlot(slot).copy());
        for(ItemStack offeredStack:offered){
            ItemStack left=offeredStack.copy();
            for(int slot=0;slot<capacity&&!left.isEmpty();slot++){
                ItemStack old=planned.get(slot);
                if(!bag.isItemValid(slot,left)||!old.isEmpty()&&!ItemStack.isSameItemSameComponents(old,left))continue;
                int room=Math.min(bag.getSlotLimit(slot),left.getMaxStackSize())-old.getCount();
                if(room<=0)continue;
                int count=Math.min(room,left.getCount());
                planned.set(slot,left.copyWithCount(old.getCount()+count));left.shrink(count);
            }
            if(!left.isEmpty())throw new CompatibilityException("merge_bag_full","沐白背包不足，未改动任何物品或身份。");
        }
        NbtIo.writeCompressed(snapshot,folder.resolve(request+"-retired-body.nbt"));
        try(var channel=java.nio.channels.FileChannel.open(folder.resolve(request+"-retired-body.nbt"),java.nio.file.StandardOpenOption.WRITE)){channel.force(true);}
        row.addProperty("status","dispatching");row.addProperty("itemStacksTransferred",offered.size());
        ReceiptJournal.write(folder.resolve(request+".json"),row,true);
        // All of the following runs once on the game thread. Crash recovery is original-ID reconciliation only.
        plugin.nativeQuiesce(donor);
        var currentSource=sourceItems(sources);
        if(currentSource.size()!=originalSource.size()||!java.util.stream.IntStream.range(0,originalSource.size())
                .allMatch(slot->ItemStack.matches(originalSource.get(slot),currentSource.get(slot))))
            throw new IllegalStateException("donor_inventory_changed_before_merge");
        plugin.retainPlayerPartner(owner,kept,remove);
        for(int slot=0;slot<capacity;slot++)bag.setStackInSlot(slot,planned.get(slot));
        for(var inventory:sources)for(int slot=0;slot<inventory.getSlots();slot++)inventory.setStackInSlot(slot,ItemStack.EMPTY);
        donor.discard(); // No death, drops, tombstone, UUID resurrection, or XP transfer.
        if(Bukkit.getEntity(remove)!=null||Bukkit.getEntity(keep)!=kept.getBukkitEntity())
            throw new IllegalStateException("original_body_removal_unconfirmed");
        plugin.retireMergedPartner(owner,remove);
        for(int slot=0;slot<capacity;slot++)if(!ItemStack.matches(bag.getStackInSlot(slot),planned.get(slot)))
            throw new IllegalStateException("consolidated_inventory_changed");
        for(int i=0;i<equipment.length;i++)if(!ItemStack.matches(kept.getItemBySlot(equipment[i]),equipped.get(i)))
            throw new IllegalStateException("original_equipment_changed");
        if (!((net.minecraft.server.level.ServerLevel)kept.level()).getServer().saveAllChunks(true,true,false))
            throw new IllegalStateException("world_flush_unconfirmed");
        row.addProperty("status","completed");row.addProperty("terminal",true);row.addProperty("keptName",kept.getName().getString());
        row.addProperty("worldFlushConfirmed",true);row.addProperty("originalEquipmentUnchanged",true);
        row.addProperty("memoryCopied",false);row.addProperty("bodyCopiesCreated",0);
    }

    private static List<ItemStack> sourceItems(List<IItemHandlerModifiable> handlers) {
        List<ItemStack> result=new ArrayList<>();
        for(var handler:handlers)for(int slot=0;slot<handler.getSlots();slot++)result.add(handler.getStackInSlot(slot).copy());
        return result;
    }
}
