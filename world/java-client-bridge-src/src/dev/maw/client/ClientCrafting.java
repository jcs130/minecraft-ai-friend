package dev.maw.client;

import com.google.gson.JsonObject;
import net.minecraft.client.Minecraft;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.inventory.CraftingMenu;
import net.minecraft.world.inventory.InventoryMenu;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.RecipeHolder;
import net.minecraft.world.item.crafting.RecipeType;
import static dev.maw.client.ClientState.object;

/** One native recipe-book placement and one output pickup, on client ticks. */
final class ClientCrafting {
    private final Minecraft mc;
    private final RecipeHolder<?> recipe;
    private final ItemStack output;
    private final int window,initialState,beforeCount;
    private int pickupState=-1,matchedTicks;
    private boolean pickupSent;
    private ClientCrafting(Minecraft mc,RecipeHolder<?> recipe){
        this.mc=mc;this.recipe=recipe;output=recipe.value().getResultItem(mc.level.registryAccess()).copy();
        window=mc.player.containerMenu.containerId;initialState=mc.player.containerMenu.getStateId();beforeCount=count();
        mc.gameMode.handlePlaceRecipe(window,recipe,false);
    }
    static void validate(Minecraft mc,JsonObject args){
        var menu=mc.player.containerMenu;
        if(menu.containerId!=args.get("windowId").getAsInt()||menu.getStateId()!=args.get("expectedStateId").getAsInt())throw new IllegalArgumentException("menu_state_changed");
        int size=menu instanceof InventoryMenu?2:menu instanceof CraftingMenu?3:0;
        if(size==0)throw new IllegalArgumentException("open_player_inventory_or_crafting_table_first");
        if(!menu.getCarried().isEmpty())throw new IllegalArgumentException("return_cursor_item_before_crafting");
        for(int i=1;i<=size*size;i++)if(!menu.slots.get(i).getItem().isEmpty())throw new IllegalArgumentException("clear_crafting_grid_before_recipe_book");
        var holder=mc.getConnection().getRecipeManager().byKey(ResourceLocation.parse(args.get("id").getAsString()));
        if(holder.isEmpty())throw new IllegalArgumentException("recipe_not_synced_to_this_client");
        var recipe=holder.get().value();
        if(recipe.getType()!=RecipeType.CRAFTING||recipe.isSpecial()||!recipe.canCraftInDimensions(size,size))throw new IllegalArgumentException("recipe_requires_different_workstation_or_manual_grid");
        if(!mc.player.getRecipeBook().contains(holder.get()))throw new IllegalArgumentException("recipe_not_unlocked_use_manual_grid");
        var result=recipe.getResultItem(mc.level.registryAccess());if(result.isEmpty())throw new IllegalArgumentException("recipe_output_unavailable");
        int room=0;for(int i=0;i<36;i++){var stack=mc.player.getInventory().getItem(i);
            if(stack.isEmpty())room+=result.getMaxStackSize();
            else if(ItemStack.isSameItemSameComponents(stack,result))room+=Math.max(0,stack.getMaxStackSize()-stack.getCount());}
        if(room<result.getCount())throw new IllegalArgumentException("inventory_has_no_room_for_recipe_output");
    }
    static ClientCrafting start(Minecraft mc,JsonObject args){
        validate(mc,args);
        return new ClientCrafting(mc,mc.getConnection().getRecipeManager().byKey(ResourceLocation.parse(args.get("id").getAsString())).orElseThrow());
    }
    private int count(){int count=0;for(int i=0;i<36;i++){var stack=mc.player.getInventory().getItem(i);
        if(ItemStack.isSameItemSameComponents(stack,output))count+=stack.getCount();}return count;}
    JsonObject tick(int ticks){
        var menu=mc.player.containerMenu;
        if(menu.containerId!=window)return result("unknown","crafting_window_changed",false);
        if(!pickupSent){
            var preview=menu.slots.get(0).getItem();
            if(ticks>=4&&menu.getStateId()!=initialState&&ItemStack.isSameItemSameComponents(preview,output)&&preview.getCount()==output.getCount()){
                if(++matchedTicks>=2){pickupState=menu.getStateId();pickupSent=true;mc.gameMode.handleInventoryMouseClick(window,0,0,ClickType.QUICK_MOVE,mc.player);}
            }else matchedTicks=0;
        }else if(count()>=beforeCount+output.getCount()&&menu.getStateId()!=pickupState){
            return result("succeeded","craft_inventory_observed",true);
        }
        if(ticks>200)return result(pickupSent?"unknown":"failed",pickupSent?"craft_pickup_not_confirmed":"recipe_placement_not_observed_check_materials",!pickupSent);
        return null;
    }
    private JsonObject result(String status,String code,boolean known){return object("status",status,"code",code,"outcomeKnown",known,
        "recipeId",recipe.id(),"beforeOwnedCount",beforeCount,"afterOwnedCount",count(),"batchOutputCount",output.getCount(),"pickupSent",pickupSent,
        "serverMenuStateChanged",mc.player.containerMenu.getStateId()!=(pickupSent?pickupState:initialState));}
}
