package org.afuhome.agentfriend.qa;

import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.EnchantmentStorageMeta;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.java.JavaPlugin;

/** Read-only native item generation; install only in the dedicated loopback QA profile. */
public final class TrialRewardBalanceQa extends JavaPlugin implements CommandExecutor {
    private Class<?> loot;private NamespacedKey aura;private int checks;
    @Override public void onEnable(){
        try{
            if(Bukkit.getPort()!=25960||!Files.readString(Path.of(".dungeon-integration-qa")).strip().equals("FRESH_DUNGEON_INTEGRATION_NO_PLAYER_INVENTORIES"))throw new IllegalStateException("QA profile required");
            var loader=Bukkit.getPluginManager().getPlugin("AgentFriend").getClass().getClassLoader();loot=Class.forName("org.afuhome.agentfriend.DungeonLoot",true,loader);
            var field=Class.forName("org.afuhome.agentfriend.DungeonGearAura",true,loader).getDeclaredField("KEY");field.setAccessible(true);aura=(NamespacedKey)field.get(null);
            getCommand("trialrewardqa").setExecutor(this);
        }catch(Exception e){throw new IllegalStateException(e);}
    }
    private void check(boolean ok,String message){checks++;if(!ok)throw new IllegalStateException(message);}
    private ItemStack item(String method,int... args)throws Exception{
        var types=new Class<?>[args.length];Arrays.fill(types,int.class);var fn=loot.getDeclaredMethod(method,types);fn.setAccessible(true);
        var boxed=Arrays.stream(args).boxed().toArray();Object bonus=fn.invoke(null,boxed);if(bonus==null)return null;
        var accessor=bonus.getClass().getDeclaredMethod("item");accessor.setAccessible(true);return (ItemStack)accessor.invoke(bonus);
    }
    private boolean equipment(ItemStack item){return item.getType().name().matches(".*_(SWORD|AXE|PICKAXE|SHOVEL|HOE|HELMET|CHESTPLATE|LEGGINGS|BOOTS)|BOW|CROSSBOW|SHIELD|TRIDENT");}
    private void ordinary(ItemStack item,int floor){
        if(item==null)return;
        check(!item.getType().name().startsWith("DIAMOND_")&&!item.getType().name().startsWith("NETHERITE_"),"ordinary top material");
        if(!item.hasItemMeta())return;var meta=item.getItemMeta();var enchants=meta instanceof EnchantmentStorageMeta book?book.getStoredEnchants():meta.getEnchants();
        check(enchants.size()<=(floor<6?1:2),"ordinary affix count");
        check(enchants.values().stream().allMatch(v->v<=2),"ordinary affix above II");
        check(!enchants.containsKey(Enchantment.MENDING),"ordinary mending");
        check(!meta.getPersistentDataContainer().has(aura,PersistentDataType.STRING),"ordinary aura");
    }
    @Override public boolean onCommand(CommandSender sender,Command command,String label,String[] args){
        if(!(sender instanceof ConsoleCommandSender||sender instanceof RemoteConsoleCommandSender)||args.length!=0){sender.sendMessage("TRIAL_REWARD_QA passed=false error=console_only");return true;}
        checks=0;
        try{
            check(item("finalCache",0,0).getType()==Material.IRON_SWORD,"normal final cache must be iron, not a guaranteed diamond sword");
            check(item("finalCache",0,1).getType()==Material.IRON_SWORD,"adventure final cache iron");
            check(item("finalCache",0,2).getType()==Material.DIAMOND_SWORD,"apocalypse completion retains differentiated equipment");
            for(int floor=1;floor<=15;floor++){
                for(int i=0;i<200;i++)ordinary(item("roll",floor,i%8,0),floor);
                for(int index=0;index<8;index++)ordinary(item("milestone",floor,index,0),floor);
            }
            for(int clears=0;clears<18;clears++)for(String fn:List.of("bossCache","finalCache")){
                ItemStack item=item(fn,clears,0);ordinary(item,15);if(clears>0)check(!equipment(item),"ordinary repeated cache must not rotate more equipment");
            }
            sender.sendMessage("TRIAL_REWARD_QA passed=true checks="+checks+" playerInventoryTouched=false version="+Bukkit.getPluginManager().getPlugin("AgentFriend").getDescription().getVersion());
        }catch(Exception e){sender.sendMessage("TRIAL_REWARD_QA passed=false checks="+checks+" error="+e.getMessage().replace(' ','_'));}
        return true;
    }
}
