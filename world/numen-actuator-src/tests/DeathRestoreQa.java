package dev.qiandeng.restoreqa;

import com.dwinovo.numen.entity.CompanionFactory;
import com.dwinovo.numen.entity.CompanionRegistry;
import com.dwinovo.numen.entity.NumenPlayer;
import com.dwinovo.numen.actuator.ExistingBodyRestore;
import com.google.gson.JsonObject;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtIo;
import net.minecraft.nbt.NbtAccounter;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.GameRules;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import com.google.gson.JsonParser;
import net.minecraft.world.level.storage.LevelResource;
import net.minecraft.world.phys.Vec3;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import java.nio.file.Files;
import java.util.UUID;
import java.util.HexFormat;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import com.dwinovo.numen.core.tools.work.MoveToTool;
import com.dwinovo.numen.task.CompanionTickDispatcher;

/** Fixture only, never packaged into the production Numen overlay. */
@Mod("qiandeng_death_restore_qa")
public final class DeathRestoreQa {
    static final UUID BODY = UUID.fromString("d4ac9523-4962-43ed-98c5-19b49e104048");
    static final UUID OWNER = UUID.fromString("e5005711-be9f-44b7-aaad-6993c0ba5df4");
    static final java.util.Map<BlockPos, BlockState> geometrySolids = new java.util.HashMap<>();
    static final java.util.Map<BlockPos, BlockState> walkGeometry = new java.util.HashMap<>();
    static String walkReply = "";
    public DeathRestoreQa() { NeoForge.EVENT_BUS.addListener(this::register); }
    private static String inventoryHash(CompoundTag data) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data.get("Inventory").toString().getBytes(StandardCharsets.UTF_8))); }
        catch(Exception error) { throw new IllegalStateException(error); }
    }
    private static <T extends Comparable<T>> BlockState property(BlockState state, Property<T> property, String value) {
        return state.setValue(property, property.getValue(value).orElseThrow());
    }
    void register(RegisterCommandsEvent event) {
        if (!"isolated-death-restore".equals(System.getenv("QD_QA_FIXTURE")))
            throw new IllegalStateException("isolated_fixture_required");
        event.getDispatcher().register(Commands.literal("qddeathqa")
            .requires(s -> s.getEntity() == null && s.hasPermission(4))
            .then(Commands.argument("action", StringArgumentType.word()).executes(c -> {
                var server=c.getSource().getServer(); var level=server.overworld();
                var registry=CompanionRegistry.get(server);
                String action=StringArgumentType.getString(c,"action");
                NumenPlayer body=NumenPlayer.findByUuid(server,BODY);
                JsonObject out=new JsonObject();
                try {
                    if (action.equals("setup")) {
                        if (registry.find(BODY)!=null || body!=null) throw new IllegalStateException("fixture_exists");
                        level.setDefaultSpawnPos(new BlockPos(0,-60,0),0);
                        level.getGameRules().getRule(GameRules.RULE_DOMOBSPAWNING).set(false,server);
                        level.getGameRules().getRule(GameRules.RULE_KEEPINVENTORY).set(true,server);
                        registry.put(BODY,new CompanionRegistry.Entry("Kirito",OWNER,level.dimension(),new BlockPos(10,-60,0)));
                        body=CompanionFactory.spawn(server,BODY,"Kirito",OWNER,level,new Vec3(10.5,-60,.5));
                        body.getInventory().setItem(0,new ItemStack(Items.IRON_SWORD));
                        body.getInventory().setItem(40,new ItemStack(Items.CAKE));
                        body.getFoodData().setFoodLevel(6); body.getFoodData().setSaturation(0);
                        body.giveExperiencePoints(37);
                        server.getPlayerList().saveAll();
                    } else if (action.equals("busy")) {
                        var args=new JsonObject();args.addProperty("x",body.getX()+100);args.addProperty("z",body.getZ());args.addProperty("walk_only",true);
                        new MoveToTool().onServerCall("isolated-busy-death",args,body,reply->out.addProperty("taskReply",reply));
                    } else if (action.equals("offline")) {
                        if (body == null || registry.find(BODY).diedAt() > 0) throw new IllegalStateException("live_body_required");
                        CompanionFactory.despawn(server, body);
                    } else if (action.equals("restore")) {
                        // Observe immediately after the registered production command,
                        // before a subsequent native/mod tick can mutate loaded items.
                        out.addProperty("restoreExitCode", server.getCommands().getDispatcher().execute(
                            "numen_restore_existing " + BODY + " " + OWNER + " Kirito", c.getSource()));
                    } else if (action.equals("spawn_geometry")) {
                        if (body != null || registry.find(BODY).diedAt() <= 0) throw new IllegalStateException("pending_death_required");
                        var geometry = JsonParser.parseString(Files.readString(java.nio.file.Path.of("qa-spawn-geometry.json"))).getAsJsonObject();
                        level.getGameRules().getRule(GameRules.RULE_RANDOMTICKING).set(0,server);
                        level.setDefaultSpawnPos(new BlockPos(-540,64,868),0);
                        geometrySolids.clear();
                        walkGeometry.clear();
                        for (var cell : geometry.getAsJsonArray("cells")) {
                            var value=cell.getAsJsonObject();var p=value.getAsJsonArray("p");
                            BlockPos pos=new BlockPos(p.get(0).getAsInt(),p.get(1).getAsInt(),p.get(2).getAsInt());
                            if(pos.getX() < -558 || pos.getX() > -529 || pos.getY()<61 || pos.getY()>71 || pos.getZ()<857 || pos.getZ()>879)
                                throw new IllegalArgumentException("fixture_geometry_outside_bound");
                            // Only the isolated fixture may prepare chunks; the production
                            // restore selector below is separately checked not to load them.
                            level.getChunk(pos.getX() >> 4,pos.getZ() >> 4);
                            var saved=value.getAsJsonObject("block");
                            var block=BuiltInRegistries.BLOCK.get(ResourceLocation.parse(saved.get("Name").getAsString()));
                            BlockState state=block.defaultBlockState();
                            if(saved.has("Properties"))for(var prop:saved.getAsJsonObject("Properties").entrySet())
                                state=property(state,java.util.Objects.requireNonNull(block.getStateDefinition().getProperty(prop.getKey())),prop.getValue().getAsString());
                            level.setBlock(pos,state,2|16);
                            if(!state.isAir() && state.getFluidState().isEmpty())geometrySolids.put(pos,state);
                        }
                        // The saved full-height sparse columns include actual sky
                        // structures missing from the lower block-volume snapshot.
                        var high=JsonParser.parseString(Files.readString(java.nio.file.Path.of("qa-spawn-high-columns.json"))).getAsJsonObject();
                        int highColumns=0, skyBlocks=0;
                        for(var column:high.getAsJsonObject("columns").entrySet()) {
                            var xz=column.getKey().split(",");int x=Integer.parseInt(xz[0]),z=Integer.parseInt(xz[1]);
                            if(x < -558 || x > -529 || z < 857 || z > 879)throw new IllegalArgumentException("fixture_high_column_outside_bound");
                            for(int y=72;y<=200;y++)level.setBlock(new BlockPos(x,y,z),Blocks.AIR.defaultBlockState(),2|16);
                            for(var cell:column.getValue().getAsJsonArray()) {
                                var value=cell.getAsJsonObject();int y=value.get("y").getAsInt();
                                if(y<72)continue;
                                if(y>200)throw new IllegalArgumentException("fixture_high_block_outside_bound");
                                var saved=value.getAsJsonObject("block");
                                var block=BuiltInRegistries.BLOCK.get(ResourceLocation.parse(saved.get("Name").getAsString()));
                                var state=block.defaultBlockState();
                                if(saved.has("Properties"))for(var prop:saved.getAsJsonObject("Properties").entrySet())
                                    state=property(state,java.util.Objects.requireNonNull(block.getStateDefinition().getProperty(prop.getKey())),prop.getValue().getAsString());
                                level.setBlock(new BlockPos(x,y,z),state,2|16);skyBlocks++;
                            }
                            highColumns++;
                        }
                        var realSelected=ExistingBodyRestore.chooseWorldSpawnLanding(level);
                        out.addProperty("realHighColumnsApplied",highColumns);
                        out.addProperty("realSkyBlocksApplied",skyBlocks);
                        out.add("realColumnsSelection",realSelected==null?com.google.gson.JsonNull.INSTANCE:new com.google.gson.Gson().toJsonTree(java.util.List.of(realSelected.getX(),realSelected.getY(),realSelected.getZ())));
                        // Additional adversarial roof covers every searched XZ. It
                        // is a separate counterexample, not a copy of real geometry.
                        for(int x=-543;x<=-537;x++)for(int z=865;z<=871;z++)
                            level.setBlock(new BlockPos(x,178,z),Blocks.STONE.defaultBlockState(),2|16);
                        var origin=level.getSharedSpawnPos();
                        out.addProperty("anchorFeetAir",level.getBlockState(origin).isAir());
                        out.addProperty("oldLowerFootWater",level.getBlockState(origin.below()).getFluidState().is(net.minecraft.tags.FluidTags.WATER));
                        out.addProperty("oldLowerStandingAccepted",ExistingBodyRestore.loadedSafeLanding(level,origin.below()));
                        var selected=ExistingBodyRestore.chooseWorldSpawnLanding(level);
                        out.addProperty("realAndAdversarialSelectionEqual",realSelected!=null && realSelected.equals(selected));
                        out.add("selectedSurface",selected==null?com.google.gson.JsonNull.INSTANCE:new com.google.gson.Gson().toJsonTree(java.util.List.of(selected.getX(),selected.getY(),selected.getZ())));
                        out.addProperty("selectedFeetDry",selected!=null && level.getBlockState(selected).getFluidState().isEmpty());
                        out.addProperty("highRoofAt178",level.getBlockState(new BlockPos(-540,178,868)).is(Blocks.STONE));
                        out.addProperty("selectedWithinSpawnHeightBand",selected!=null && selected.getY()>=64 && selected.getY()<=72);
                    } else if (action.equals("walk_exit")) {
                        if(body==null || geometrySolids.isEmpty())throw new IllegalStateException("restored_geometry_body_required");
                        // Capture every original solid coordinate at the actual walk
                        // boundary. Pasting a bounded volume into a fresh world may
                        // first trigger sand/gravel falls outside the walking route.
                        // Preserve that full diff; never exempt changed block types.
                        var changes=new com.google.gson.JsonArray();
                        geometrySolids.forEach((pos,original)->{
                            var current=level.getBlockState(pos);walkGeometry.put(pos,current);
                            if(current.getBlock()!=original.getBlock()) {
                                var change=new JsonObject();change.add("pos",new com.google.gson.Gson().toJsonTree(java.util.List.of(pos.getX(),pos.getY(),pos.getZ())));
                                change.addProperty("before",BuiltInRegistries.BLOCK.getKey(original.getBlock()).toString());
                                change.addProperty("after",BuiltInRegistries.BLOCK.getKey(current.getBlock()).toString());changes.add(change);
                            }
                        });
                        // Keep the complete evidence out of RCON's 4096-byte packet.
                        Files.writeString(java.nio.file.Path.of("qa-geometry-before-walk.json"),changes.toString(),StandardCharsets.UTF_8);
                        out.addProperty("pastedGeometryChangesBeforeWalkCount",changes.size());
                        out.addProperty("walkBaselineCoordinates",walkGeometry.size());
                        out.addProperty("walkBaselineGameTime",level.getGameTime());
                        walkReply="";
                        var args=new JsonObject();args.addProperty("x",-535.5);args.addProperty("y",63);args.addProperty("z",873.5);args.addProperty("walk_only",true);
                        new MoveToTool().onServerCall("isolated-surface-exit",args,body,reply->walkReply=reply);
                    } else if (action.equals("stale_task")) {
                        var entry=registry.find(BODY);
                        if(body!=null || entry==null || entry.diedAt()<=0)throw new IllegalStateException("pending_dead_required");
                        registry.put(BODY,entry.doing("goto","{\"x\":1000,\"z\":1000,\"walk_only\":true}"));
                    } else if (action.equals("die") || action.equals("die_drop")) {
                        if (body==null) throw new IllegalStateException("body_missing");
                        if (action.equals("die_drop")) level.getGameRules().getRule(GameRules.RULE_KEEPINVENTORY).set(false,server);
                        body.hurt(body.damageSources().genericKill(),Float.MAX_VALUE);
                    } else if (action.equals("unsafe_spawn") || action.equals("safe_spawn")) {
                        boolean unsafe=action.equals("unsafe_spawn");
                        for(int x=-3;x<=3;x++)for(int z=-3;z<=3;z++)for(int y=-60;y<=-50;y++)
                            level.setBlockAndUpdate(new BlockPos(x,y,z),(unsafe?Blocks.MAGMA_BLOCK:Blocks.AIR).defaultBlockState());
                    } else if (action.equals("claim_unknown")) {
                        var entry=registry.find(BODY);
                        if(body!=null || entry==null || entry.diedAt()<=0) throw new IllegalStateException("pending_dead_required");
                        var directory=server.getWorldPath(LevelResource.ROOT).resolve("data/qd-numen-restores");
                        Files.createDirectories(directory);
                        Files.writeString(directory.resolve(BODY+"-"+entry.diedAt()+".json"),"{\"status\":\"reserved\",\"fixture\":true}",java.nio.file.StandardOpenOption.CREATE_NEW);
                    } else if (!action.equals("status")) throw new IllegalStateException("unknown_action");
                    out.addProperty("ok",true);
                } catch(Exception error) { out.addProperty("ok",false);out.addProperty("error",error.toString()); }
                body=NumenPlayer.findByUuid(server,BODY);
                var entry=registry.find(BODY);
                out.addProperty("ownerOnline",server.getPlayerList().getPlayer(OWNER)!=null);
                out.addProperty("bodyOnline",body!=null);
                out.addProperty("rosterCount",server.getPlayerList().getPlayers().size());
                out.addProperty("registryCount",registry.all().size());
                out.addProperty("pendingDeath",entry==null?-1:entry.diedAt());
                out.addProperty("taskTool",entry==null?"":entry.taskTool());
                out.addProperty("currentTask",CompanionTickDispatcher.currentTaskFor(BODY)!=null);
                out.addProperty("gameTime",level.getGameTime());
                out.addProperty("farChunkLoaded",level.getChunkSource().hasChunk(100000,100000));
                out.addProperty("farSafeRejected",!ExistingBodyRestore.loadedSafeLanding(level,new BlockPos(1600000,-60,1600000)));
                out.addProperty("farChunkLoadedAfter",level.getChunkSource().hasChunk(100000,100000));
                out.addProperty("farWorldSpawnColumnRejected",ExistingBodyRestore.loadedWorldSpawnColumn(level,1600000,1600000)==null);
                out.addProperty("farChunkLoadedAfterColumn",level.getChunkSource().hasChunk(100000,100000));
                if(!geometrySolids.isEmpty()) {
                    out.addProperty("walkReply",walkReply);
                    out.addProperty("geometryChangedSolidBlocks",(walkGeometry.isEmpty()?geometrySolids:walkGeometry).entrySet().stream()
                        .filter(e->level.getBlockState(e.getKey()).getBlock()!=e.getValue().getBlock()).count());
                }
                if(body!=null) {
                    out.addProperty("uuid",body.getStringUUID()); out.addProperty("ownerUuid",body.getOwnerUuid().toString());
                    out.addProperty("hp",body.getHealth()); out.addProperty("food",body.getFoodData().getFoodLevel());
                    out.addProperty("xp",body.totalExperience); out.addProperty("dimension",body.serverLevel().dimension().location().toString());
                    out.addProperty("x",body.getX());out.addProperty("y",body.getY());out.addProperty("z",body.getZ());
                    CompoundTag live=new CompoundTag(); body.saveWithoutId(live);
                    out.addProperty("inventorySha256",inventoryHash(live));
                    // Preserve exact diagnostic bytes without rcon-cli translating
                    // legacy item-name formatting into invalid JSON control bytes.
                    out.addProperty("inventoryNbtBase64",java.util.Base64.getEncoder().encodeToString(live.get("Inventory").toString().getBytes(StandardCharsets.UTF_8)));
                    out.addProperty("cake",body.getInventory().countItem(Items.CAKE));
                    out.addProperty("cakeOffhand",body.getOffhandItem().is(Items.CAKE));
                    out.addProperty("sword",body.getInventory().countItem(Items.IRON_SWORD));
                    out.addProperty("safeLanding",ExistingBodyRestore.loadedSafeLanding(level,body.blockPosition()));
                    out.addProperty("feetDry",level.getBlockState(body.blockPosition()).getFluidState().isEmpty());
                }
                try {
                    var path=server.getWorldPath(LevelResource.PLAYER_DATA_DIR).resolve(BODY+".dat");
                    if(Files.exists(path)) {
                        var data=NbtIo.readCompressed(path,NbtAccounter.create(8388608));
                        out.addProperty("savedInventorySha256",inventoryHash(data));
                        out.addProperty("savedInventoryNbtBase64",java.util.Base64.getEncoder().encodeToString(data.get("Inventory").toString().getBytes(StandardCharsets.UTF_8)));
                        if (body != null) {
                            CompoundTag current = new CompoundTag(); body.saveWithoutId(current);
                            out.addProperty("savedInventoryMatchesLive", java.util.Objects.equals(data.get("Inventory"), current.get("Inventory")));
                        }
                        out.addProperty("savedFood",data.getInt("foodLevel")); out.addProperty("savedXp",data.getInt("XpTotal"));
                        out.addProperty("savedHealth",data.getFloat("Health"));
                    }
                } catch(Exception error) { out.addProperty("saveError",error.toString()); }
                String text="QD_DEATH_QA "+out;
                c.getSource().sendSuccess(()->Component.literal(text),false);return out.get("ok").getAsBoolean()?1:0;
            })));
    }
}
