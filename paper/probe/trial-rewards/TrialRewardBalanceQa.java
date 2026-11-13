package org.afuhome.agentfriend.qa;

import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.EnchantmentStorageMeta;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.java.JavaPlugin;

/** Read-only native item generation; install only in the dedicated loopback QA profile. */
public final class TrialRewardBalanceQa extends JavaPlugin implements CommandExecutor {
    private Class<?> loot;private NamespacedKey aura;private int checks;
    private final NamespacedKey quality=NamespacedKey.fromString("agentfriend:trial_loot_tier");
    @Override public void onEnable(){
        try{
            if(!Bukkit.getIp().equals("127.0.0.1")||Bukkit.getPort()!=25960||!Files.readString(Path.of(".dungeon-integration-qa")).strip().equals("FRESH_DUNGEON_INTEGRATION_NO_PLAYER_INVENTORIES"))throw new IllegalStateException("QA profile required");
            var loader=Bukkit.getPluginManager().getPlugin("AgentFriend").getClass().getClassLoader();loot=Class.forName("org.afuhome.agentfriend.DungeonLoot",true,loader);
            var field=Class.forName("org.afuhome.agentfriend.DungeonGearAura",true,loader).getDeclaredField("KEY");field.setAccessible(true);aura=(NamespacedKey)field.get(null);
            getCommand("trialrewardqa").setExecutor(this);
        }catch(Exception e){throw new IllegalStateException(e);}
    }
    private void check(boolean ok,String message){checks++;if(!ok)throw new IllegalStateException(message);}
    private ItemStack item(String method,int... args)throws Exception{
        var types=new Class<?>[args.length];Arrays.fill(types,int.class);var fn=loot.getDeclaredMethod(method,types);fn.setAccessible(true);
        var boxed=Arrays.stream(args).boxed().toArray();Object bonus=fn.invoke(null,boxed);return bonus==null?null:item(bonus);
    }
    private ItemStack item(Object bonus)throws Exception{
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
    private void auditQuality() throws Exception {
        var entries = new TreeMap<String, Set<String>>();
        var lootRoll = loot.getDeclaredMethod("roll", int.class, int.class, int.class);
        lootRoll.setAccessible(true);
        for (int difficulty=1; difficulty<=2; difficulty++) {
            for (int floor : new int[]{4, 8, 11, 12, 15}) {
                for (int draw=0; draw<180; draw++) {
                    var bonus = lootRoll.invoke(null, floor, draw%2==0 ? 0 : 12, difficulty);
                    if (bonus==null) continue;
                    var tierAccessor = bonus.getClass().getDeclaredMethod("tier");
                    tierAccessor.setAccessible(true);
                    String tier = (String) tierAccessor.invoke(bonus);
                    ItemStack item = item(bonus);
                    if (!Set.of("rare","excellent","legendary").contains(tier)) continue;
                    var meta = item.getItemMeta();
                    check(equipment(item) || item.getType()==Material.ENCHANTED_BOOK, "premium roll returned a supply");
                    check(tier.equals(meta.getPersistentDataContainer().get(quality,PersistentDataType.STRING)), "missing quality identity");
                    check(tier.equals("rare") || floor>=8, "early excellent");
                    check(!tier.equals("legendary") || difficulty==2 && floor>=12, "early legendary");
                    var enchants=meta instanceof EnchantmentStorageMeta book ? book.getStoredEnchants() : meta.getEnchants();
                    check(!enchants.isEmpty() && enchants.size()<=4, "premium enchantment budget");
                    for (var ench : enchants.entrySet()) {
                        check(ench.getValue()<=ench.getKey().getMaxLevel(), "exceeds vanilla cap");
                        check(item.getType()==Material.ENCHANTED_BOOK || ench.getKey().canEnchantItem(item), "illegal enchantment material");
                        check(enchants.keySet().stream().noneMatch(other -> other!=ench.getKey() && other.conflictsWith(ench.getKey())),
                                "incompatible enchantments");
                    }
                    check(item.isSimilar(ItemStack.deserializeBytes(item.serializeAsBytes())), "item bytes lost tier or enchantments");
                    entries.computeIfAbsent(tier, unused -> new TreeSet<>()).add(ChatColor.stripColor(meta.getDisplayName()));
                }
            }
        }
        check(entries.getOrDefault("excellent",Set.of()).size()>=2,"missing excellent variety");
        check(!entries.getOrDefault("legendary",Set.of()).isEmpty(),"missing legendary roll");
        for(int clear=1;clear<10;clear++)for(int difficulty=0;difficulty<3;difficulty++){
            check(!equipment(item("bossCache",clear,difficulty)) && !equipment(item("finalCache",clear,difficulty)),
                    "boss repeats still mint equipment");
        }
        for (int n=0;n<8;n++) {
            ItemStack template=item("equipmentPreview",n);
            var identify=loot.getDeclaredMethod("equipmentIndex",ItemStack.class);
            identify.setAccessible(true);
            check(identify.invoke(null,template).equals(n),"rotation item not recognized");
            ItemStack forged=new ItemStack(template.getType());var meta=forged.getItemMeta();
            meta.setDisplayName(template.getItemMeta().getDisplayName());forged.setItemMeta(meta);
            check(identify.invoke(null,forged).equals(-1),"renamed lookalike was counted");
        }
    }
    private Object dungeon() throws Exception {
        Object plugin=Bukkit.getPluginManager().getPlugin("AgentFriend");
        return method(plugin.getClass(),"dungeon").invoke(plugin);
    }
    private Method method(Class<?> owner,String name,Class<?>... params) throws Exception {
        var method=owner.getDeclaredMethod(name,params);method.setAccessible(true);return method;
    }
    private Field field(Object target,String name) throws Exception {
        var field=target.getClass().getDeclaredField(name);field.setAccessible(true);return field;
    }
    @SuppressWarnings({"unchecked","rawtypes"})
    private void settle(Player player,int floor,String difficulty) throws Exception {
        var manager=dungeon();
        var mode=field(manager,"difficulty");
        var roster=(Set<UUID>)field(manager,"participants").get(manager);
        if(field(manager,"active").getBoolean(manager)||!roster.isEmpty())throw new IllegalStateException("fixture trial already active");
        var world=Bukkit.getWorld("world");
        int x=(int)method(manager.getClass(),"floorX",int.class).invoke(manager,floor);
        int z=(int)method(manager.getClass(),"floorZ",int.class).invoke(manager,floor);
        int y=((int[])field(manager,"Y").get(null))[floor-1]+1;
        for (int dx=-1;dx<=1;dx++)for(int dz=-1;dz<=1;dz++){
            world.getBlockAt(x+dx,y-1,z+dz).setType(Material.STONE,false);
            world.getBlockAt(x+dx,y,z+dz).setType(Material.AIR,false);
            world.getBlockAt(x+dx,y+1,z+dz).setType(Material.AIR,false);
        }
        if(!player.teleport(new Location(world,x+.5,y,z+.5)))throw new IllegalStateException("fixture teleport failed");
        Object priorMode=mode.get(manager);
        int priorFloor=field(manager,"floor").getInt(manager);
        roster.add(player.getUniqueId());
        try {
            mode.set(manager,Enum.valueOf((Class)mode.getType(),difficulty));
            field(manager,"floor").setInt(manager,floor);
            method(manager.getClass(),"rewardFloor").invoke(manager);
        } finally {
            roster.clear();
            mode.set(manager,priorMode);
            field(manager,"floor").setInt(manager,priorFloor);
        }
    }
    private String state(Player player) {
        var data=((JavaPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend")).getConfig();
        String id=player.getUniqueId().toString();
        var queue=data.getList("dungeon-bonus-items."+id,List.of());
        var gear=queue.stream().filter(ItemStack.class::isInstance).map(ItemStack.class::cast).filter(this::equipment).count();
        return "queue="+queue.size()+" gear="+gear+" boss="+data.getInt("dungeon-boss-clears."+id,0)
                +" final="+data.getInt("dungeon-final-clears."+id,0)
                +" rotation="+data.getInt("dungeon-diamond-set-index."+id,0)
                +" pityAdventure="+data.getInt("dungeon-rare-gear-misses."+id+".adventure",-1)
                +" pityApocalypse="+data.getInt("dungeon-rare-gear-misses."+id+".apocalypse",-1);
    }
    private boolean ledger(CommandSender sender,String[] args) throws Exception {
        if(args.length<2||!args[1].equals("TrialGearQA"))return false;
        Player player=Bukkit.getPlayerExact(args[1]);
        if(player==null||player.isOp())throw new IllegalStateException("ordinary synthetic player required");
        if(args[0].equals("settle")&&args.length==4)settle(player,Integer.parseInt(args[2]),args[3]);
        else if(args[0].equals("seed")&&args.length==2){
            var plugin=(JavaPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend");
            var data=plugin.getConfig();
            String id=player.getUniqueId().toString();
            data.set("dungeon-rare-misses."+id,12);
            data.set("dungeon-personal-stash."+id+".539",item("equipmentPreview",7));
            player.getInventory().setItem(4,item("equipmentPreview",5));
            plugin.saveConfig();
        } else if(!args[0].equals("state")||args.length!=2)return false;
        sender.sendMessage("TRIAL_GEAR_LEDGER "+state(player));
        return true;
    }
    @Override public boolean onCommand(CommandSender sender,Command command,String label,String[] args){
        if(!(sender instanceof ConsoleCommandSender||sender instanceof RemoteConsoleCommandSender)){
            sender.sendMessage("TRIAL_REWARD_QA passed=false error=console_only");return true;
        }
        checks=0;
        try{
            if(args.length>=2) return ledger(sender,args);
            if(args.length==1&&!args[0].equals("quality")) return false;
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
            if (args.length==1) auditQuality();
            sender.sendMessage("TRIAL_REWARD_QA passed=true checks="+checks+" playerInventoryTouched=false version="+Bukkit.getPluginManager().getPlugin("AgentFriend").getDescription().getVersion());
        }catch(Exception e){
            Throwable cause=e instanceof InvocationTargetException && e.getCause()!=null ? e.getCause() : e;
            sender.sendMessage("TRIAL_REWARD_QA passed=false checks="+checks+" error="+cause.toString().replace(' ','_'));
        }
        return true;
    }
}
