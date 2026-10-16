package org.afuhome.agentfriend;

import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.bukkit.Material;
import org.bukkit.inventory.*;
import org.bukkit.inventory.meta.MapMeta;

/** Photo originals go to the existing personal reward chest, never the carried inventory.
 * Receipt and items share one atomic config write; retrying the same ImageFrame image
 * cannot mint another copy. Full chests retain their tiles in a bounded private queue. */
final class PhotoRewards {
    private static final String ROOT="photo-rewards.";
    private PhotoRewards() { }

    static boolean accept(AgentFriendPlugin plugin, PagedPersonalStash storage, UUID owner, int image, List<ItemStack> items) {
        if(!org.bukkit.Bukkit.isPrimaryThread())throw new IllegalStateException("photo reward thread");
        if(image<0 || items==null || !Set.of(1,4).contains(items.size()))throw new IllegalArgumentException("photo tile count");
        List<Integer> ids=new ArrayList<>();
        for(ItemStack item:items){
            if(item==null||item.getType()!=Material.FILLED_MAP||item.getAmount()!=1||!(item.getItemMeta() instanceof MapMeta meta)||!meta.hasMapView())throw new IllegalArgumentException("photo tile");
            ids.add(meta.getMapView().getId());
        }
        if(new HashSet<>(ids).size()!=ids.size())throw new IllegalArgumentException("duplicate photo tile");
        String path=ROOT+owner+"."+image;
        if(plugin.getConfig().contains(path))return plugin.getConfig().getIntegerList(path+".map-ids").equals(ids);
        var section=plugin.getConfig().getConfigurationSection(ROOT+owner);
        if(section!=null&&section.getKeys(false).size()>=64)return false;
        ItemStack[] before=cloneItems(storage.contents(owner));
        try{
            List<ItemStack> overflow=new ArrayList<>();
            for(ItemStack item:items){int left=storage.add(owner,item.clone());if(left>0){ItemStack pending=item.clone();pending.setAmount(left);overflow.add(pending);}}
            plugin.getConfig().set(path+".map-ids",ids);
            plugin.getConfig().set(path+".pending",overflow);
            plugin.getConfig().set(path+".stored-at",System.currentTimeMillis());
            save(plugin);return true;
        }catch(Exception failed){
            for(int i=0;i<before.length;i++)storage.set(owner,i,before[i]);
            for(int i=0;i<PagedPersonalStash.PAGES;i++)storage.write(storage.page(owner,i),owner);
            plugin.getConfig().set(path,null);
            plugin.getLogger().warning("Photo reward not committed owner="+owner+" image="+image+" error="+failed.getClass().getSimpleName());
            return false;
        }
    }

    /** Called when an existing personal chest page is opened. Does not issue copies. */
    static boolean materialize(AgentFriendPlugin plugin,PagedPersonalStash storage,Inventory inv,UUID owner) {
        var section=plugin.getConfig().getConfigurationSection(ROOT+owner);if(section==null)return false;
        ItemStack[] before=cloneItems(inv.getContents());Map<String,List<ItemStack>> previous=new LinkedHashMap<>();boolean moved=false;
        for(String key:section.getKeys(false)){
            String path=ROOT+owner+"."+key+".pending";List<ItemStack> pending=readItems(plugin,path);if(pending.isEmpty())continue;
            previous.put(path,pending);List<ItemStack> left=new ArrayList<>();
            for(ItemStack item:pending){int n=inv.addItem(item.clone()).values().stream().mapToInt(ItemStack::getAmount).sum();if(n<item.getAmount())moved=true;if(n>0){ItemStack rest=item.clone();rest.setAmount(n);left.add(rest);}}
            plugin.getConfig().set(path,left);
        }
        if(!moved)return false;
        try{storage.write(inv,owner);save(plugin);return true;}catch(Exception failed){
            inv.setContents(before);storage.write(inv,owner);previous.forEach((p,items)->plugin.getConfig().set(p,items));
            plugin.getLogger().warning("Photo chest queue not committed owner="+owner+" error="+failed.getClass().getSimpleName());return false;
        }
    }
    static int pending(AgentFriendPlugin plugin,UUID owner){
        var section=plugin.getConfig().getConfigurationSection(ROOT+owner);if(section==null)return 0;
        return section.getKeys(false).stream().mapToInt(key->readItems(plugin,ROOT+owner+"."+key+".pending").stream().mapToInt(ItemStack::getAmount).sum()).sum();
    }
    private static List<ItemStack> readItems(AgentFriendPlugin plugin,String path){
        List<ItemStack> out=new ArrayList<>();for(Object item:plugin.getConfig().getList(path,List.of()))if(item instanceof ItemStack stack)out.add(stack.clone());else throw new IllegalStateException("invalid saved photo tile");return out;
    }
    private static ItemStack[] cloneItems(ItemStack[] values){return Arrays.stream(values).map(i->i==null?null:i.clone()).toArray(ItemStack[]::new);}
    static void save(AgentFriendPlugin plugin)throws Exception{
        Path file=plugin.getDataFolder().toPath().resolve("config.yml"),temp=file.resolveSibling("config.yml.photo.tmp");
        byte[] bytes=plugin.getConfig().saveToString().getBytes(StandardCharsets.UTF_8);
        try(FileChannel channel=FileChannel.open(temp,StandardOpenOption.CREATE,StandardOpenOption.TRUNCATE_EXISTING,StandardOpenOption.WRITE)){
            ByteBuffer buffer=ByteBuffer.wrap(bytes);while(buffer.hasRemaining())channel.write(buffer);channel.force(true);
        }
        Files.move(temp,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
    }
}
