package dev.qiandeng.interactionqa;

import com.dwinovo.numen.entity.CompanionFactory;
import com.dwinovo.numen.entity.CompanionRegistry;
import com.dwinovo.numen.entity.NumenPlayer;
import com.dwinovo.numen.task.CompanionTickDispatcher;
import com.google.gson.JsonObject;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.ClipContext;
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

/** Isolated-world arrangement and observation only; bridge performs every test click. */
@Mod("qiandeng_interaction_qa")
public final class InteractionQa {
    static final UUID BODY=UUID.fromString("d4ac9523-4962-43ed-98c5-19b49e104048");
    static final UUID OWNER=UUID.fromString("e5005711-be9f-44b7-aaad-6993c0ba5df4");
    static final BlockPos TARGET=new BlockPos(3,-60,0);
    static final BlockPos PLACEMENT=new BlockPos(2,-60,0);
    static final BlockPos GRASS=PLACEMENT.above();
    private String shutdownRequest;
    private boolean shutdownFood;
    public InteractionQa(){NeoForge.EVENT_BUS.addListener(this::register);NeoForge.EVENT_BUS.addListener(this::stopping);}

    void stopping(ServerStoppingEvent event){
        if(shutdownRequest==null)return;
        var server=event.getServer();
        JsonObject args=new JsonObject();args.addProperty("button","right");
        args.addProperty("x",TARGET.getX());args.addProperty("y",TARGET.getY());args.addProperty("z",TARGET.getZ());
        args.addProperty("hold_ticks",0);args.addProperty("item_id","minecraft:dirt");
        if(shutdownFood){args=new JsonObject();args.addProperty("item_id","minecraft:bread");}
        String payload=Base64.getUrlEncoder().withoutPadding().encodeToString(args.toString().getBytes(StandardCharsets.UTF_8));
        // A real accepted request at shutdown, after the final tick. No fabricated native journal.
        server.getCommands().performPrefixedCommand(server.createCommandSourceStack(),
            "qdworld "+(shutdownFood?"eat":"interact")+" "+BODY+" "+shutdownRequest+" "+payload);
    }

    void register(RegisterCommandsEvent event){
        if(!"isolated-world-interaction".equals(System.getenv("QD_QA_FIXTURE")))
            throw new IllegalStateException("isolated_fixture_required");
        event.getDispatcher().register(Commands.literal("qdinteractionqa")
            .requires(s->s.getEntity()==null && s.hasPermission(4))
            .then(Commands.argument("action",StringArgumentType.word()).executes(c->{
                var server=c.getSource().getServer();var level=server.overworld();
                var registry=CompanionRegistry.get(server);
                var body=NumenPlayer.findByUuid(server,BODY);
                String action=StringArgumentType.getString(c,"action");
                JsonObject out=new JsonObject();
                try{
                    if(action.equals("setup")){
                        if(body!=null || registry.find(BODY)!=null)throw new IllegalStateException("fixture_exists");
                        level.setDefaultSpawnPos(new BlockPos(0,-60,0),0);
                        level.getGameRules().getRule(GameRules.RULE_DOMOBSPAWNING).set(false,server);
                        level.getGameRules().getRule(GameRules.RULE_KEEPINVENTORY).set(true,server);
                        for(int x=-4;x<=8;x++)for(int z=-4;z<=4;z++){
                            level.setBlockAndUpdate(new BlockPos(x,-61,z),Blocks.STONE.defaultBlockState());
                            for(int y=-60;y<=-55;y++)level.setBlockAndUpdate(new BlockPos(x,y,z),Blocks.AIR.defaultBlockState());
                        }
                        level.setBlockAndUpdate(TARGET,Blocks.STONE.defaultBlockState());
                        level.setBlockAndUpdate(PLACEMENT,Blocks.GRASS_BLOCK.defaultBlockState());
                        level.setBlockAndUpdate(GRASS,Blocks.SHORT_GRASS.defaultBlockState());
                        registry.put(BODY,new CompanionRegistry.Entry("Kirito",OWNER,level.dimension(),new BlockPos(0,-60,0)));
                        body=CompanionFactory.spawn(server,BODY,"Kirito",OWNER,level,new Vec3(.5,-60,.5));
                        body.getInventory().clearContent();
                        body.getInventory().setItem(0,new ItemStack(Items.DIRT,8));
                        body.getFoodData().setFoodLevel(20);
                        server.getPlayerList().saveAll();
                    }else if(action.equals("clear")){
                        if(body==null || CompanionTickDispatcher.currentTaskFor(BODY)!=null)
                            throw new IllegalStateException("idle_existing_body_required");
                        level.setBlockAndUpdate(GRASS,Blocks.AIR.defaultBlockState());
                        level.setBlockAndUpdate(PLACEMENT,Blocks.AIR.defaultBlockState());
                    }else if(action.equals("remove_placed")){
                        if(!level.getBlockState(PLACEMENT).is(Blocks.DIRT))throw new IllegalStateException("placed_dirt_required");
                        // No drop or refund. A replay would now place another block and consume again.
                        level.setBlockAndUpdate(PLACEMENT,Blocks.AIR.defaultBlockState());
                    }else if(action.equals("restore")){
                        var entry=registry.find(BODY);
                        if(body==null){
                            if(entry==null || !OWNER.equals(entry.owner())
                                || !Files.isRegularFile(server.getWorldPath(LevelResource.PLAYER_DATA_DIR).resolve(BODY+".dat")))
                                throw new IllegalStateException("exact_saved_fixture_required");
                            body=CompanionFactory.spawn(server,BODY,"Kirito",OWNER,level,null);
                        }
                    }else if(action.equals("food_setup") || action.equals("food_hungry")){
                        if(body==null || CompanionTickDispatcher.currentTaskFor(BODY)!=null)
                            throw new IllegalStateException("idle_existing_body_required");
                        if(action.equals("food_setup"))body.getInventory().setItem(1,new ItemStack(Items.BREAD,8));
                        body.getFoodData().setFoodLevel(15);body.getFoodData().setSaturation(0);
                    }else if(action.startsWith("food_arm_")){
                        String request=action.substring(9);
                        if(!request.matches("[0-9a-f]{32}") || body==null || !body.onGround())
                            throw new IllegalStateException("valid_shutdown_request_required");
                        shutdownRequest=request;shutdownFood=true;
                    }else if(action.startsWith("arm_")){
                        String request=action.substring(4);
                        if(!request.matches("[0-9a-f]{32}") || body==null || !body.onGround())
                            throw new IllegalStateException("valid_shutdown_request_required");
                        shutdownRequest=request;shutdownFood=false;
                    }else if(!action.equals("status"))throw new IllegalStateException("unknown_fixture_action");
                    out.addProperty("ok",true);
                }catch(Exception error){out.addProperty("ok",false);out.addProperty("error",error.toString());}
                body=NumenPlayer.findByUuid(server,BODY);
                out.addProperty("bodyOnline",body!=null);
                out.addProperty("ownerOnline",server.getPlayerList().getPlayer(OWNER)!=null);
                out.addProperty("registryCount",registry.snapshot().size());
                out.addProperty("rosterCount",server.getPlayerList().getPlayers().size());
                out.addProperty("currentTask",CompanionTickDispatcher.currentTaskFor(BODY)!=null);
                out.addProperty("gameTime",level.getGameTime());
                if(shutdownRequest!=null)out.addProperty("shutdownRequestId",shutdownRequest);
                out.addProperty("targetBlock",BuiltInRegistries.BLOCK.getKey(level.getBlockState(TARGET).getBlock()).toString());
                out.addProperty("placementBlock",BuiltInRegistries.BLOCK.getKey(level.getBlockState(PLACEMENT).getBlock()).toString());
                out.addProperty("grassBlock",BuiltInRegistries.BLOCK.getKey(level.getBlockState(GRASS).getBlock()).toString());
                if(body!=null){
                    out.addProperty("uuid",body.getStringUUID());out.addProperty("ownerUuid",body.getOwnerUuid().toString());
                    out.addProperty("dirt",body.getInventory().countItem(Items.DIRT));
                    out.addProperty("bread",body.getInventory().countItem(Items.BREAD));
                    out.addProperty("hunger",body.getFoodData().getFoodLevel());
                    var registered=registry.find(BODY);
                    out.addProperty("persistedTaskTool",registered==null?"":registered.taskTool());
                    out.addProperty("x",body.getX());out.addProperty("y",body.getY());out.addProperty("z",body.getZ());
                    out.addProperty("onGround",body.onGround());
                    out.addProperty("gameMode",body.gameMode.getGameModeForPlayer().getName());
                    var eye=body.getEyePosition();var direction=Vec3.atCenterOf(TARGET).subtract(eye).normalize().scale(4.5);
                    var hit=level.clip(new ClipContext(eye,eye.add(direction),ClipContext.Block.OUTLINE,ClipContext.Fluid.NONE,body));
                    out.addProperty("rayHitBlock",BuiltInRegistries.BLOCK.getKey(level.getBlockState(hit.getBlockPos()).getBlock()).toString());
                    out.addProperty("rayHitPosition",hit.getBlockPos().toShortString());
                    out.addProperty("rayHitFace",hit.getDirection().getName());
                }
                String reply="QD_INTERACTION_QA "+out;
                c.getSource().sendSuccess(()->Component.literal(reply),false);
                return out.get("ok").getAsBoolean()?1:0;
            })));
    }
}
