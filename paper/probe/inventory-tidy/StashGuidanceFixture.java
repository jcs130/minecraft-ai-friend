package org.qiandengji.stashqa;

import com.google.gson.*;
import java.nio.file.*;
import java.lang.reflect.*;
import java.util.*;
import java.security.MessageDigest;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.*;
import org.bukkit.inventory.*;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.java.JavaPlugin;

/** Synthetic-account stimulus; never included in a production artifact. */
public final class StashGuidanceFixture extends JavaPlugin {
    private JavaPlugin af;
    private final Map<UUID,java.nio.channels.FileChannel> saveBlocks=new HashMap<>();
    @Override public void onDisable(){for(var channel:saveBlocks.values())try{channel.close();}catch(Exception ignored){}saveBlocks.clear();}
    private static Method method(Class<?> type,String name,Class<?>...args)throws Exception{Method m=type.getDeclaredMethod(name,args);m.setAccessible(true);return m;}
    @Override public void onEnable(){try{
        if(getServer().getPort()!=25928||!getServer().getIp().equals("127.0.0.1")
                ||!Files.readString(Path.of(".shop-qa")).equals("FRESH_RPG_SHOP_QA_NO_PLAYER_DATA"))throw new IllegalStateException("Isolated marked stage required");
        af=(JavaPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend");if(af==null)throw new IllegalStateException("Real AgentFriend required");
    }catch(Exception e){throw new IllegalStateException(e);}}
    private Object field(Object target,String name)throws Exception{Field f=target.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(target);}
    private Object dungeon()throws Exception{return method(af.getClass(),"dungeon").invoke(af);}
    private Inventory page(Player p,int page)throws Exception{Object d=dungeon(),storage=method(d.getClass(),"storage").invoke(d);return(Inventory)method(storage.getClass(),"page",UUID.class,int.class).invoke(storage,p.getUniqueId(),page);}
    private ItemStack marked(Material m,String name){ItemStack i=new ItemStack(m,1);var meta=i.getItemMeta();meta.setDisplayName(name);i.setItemMeta(meta);return i;}
    private String hash(ItemStack[] items)throws Exception{MessageDigest h=MessageDigest.getInstance("SHA-256");for(ItemStack i:items){h.update((byte)(i==null?0:1));if(i!=null)h.update(i.serializeAsBytes());}return HexFormat.of().formatHex(h.digest());}
    @Override public boolean onCommand(CommandSender sender,Command command,String label,String[] args){try{
        if(sender instanceof Player||args.length<2)throw new IllegalArgumentException("Console QA action and actor only");
        Player p=Bukkit.getPlayerExact(args[1]);if(p==null||!p.getName().matches("ag_RUStash[a-z0-9]{1,4}")
                ||!p.getUniqueId().equals(UUID.nameUUIDFromBytes(("OfflinePlayer:"+p.getName()).getBytes(java.nio.charset.StandardCharsets.UTF_8))))throw new IllegalArgumentException("Synthetic offline identity only");
        if(args[0].equals("reset")){
            if(args.length!=3||!Set.of("full","partial","space","tidystash").contains(args[2]))throw new IllegalArgumentException("bounded stash mode");
            af.getConfig().set("inventory-tidy."+p.getUniqueId(),null);p.closeInventory();p.setItemOnCursor(null);p.getInventory().clear();
            Object arena=field(af,"pvpArena");((Set<?>)field(arena,"recovering")).remove(p.getUniqueId());
            for(int n=0;n<36;n++)p.getInventory().setItem(n,new ItemStack(Material.GOLD_INGOT,64));
            p.getInventory().setItem(0,new ItemStack(Material.IRON_SWORD));p.getInventory().setHeldItemSlot(0);
            p.getInventory().setItem(1,new ItemStack(Material.COBBLESTONE,16));
            p.getInventory().setItem(9,new ItemStack(Material.COBBLESTONE,21));p.getInventory().setItem(10,new ItemStack(Material.CLAY_BALL,52));
            p.getInventory().setItem(11,marked(Material.COBBLESTONE,"QA quest stone"));
            ItemStack enchanted=new ItemStack(Material.DIRT,32);enchanted.addUnsafeEnchantment(org.bukkit.enchantments.Enchantment.UNBREAKING,1);p.getInventory().setItem(12,enchanted);
            ItemStack tagged=new ItemStack(Material.DIRT,61);var meta=tagged.getItemMeta();meta.getPersistentDataContainer().set(new NamespacedKey(this,"test_protected"),PersistentDataType.INTEGER,1);tagged.setItemMeta(meta);p.getInventory().setItem(13,tagged);
            p.getInventory().setItem(14,marked(Material.DIAMOND_SWORD,"QA protected blade"));p.getInventory().setItem(15,new ItemStack(Material.BREAD,7));
            p.getInventory().setItem(16,new ItemStack(Material.GOLDEN_APPLE,20));p.getInventory().setItem(17,new ItemStack(Material.GOLDEN_APPLE,28));
            p.getInventory().setChestplate(marked(Material.DIAMOND_CHESTPLATE,"QA armor"));p.getInventory().setItemInOffHand(marked(Material.SHIELD,"QA shield"));
            for(int n=0;n<10;n++){Inventory inv=page(p,n);for(int s=0;s<54;s++)inv.setItem(s,new ItemStack(Material.STONE,64));}
            page(p,0).setItem(23,new ItemStack(Material.COBBLESTONE,64));
            if(args[2].equals("partial"))page(p,9).setItem(53,new ItemStack(Material.COBBLESTONE,60));
            if(args[2].equals("space"))page(p,9).setItem(53,null);
            if(args[2].equals("tidystash")){
                for(int n=0;n<10;n++)page(p,n).clear();
                page(p,0).setItem(0,new ItemStack(Material.COBBLESTONE,12));page(p,0).setItem(53,new ItemStack(Material.COBBLESTONE,20));
                page(p,1).setItem(0,new ItemStack(Material.DIRT,7));page(p,1).setItem(53,new ItemStack(Material.ROTTEN_FLESH,8));
                page(p,2).setItem(0,new ItemStack(Material.BREAD,3));page(p,9).setItem(53,new ItemStack(Material.BREAD,5));
                page(p,4).setItem(23,enchanted.clone());page(p,4).setItem(24,tagged.clone());page(p,4).setItem(25,marked(Material.STONE,"QA stash quest"));
                for(int n=34;n<37;n++)page(p,4).setItem(n,new ItemStack(Material.IRON_HELMET));
                page(p,4).setItem(37,marked(Material.DIAMOND_SWORD,"QA stash rare blade"));
            }
            Object d=dungeon(),storage=method(d.getClass(),"storage").invoke(d);for(int n=0;n<10;n++)method(storage.getClass(),"write",Inventory.class,UUID.class).invoke(storage,page(p,n),p.getUniqueId());
            af.saveConfig();p.saveData();p.updateInventory();sender.sendMessage("STASH_QA reset="+args[2]);
        }else if(args[0].equals("read")){
            JsonObject out=new JsonObject();out.addProperty("bagHash",hash(p.getInventory().getStorageContents()));out.addProperty("armorHash",hash(p.getInventory().getArmorContents()));out.addProperty("offhandHash",hash(new ItemStack[]{p.getInventory().getItemInOffHand()}));
            out.addProperty("protectedHash",hash(new ItemStack[]{p.getInventory().getItem(0),p.getInventory().getItem(1),p.getInventory().getItem(11),p.getInventory().getItem(12),p.getInventory().getItem(13),p.getInventory().getItem(14),p.getInventory().getItem(15)}));
            JsonArray items=new JsonArray();for(int n=0;n<36;n++){ItemStack i=p.getInventory().getItem(n);if(i==null||i.getType().isAir())continue;JsonObject row=new JsonObject();row.addProperty("slot",n);row.addProperty("id",i.getType().name());row.addProperty("count",i.getAmount());row.addProperty("meta",i.hasItemMeta());items.add(row);}out.add("bag",items);
            int used=0;List<ItemStack> all=new ArrayList<>();List<String> protectedItems=new ArrayList<>();for(int n=0;n<10;n++)for(ItemStack i:page(p,n).getContents()){all.add(i);if(i!=null&&!i.getType().isAir()){used++;if(i.hasItemMeta()||i.getType()==Material.IRON_HELMET)protectedItems.add(hash(new ItemStack[]{i}));}}
            Collections.sort(protectedItems);
            out.addProperty("stashOccupied",used);out.addProperty("stashHash",hash(all.toArray(ItemStack[]::new)));out.addProperty("stashProtectedHash",String.join("",protectedItems));
            out.addProperty("firstStashItem",all.getFirst()==null?"AIR":all.getFirst().getType().name());sender.sendMessage("STASH_QA "+out);
        }else if(args[0].equals("pvp")){
            @SuppressWarnings("unchecked") Set<UUID> recovering=(Set<UUID>)field(field(af,"pvpArena"),"recovering");if(args[2].equals("on"))recovering.add(p.getUniqueId());else if(args[2].equals("off"))recovering.remove(p.getUniqueId());else throw new IllegalArgumentException("on/off");sender.sendMessage("STASH_QA pvp="+args[2]);
        }else if(args[0].equals("saveblock")){
            Path boundary=Bukkit.getWorlds().getFirst().getWorldFolder().toPath().toAbsolutePath().normalize().resolve("playerdata");
            Path file=boundary.resolve(p.getUniqueId()+".dat").normalize();
            if(!file.startsWith(boundary))throw new IllegalStateException("Synthetic playerdata boundary");
            if(args[2].equals("on")){
                if(saveBlocks.containsKey(p.getUniqueId()))throw new IllegalStateException("Original fault already held");p.saveData();
                var channel=java.nio.channels.FileChannel.open(file,StandardOpenOption.READ,com.sun.nio.file.ExtendedOpenOption.NOSHARE_DELETE,com.sun.nio.file.ExtendedOpenOption.NOSHARE_WRITE);saveBlocks.put(p.getUniqueId(),channel);
            }
            else if(args[2].equals("off")){var channel=saveBlocks.remove(p.getUniqueId());if(channel==null)throw new IllegalStateException("Original fault not held");channel.close();}
            else throw new IllegalArgumentException("on/off");sender.sendMessage("STASH_QA saveblock="+args[2]);
        }else if(args[0].equals("drop")){p.getWorld().dropItem(p.getLocation(),new ItemStack(Material.COBBLESTONE,4)).setPickupDelay(0);sender.sendMessage("STASH_QA dropped=4");}
        else throw new IllegalArgumentException("Known bounded QA action only");return true;
    }catch(Exception e){throw new IllegalStateException(e);}}
}
