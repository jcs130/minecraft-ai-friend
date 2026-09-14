package dev.qiandeng.navigationqa;

import com.dwinovo.numen.entity.CompanionFactory;
import com.dwinovo.numen.entity.CompanionRegistry;
import com.dwinovo.numen.entity.NumenPlayer;
import com.google.gson.JsonObject;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.monster.Zombie;
import net.minecraft.world.level.GameRules;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.phys.Vec3;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import java.util.UUID;

/** Only this fresh isolated test world is arranged. The reviewed bridge does all observations. */
@Mod("qiandeng_interaction_qa")
public final class NavigationSenseQa {
    static final UUID BODY=UUID.fromString("d4ac9523-4962-43ed-98c5-19b49e104048");
    static final UUID OWNER=UUID.fromString("e5005711-be9f-44b7-aaad-6993c0ba5df4");
    private Zombie hostile;
    public NavigationSenseQa(){NeoForge.EVENT_BUS.addListener(this::register);}
    void register(RegisterCommandsEvent event){
        if(!"isolated-world-interaction".equals(System.getenv("QD_QA_FIXTURE"))) throw new IllegalStateException("isolated_fixture_required");
        event.getDispatcher().register(Commands.literal("qdnavqa").requires(s->s.getEntity()==null && s.hasPermission(4))
            .then(Commands.argument("action",StringArgumentType.word()).executes(c->{
                var server=c.getSource().getServer();var level=server.overworld();
                var body=NumenPlayer.findByUuid(server,BODY);var out=new JsonObject();
                String action=StringArgumentType.getString(c,"action");
                try{
                    if(action.equals("setup")){
                        if(body!=null || CompanionRegistry.get(server).find(BODY)!=null) throw new IllegalStateException("fresh_fixture_required");
                        level.setDefaultSpawnPos(new BlockPos(0,-60,0),0);
                        level.getGameRules().getRule(GameRules.RULE_DOMOBSPAWNING).set(false,server);
                        level.getGameRules().getRule(GameRules.RULE_DAYLIGHT).set(false,server);
                        level.setDayTime(18000);
                        for(int x=-8;x<=8;x++)for(int z=-8;z<=8;z++){
                            level.setBlockAndUpdate(new BlockPos(x,-61,z),Blocks.STONE.defaultBlockState());
                            for(int y=-60;y<=-54;y++)level.setBlockAndUpdate(new BlockPos(x,y,z),Blocks.AIR.defaultBlockState());
                        }
                        level.setBlockAndUpdate(new BlockPos(3,-60,0),Blocks.CRAFTING_TABLE.defaultBlockState());
                        level.setBlockAndUpdate(new BlockPos(2,-61,0),Blocks.FARMLAND.defaultBlockState());
                        // Contain the fluid fixture; otherwise it floods the farmland
                        // and moves the idle body before the read-only assertions.
                        level.setBlockAndUpdate(new BlockPos(5,-60,0),Blocks.GLASS.defaultBlockState());
                        level.setBlockAndUpdate(new BlockPos(4,-60,1),Blocks.GLASS.defaultBlockState());
                        level.setBlockAndUpdate(new BlockPos(4,-60,-1),Blocks.GLASS.defaultBlockState());
                        level.setBlockAndUpdate(new BlockPos(4,-60,0),Blocks.WATER.defaultBlockState());
                        CompanionRegistry.get(server).put(BODY,new CompanionRegistry.Entry("Kirito",OWNER,level.dimension(),new BlockPos(0,-60,0)));
                        body=CompanionFactory.spawn(server,BODY,"Kirito",OWNER,level,new Vec3(.5,-60,.5));
                        body.setInvulnerable(true);body.getInventory().clearContent();
                    }else if(action.equals("danger")){
                        if(body==null || hostile!=null)throw new IllegalStateException("idle_fixture_required");
                        hostile=EntityType.ZOMBIE.create(level);
                        hostile.moveTo(body.getX()+2,body.getY(),body.getZ());hostile.setTarget(body);
                        hostile.setPersistenceRequired();hostile.setInvulnerable(true);level.addFreshEntity(hostile);
                    }else if(action.equals("clear_danger")){
                        if(hostile!=null){hostile.discard();hostile=null;}
                    }else if(!action.equals("status"))throw new IllegalArgumentException("unknown_action");
                    out.addProperty("ok",true);
                }catch(Exception error){out.addProperty("ok",false);out.addProperty("error",error.toString());}
                body=NumenPlayer.findByUuid(server,BODY);
                out.addProperty("bodyOnline",body!=null);out.addProperty("chunkCount",level.getChunkSource().getLoadedChunksCount());
                out.addProperty("gameTime",level.getGameTime());
                if(body!=null){out.addProperty("x",body.getX());out.addProperty("y",body.getY());out.addProperty("z",body.getZ());out.addProperty("bodyTick",body.tickCount);}
                c.getSource().sendSuccess(()->Component.literal("QD_NAVIGATION_QA "+out),false);
                return out.get("ok").getAsBoolean()?1:0;
            })));
    }
}
