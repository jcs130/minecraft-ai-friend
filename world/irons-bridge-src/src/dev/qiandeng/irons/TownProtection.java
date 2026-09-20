package dev.qiandeng.irons;

import com.google.gson.JsonObject;
import com.mojang.brigadier.CommandDispatcher;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.decoration.ArmorStand;
import net.minecraft.world.entity.decoration.HangingEntity;
import net.minecraft.world.entity.monster.Enemy;
import net.minecraft.world.item.BoneMealItem;
import net.minecraft.world.item.BucketItem;
import net.minecraft.world.item.FireChargeItem;
import net.minecraft.world.item.FlintAndSteelItem;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.LevelAccessor;
import net.minecraft.world.level.block.BaseFireBlock;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.CropBlock;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.EntityMobGriefingEvent;
import net.neoforged.neoforge.event.entity.living.LivingDestroyBlockEvent;
import net.neoforged.neoforge.event.entity.player.AttackEntityEvent;
import net.neoforged.neoforge.event.entity.player.PlayerInteractEvent;
import net.neoforged.neoforge.event.level.BlockEvent;
import net.neoforged.neoforge.event.level.ExplosionEvent;
import net.neoforged.neoforge.event.level.PistonEvent;

/** Always-on server region guard. Console-native construction remains a trusted control plane. */
public final class TownProtection {
    private static boolean installed;
    private static long refusals;
    private TownProtection() {}

    public static synchronized void install() {
        if (installed) return;
        installed = true;
        NeoForge.EVENT_BUS.addListener(EventPriority.LOWEST, true, TownProtection::breakBlock);
        NeoForge.EVENT_BUS.addListener(EventPriority.LOWEST, true, TownProtection::placeBlock);
        NeoForge.EVENT_BUS.addListener(EventPriority.LOWEST, true, TownProtection::toolModification);
        NeoForge.EVENT_BUS.addListener(EventPriority.LOWEST, true, TownProtection::trample);
        NeoForge.EVENT_BUS.addListener(EventPriority.LOWEST, true, TownProtection::fluidPlacement);
        NeoForge.EVENT_BUS.addListener(EventPriority.LOWEST, true, TownProtection::livingDestroy);
        NeoForge.EVENT_BUS.addListener(EventPriority.LOWEST, true, TownProtection::piston);
        NeoForge.EVENT_BUS.addListener(EventPriority.LOWEST, true, TownProtection::rightClickBlock);
        NeoForge.EVENT_BUS.addListener(EventPriority.LOWEST, true, TownProtection::rightClickItem);
        NeoForge.EVENT_BUS.addListener(EventPriority.LOWEST, true, TownProtection::attackDecoration);
        NeoForge.EVENT_BUS.addListener(TownProtection::explosion);
        NeoForge.EVENT_BUS.addListener(TownProtection::mobGriefing);
    }
    public static boolean protects(LevelAccessor level, BlockPos pos) {
        return level instanceof ServerLevel server && TownProtectionPolicy.contains(
            server.dimension().location().toString(), pos.getX(), pos.getZ());
    }
    public static boolean matureCrop(LevelAccessor level, BlockPos pos, BlockState state) {
        return state.getBlock() instanceof CropBlock crop && TownProtectionPolicy.matureFieldCrop(
            BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString(), crop.getAge(state),
            crop.getMaxAge(), level.getBlockState(pos.below()).is(Blocks.FARMLAND));
    }
    public static boolean mayRemove(LevelAccessor level, BlockPos pos, BlockState state) {
        // Extinguishing fire is harmless; plants are not a blanket exception for leaf/hay roofs.
        return TownCommandScope.active() || !protects(level, pos) || state.isAir() || state.getBlock() instanceof BaseFireBlock
            || matureCrop(level, pos, state);
    }
    public static void refused() { refusals++; }
    private static boolean planting(LevelAccessor level, BlockPos pos, BlockState before, BlockState after) {
        return TownProtectionPolicy.mayPlant(BuiltInRegistries.BLOCK.getKey(after.getBlock()).toString(),
            before.isAir(), level.getBlockState(pos.below()).is(Blocks.FARMLAND));
    }
    private static void breakBlock(BlockEvent.BreakEvent event) {
        if (!mayRemove(event.getLevel(), event.getPos(), event.getState())) { event.setCanceled(true); refused(); }
    }
    private static void placeBlock(BlockEvent.EntityPlaceEvent event) {
        boolean deny;
        if (event instanceof BlockEvent.EntityMultiPlaceEvent multi) {
            deny = multi.getReplacedBlockSnapshots().stream().anyMatch(s -> protects(event.getLevel(), s.getPos())
                && !planting(event.getLevel(), s.getPos(), s.getState(), s.getCurrentState()));
        } else {
            deny = protects(event.getLevel(), event.getPos()) && !planting(event.getLevel(), event.getPos(),
                event.getBlockSnapshot().getState(), event.getPlacedBlock());
        }
        if (deny) { event.setCanceled(true); refused(); }
    }
    private static void toolModification(BlockEvent.BlockToolModificationEvent event) {
        if (protects(event.getLevel(), event.getPos())) { event.setCanceled(true); refused(); }
    }
    private static void trample(BlockEvent.FarmlandTrampleEvent event) {
        if (protects(event.getLevel(), event.getPos())) { event.setCanceled(true); refused(); }
    }
    private static void fluidPlacement(BlockEvent.FluidPlaceBlockEvent event) {
        if (protects(event.getLevel(), event.getPos())) { event.setNewState(event.getOriginalState()); event.setCanceled(true); refused(); }
    }
    private static void livingDestroy(LivingDestroyBlockEvent event) {
        if (protects(event.getEntity().level(), event.getPos())) { event.setCanceled(true); refused(); }
    }
    private static void mobGriefing(EntityMobGriefingEvent event) {
        // Do not disable villager farming or maid harvesting through a global gamerule.
        Entity entity = event.getEntity();
        if (entity instanceof Enemy && protects(entity.level(), entity.blockPosition())) { event.setCanGrief(false); refused(); }
    }
    private static void explosion(ExplosionEvent.Detonate event) {
        int before = event.getAffectedBlocks().size();
        event.getAffectedBlocks().removeIf(p -> protects(event.getLevel(), p));
        event.getAffectedEntities().removeIf(e -> (e instanceof HangingEntity || e instanceof ArmorStand)
            && protects(e.level(), e.blockPosition()));
        if (before != event.getAffectedBlocks().size()) refused();
    }
    private static void piston(PistonEvent.Pre event) {
        if (!(event.getLevel() instanceof ServerLevel level)) return;
        BlockPos origin = event.getPos();
        if (!TownProtectionPolicy.near(level.dimension().location().toString(), origin.getX(), origin.getZ(), 14)) return;
        boolean deny = protects(level, origin) || protects(level, event.getFaceOffsetPos());
        try {
            var resolver = event.getStructureHelper();
            if (resolver != null && resolver.resolve()) {
                deny |= resolver.getToPush().stream().anyMatch(p -> protects(level, p) || protects(level, p.relative(resolver.getPushDirection())))
                    || resolver.getToDestroy().stream().anyMatch(p -> protects(level, p));
            }
        } catch (RuntimeException error) { deny = true; }
        if (deny) { event.setCanceled(true); refused(); }
    }
    private static boolean harmfulUse(Level level, BlockPos pos, net.minecraft.world.item.ItemStack item) {
        if (!protects(level, pos)) return false;
        return item.getItem() instanceof BucketItem || item.getItem() instanceof FlintAndSteelItem
            || item.getItem() instanceof FireChargeItem || (item.getItem() instanceof BoneMealItem
            && !TownProtectionPolicy.mayPlant(BuiltInRegistries.BLOCK.getKey(
                level.getBlockState(pos).getBlock()).toString(), true,
                level.getBlockState(pos.below()).is(Blocks.FARMLAND)));
    }
    private static void rightClickBlock(PlayerInteractEvent.RightClickBlock event) {
        if (harmfulUse(event.getLevel(), event.getPos(), event.getItemStack())
                || (!(event.getItemStack().getItem() instanceof BoneMealItem) && event.getFace() != null
                && harmfulUse(event.getLevel(), event.getPos().relative(event.getFace()), event.getItemStack()))) {
            event.setCanceled(true); refused();
        }
    }
    private static void rightClickItem(PlayerInteractEvent.RightClickItem event) {
        if (!(event.getItemStack().getItem() instanceof BucketItem) || event.getLevel().isClientSide) return;
        var player = event.getEntity();
        var start = player.getEyePosition();
        var end = start.add(player.getViewVector(1.0F).scale(player.blockInteractionRange()));
        for (var fluid : new ClipContext.Fluid[]{ClipContext.Fluid.NONE, ClipContext.Fluid.SOURCE_ONLY}) {
            BlockHitResult hit = event.getLevel().clip(new ClipContext(start, end, ClipContext.Block.OUTLINE, fluid, player));
            if (hit.getType() == HitResult.Type.BLOCK && (protects(event.getLevel(), hit.getBlockPos())
                    || protects(event.getLevel(), hit.getBlockPos().relative(hit.getDirection())))) {
                event.setCanceled(true); refused(); return;
            }
        }
    }
    private static void attackDecoration(AttackEntityEvent event) {
        var target = event.getTarget();
        if ((target instanceof HangingEntity || target instanceof ArmorStand) && protects(target.level(), target.blockPosition())) {
            event.setCanceled(true); refused();
        }
    }
    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("qdworldprotect").requires(s -> s.hasPermission(4) && s.getEntity() == null)
            .then(Commands.literal("status").executes(c -> {
                JsonObject out = new JsonObject();
                out.addProperty("schema", 1); out.addProperty("enabled", installed);
                out.addProperty("dimension", TownProtectionPolicy.DIMENSION);
                out.addProperty("minX", TownProtectionPolicy.MIN_X); out.addProperty("maxX", TownProtectionPolicy.MAX_X);
                out.addProperty("minZ", TownProtectionPolicy.MIN_Z); out.addProperty("maxZ", TownProtectionPolicy.MAX_Z);
                out.addProperty("allY", true); out.addProperty("manualOpBypass", false);
                out.addProperty("refusals", refusals); out.addProperty("maintenance", "trusted_console_native_commands_only");
                c.getSource().sendSuccess(() -> Component.literal("QD_TOWN_PROTECTION_JSON " + out), false);
                return installed ? 1 : 0;
            })));
    }
}
