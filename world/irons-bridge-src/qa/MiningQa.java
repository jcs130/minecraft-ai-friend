package dev.qiandeng.interactionqa;

import com.dwinovo.numen.entity.CompanionFactory;
import com.dwinovo.numen.entity.CompanionRegistry;
import com.dwinovo.numen.entity.NumenPlayer;
import com.dwinovo.numen.task.CompanionTickDispatcher;
import com.dwinovo.numen.core.task.mine.MineBlockTaskRecord;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
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
import net.neoforged.neoforge.event.server.ServerStoppingEvent;
import java.nio.file.Files;
import java.util.UUID;
import java.util.Base64;
import java.nio.charset.StandardCharsets;

/** Fixture-only arrangement/clock acceleration; no fabricated receipts or task results. */
@Mod("qiandeng_interaction_qa")
public final class MiningQa {
    static final UUID BODY=UUID.fromString("d4ac9523-4962-43ed-98c5-19b49e104048");
    static final UUID OWNER=UUID.fromString("e5005711-be9f-44b7-aaad-6993c0ba5df4");
    private String shutdownRequest;
    public MiningQa(){NeoForge.EVENT_BUS.addListener(this::register);NeoForge.EVENT_BUS.addListener(this::stopping);}

    static String payload(){
        var args=new JsonObject();var ids=new JsonArray();ids.add("minecraft:oak_log");
        args.add("block_ids",ids);args.addProperty("count",1);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(args.toString().getBytes(StandardCharsets.UTF_8));
    }
    void stopping(ServerStoppingEvent event){
        if(shutdownRequest==null)return;
        var server=event.getServer();
        server.getCommands().performPrefixedCommand(server.createCommandSourceStack(),
            "qdworld mine "+BODY+" "+shutdownRequest+" "+payload());
    }
    void register(RegisterCommandsEvent event){
        if(!"isolated-world-interaction".equals(System.getenv("QD_QA_FIXTURE")))
            throw new IllegalStateException("isolated_fixture_required");
        event.getDispatcher().register(Commands.literal("qdminingqa")
            .requires(s->s.getEntity()==null && s.hasPermission(4))
            .then(Commands.argument("action",StringArgumentType.word()).executes(c->{
                var server=c.getSource().getServer();var level=server.overworld();
                var registry=CompanionRegistry.get(server);
                var body=NumenPlayer.findByUuid(server,BODY);
                String action=StringArgumentType.getString(c,"action");
                var out=new JsonObject();
                try{
                    if(action.equals("setup")){
                        if(body!=null || registry.find(BODY)!=null)throw new IllegalStateException("fixture_exists");
                        level.setDefaultSpawnPos(new BlockPos(0,-60,0),0);
                        level.getGameRules().getRule(GameRules.RULE_DOMOBSPAWNING).set(false,server);
                        level.getGameRules().getRule(GameRules.RULE_KEEPINVENTORY).set(true,server);
                        for(int x=-20;x<=32;x++)for(int z=-20;z<=20;z++){
                            level.setBlockAndUpdate(new BlockPos(x,-61,z),Blocks.STONE.defaultBlockState());
                            for(int y=-60;y<=-53;y++)level.setBlockAndUpdate(new BlockPos(x,y,z),Blocks.AIR.defaultBlockState());
                        }
                        registry.put(BODY,new CompanionRegistry.Entry("Kirito",OWNER,level.dimension(),new BlockPos(0,-60,0)));
                        body=CompanionFactory.spawn(server,BODY,"Kirito",OWNER,level,new Vec3(.5,-60,.5));
                        body.getInventory().clearContent();
                        body.getInventory().setItem(0,new ItemStack(Items.IRON_AXE));
                        body.getFoodData().setFoodLevel(20);
                        level.setBlockAndUpdate(new BlockPos(30,-60,0),Blocks.OAK_LOG.defaultBlockState());
                    }else if(action.equals("arrange") || action.equals("arrange_timeout")){
                        if(body==null || CompanionTickDispatcher.currentTaskFor(BODY)!=null)
                            throw new IllegalStateException("idle_existing_body_required");
                        body.teleportTo(.5,-60,.5);
                        body.getInventory().setItem(0,action.equals("arrange_timeout") ? ItemStack.EMPTY : new ItemStack(Items.IRON_AXE));
                        for(int x=2;x<=4;x++)level.setBlockAndUpdate(new BlockPos(x,-60,0),Blocks.OAK_LOG.defaultBlockState());
                        level.setBlockAndUpdate(new BlockPos(2,-60,2),Blocks.DIAMOND_ORE.defaultBlockState());
                    }else if(action.equals("restore")){
                        var entry=registry.find(BODY);
                        if(body==null){
                            if(entry==null || !OWNER.equals(entry.owner())
                                || !Files.isRegularFile(server.getWorldPath(LevelResource.PLAYER_DATA_DIR).resolve(BODY+".dat")))
                                throw new IllegalStateException("exact_saved_fixture_required");
                            body=CompanionFactory.spawn(server,BODY,"Kirito",OWNER,level,null);
                        }
                    }else if(action.startsWith("timeout_")){
                        String request=action.substring(8);
                        var task=CompanionTickDispatcher.currentTaskFor(BODY);
                        if(!request.matches("[0-9a-f]{32}") || body==null || !(task instanceof MineBlockTaskRecord)
                                || !("mcp-"+request).equals(task.getToolCallId()))
                            throw new IllegalStateException("exact_native_mine_not_accepted");
                        out.addProperty("originalTask",task.publicId());
                        out.addProperty("deadline",task.getDeadlineGameTime());
                        // The real next TaskSlot tick creates TIMEOUT and the real mining result.
                        server.getWorldData().overworldData().setGameTime(task.getDeadlineGameTime());
                    }else if(action.startsWith("arm_")){
                        String request=action.substring(4);
                        if(!request.matches("[0-9a-f]{32}") || body==null || CompanionTickDispatcher.currentTaskFor(BODY)!=null)
                            throw new IllegalStateException("valid_shutdown_request_required");
                        shutdownRequest=request;
                    }else if(!action.equals("status"))throw new IllegalStateException("unknown_fixture_action");
                    out.addProperty("ok",true);
                }catch(Exception error){out.addProperty("ok",false);out.addProperty("error",error.toString());}
                body=NumenPlayer.findByUuid(server,BODY);
                out.addProperty("bodyOnline",body!=null);out.addProperty("gameTime",level.getGameTime());
                out.addProperty("currentTask",CompanionTickDispatcher.currentTaskFor(BODY)!=null);
                out.addProperty("farOakIntact",level.getBlockState(new BlockPos(30,-60,0)).is(Blocks.OAK_LOG));
                if(body!=null){
                    out.addProperty("oak",body.getInventory().countItem(Items.OAK_LOG));
                    out.addProperty("diamond",body.getInventory().countItem(Items.DIAMOND));
                    out.addProperty("onGround",body.onGround());
                    out.addProperty("x",body.getX());out.addProperty("y",body.getY());out.addProperty("z",body.getZ());
                    var registered=registry.find(BODY);
                    out.addProperty("persistedTaskTool",registered==null?"":registered.taskTool());
                    var task=CompanionTickDispatcher.currentTaskFor(BODY);
                    if(task instanceof MineBlockTaskRecord mine){
                        out.addProperty("nativeTaskId",mine.publicId());out.addProperty("namedCells",mine.named.size());
                    }
                }
                String reply="QD_MINING_QA "+out;
                c.getSource().sendSuccess(()->Component.literal(reply),false);
                return out.get("ok").getAsBoolean()?1:0;
            })));
    }
}
