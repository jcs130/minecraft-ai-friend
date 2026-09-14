package dev.qiandeng.dropqa;

import com.dwinovo.numen.entity.CompanionFactory;
import com.dwinovo.numen.entity.CompanionRegistry;
import com.dwinovo.numen.entity.NumenPlayer;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.core.component.DataComponents;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.component.CustomData;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.entity.item.ItemTossEvent;
import java.util.UUID;

/** Isolated test arrangement only; actual drops always use the production bridge. */
@Mod("qiandeng_drop_qa")
public final class DropQa {
    static final UUID BODY=UUID.fromString("c580fd66-6311-46db-a839-3b0032f6d001");
    static final UUID OWNER=UUID.fromString("c580fd66-6311-46db-a839-3b0032f6d002");
    static final AABB AREA=new AABB(290,-65,290,315,-45,315);
    private boolean cancelNext;
    public DropQa(){NeoForge.EVENT_BUS.addListener(this::register);NeoForge.EVENT_BUS.addListener(this::toss);}
    void toss(ItemTossEvent event){
        if(cancelNext && event.getPlayer().getUUID().equals(BODY)){cancelNext=false;event.setCanceled(true);}
    }
    static ItemStack stack(String label, int count){
        ItemStack item=new ItemStack(Items.PAPER,count);
        item.set(DataComponents.CUSTOM_NAME,Component.literal(label));
        CompoundTag data=new CompoundTag();data.putString("qa_component_marker",label);
        item.set(DataComponents.CUSTOM_DATA,CustomData.of(data));
        return item;
    }
    void register(RegisterCommandsEvent event){
        String scope=System.getenv("QD_QA_FIXTURE");
        if(!"isolated-maid-bridge".equals(scope) && !"isolated-world-interaction".equals(scope))
            throw new IllegalStateException("isolated_drop_fixture_required");
        event.getDispatcher().register(Commands.literal("qddropqa").requires(s->s.getEntity()==null && s.hasPermission(4))
            .then(Commands.argument("action",StringArgumentType.word()).executes(c->{
                var server=c.getSource().getServer();var level=server.overworld();
                String action=StringArgumentType.getString(c,"action");JsonObject out=new JsonObject();
                try{
                    var body=NumenPlayer.findByUuid(server,BODY);
                    if(action.equals("setup")){
                        if(body==null){
                            for(int x=294;x<=310;x++)for(int z=294;z<=310;z++){
                                level.setBlockAndUpdate(new BlockPos(x,-61,z),Blocks.STONE.defaultBlockState());
                                for(int y=-60;y<=-55;y++)level.setBlockAndUpdate(new BlockPos(x,y,z),Blocks.AIR.defaultBlockState());
                            }
                            CompanionRegistry.get(server).put(BODY,new CompanionRegistry.Entry("DropQa",OWNER,level.dimension(),new BlockPos(300,-60,300)));
                            body=CompanionFactory.spawn(server,BODY,"DropQa",OWNER,level,new Vec3(300.5,-60,300.5));
                        }
                        for(var entity:level.getEntitiesOfClass(ItemEntity.class,AREA))entity.discard();
                        body.getInventory().clearContent();
                        body.getInventory().setItem(0,stack("qa-alpha",4));body.getInventory().setItem(1,stack("qa-beta",4));
                        body.getFoodData().setFoodLevel(20);
                    }else if(action.equals("cancel_next")){cancelNext=true;}
                    else if(!action.equals("status"))throw new IllegalArgumentException("invalid_drop_qa_action");
                    body=NumenPlayer.findByUuid(server,BODY);
                    if(body==null)throw new IllegalStateException("fixture_body_missing");
                    out.addProperty("ok",true);out.addProperty("bodyUuid",BODY.toString());
                    out.addProperty("inventoryPaper",body.getInventory().countItem(Items.PAPER));
                    out.addProperty("slot0",body.getInventory().getItem(0).getCount());
                    out.addProperty("slot1",body.getInventory().getItem(1).getCount());
                    out.addProperty("slot0AlphaComponents",ItemStack.isSameItemSameComponents(body.getInventory().getItem(0),stack("qa-alpha",1)));
                    out.addProperty("slot1BetaComponents",ItemStack.isSameItemSameComponents(body.getInventory().getItem(1),stack("qa-beta",1)));
                    JsonArray entities=new JsonArray();
                    for(var entity:level.getEntitiesOfClass(ItemEntity.class,AREA)){
                        ItemStack item=entity.getItem();JsonObject row=new JsonObject();
                        row.addProperty("entityUuid",entity.getStringUUID());row.addProperty("count",item.getCount());
                        row.addProperty("alphaComponents",ItemStack.isSameItemSameComponents(item,stack("qa-alpha",1)));
                        row.addProperty("betaComponents",ItemStack.isSameItemSameComponents(item,stack("qa-beta",1)));
                        entities.add(row);
                    }
                    out.add("entities",entities);
                }catch(Exception error){out.addProperty("ok",false);out.addProperty("errorType",error.getClass().getSimpleName());}
                String result="QD_DROP_QA "+out;c.getSource().sendSuccess(()->Component.literal(result),false);
                return out.get("ok").getAsBoolean()?1:0;
            })));
    }
}
