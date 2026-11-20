package org.afuhome.agentfriend;

import com.google.gson.*;
import java.lang.reflect.Proxy;
import java.util.*;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;
import static org.bukkit.Material.*;

/** Invokes the compiled production command with synthetic inventory and private-box services. */
final class Cases {
    final AgentFriendPlugin plugin;
    final InventoryBatch batch;
    final UUID id = UUID.fromString("00000000-0000-4000-8000-000000000001");
    final UUID other = UUID.fromString("00000000-0000-4000-8000-000000000002");
    final JsonArray checks = new JsonArray();
    final List<String> messages = new ArrayList<>();
    final Player player;
    ItemStack[] bag = new ItemStack[36];
    final ItemStack[] armor = {new ItemStack(DIAMOND_BOOTS)};
    final ItemStack offhand = new ItemStack(SHIELD);
    final ItemStack residentHand = new ItemStack(NETHERRACK,64);
    int updated;

    Cases(AgentFriendPlugin plugin) {
        this.plugin=plugin;
        this.batch=new InventoryBatch(plugin);
        ClassLoader loader=getClass().getClassLoader();
        var inv=(PlayerInventory)Proxy.newProxyInstance(loader,new Class[]{PlayerInventory.class},(obj,method,args)->switch(method.getName()) {
            case "getStorageContents" -> copy(bag);
            case "setStorageContents" -> {bag=copy((ItemStack[])args[0]); yield null;}
            case "getArmorContents" -> copy(armor);
            case "getItemInOffHand" -> offhand.clone();
            case "getHeldItemSlot" -> ResidentCli.isResident(id) ? -1 : 0;
            case "getItemInMainHand" -> ResidentCli.isResident(id) ? residentHand.clone() : bag[0];
            default -> throw new AssertionError("Unexpected inventory call: "+method);
        });
        player=(Player)Proxy.newProxyInstance(loader,new Class[]{Player.class},(obj,method,args)->switch(method.getName()) {
            case "getUniqueId" -> id;
            case "getInventory" -> inv;
            case "sendMessage" -> {messages.add((String)args[0]); yield null;}
            case "updateInventory" -> {updated++; yield null;}
            default -> throw new AssertionError("Unexpected player call: "+method);
        });
    }
    static ItemStack[] copy(ItemStack[] input) {
        return Arrays.stream(input).map(i->i==null?null:i.clone()).toArray(ItemStack[]::new);
    }
    void check(String label, boolean ok) {
        if (!ok) throw new AssertionError(label);
        checks.add(label);
    }
    static int count(ItemStack[] contents, Material m) {
        return Arrays.stream(contents).filter(i->i!=null && i.getType()==m).mapToInt(ItemStack::getAmount).sum();
    }
    static JsonObject at(JsonObject receipt,String key){return receipt.getAsJsonObject(key);}
    static int n(JsonObject json, String key){return json.get(key).getAsInt();}
    static String str(JsonObject json, String key){return json.get(key).getAsString();}
    JsonObject cmd(String text) {
        messages.clear();
        batch.command(player,("inventory "+text+" --json").split(" "));
        var receipts=messages.stream().filter(s->s.startsWith("MC_INVENTORY_BATCH ")).toList();
        if(receipts.size()!=1) throw new AssertionError("Expected one receipt: "+messages);
        var r=JsonParser.parseString(receipts.getFirst().substring("MC_INVENTORY_BATCH ".length())).getAsJsonObject();
        if(!id.toString().equals(str(r,"playerUuid")) || n(r,"schemaVersion")!=1) throw new AssertionError(r);
        return r;
    }
    JsonArray run() {
        check("Paper main server thread",Bukkit.isPrimaryThread());
        final String neth="minecraft:netherrack",basalt="minecraft:basalt";
        final String select="store --keep "+neth+"=64";
        for(int i=0;i<4;i++)bag[9+i]=new ItemStack(NETHERRACK,64);
        bag[13]=new ItemStack(NETHERRACK,44);
        bag[14]=new ItemStack(BASALT,16);
        bag[15]=new ItemStack(DIAMOND,5);
        plugin.boxes.stock.put(other,new ItemStack[]{new ItemStack(NETHERRACK,6)});
        var before=copy(bag);
        var p=cmd(select+" --dry-run");
        check("preview reports 300 to 64, dry run carries original 300",str(p,"action").equals("store_selected")
                && n(at(p,"keep"),neth)==64 && n(at(p,"carriedBefore"),neth)==300 && n(at(p,"projectedCarried"),neth)==64
                && n(at(p,"carriedAfter"),neth)==300 && n(p,"plannedItems")==236 && n(p,"plannedFreedSlots")==4);
        check("preview has no fee, side effects or recorded transfer",n(p,"moved")==0 && n(p,"freedSlots")==0
                && n(p,"manaSpent")==0 && n(p,"quotedMana")==2 && !p.has("requestId")
                && Arrays.equals(bag,before) && plugin.bagWrites==0 && !batch.unresolved(id) && plugin.boxes.spent==0);
        plugin.boxes.ready=false;
        var refused=cmd(select);
        check("remote cost gate rejects before writing","remote_storage_unavailable".equals(str(refused,"reason"))
                && Arrays.equals(bag,before) && plugin.bagWrites==0 && !batch.unresolved(id));
        plugin.boxes.ready=true;
        var moved=cmd(select);
        check("single commit moves 236, keeps 64, accounts for four freed slots",n(moved,"moved")==236
                && n(moved,"freedSlots")==4 && n(at(moved,"items"),neth)==236 && n(at(moved,"carriedAfter"),neth)==64
                && count(bag,NETHERRACK)==64 && count(plugin.boxes.stock.get(id),NETHERRACK)==236);
        check("charges once, touches only requested material and own box",n(moved,"manaSpent")==2
                && plugin.boxes.spent==2 && plugin.bagWrites==1 && plugin.configWrites==1 && updated==1 && moved.has("requestId")
                && !batch.unresolved(id) && count(bag,BASALT)==16 && count(bag,DIAMOND)==5 && count(plugin.boxes.stock.get(other),NETHERRACK)==6);
        var again=cmd(select);
        check("identical apply cannot drain reserve or charge twice",n(again,"moved")==0
                && n(again,"manaSpent")==0 && plugin.boxes.spent==2 && plugin.bagWrites==1 && !again.has("requestId"));
        bag=new ItemStack[36];bag[0]=new ItemStack(NETHERRACK,64);bag[1]=new ItemStack(NETHERRACK,36);bag[9]=new ItemStack(BASALT,16);
        String multi=select+" --keep "+basalt+"=8";
        var regular=cmd(multi+" --dry-run");
        check("default protects hotbar, allows excess above request",!regular.get("includeHotbar").getAsBoolean()
                && n(regular,"plannedItems")==8 && n(at(regular,"projectedCarried"),neth)==100 && n(at(regular,"projectedCarried"),basalt)==8);
        plugin.boxes.local=true; var hot=cmd(multi+" --include-hotbar");
        check("explicit hotbar may move excess from named materials; local box is free",n(hot,"moved")==44
                && n(at(hot,"items"),neth)==36 && n(at(hot,"items"),basalt)==8 && n(hot,"manaSpent")==0
                && count(bag,NETHERRACK)==64 && count(bag,BASALT)==8 && plugin.boxes.spent==2);
        bag=new ItemStack[36];bag[0]=new ItemStack(BASALT,12);
        var named=bag[0].getItemMeta();named.setDisplayName("Synthetic keepsake");bag[0].setItemMeta(named);
        bag[1]=new ItemStack(OBSIDIAN,9);bag[2]=new ItemStack(COMPASS);bag[3]=new ItemStack(BASALT,4);
        var protectedItems=cmd("store --keep minecraft:basalt=0 --keep minecraft:obsidian=0 --keep minecraft:compass=0"
                +" --keep minecraft:diamond_boots=0 --keep minecraft:shield=0 --include-hotbar");
        check("named, bound, shortcut, worn and offhand remain protected even on explicit hotbar",
                n(protectedItems,"moved")==4 && count(bag,BASALT)==12 && bag[0].hasItemMeta() && count(bag,OBSIDIAN)==9 && count(bag,COMPASS)==1
                && n(at(protectedItems,"carriedBefore"),basalt)==4 && n(at(protectedItems,"carriedBefore"),"minecraft:obsidian")==0
                && armor[0].getType()==DIAMOND_BOOTS && offhand.getType()==SHIELD);
        ResidentCli.syntheticResidents.add(id);
        try {
            bag=new ItemStack[36];bag[0]=new ItemStack(NETHERRACK,64);bag[1]=new ItemStack(NETHERRACK,20);
            var selected=cmd("store --keep "+neth+"=32");
            check("resident bag starts at zero, separate held items cannot satisfy the bag reserve",
                    player.getInventory().getHeldItemSlot()==-1 && !selected.get("includeHotbar").getAsBoolean()
                    && n(at(selected,"carriedBefore"),neth)==84 && n(at(selected,"projectedCarried"),neth)==32
                    && n(at(selected,"carriedAfter"),neth)==32 && n(selected,"moved")==52 && n(selected,"freedSlots")==1
                    && bag[0].getAmount()==32 && bag[1]==null && player.getInventory().getItemInMainHand().getAmount()==64);
        } finally {
            ResidentCli.syntheticResidents.remove(id);
        }
        bag=new ItemStack[36];bag[9]=new ItemStack(NETHERRACK,24);plugin.boxes.stock.put(id,new ItemStack[]{new ItemStack(NETHERRACK,61)});
        var partial=cmd("store --keep "+neth+"=12");
        check("partial capacity moves only three, leaves 21 and reports nine blocked",str(partial,"reason").equals("partial") && n(partial,"moved")==3
                && n(partial,"leftForCapacity")==9 && n(partial,"freedSlots")==0 && count(bag,NETHERRACK)==21 && count(plugin.boxes.stock.get(id),NETHERRACK)==64);
        var full=cmd("store --keep "+neth+"=12");
        check("full box yields no transfer, fee or misleading projected gain",str(full,"reason").equals("destination_full")
                && n(full,"moved")==0 && n(full,"manaSpent")==0 && n(at(full,"carriedAfter"),neth)==21);
        for(var invalid: List.of("store --keep","store --keep netherrack=4","store --keep "+neth+"=-1","store --keep "+neth+"=9999999999",
                "store --keep custom:ore=3","store --keep minecraft:air=1",select+" --keep "+neth+"=0",
                "store --include-hotbar","donate --keep "+neth+"=1","clean --keep "+neth+"=1")) {
            var r=cmd(invalid);
            check("invalid request rejected without changes: "+invalid,str(r,"reason").equals("invalid_argument") && count(bag,NETHERRACK)==21);
        }
        plugin.trade.busy=true;var busy=cmd(select);
        check("trade lock preserves bag","trade_pending".equals(str(busy,"reason")) && count(bag,NETHERRACK)==21);
        plugin.trade.busy=false;
        bag=new ItemStack[36];bag[0]=new ItemStack(DIRT,12);bag[9]=new ItemStack(ARROW,64);bag[10]=new ItemStack(ARROW,16);
        plugin.boxes.stock.put(id,new ItemStack[5]);
        var legacy=cmd("store");
        check("legacy store retains its original envelope, arrow reserve and hotbar",str(legacy,"action").equals("store")
                && !legacy.has("keep") && n(legacy,"moved")==16 && count(bag,ARROW)==64 && count(bag,DIRT)==12);
        bag[11]=new ItemStack(STRING,3);
        var donate=cmd("donate --dry-run");
        check("legacy donate retains its action, strict storage separation",str(donate,"action").equals("donate")
                && n(donate,"leftForUnavailableChest")==3 && count(bag,STRING)==3);
        batch.command(player,new String[]{"inventory","clean","--dry-run","--json"});
        check("legacy clean still delegates to InventoryTidy",plugin.tidy.cleanCalls==1);
        plugin.failConfig=true;bag[11]=new ItemStack(NETHERRACK,7);
        var failed=cmd("store --keep "+neth+"=0");
        check("injected save failure retains on-disk intent and marks uncertain outcome",str(failed,"reason").equals("save_unverified")
                && failed.get("outcomeUnknown").getAsBoolean() && !failed.get("retrySameAction").getAsBoolean() && batch.unresolved(id));
        var blocked=cmd("store --keep "+neth+"=0");
        check("pending intent prevents repeated application",str(blocked,"reason").equals("transfer_unverified"));
        return checks;
    }
}
