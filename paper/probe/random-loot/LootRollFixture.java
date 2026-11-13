package org.qiandengji.lootqa;

import com.google.gson.*;
import java.io.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.EnchantmentStorageMeta;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.java.JavaPlugin;

/** Real Bukkit/Youer item and storage checks. Never install on a public server. */
public final class LootRollFixture extends JavaPlugin implements CommandExecutor {
    private JavaPlugin af;private Class<?> loot;private int checks,appearanceChecks;private final Gson json=new Gson();
    private Method method(Class<?> c,String name,Class<?>...types)throws Exception{Method m=c.getDeclaredMethod(name,types);m.setAccessible(true);return m;}
    private Object dungeon()throws Exception{return method(af.getClass(),"dungeon").invoke(af);}
    private Object invoke(String name,Class<?>[] types,Object...args)throws Exception{return method(loot,name,types).invoke(null,args);}
    private ItemStack item(Object bonus)throws Exception{return(ItemStack)method(bonus.getClass(),"item").invoke(bonus);}
    private ItemStack milestone(int floor,int index,int difficulty)throws Exception{Object b=invoke("milestone",new Class<?>[]{int.class,int.class,int.class},floor,index,difficulty);return b==null?null:item(b);}
    private ItemStack cache(String name,int clears,int difficulty)throws Exception{return item(invoke(name,new Class<?>[]{int.class,int.class},clears,difficulty));}
    private void require(boolean ok,String label){checks++;if(!ok)throw new IllegalStateException(label);}
    private Map<Enchantment,Integer> enchants(ItemStack item){var meta=item.getItemMeta();return meta instanceof EnchantmentStorageMeta b?b.getStoredEnchants():meta.getEnchants();}
    private Map<String,Object> describe(ItemStack item){var meta=item.getItemMeta();var ench=new TreeMap<String,Integer>();enchants(item).forEach((e,n)->ench.put(e.getKey().toString(),n));var out=new LinkedHashMap<String,Object>();out.put("type",item.getType().name());out.put("amount",item.getAmount());out.put("enchantments",ench);out.put("name",meta.getDisplayName());out.put("customModelData",meta.hasCustomModelData()?meta.getCustomModelData():null);out.put("imprint",meta.getPersistentDataContainer().get(NamespacedKey.fromString("agentfriend:imprint_spell"),PersistentDataType.STRING));out.put("aura",meta.getPersistentDataContainer().get(NamespacedKey.fromString("agentfriend:gear_aura"),PersistentDataType.STRING));return out;}
    private void validate(ItemStack item)throws Exception{
        if(item==null)return;var ench=enchants(item);
        if(item.getType().getMaxDurability()>0||item.getType()==Material.ENCHANTED_BOOK)require(!ench.isEmpty(),"empty equipment enchantments");
        require(ench.size()<=4,"too many enchantments");
        for(var e:ench.entrySet()){
            require(e.getValue()>=1&&e.getValue()<=e.getKey().getMaxLevel(),"vanilla cap");
            require(!e.getKey().isCursed()&&!e.getKey().getKey().getKey().equals("sweeping_edge"),"crossplay pool");
            require(item.getType()==Material.ENCHANTED_BOOK||e.getKey().canEnchantItem(item),"wrong material:"+item.getType()+":"+e);
            for(var other:ench.keySet())if(other!=e.getKey())require(!other.conflictsWith(e.getKey()),"conflicting enchantments");
        }
        require(item.isSimilar(ItemStack.deserializeBytes(item.serializeAsBytes())),"native bytes roundtrip");
        var meta=item.getItemMeta();if(meta.hasCustomModelData()&&meta.getPersistentDataContainer().has(NamespacedKey.fromString("agentfriend:appearance"),PersistentDataType.STRING)){
            Class<?> appearances=Class.forName("org.afuhome.agentfriend.ItemAppearances",true,af.getClass().getClassLoader());var out=new JsonObject();method(appearances,"appendDescription",ItemStack.class,JsonObject.class).invoke(null,item,out);require(out.has("appearance"),"random roll lost appearance metadata");appearanceChecks++;
        }
    }
    public void onEnable(){try{
        if(!Bukkit.getIp().equals("127.0.0.1")||Bukkit.getPort()!=40081||!Files.readString(Path.of(".loot-qa-only")).equals("QD_RANDOM_LOOT_20261109"))throw new IllegalStateException("dedicated loopback fixture required");
        af=(JavaPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend");loot=Class.forName("org.afuhome.agentfriend.DungeonLoot",true,af.getClass().getClassLoader());getCommand("lootrollqa").setExecutor(this);
    }catch(Exception e){throw new IllegalStateException(e);}}
    public boolean onCommand(CommandSender sender,Command command,String label,String[] args){
        if(!(sender instanceof ConsoleCommandSender)&&!(sender instanceof RemoteConsoleCommandSender))return true;
        try{
            var out=new LinkedHashMap<String,Object>();checks=0;appearanceChecks=0;
            if(args[0].equals("audit")){
                int items=0,books=0;var variants=new HashSet<String>();var bookVariants=new HashSet<String>();
                for(int difficulty=0;difficulty<3;difficulty++){
                    for(int index=0;index<8;index++)for(int n=0;n<25;n++){
                        ItemStack actual=milestone(6,index,difficulty);validate(actual);items++;
                        ItemStack preview=item(invoke("equipmentPreview",new Class<?>[]{int.class},index));ItemStack stripped=actual.clone();var meta=stripped.getItemMeta();for(var e:List.copyOf(meta.getEnchants().keySet()))meta.removeEnchant(e);meta.getPersistentDataContainer().remove(NamespacedKey.fromString("agentfriend:loot_enchant_schema"));stripped.setItemMeta(meta);var pm=preview.getItemMeta();for(var e:List.copyOf(pm.getEnchants().keySet()))pm.removeEnchant(e);preview.setItemMeta(pm);require(stripped.isSimilar(preview),"name/imprint/appearance/persistent metadata changed");
                        if(index==0)variants.add(json.toJson(describe(actual).get("enchantments")));
                    }
                    for(int floor:new int[]{4,5,8,9,11,12,13,14})for(int n=0;n<8;n++){validate(milestone(floor,0,difficulty));items++;}
                    for(int clear=0;clear<13;clear++)for(int n=0;n<8;n++)for(String cache:List.of("bossCache","finalCache")){validate(cache(cache,clear,difficulty));items++;}
                    for(int floor:new int[]{4,8,12,15})for(int n=0;n<100;n++){
                        Object rolled=invoke("roll",new Class<?>[]{int.class,int.class,int.class},floor,12,difficulty);
                        if(rolled==null)continue;
                        ItemStack actual=item(rolled);validate(actual);items++;if(actual.getType()==Material.ENCHANTED_BOOK){books++;bookVariants.add(json.toJson(describe(actual).get("enchantments")));}
                    }
                }
                require(variants.size()>20,"same sword has no useful variation");require(books>10&&bookVariants.size()>5,"book variety missing");out.put("items",items);out.put("swordVariants",variants.size());out.put("books",books);out.put("bookVariants",bookVariants.size());
                Class<?> appearances=Class.forName("org.afuhome.agentfriend.ItemAppearances",true,af.getClass().getClassLoader());
                require(appearanceChecks>10,"real appearance branch was not exercised");out.put("appearanceChecks",appearanceChecks);
                ItemStack unmarked=(ItemStack)invoke("bossRelic",new Class<?>[]{});var um=unmarked.getItemMeta();um.getPersistentDataContainer().remove(NamespacedKey.fromString("agentfriend:appearance"));for(var e:List.copyOf(um.getEnchants().keySet()))um.removeEnchant(e);um.addEnchant(Enchantment.UNBREAKING,1,false);um.getPersistentDataContainer().set(NamespacedKey.fromString("agentfriend:loot_enchant_schema"),PersistentDataType.INTEGER,1);unmarked.setItemMeta(um);
                var info=new JsonObject();method(appearances,"appendDescription",ItemStack.class,JsonObject.class).invoke(null,unmarked,info);require(!info.has("appearance"),"unmarked low-affix item forged a server appearance");
                ItemStack legacy=(ItemStack)invoke("bossRelic",new Class<?>[]{});var legacyInfo=new JsonObject();method(appearances,"appendDescription",ItemStack.class,JsonObject.class).invoke(null,legacy,legacyInfo);require(legacyInfo.has("appearance"),"legacy appearance no longer recognized");
            }else{
                Player p=Bukkit.getPlayerExact(args[1]);require(p!=null&&p.getName().equals("LootReader")&&p.getUniqueId().equals(UUID.nameUUIDFromBytes("OfflinePlayer:LootReader".getBytes(StandardCharsets.UTF_8))),"synthetic player only");
                Path expected=Path.of("loot-qa/expected.yml"),description=Path.of("loot-qa/expected.json");Files.createDirectories(expected.getParent());Object d=dungeon();
                if(args[0].equals("queue")){
                    require(!Files.exists(expected),"queue already accepted; inspect instead of replay");p.setOp(false);p.setGameMode(GameMode.SURVIVAL);var items=new ArrayList<ItemStack>();
                    for(int n=0;n<12;n++)items.add(milestone(6,0,1));for(int index=0;index<8;index++)items.add(milestone(6,index,1));
                    for(int n=0;n<4;n++){ItemStack book=null;for(int attempt=0;attempt<1000;attempt++){Object rolled=invoke("roll",new Class<?>[]{int.class,int.class,int.class},15,12,1);if(rolled!=null&&item(rolled).getType()==Material.ENCHANTED_BOOK){book=item(rolled);break;}}require(book!=null,"book preparation budget");items.add(book);}
                    for(int clear:new int[]{5,6,7})items.add(cache("finalCache",clear,1));
                    items.add(item(invoke("equipmentPreview",new Class<?>[]{int.class},0))); // legacy unrolled item must stay unchanged too
                    var yaml=new YamlConfiguration();yaml.set("items",items);yaml.save(expected.toFile());Files.writeString(description,json.toJson(items.stream().map(this::describe).toList()));
                    Method queue=method(d.getClass(),"queuePurchased",UUID.class,ItemStack.class);for(ItemStack item:items)require(Boolean.TRUE.equals(queue.invoke(d,p.getUniqueId(),item)),"real personal reward queue rejected");af.saveConfig();out.put("items",items.size());
                }else if(args[0].equals("state")){
                    var actual=new ArrayList<ItemStack>();for(ItemStack i:(ItemStack[])method(d.getClass(),"stashContents",UUID.class).invoke(d,p.getUniqueId()))if(i!=null)actual.add(i.clone());for(ItemStack i:p.getInventory().getContents())if(i!=null)actual.add(i.clone());
                    var expectedItems=YamlConfiguration.loadConfiguration(expected.toFile()).getList("items");var found=new ArrayList<Map<String,Object>>();
                    for(Object value:expectedItems){ItemStack wanted=(ItemStack)value;int index=-1;for(int i=0;i<actual.size();i++)if(wanted.isSimilar(actual.get(i))){index=i;break;}require(index>=0,"missing or rerolled saved item:"+describe(wanted));ItemStack matched=actual.remove(index);found.add(describe(matched));}
                    require(json.toJsonTree(found).equals(JsonParser.parseString(Files.readString(description))),"actual component data changed after storage or restart");require(!p.isOp(),"ordinary client required");out.put("items",found);out.put("op",p.isOp());
                }else throw new IllegalArgumentException("audit|queue|state");
            }
            out.put("passed",true);out.put("checks",checks);out.put("observedAt",System.currentTimeMillis());sender.sendMessage(json.toJson(out));
        }catch(Exception e){sender.sendMessage(json.toJson(Map.of("passed",false,"error",e.toString(),"cause",String.valueOf(e.getCause()),"checks",checks)));}return true;
    }
}
