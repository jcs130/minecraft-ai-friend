package qa;

import com.google.gson.*;
import java.nio.file.*;
import java.lang.reflect.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.plugin.java.JavaPlugin;
import com.earth2me.essentials.Essentials;

/** Console-only helper, restricted to a disposable loopback world. Never packaged with AgentFriend. */
public final class TravelPointQa extends JavaPlugin implements Listener {
    private JavaPlugin af;
    private boolean cancel;
    private static Object call(Object target,String method,Class<?>[] types,Object... args)throws Exception{
        Method m=target.getClass().getDeclaredMethod(method,types);m.setAccessible(true);return m.invoke(target,args);
    }
    @Override public void onEnable(){
        try{
            if(!Files.readString(Path.of(".travel-point-qa")).equals("SYNTHETIC_TRAVEL_POINT_ONLY")||!Bukkit.getIp().equals("127.0.0.1")||Bukkit.getPort()!=26461)throw new IllegalStateException("isolated fixture required");
            af=(JavaPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend");
            Bukkit.getPluginManager().registerEvents(this,this);
            Bukkit.getCommandMap().register("travelpointqa",new Command("travelpointqa"){
                @Override public boolean execute(CommandSender sender,String label,String[] args){
                    if(sender instanceof Player)return false;
                    try{run(sender,args);}catch(Exception error){throw new IllegalStateException(error);}return true;
                }
            });
        }catch(Exception error){throw new IllegalStateException(error);}
    }
    @EventHandler(priority=EventPriority.HIGHEST)
    public void travel(PlayerTeleportEvent event){if(cancel&&event.getPlayer().getName().equals("TravelPointQA"))event.setCancelled(true);}
    private void run(CommandSender sender,String[] args)throws Exception{
        Player p=Bukkit.getPlayerExact("TravelPointQA");if(p==null)throw new IllegalStateException("synthetic client required");
        Object rpg=call(af,"nativeRpg",new Class<?>[0]);JsonObject out=new JsonObject();
        if(args[0].equals("refill"))call(rpg,"refillDungeonMana",new Class<?>[]{Player.class},p);
        if(args[0].equals("cancel"))cancel=Boolean.parseBoolean(args[1]);
        if(args[0].startsWith("marker")){
            JsonArray markers=JsonParser.parseString(Files.readString(Path.of("plugins/AgentFriend/travel-markers-plan.json"))).getAsJsonObject().getAsJsonArray("markers");
            JsonObject marker=null;for(JsonElement value:markers)if(value.getAsJsonObject().get("id").getAsString().equals(args[1]))marker=value.getAsJsonObject();
            if(marker==null)throw new IllegalArgumentException("unknown fixture marker");World world=Bukkit.getWorld(marker.get("worldName").getAsString());
            JsonObject geometry=marker.getAsJsonObject("geometry");JsonArray reader=geometry.getAsJsonArray("reader");
            if(args[0].equals("markerarrive"))p.teleport(new Location(world,reader.get(0).getAsDouble(),reader.get(1).getAsDouble(),reader.get(2).getAsDouble()));
            JsonArray b=geometry.getAsJsonArray("beacon"),s=geometry.getAsJsonArray("sign");var beacon=world.getBlockAt(b.get(0).getAsInt(),b.get(1).getAsInt(),b.get(2).getAsInt());var sign=world.getBlockAt(s.get(0).getAsInt(),s.get(1).getAsInt(),s.get(2).getAsInt());
            out.addProperty("beacon",beacon.getType().toString());out.addProperty("sign",sign.getType().toString());out.add("signPosition",s);
            if(sign.getState() instanceof org.bukkit.block.Sign state){out.addProperty("waxed",state.isWaxed());JsonArray lines=new JsonArray();for(String line:state.getLines())lines.add(line);out.add("signLines",lines);}
            boolean allAfter=true,allBefore=true;for(JsonElement v:geometry.getAsJsonArray("changes")){var row=v.getAsJsonObject();var at=row.getAsJsonArray("position");String current=world.getBlockAt(at.get(0).getAsInt(),at.get(1).getAsInt(),at.get(2).getAsInt()).getBlockData().getAsString();allAfter&=current.equals(row.get("after").getAsString());allBefore&=current.equals(row.get("before").getAsString());}
            out.addProperty("allAfter",allAfter);out.addProperty("allBefore",allBefore);
            var broken=new org.bukkit.event.block.BlockBreakEvent(beacon,p);Bukkit.getPluginManager().callEvent(broken);out.addProperty("breakProtected",broken.isCancelled());
            var blast=new org.bukkit.event.block.BlockExplodeEvent(beacon,beacon.getState(),new ArrayList<>(List.of(beacon,sign)),1,org.bukkit.ExplosionResult.DESTROY);Bukkit.getPluginManager().callEvent(blast);out.addProperty("explosionProtected",blast.blockList().isEmpty());
            if(args[0].equals("markeralter"))beacon.setType(Material.GLASS,false);
            if(args[0].equals("markerunalter")&&beacon.getType()==Material.GLASS)beacon.setType(Material.BEACON,false);
        }
        if(args[0].equals("audit")){
            Field hallField=af.getClass().getDeclaredField("guildHall");hallField.setAccessible(true);Object hall=hallField.get(af);
            for(var field:Map.of("built",true,"ready",true,"x",-489,"y",66,"z",-502).entrySet()){
                Field value=hall.getClass().getDeclaredField(field.getKey());value.setAccessible(true);value.set(hall,field.getValue());
            }
            JsonArray rows=new JsonArray();var ess=(Essentials)Bukkit.getPluginManager().getPlugin("Essentials");
            Class<?> landing=af.getClass().getClassLoader().loadClass("org.afuhome.agentfriend.HomeLanding");
            var ctor=landing.getDeclaredConstructor(Player.class,Location.class);ctor.setAccessible(true);
            for(var raw:JsonParser.parseString(Files.readString(Path.of("public-points.json"))).getAsJsonArray()){
                JsonObject point=raw.getAsJsonObject().deepCopy();World world=Bukkit.getWorld(point.get("worldName").getAsString());
                if(world==null)throw new IllegalStateException("world unavailable");
                Location at=new Location(world,point.get("x").getAsDouble(),point.get("y").getAsDouble(),point.get("z").getAsDouble());
                ess.getWarps().setWarp(point.get("id").getAsString(),at);
                Object selection=call(ctor.newInstance(p,at),"select",new Class<?>[0]);
                Object issue=call(selection,"originalIssue",new Class<?>[0]);
                if(issue!=null)point.addProperty("issue",String.valueOf(call(issue,"code",new Class<?>[0])));
                Location chosen=(Location)call(selection,"destination",new Class<?>[0]);
                point.addProperty("found",chosen!=null);
                if(chosen!=null){JsonArray xyz=new JsonArray();xyz.add(chosen.getX());xyz.add(chosen.getY());xyz.add(chosen.getZ());point.add("safeDestination",xyz);}
                point.addProperty("blockReads",(int)call(selection,"blockReads",new Class<?>[0]));rows.add(point);
            }
            out.add("points",rows);Files.writeString(Path.of("public-points-verified.json"),out.toString());
        }
        out.addProperty("world",p.getWorld().getName());JsonArray at=new JsonArray();at.add(p.getX());at.add(p.getY());at.add(p.getZ());out.add("position",at);
        out.add("mana",(JsonElement)call(rpg,"mana",new Class<?>[]{Player.class},p));
        sender.sendMessage("TRAVEL_POINT_QA "+out);
    }
}
