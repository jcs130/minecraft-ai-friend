package org.qiandengji.mcbot;

import com.dwinovo.numen.api.entity.NumenPlayer;
import com.google.gson.*;
import net.minecraft.world.inventory.AbstractContainerMenu;
import org.bukkit.*;
import org.bukkit.block.*;
import org.bukkit.entity.Player;
import org.bukkit.inventory.*;
import org.bukkit.loot.Lootable;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Function;

/** Uses native window operations; never assigns container or player stacks. */
public final class Containers {
    private final NumenPlayer body;
    private final Player player;
    private final NativeCalls calls;
    public Containers(NumenPlayer body,NativeCalls calls){this.body=body;this.player=(Player)body.getBukkitEntity();this.calls=calls;}
    private Container target(JsonObject a,double reach){
        int x=(int)Wire.integer(a,"x",-29999984,29999984),y=(int)Wire.integer(a,"y",player.getWorld().getMinHeight(),player.getWorld().getMaxHeight()-1),z=(int)Wire.integer(a,"z",-29999984,29999984);
        if(!player.getWorld().isChunkLoaded(x>>4,z>>4)||player.getLocation().distanceSquared(new Location(player.getWorld(),x+.5,y+.5,z+.5))>reach*reach)throw new IllegalArgumentException("容器未加载或超出距离；先接近后重新查询。");
        BlockState state=player.getWorld().getBlockAt(x,y,z).getState();if(!(state instanceof Container c))throw new IllegalArgumentException("目标不是容器");
        if(!Perception.visible(body,state.getBlock()))throw new IllegalArgumentException("容器被遮挡；先接近到可见位置。");
        if(c.isLocked()||state instanceof Lootable l&&l.getLootTable()!=null)throw new IllegalArgumentException("锁定或未展开战利品容器不能直接存取。");
        return c;
    }
    private <T> CompletableFuture<T> window(Container container,Function<AbstractContainerMenu,CompletableFuture<T>> action){
        return atBlock(container.getBlock(),action);
    }
    public <T> CompletableFuture<T> atBlock(Block block,Function<AbstractContainerMenu,CompletableFuture<T>> action){
        if(body.containerMenu!=body.inventoryMenu)throw new IllegalArgumentException("身体已有窗口打开；本次未关闭或混用旧窗口。");
        Location at=block.getLocation();
        // A skill-bound sword or the starter backpack can consume right-click.
        // Select an empty hand through native inventory operations before
        // opening a container, preserving the real held stack in inventory.
        body.hotbar().hold(-1);
        CompletableFuture<?> empty=body.getMainHandItem().isEmpty()?CompletableFuture.completedFuture(null):calls.call("numen.gear.remove",List.of("mainhand"),Map.of());
        return empty.thenCompose(ignored->{
            if(!body.getMainHandItem().isEmpty())throw new IllegalStateException("无法腾出空手交互；请先腾出一个背包空槽，未打开或搬运。");
            return calls.call("numen.use.block",List.of(Map.of("x",at.getBlockX(),"y",at.getBlockY(),"z",at.getBlockZ())),Map.of());
        }).thenCompose(pressed->{
            AbstractContainerMenu menu=body.containerMenu;
            if(menu==body.inventoryMenu||!menu.getCarried().isEmpty())throw new IllegalStateException("原生窗口未打开或光标非空；未存取。交互读回："+pressed);
            CompletableFuture<T> result;
            try{result=action.apply(menu);}catch(RuntimeException failure){result=CompletableFuture.failedFuture(failure);}
            return result.whenComplete((value,error)->{if(body.containerMenu==menu&&menu.getCarried().isEmpty())body.closeContainer();});
        });
    }
    private static String item(ItemStack s){return Toolbox.id(s.getType());}
    private int carried(Material type){int n=0;for(ItemStack s:player.getInventory().getStorageContents())if(s!=null&&s.getType()==type)n+=s.getAmount();return n;}
    public CompletableFuture<Toolbox.Result> transfer(JsonObject a){
        Policy.keys(a,"x","y","z","dir","item");Container c=target(a,6.5);if(c instanceof Furnace)throw new IllegalArgumentException("熔炉请用smelt query/load/take，不能用transfer。");
        String direction=Wire.string(a,"dir",1,3);if(!Set.of("in","out").contains(direction))throw new IllegalArgumentException("dir须in或out");
        boolean out=direction.equals("out");Inventory source=out?c.getInventory():player.getInventory();
        Set<String> ids=new LinkedHashSet<>();String filter=a.has("item")?Policy.item(a,"item"):null;
        ItemStack[] contents=out?source.getContents():player.getInventory().getStorageContents();
        for(ItemStack s:contents)if(s!=null&&!s.getType().isAir()&&(filter==null||item(s).equals(filter)))ids.add(item(s));
        if(ids.size()>36)throw new IllegalArgumentException("本次物品种类过多；用item指定一种再操作。");
        return window(c,menu->{
            String fn=out?"numen.gui.take":"numen.gui.put";StringBuilder expression=new StringBuilder("(function() local n=0; ");
            for(String id:ids)expression.append("n=n+").append(NativeCalls.code(fn,id)).append(';');
            expression.append("return {moved=n} end)()");
            return calls.expression(expression.toString()).thenApply(value->{
                if(body.containerMenu!=menu||!menu.getCarried().isEmpty())throw new IllegalStateException("窗口已改变或光标未归零；结果需查询核对，勿重放。");
                JsonObject data=value.getAsJsonObject();data.addProperty("direction",direction);data.addProperty("cursor_empty",true);
                return Toolbox.Result.ok("原生存取已结束；moved是实际搬运数，未搬完的物品仍在来源。",data);
            });
        });
    }
    public CompletableFuture<Toolbox.Result> smelt(JsonObject a){
        Policy.keys(a,"x","y","z","action","input_slot","input_count","fuel_slot","fuel_count","slot","count");
        Container raw=target(a,5.5);if(!(raw instanceof Furnace furnace))throw new IllegalArgumentException("仅支持原版熔炉、高炉和烟熏炉");
        String action=a.has("action")?Wire.string(a,"action",1,8):"query";
        if(action.equals("query"))return CompletableFuture.completedFuture(Toolbox.Result.ok("机器真实快照；装料、燃烧与成品取出是不同阶段。燃料总续航尚未估算。",machine(furnace)));
        if(!Set.of("load","take").contains(action))throw new IllegalArgumentException("action须query/load/take");
        if(action.equals("take")){
            String source=a.has("slot")?Wire.string(a,"slot",1,8):"output";
            int slot=switch(source){case"input"->0;case"fuel"->1;case"output"->2;default->throw new IllegalArgumentException("无效机器槽位");};
            int count=a.has("count")?(int)Wire.integer(a,"count",1,64):64;
            return window(furnace,menu->take(menu,slot,count).thenApply(moved->{JsonObject data=machine(furnace);data.addProperty("taken_count",moved);data.addProperty("cursor_empty",menu.getCarried().isEmpty());return Toolbox.Result.ok("原生取出已结束；只报告实际进入玩家库存的数量。",data);}));
        }
        if(!a.has("input_slot")&&!a.has("fuel_slot"))throw new IllegalArgumentException("load至少指定原料槽或燃料槽");
        record Load(int source,int target,int count){}
        List<Load> loads=new ArrayList<>();Map<Integer,Integer> needed=new HashMap<>();
        for(String type:List.of("input","fuel"))if(a.has(type+"_slot")){
            int from=(int)Wire.integer(a,type+"_slot",0,35),count=a.has(type+"_count")?(int)Wire.integer(a,type+"_count",1,64):1;
            ItemStack stack=player.getInventory().getItem(from);if(stack==null||stack.getType().isAir())throw new IllegalArgumentException("指定玩家槽位为空");
            needed.merge(from,count,Integer::sum);if(needed.get(from)>stack.getAmount())throw new IllegalArgumentException("原料和燃料合计超出来源数量；未装料。");
            int to=type.equals("input")?0:1;ItemStack old=furnace.getInventory().getItem(to);
            if(old!=null&&!old.getType().isAir()&&(!old.isSimilar(stack)||old.getAmount()+count>old.getMaxStackSize()))throw new IllegalArgumentException("机器槽位不兼容或装不下整批；未装料。");
            if(type.equals("fuel")&&!stack.getType().isFuel()&&stack.getType()!=Material.LAVA_BUCKET)throw new IllegalArgumentException("指定物品不是燃料；未装料。");
            if(type.equals("input")&&!cookable(stack,furnace))throw new IllegalArgumentException("这台机器没有该原料的烧制配方；未装料。");
            loads.add(new Load(from,to,count));
        }
        return window(furnace,menu->{
            CompletableFuture<JsonObject> chain=CompletableFuture.completedFuture(new JsonObject());
            for(Load load:loads)chain=chain.thenCompose(data->{
                requireMenu(menu);int from=playerSlot(menu,load.source()),before=body.getInventory().getItem(load.source()).getCount();
                return calls.call("numen.gui.move",List.of(from,load.target()),Map.of("count",load.count())).thenApply(value->{
                    requireMenu(menu);int after=body.getInventory().getItem(load.source()).getCount(),moved=before-after;
                    if(moved<0||moved>load.count())throw new IllegalStateException("来源数量出现额外变化；结果未知，请查询机器和库存，勿重放。");
                    data.addProperty(load.target()==0?"loaded_input_count":"loaded_fuel_count",moved);return data;
                });
            });
            return chain.thenApply(data->{JsonObject state=machine(furnace);for(String key:data.keySet())state.add(key,data.get(key));state.addProperty("cursor_empty",menu.getCarried().isEmpty());return Toolbox.Result.ok("原生装料已结束；装料不表示烧制完成，query后再决定等待和取出。",state);});
        });
    }
    private void requireMenu(AbstractContainerMenu menu){if(body.containerMenu!=menu||!menu.getCarried().isEmpty())throw new IllegalStateException("旧窗口已失效或光标未归零；后续操作未派发。");}
    private static int playerSlot(AbstractContainerMenu menu,int inventorySlot){
        for(int i=0;i<menu.slots.size();i++){var slot=menu.slots.get(i);if(slot.container instanceof net.minecraft.world.entity.player.Inventory&&slot.getContainerSlot()==inventorySlot)return i;}
        throw new IllegalStateException("原生窗口找不到来源槽；未移动物品。");
    }
    private CompletableFuture<Integer> take(AbstractContainerMenu menu,int slot,int count){
        requireMenu(menu);var source=menu.slots.get(slot).getItem();if(source.isEmpty())return CompletableFuture.completedFuture(0);
        var expected=source.copy();int destination=-1,capacity=0;
        for(int pass=0;pass<2&&destination<0;pass++)for(int i=0;i<menu.slots.size();i++){
            var candidate=menu.slots.get(i);var stack=candidate.getItem();
            if(candidate.container!=body.getInventory()||candidate.getContainerSlot()>35||!candidate.mayPlace(source))continue;
            boolean suitable=pass==0?!stack.isEmpty()&&net.minecraft.world.item.ItemStack.isSameItemSameComponents(source,stack):stack.isEmpty();
            int room=candidate.getMaxStackSize(source)-stack.getCount();
            if(suitable&&room>0){destination=i;capacity=room;break;}
        }
        if(destination<0)return CompletableFuture.completedFuture(0);
        final int targetSlot=destination,before=menu.slots.get(destination).getItem().getCount(),amount=Math.min(Math.min(count,source.getCount()),capacity);
        return calls.call("numen.gui.move",List.of(slot,targetSlot),Map.of("count",amount)).thenCompose(value->{
            requireMenu(menu);var target=menu.slots.get(targetSlot).getItem();int moved=target.getCount()-before;
            if(!net.minecraft.world.item.ItemStack.isSameItemSameComponents(expected,target)||moved<0||moved>amount)throw new IllegalStateException("指定槽位取出结果未知；请重查，勿重复取出。");
            if(moved==0||moved>=count||menu.slots.get(slot).getItem().isEmpty())return CompletableFuture.completedFuture(moved);
            return take(menu,slot,count-moved).thenApply(more->moved+more);
        });
    }
    private static boolean cookable(ItemStack input,Furnace furnace){
        Iterator<Recipe> recipes=Bukkit.recipeIterator();while(recipes.hasNext()){
            Recipe r=recipes.next();if(!(r instanceof CookingRecipe<?> c)||!c.getInputChoice().test(input))continue;
            if(furnace instanceof BlastFurnace&&r instanceof BlastingRecipe||furnace instanceof Smoker&&r instanceof SmokingRecipe||!(furnace instanceof BlastFurnace)&&!(furnace instanceof Smoker)&&r instanceof FurnaceRecipe)return true;
        }return false;
    }
    private static JsonObject machine(Furnace furnace){
        furnace=(Furnace)furnace.getBlock().getState();
        JsonObject d=new JsonObject();d.addProperty("machine",Toolbox.id(furnace.getType()));
        d.add("input",Toolbox.stack(furnace.getInventory().getSmelting()));d.add("fuel",Toolbox.stack(furnace.getInventory().getFuel()));d.add("output",Toolbox.stack(furnace.getInventory().getResult()));
        d.addProperty("burn_remaining_ticks",Math.max(0,furnace.getBurnTime()));d.addProperty("cook_progress_ticks",Math.max(0,furnace.getCookTime()));d.addProperty("cook_total_ticks",furnace.getCookTimeTotal());
        d.add("fuel_sufficient_for_input",JsonNull.INSTANCE);d.addProperty("fuel_estimate_known",false);d.addProperty("suggested_wait_seconds",Math.max(1,Math.ceil(Math.max(0,furnace.getCookTimeTotal()-furnace.getCookTime())/20d)));
        return d;
    }
}
