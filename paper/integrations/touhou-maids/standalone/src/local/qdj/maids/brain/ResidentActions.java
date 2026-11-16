package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.JsonObject;
import com.mojang.authlib.GameProfile;
import java.util.List;
import java.util.Map;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.context.UseOnContext;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.level.GameType;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;
import net.neoforged.neoforge.common.util.FakePlayerFactory;

/** One physical block operation at a time, using survival item rules and the host's native event hooks. */
final class ResidentActions {
    static java.util.List<Map<String,Object>> inventory(EntityMaid maid) {
        var rows=new java.util.ArrayList<Map<String,Object>>();
        int size=Math.min(maid.getMaidInv().getSlots(),maid.getMaidBackpackType().getAvailableMaxContainerIndex());
        for(int slot=0;slot<size;slot++) {var item=maid.getMaidInv().getStackInSlot(slot);if(item.isEmpty())continue;
            rows.add(Map.of("slot",slot,"id",BuiltInRegistries.ITEM.getKey(item.getItem()).toString(),"name",item.getHoverName().getString(),
                "count",item.getCount(),"damage",item.getDamageValue(),"maxDamage",item.getMaxDamage()));}
        return rows;
    }
    static ItemStack stack(EntityMaid maid,JsonObject input){
        String action=input.get("action").getAsString();if(action.equals("break"))return maid.getMainHandItem();
        if(!List.of("place","equip").contains(action))return ItemStack.EMPTY;
        int slot=ResidentContract.integer(input,"slot");if(slot<0||slot>=maid.getMaidInv().getSlots())throw new IllegalArgumentException("slot_out_of_range");
        return maid.getMaidInv().getStackInSlot(slot);
    }
    static long miningMillis(EntityMaid maid,BlockPos p) {
        var level=(ServerLevel)maid.level();
        var actor=FakePlayerFactory.get(level,new GameProfile(maid.getUUID(),"npc_"+maid.getStringUUID().substring(0,8)));
        actor.setPos(maid.position());actor.gameMode.changeGameModeForPlayer(GameType.SURVIVAL);
        actor.setOnGround(maid.onGround());
        actor.setItemInHand(InteractionHand.MAIN_HAND,maid.getMainHandItem().copy());
        try {
            float progress=level.getBlockState(p).getDestroyProgress(actor,level,p);
            if(!Float.isFinite(progress)||progress<=0)throw new IllegalArgumentException("block_cannot_be_mined");
            long millis=(long)Math.ceil(1.0/progress)*50L;
            if(millis>80_000)throw new IllegalArgumentException("mining_requires_better_tool");
            return Math.max(50,millis);
        } finally {actor.setItemInHand(InteractionHand.MAIN_HAND,ItemStack.EMPTY);}
    }
    static BlockPos position(JsonObject input,String key) {
        if(!input.has(key)||!input.get(key).isJsonObject()) throw new IllegalArgumentException(key+": expected absolute {x,y,z} integer coordinates");
        var p=input.getAsJsonObject(key);
        try { return new BlockPos(p.get("x").getAsBigDecimal().intValueExact(),p.get("y").getAsBigDecimal().intValueExact(),p.get("z").getAsBigDecimal().intValueExact()); }
        catch(Exception invalid) { throw new IllegalArgumentException(key+": all of x,y,z must be integers"); }
    }
    static Map<String,Object> point(BlockPos p) { return Map.of("x",p.getX(),"y",p.getY(),"z",p.getZ()); }
    static String block(ServerLevel level,BlockPos p) { return BuiltInRegistries.BLOCK.getKey(level.getBlockState(p).getBlock()).toString(); }
    static void check(EntityMaid maid,ResidentConfig.Resident resident,BlockPos p) {
        boolean homeDimension=maid.level().dimension().location().toString().equals(resident.home().dimension());
        if(homeDimension&&resident.home().interior().contains(p)||!resident.roamingWork()&&(!homeDimension||resident.workArea()==null||!resident.workArea().contains(p)))
            throw new IllegalArgumentException("outside_authorized_work_area_or_inside_protected_house");
        var level=(ServerLevel)maid.level();
        if(!level.hasChunkAt(p)||!level.getWorldBorder().isWithinBounds(p)||level.isOutsideBuildHeight(p)) throw new IllegalArgumentException("unloaded_or_outside_world");
        if(maid.getEyePosition().distanceToSqr(Vec3.atCenterOf(p))>25) throw new IllegalArgumentException("approach_within_5_blocks");
    }
    static boolean visible(EntityMaid maid,BlockPos p) {
        var hit=maid.level().clip(new ClipContext(maid.getEyePosition(),Vec3.atCenterOf(p),ClipContext.Block.COLLIDER,ClipContext.Fluid.NONE,maid));
        return hit.getType()==HitResult.Type.MISS||hit.getBlockPos().equals(p);
    }
    static Map<String,Object> mine(EntityMaid maid,ResidentConfig.Resident resident,JsonObject input) {
        BlockPos p=position(input,"at"); check(maid,resident,p);
        var level=(ServerLevel)maid.level(); var before=level.getBlockState(p); String id=block(level,p);
        if(!input.has("expectedBlock")||!input.get("expectedBlock").getAsString().equals(id)) throw new IllegalArgumentException("observed_block_changed_read_again");
        if(!resident.mineBlocks().contains(id)||before.hasBlockEntity()||before.getDestroySpeed(level,p)<0||!before.getFluidState().isEmpty())
            throw new IllegalArgumentException("block_not_authorized_for_mining");
        if(!visible(maid,p)) throw new IllegalArgumentException("block_not_visible");
        ResidentProtection.require(maid,"break",p);
        ItemStack tool=maid.getMainHandItem();
        if(tool.isEmpty()||before.requiresCorrectToolForDrops()&&!tool.isCorrectToolForDrops(before)) throw new IllegalArgumentException("correct_equipped_tool_required");
        // This helper is never added to PlayerList, never connected and never granted OP.
        // ServerPlayerGameMode fires NeoForge/Bukkit protection and item-harvest hooks.
        var actor=FakePlayerFactory.get(level,new GameProfile(maid.getUUID(),"npc_"+maid.getStringUUID().substring(0,8)));
        actor.setPos(maid.position()); actor.setYRot(maid.getYRot()); actor.setXRot(maid.getXRot());
        actor.gameMode.changeGameModeForPlayer(GameType.SURVIVAL);
        actor.setItemInHand(InteractionHand.MAIN_HAND,tool.copy());
        boolean accepted;
        try { accepted=actor.gameMode.destroyBlock(p); }
        finally { maid.setItemSlot(EquipmentSlot.MAINHAND,actor.getMainHandItem().copy()); actor.setItemInHand(InteractionHand.MAIN_HAND,ItemStack.EMPTY); }
        boolean changed=!before.equals(level.getBlockState(p));
        return Map.of("status",accepted&&changed?"completed":changed?"partial":"blocked","reason",accepted&&changed?"block_harvested":changed?"world_changed_without_confirmed_harvest":"native_permission_or_harvest_refused",
            "completed",accepted&&changed,"worldChanged",changed,"at",point(p),"before",id,"after",block(level,p),"drops","native_world_drops_not_yet_collected");
    }
    static Map<String,Object> place(EntityMaid maid,ResidentConfig.Resident resident,JsonObject input) {
        BlockPos p=position(input,"at"); check(maid,resident,p);
        var level=(ServerLevel)maid.level();
        if(!level.getBlockState(p).isAir()) throw new IllegalArgumentException("placement_target_must_be_air");
        ResidentProtection.require(maid,"place",p);
        int index;
        try { index=input.get("slot").getAsBigDecimal().intValueExact(); } catch(Exception e) { throw new IllegalArgumentException("slot: expected inventory integer"); }
        var bag=maid.getMaidInv();
        if(index<0||index>=bag.getSlots()) throw new IllegalArgumentException("slot_out_of_range");
        var stack=bag.getStackInSlot(index);
        if(stack.isEmpty()||!(stack.getItem() instanceof BlockItem bi)) throw new IllegalArgumentException("block_item_required");
        String id=BuiltInRegistries.BLOCK.getKey(bi.getBlock()).toString();
        if(!input.has("expectedItem")||!input.get("expectedItem").getAsString().equals(BuiltInRegistries.ITEM.getKey(stack.getItem()).toString()))
            throw new IllegalArgumentException("observed_item_changed_read_again");
        if(!resident.buildBlocks().contains(id)||bi.getBlock().defaultBlockState().hasBlockEntity()||
            bi.getBlock() instanceof net.minecraft.world.level.block.BedBlock||bi.getBlock() instanceof net.minecraft.world.level.block.DoorBlock||
            bi.getBlock() instanceof net.minecraft.world.level.block.DoublePlantBlock||bi.getBlock() instanceof net.minecraft.world.level.block.FallingBlock)
            throw new IllegalArgumentException("unsupported_or_unauthorized_building_block");
        Direction face;
        try { face=Direction.valueOf(input.get("face").getAsString().toUpperCase(java.util.Locale.ROOT)); }
        catch(Exception e) { throw new IllegalArgumentException("face: expected up/down/north/south/east/west"); }
        BlockPos against=p.relative(face.getOpposite());
        Vec3 hit=Vec3.atCenterOf(against).add(Vec3.atLowerCornerOf(face.getNormal()).scale(.5));
        var sight=level.clip(new ClipContext(maid.getEyePosition(),hit.subtract(Vec3.atLowerCornerOf(face.getNormal()).scale(.001)),ClipContext.Block.COLLIDER,ClipContext.Fluid.NONE,maid));
        if(!level.hasChunkAt(against)||level.getBlockState(against).isAir()||sight.getType()!=HitResult.Type.BLOCK||!sight.getBlockPos().equals(against))throw new IllegalArgumentException("visible_support_face_required");
        var actor=FakePlayerFactory.get(level,new GameProfile(maid.getUUID(),"npc_"+maid.getStringUUID().substring(0,8)));
        actor.setPos(maid.position()); actor.setYRot(maid.getYRot()); actor.setXRot(maid.getXRot());
        actor.gameMode.changeGameModeForPlayer(GameType.SURVIVAL);
        int before=stack.getCount(); actor.setItemInHand(InteractionHand.MAIN_HAND,stack.copy());
        try { actor.getMainHandItem().useOn(new UseOnContext(actor,InteractionHand.MAIN_HAND,new BlockHitResult(hit,face,against,false))); }
        finally { bag.setStackInSlot(index,actor.getMainHandItem().copy()); actor.setItemInHand(InteractionHand.MAIN_HAND,ItemStack.EMPTY); }
        int remaining=bag.getStackInSlot(index).getCount(); boolean changed=!level.getBlockState(p).isAir();
        boolean success=changed&&block(level,p).equals(id)&&remaining==before-1;
        return Map.of("status",success?"completed":changed||remaining!=before?"partial":"blocked",
            "reason",success?"block_placed":changed||remaining!=before?"unexpected_native_result":"native_permission_or_placement_refused",
            "completed",success,"at",point(p),"after",block(level,p),"slot",index,"consumed",before-remaining,"remaining",remaining);
    }
}
