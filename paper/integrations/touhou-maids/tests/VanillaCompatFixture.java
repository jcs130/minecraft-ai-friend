package org.qiandengji.compat.tests;

import com.google.gson.Gson;
import java.nio.file.*;
import java.util.*;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.game.*;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.item.ItemStack;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.craftbukkit.CraftServer;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import org.bukkit.craftbukkit.inventory.CraftItemStack;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

/** Only marked loopback, own temporary actors, terrain and items. Never installed in production. */
public final class VanillaCompatFixture extends JavaPlugin {
    private final Gson json=new Gson();
    private final Map<String,Entity> entities=new LinkedHashMap<>();
    @Override public void onEnable(){
        try{
            if(!getServer().getIp().equals("127.0.0.1")||getServer().getPort()!=29397||
                !Files.readString(Path.of(".communication-qa")).strip().equals("127.0.0.1:29397 20261030"))throw new IllegalStateException("Marked loopback only");
        }catch(Exception error){throw new IllegalStateException(error);}
        getServer().getCommandMap().register("compatfixture",new Command("compatqa"){
            @Override public boolean execute(CommandSender sender,String label,String[]args){
                if(!(sender instanceof ConsoleCommandSender)&&!(sender instanceof RemoteConsoleCommandSender))return false;
                if(args.length<2||!args[1].matches("ag_VC[a-z0-9]{3,10}"))throw new IllegalArgumentException("Own actor only");
                var player=Bukkit.getPlayerExact(args[1]);if(player==null)throw new IllegalStateException("Own actor offline");
                try{sender.sendMessage("COMPAT_QA "+json.toJson(run(player,args)));}
                catch(Exception error){throw new IllegalStateException(error);}return true;
            }});
    }
    private Class<?> projection()throws Exception{return Class.forName("local.tlmcompat.numen.NativeClientProjection",true,net.minecraft.world.level.Level.class.getClassLoader());}
    private Packet<?> projected(Packet<?> packet,ServerPlayer p,boolean observer)throws Exception{
        return (Packet<?>)projection().getMethod(observer?"forObserver":"project",Packet.class,ServerPlayer.class,net.minecraft.server.MinecraftServer.class).invoke(null,packet,p,((CraftServer)Bukkit.getServer()).getServer());
    }
    private Entity spawn(Player p,String key,String name,int dx){
        var level=((CraftPlayer)p).getHandle().serverLevel();
        var type=BuiltInRegistries.ENTITY_TYPE.get(ResourceLocation.parse(key));
        var entity=type.create(level);if(entity==null)throw new IllegalStateException("Native entity create failed");
        entity.moveTo(650.5+dx,126,650.5,180,0);entity.setCustomName(Component.literal(name));
        if(entity instanceof net.minecraft.world.entity.Mob mob)mob.setNoAi(!key.equals("minecraft:enderman"));
        level.addFreshEntity(entity);entities.put(key,entity);return entity;
    }
    private Map<String,Object> run(Player p,String[]args)throws Exception{
        String action=args[0];var w=p.getWorld();
        if(action.equals("scene")){
            for(var entity:entities.values())entity.discard();entities.clear();
            for(int x=640;x<=663;x++)for(int z=640;z<=664;z++)for(int y=124;y<=131;y++)w.getBlockAt(x,y,z).setType(y<=125?Material.STONE:Material.AIR,false);
            // Old stopped QA worlds can contain our prior fixture's last save.
            // This scope is the marked loopback's own tiny fixture volume only.
            for(var entity:w.getNearbyEntities(new Location(w,651,126,651),20,10,20))
                if(entity.getCustomName()!=null&&Set.of("兼容联测女仆","兼容联测妖精","兼容联测末影人").contains(entity.getCustomName()))entity.remove();
            w.setTime(18000);w.setStorm(false);p.setOp(false);p.setGameMode(GameMode.SURVIVAL);p.setHealth(p.getMaxHealth());p.setFoodLevel(20);
            p.teleport(new Location(w,651.5,126,645.5));p.setFallDistance(0);
            spawn(p,"touhou_little_maid:maid","兼容联测女仆",0);
            spawn(p,"touhou_little_maid:fairy","兼容联测妖精",3);
        }else if(action.equals("items")){
            for(int i=0;i<2;i++){
                String id=i==0?"smart_slab_init":"red_fox_scroll";
                var stack=new ItemStack(BuiltInRegistries.ITEM.get(ResourceLocation.parse("touhou_little_maid:"+id)),1);
                p.getInventory().setItem(i,CraftItemStack.asCraftMirror(stack));
            }
        }else if(action.equals("health")){
            p.getAttribute(org.bukkit.attribute.Attribute.GENERIC_MAX_HEALTH).setBaseValue(35);
            p.setHealthScaled(false);p.setHealth(24);p.setFoodLevel(17);p.setSaturation(0);
        }else if(action.equals("refill")){
            var vortex=(io.vortexcore.VortexCorePlugin)Bukkit.getPluginManager().getPlugin("VortexRPG");
            vortex.qiandengjiMana().setMana(p.getUniqueId(),vortex.qiandengjiMana().getMaxMana(p));
        }else if(action.equals("scale")){
            p.setHealthScale(30);
        }else if(action.equals("gear")){
            p.getInventory().setHelmet(new org.bukkit.inventory.ItemStack(Material.IRON_HELMET));
            p.getInventory().setChestplate(new org.bukkit.inventory.ItemStack(Material.IRON_CHESTPLATE));
            p.getInventory().setLeggings(new org.bukkit.inventory.ItemStack(Material.IRON_LEGGINGS));
            p.getInventory().setBoots(new org.bukkit.inventory.ItemStack(Material.IRON_BOOTS));
            p.getInventory().setItem(2,new org.bukkit.inventory.ItemStack(Material.DIAMOND_AXE));
        }else if(action.equals("room")){
            int room=Integer.parseInt(args[2]);if(room<0||room>3)throw new IllegalArgumentException("Own site only");
            int x=room==0?710:room==3?665:650,z=room<2?650:665;
            if(room==0)for(int dx=-2;dx<=2;dx++)for(int dz=-2;dz<=2;dz++){w.getBlockAt(x+dx,125,z+dz).setType(Material.STONE,false);w.getBlockAt(x+dx,126,z+dz).setType(Material.AIR,false);w.getBlockAt(x+dx,127,z+dz).setType(Material.AIR,false);}
            p.teleport(new Location(w,x+.5,126,z+.5));p.setFallDistance(0);p.setHealth(p.getMaxHealth());
        }else if(action.equals("site")){
            for(int x=640;x<=675;x++)for(int z=640;z<=675;z++)for(int y=124;y<=130;y++)w.getBlockAt(x,y,z).setType(y<=125?Material.STONE:Material.AIR,false);
            p.teleport(new Location(w,650.5,126,650.5));p.setFallDistance(0);
        }else if(action.equals("fight")){
            for(var e:p.getNearbyEntities(8,4,8))if(e instanceof org.bukkit.entity.LivingEntity mob&&e.getScoreboardTags().contains("afu_site_dungeon"))mob.damage(100,p);
        }else if(action.equals("down")){
            p.setNoDamageTicks(0);p.damage(1000);
        }else if(action.equals("bubble")){
            var maid=entities.get("touhou_little_maid:maid");var manager=maid.getClass().getMethod("getChatBubbleManager").invoke(maid);
            manager.getClass().getMethod("addTextChatBubble",String.class).invoke(manager,"chat_bubble.touhou_little_maid.inner.fishing.no_sit");
        }else if(action.equals("far"))p.teleport(new Location(w,651.5,126,663.5));
        else if(action.equals("near"))p.teleport(new Location(w,651.5,126,645.5));
        else if(action.equals("away"))p.teleport(new Location(w,754.5,126,641.5));
        else if(action.equals("enderman")){
            for(var entity:entities.values())entity.discard();entities.clear();
            p.getInventory().clear();p.setGameMode(GameMode.SURVIVAL);p.setHealth(p.getMaxHealth());p.setFoodLevel(20);p.setNoDamageTicks(0);
            p.teleport(new Location(w,651.5,126,645.5));
            spawn(p,"minecraft:enderman","兼容联测末影人",0);
        }else if(action.equals("target")){
            var mob=(org.bukkit.entity.Enderman)entities.get("minecraft:enderman").getBukkitEntity();mob.setTarget(p);
        }else if(action.equals("terrain")){
            if(!Set.of("path","farmland","slab","stone","blocked","hazard").contains(args[2]))throw new IllegalArgumentException("Own terrain only");
            for(int x=736;x<=756;x++)for(int z=636;z<=646;z++)for(int y=124;y<=129;y++)w.getBlockAt(x,y,z).setType(y<=125?Material.STONE:Material.AIR,false);
            var material=switch(args[2]){case"path"->Material.DIRT_PATH;case"farmland"->Material.FARMLAND;case"slab"->Material.OAK_SLAB;case"hazard"->Material.MAGMA_BLOCK;default->Material.STONE;};
            for(int x=740;x<=743;x++)for(int z=640;z<=643;z++)w.getBlockAt(x,125,z).setType(material,false);
            double y=material==Material.OAK_SLAB?125.5:material==Material.DIRT_PATH||material==Material.FARMLAND?125.9375:126;
            p.teleport(new Location(w,741.5,y,641.5));p.setFallDistance(0);p.setGameMode(GameMode.SURVIVAL);
            if(args[2].equals("blocked"))w.getBlockAt(741,126,641).setType(Material.STONE,false);
        }else if(!action.equals("state")&&!action.equals("projection"))throw new IllegalArgumentException("Unknown fixture action");
        Map<String,Object> result=new LinkedHashMap<>();
        result.put("position",List.of(p.getX(),p.getY(),p.getZ()));result.put("health",p.getHealth());result.put("op",p.isOp());
        result.put("healthScaled",p.isHealthScaled());result.put("healthScale",p.getHealthScale());
        result.put("maxHealth",p.getAttribute(org.bukkit.attribute.Attribute.GENERIC_MAX_HEALTH).getValue());result.put("absorption",p.getAbsorptionAmount());
        try{result.put("sentChunks",p.getClass().getMethod("getSentChunkKeys").invoke(p));}
        catch(NoSuchMethodException missing){result.put("sentChunksApi","unavailable");}
        var handle=((CraftPlayer)p).getHandle();int cx=p.getLocation().getBlockX()>>4,cz=p.getLocation().getBlockZ()>>4;
        result.put("trackingCurrent",handle.getChunkTrackingView().contains(cx,cz));
        result.put("pendingCurrent",handle.connection.chunkSender.isPending(net.minecraft.world.level.ChunkPos.asLong(cx,cz)));
        // Paper's plugin remapper changes the descriptor of a getId field
        // access on Youer. Inspect this diagnostic registry reflectively.
        Object attributes=BuiltInRegistries.class.getField("ATTRIBUTE").get(null);
        var keyMethod=attributes.getClass().getMethod("getKey",Object.class);var idMethod=attributes.getClass().getMethod("getId",Object.class);
        Map<String,Integer> attributeIds=new LinkedHashMap<>();for(var attribute:(Iterable<?>)attributes)attributeIds.put(keyMethod.invoke(attributes,attribute).toString(),((Number)idMethod.invoke(attributes,attribute)).intValue());result.put("attributeIds",attributeIds);
        result.put("nativeChunkReady",handle.serverLevel().getChunkSource().getChunkNow(cx,cz)!=null);
        result.put("entities",entities.values().stream().map(e->{
            Map<String,Object> row=new LinkedHashMap<>();row.put("id",e.getId());row.put("uuid",e.getUUID().toString());row.put("type",BuiltInRegistries.ENTITY_TYPE.getKey(e.getType()).toString());
            row.put("position",List.of(e.getX(),e.getY(),e.getZ()));row.put("alive",e.isAlive());
            if(e.getBukkitEntity()instanceof org.bukkit.entity.Mob mob){row.put("ai",mob.hasAI());row.put("aware",mob.isAware());row.put("target",mob.getTarget()==null?"":mob.getTarget().getUniqueId().toString());}
            return row;
        }).toList());
        if(action.equals("projection")){
            var serverPlayer=((CraftPlayer)p).getHandle();var projected=new ArrayList<Object>();
            for(var entity:entities.values()){
                if(!BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).getNamespace().equals("touhou_little_maid"))continue;
                var original=new ClientboundAddEntityPacket(entity.getId(),entity.getUUID(),entity.getX(),entity.getY(),entity.getZ(),0,0,entity.getType(),0,net.minecraft.world.phys.Vec3.ZERO,0);
                var view=projected(original,serverPlayer,true);var children=new ArrayList<Packet<?>>();
                if(view instanceof ClientboundBundlePacket bundle)for(var child:bundle.subPackets())children.add(child);else children.add(view);
                var mapped=(ClientboundAddEntityPacket)children.getFirst();
                var meta=projected(new ClientboundSetEntityDataPacket(entity.getId(),entity.getEntityData().getNonDefaultValues()),serverPlayer,true);
                var data=((ClientboundSetEntityDataPacket)meta).packedItems();
                projected.add(Map.of("uuidPreserved",mapped.getUUID().equals(entity.getUUID()),"type",BuiltInRegistries.ENTITY_TYPE.getKey(mapped.getType()).toString(),"bundleSize",children.size(),"maxMetadata",data.stream().mapToInt(v->v.id()).max().orElse(-1)));
            }
            result.put("projections",projected);
            var stack=new ItemStack(BuiltInRegistries.ITEM.get(ResourceLocation.parse("touhou_little_maid:smart_slab_init")),1);String before=stack.toString();
            var mapped=(ItemStack)projection().getMethod("item",ItemStack.class).invoke(null,stack);
            result.put("item",Map.of("sourcePreserved",before.equals(stack.toString()),"id",BuiltInRegistries.ITEM.getKey(mapped.getItem()).toString(),"name",mapped.getHoverName().getString()));
        }
        return result;
    }
    @Override public void onDisable(){for(var entity:entities.values())if(!entity.isRemoved())entity.discard();entities.clear();}
}
