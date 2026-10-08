package dev.qiandeng.maw.qa;

import com.minecolonies.api.colony.IColony;
import com.minecolonies.api.colony.IColonyManager;
import com.minecolonies.api.colony.buildings.IBuilding;
import com.minecolonies.api.colony.requestsystem.requestable.Stack;
import com.minecolonies.core.tileentities.TileEntityColonyBuilding;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.context.CommandContext;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;

import java.util.function.BiFunction;

/** Operator-only disposable-world fixture; never packaged in maw_agent_bridge. */
@Mod("maw_colony_lab")
public final class ColonyLabSetup {
    public ColonyLabSetup(IEventBus bus, ModContainer container) {
        NeoForge.EVENT_BUS.addListener(ColonyLabSetup::register);
    }

    private static void register(RegisterCommandsEvent event) {
        var root = Commands.literal("labcolony").requires(source -> source.hasPermission(4));
        root.then(Commands.literal("found")
                .then(Commands.argument("owner", StringArgumentType.word())
                        .executes(context -> found(context.getSource(),
                                StringArgumentType.getString(context, "owner")))));
        root.then(positionCommand("builder", ColonyLabSetup::builder));
        root.then(positionCommand("university_fixture", ColonyLabSetup::university));
        root.then(positionCommand("fix", ColonyLabSetup::fix));
        root.then(positionCommand("request_build", ColonyLabSetup::requestBuild));
        root.then(positionCommand("request_planks", ColonyLabSetup::requestPlanks));
        event.getDispatcher().register(root);
    }

    private static LiteralArgumentBuilder<CommandSourceStack> positionCommand(
            String name, BiFunction<CommandSourceStack, BlockPos, Integer> action) {
        return Commands.literal(name)
                .then(Commands.argument("x", IntegerArgumentType.integer())
                        .then(Commands.argument("y", IntegerArgumentType.integer())
                                .then(Commands.argument("z", IntegerArgumentType.integer())
                                        .executes(context -> action.apply(context.getSource(), position(context))))));
    }

    private static BlockPos position(CommandContext<CommandSourceStack> context) {
        return new BlockPos(IntegerArgumentType.getInteger(context, "x"),
                IntegerArgumentType.getInteger(context, "y"),
                IntegerArgumentType.getInteger(context, "z"));
    }

    private static int reply(CommandSourceStack source, String text) {
        source.sendSuccess(() -> Component.literal("MAW_LAB " + text), false);
        return 1;
    }

    private static int found(CommandSourceStack source, String ownerName) {
        ServerPlayer owner = source.getServer().getPlayerList().getPlayerByName(ownerName);
        if (owner == null) return reply(source, "owner_offline");
        ServerLevel level = owner.serverLevel();
        BlockPos pos = new BlockPos(5, 64, 4);
        if (!(level.getBlockEntity(pos) instanceof TileEntityColonyBuilding tile)) {
            return reply(source, "townhall_tile_missing");
        }
        IColonyManager manager = IColonyManager.getInstance();
        if (manager.getIColonyByOwner(level, owner) != null || manager.getColonyByPosFromWorld(level, pos) != null) {
            return reply(source, "colony_already_exists");
        }
        IColony colony = manager.createColony(level, pos, owner, "Maw Lab", "Minecolonies Original");
        if (colony == null) return reply(source, "create_failed");
        tile.setBlueprintPath("fundamentals/townhall1.blueprint");
        IBuilding building = colony.getServerBuildingManager().addNewBuilding(tile, level);
        if (building != null) configure(building, "fundamentals/townhall1.blueprint");
        return reply(source, "colony=" + colony.getID() + " townHall=" + (building == null ? "null" : building.getPosition()));
    }

    private static int builder(CommandSourceStack source, BlockPos pos) {
        ServerLevel level = source.getServer().overworld();
        IColony colony = IColonyManager.getInstance().getColonyByPosFromWorld(level, pos);
        if (colony == null) return reply(source, "colony_missing");
        if (!(level.getBlockEntity(pos) instanceof TileEntityColonyBuilding tile)) return reply(source, "builder_tile_missing");
        tile.setBlueprintPath("fundamentals/builder1.blueprint");
        IBuilding building = colony.getServerBuildingManager().addNewBuilding(tile, level);
        if (building != null) configure(building, "fundamentals/builder1.blueprint");
        return reply(source, "builder=" + (building == null ? "null" : building.getPosition()));
    }

    private static void configure(IBuilding building, String path) {
        building.setStructurePack("Minecolonies Original");
        building.setBlueprintPath(path);
        building.calculateCorners();
    }

    /** Explicit prebuilt university fixture for research API QA, never a player action. */
    private static int university(CommandSourceStack source, BlockPos pos) {
        ServerLevel level = source.getServer().overworld();
        if (!(level.getBlockEntity(pos) instanceof TileEntityColonyBuilding tile)) return reply(source, "university_tile_missing");
        tile.setBlueprintPath("education/university1.blueprint");
        IColony colony = IColonyManager.getInstance().getColonyByPosFromWorld(level, pos);
        if (colony == null) return reply(source, "colony_missing");
        IBuilding building = colony.getServerBuildingManager().addNewBuilding(tile, level);
        if (!(building instanceof com.minecolonies.core.colony.buildings.workerbuildings.BuildingUniversity)) return reply(source, "university_required");
        configure(building, "education/university1.blueprint");
        building.setBuildingLevel(1); building.markDirty(); colony.markDirty();
        return reply(source, "operator_fixture_university_level=" + building.getBuildingLevel());
    }

    private static int fix(CommandSourceStack source, BlockPos pos) {
        IBuilding building = IColonyManager.getInstance().getBuilding(source.getServer().overworld(), pos);
        if (building == null) return reply(source, "building_missing");
        String path = building.getBuildingType().getRegistryName().getPath().equals("townhall")
                ? "fundamentals/townhall1.blueprint" : "fundamentals/builder1.blueprint";
        configure(building, path);
        return reply(source, "fixed=" + building.getBlueprintPath());
    }

    private static int requestPlanks(CommandSourceStack source, BlockPos pos) {
        ServerLevel level = source.getServer().overworld();
        IBuilding building = IColonyManager.getInstance().getBuilding(level, pos);
        if (building == null) return reply(source, "builder_missing");
        var token = building.createRequest(new Stack(new ItemStack(Items.OAK_PLANKS, 16)), true);
        return reply(source, "native_request=" + (token == null ? "null" : token.getIdentifier()));
    }

    private static int requestBuild(CommandSourceStack source, BlockPos pos) {
        ServerLevel level = source.getServer().overworld();
        IBuilding building = IColonyManager.getInstance().getBuilding(level, pos);
        if (building == null) return reply(source, "building_missing");
        ServerPlayer owner = source.getServer().getPlayerList()
                .getPlayer(building.getColony().getPermissions().getOwner());
        if (owner == null) return reply(source, "owner_offline");
        building.requestUpgrade(owner, pos);
        return reply(source, "upgrade_requested=" + pos);
    }
}
