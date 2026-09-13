package dev.qiandeng.restoreqa;

import com.dwinovo.numen.entity.CompanionFactory;
import com.dwinovo.numen.entity.CompanionRegistry;
import com.dwinovo.numen.entity.NumenPlayer;
import com.dwinovo.numen.core.entity.ExistingBodyRestore;
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
    public DeathRestoreQa() { NeoForge.EVENT_BUS.addListener(this::register); }
    private static String inventoryHash(CompoundTag data) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data.get("Inventory").toString().getBytes(StandardCharsets.UTF_8))); }
        catch(Exception error) { throw new IllegalStateException(error); }
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
                            level.setBlockAndUpdate(new BlockPos(x,y,z),(unsafe?Blocks.STONE:Blocks.AIR).defaultBlockState());
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
                out.addProperty("registryCount",registry.snapshot().size());
                out.addProperty("pendingDeath",entry==null?-1:entry.diedAt());
                out.addProperty("taskTool",entry==null?"":entry.taskTool());
                out.addProperty("currentTask",CompanionTickDispatcher.currentTaskFor(BODY)!=null);
                out.addProperty("gameTime",level.getGameTime());
                out.addProperty("farChunkLoaded",level.getChunkSource().hasChunk(100000,100000));
                out.addProperty("farSafeRejected",!ExistingBodyRestore.loadedSafeLanding(level,new BlockPos(1600000,-60,1600000)));
                out.addProperty("farChunkLoadedAfter",level.getChunkSource().hasChunk(100000,100000));
                if(body!=null) {
                    out.addProperty("uuid",body.getStringUUID()); out.addProperty("ownerUuid",body.getOwnerUuid().toString());
                    out.addProperty("hp",body.getHealth()); out.addProperty("food",body.getFoodData().getFoodLevel());
                    out.addProperty("xp",body.totalExperience); out.addProperty("dimension",body.serverLevel().dimension().location().toString());
                    out.addProperty("x",body.getX());out.addProperty("y",body.getY());out.addProperty("z",body.getZ());
                    CompoundTag live=new CompoundTag(); body.saveWithoutId(live);
                    out.addProperty("inventorySha256",inventoryHash(live));
                    out.addProperty("cake",body.getInventory().countItem(Items.CAKE));
                    out.addProperty("cakeOffhand",body.getOffhandItem().is(Items.CAKE));
                    out.addProperty("sword",body.getInventory().countItem(Items.IRON_SWORD));
                    out.addProperty("safeLanding",ExistingBodyRestore.loadedSafeLanding(level,body.blockPosition()));
                }
                try {
                    var path=server.getWorldPath(LevelResource.PLAYER_DATA_DIR).resolve(BODY+".dat");
                    if(Files.exists(path)) {
                        var data=NbtIo.readCompressed(path,NbtAccounter.create(8388608));
                        out.addProperty("savedInventorySha256",inventoryHash(data));
                        out.addProperty("savedFood",data.getInt("foodLevel")); out.addProperty("savedXp",data.getInt("XpTotal"));
                        out.addProperty("savedHealth",data.getFloat("Health"));
                    }
                } catch(Exception error) { out.addProperty("saveError",error.toString()); }
                String text="QD_DEATH_QA "+out;
                c.getSource().sendSuccess(()->Component.literal(text),false);return out.get("ok").getAsBoolean()?1:0;
            })));
    }
}
