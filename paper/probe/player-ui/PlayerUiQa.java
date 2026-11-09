package local.playeruiqa;

import com.google.gson.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

/** Synthetic/read-only UI acceptance. This plugin refuses every production profile. */
public final class PlayerUiQa extends JavaPlugin implements CommandExecutor {
    private Object friend,manager;private ClassLoader loader;private int checks;
    @Override public void onEnable(){try{
        if(Bukkit.getPort()!=25960||!Files.readString(Path.of(".dungeon-integration-qa")).strip().equals("FRESH_DUNGEON_INTEGRATION_NO_PLAYER_INVENTORIES"))throw new IllegalStateException("QA profile required");
        friend=Bukkit.getPluginManager().getPlugin("AgentFriend");loader=friend.getClass().getClassLoader();
        Field f=friend.getClass().getDeclaredField("playerAdventureMenus");f.setAccessible(true);manager=f.get(friend);
        getCommand("playeruiqa").setExecutor(this);
    }catch(Exception failure){throw new IllegalStateException(failure);}}
    private void check(boolean ok,String why){checks++;if(!ok)throw new IllegalStateException(why);}
    private static Object call(Object target,String name)throws Exception {Method m=target.getClass().getDeclaredMethod(name);m.setAccessible(true);return m.invoke(target);}
    private String snapshot(Player p)throws Exception{
        Object rpg=Bukkit.getPluginManager().getPlugin("QiandengjiRpg");
        JsonObject s=JsonParser.parseString((String)rpg.getClass().getMethod("selfState",Player.class).invoke(rpg,p)).getAsJsonObject();
        JsonObject out=new JsonObject();
        for(String key:List.of("combat","level","xp","skillPoints","activeSkill","mana","economy"))if(s.has(key))out.add(key,s.get(key));
        JsonObject party=JsonParser.parseString((String)rpg.getClass().getMethod("partyState",Player.class).invoke(rpg,p)).getAsJsonObject();
        out.add("inParty",party.get("inParty"));out.add("partyId",party.get("partyId"));
        MessageDigest md=MessageDigest.getInstance("SHA-256");
        for(var item:p.getInventory().getContents())md.update(item==null?new byte[]{0}:item.serializeAsBytes());
        out.addProperty("inventory",HexFormat.of().formatHex(md.digest()));out.addProperty("op",p.isOp());
        out.addProperty("world",p.getWorld().getName());out.addProperty("x",p.getLocation().getX());out.addProperty("y",p.getLocation().getY());out.addProperty("z",p.getLocation().getZ());
        return out.toString();
    }
    @SuppressWarnings({"rawtypes","unchecked"}) private void forms(Player p)throws Exception{
        checks=0;Class<?> page=Class.forName("org.afuhome.agentfriend.AdventureMenuModel$Page",true,loader);
        Class<?> viewClass=Class.forName("org.afuhome.agentfriend.AdventureMenuModel$View",true,loader);
        Method view=manager.getClass().getDeclaredMethod("view",Player.class,page,String.class);view.setAccessible(true);
        Class<?> adapter=Class.forName("org.afuhome.agentfriend.BedrockMenuForms",true,loader);
        Method available=adapter.getDeclaredMethod("available");available.setAccessible(true);Object api=available.invoke(null);check(api!=null,"optional_floodgate_adapter");
        Method create=adapter.getDeclaredMethod("create",viewClass,Consumer.class,Runnable.class);create.setAccessible(true);
        ClassLoader fg=Bukkit.getPluginManager().getPlugin("floodgate").getClass().getClassLoader();
        Class<?> form=Class.forName("org.geysermc.cumulus.form.Form",true,fg),simple=Class.forName("org.geysermc.cumulus.form.SimpleForm",true,fg);
        Class<?> defsClass=Class.forName("org.geysermc.cumulus.form.impl.FormDefinitions",true,fg);
        Object defs=defsClass.getMethod("instance").invoke(null);
        Class<?> codecClass=Class.forName("org.geysermc.cumulus.form.util.FormCodec",true,fg),defClass=Class.forName("org.geysermc.cumulus.form.impl.FormDefinition",true,fg);
        for(String name:List.of("HOME","GROWTH","ADVENTURE","STORAGE","TRADE","SOCIAL","MEMORIES","COMMON","COMMON_DETAIL","CHARACTER","TIDY_BAG","TIDY_STASH","PARTY","PARTY_CONFIRM","HELP","ERROR")){
            Object v=view.invoke(manager,p,Enum.valueOf((Class)page,name),name.equals("COMMON_DETAIL")?"blink":name.equals("PARTY_CONFIRM")?"create":"");
            List<?> buttons=(List<?>)call(v,"buttons");
            check(buttons.stream().map(b->{try{return call(b,"slot");}catch(Exception e){throw new IllegalStateException(e);}}).distinct().count()==buttons.size(),"unique_slots_"+name);
            AtomicInteger selected=new AtomicInteger(-1),closed=new AtomicInteger();
            Object f=create.invoke(api,v,(Consumer<Integer>)selected::set,(Runnable)closed::incrementAndGet);
            Object codec=defsClass.getMethod("codecFor",form).invoke(defs,f);
            JsonObject json=JsonParser.parseString((String)codecClass.getMethod("jsonData",form).invoke(codec,f)).getAsJsonObject();
            List<?> actions=(List<?>)call(v,"actions");
            check(json.get("type").getAsString().equals("form"),"simple_touch_form_"+name);
            check(json.getAsJsonArray("buttons").size()==actions.size(),"same_actions_"+name);
            check(simple.getMethod("title").invoke(f).equals(call(v,"title")),"same_title_"+name);
            Object definition=defsClass.getMethod("definitionFor",form).invoke(defs,f);
            defClass.getMethod("handleFormResponse",form,String.class).invoke(definition,f,"0");check(selected.get()==0,"real_valid_response_"+name);
            Object canceled=create.invoke(api,v,(Consumer<Integer>)i->{throw new IllegalStateException("closed_executed");},(Runnable)closed::incrementAndGet);
            defClass.getMethod("handleFormResponse",form,String.class).invoke(definition,canceled,"null");check(closed.get()==1,"close_no_action_"+name);
            Object invalid=create.invoke(api,v,(Consumer<Integer>)i->{throw new IllegalStateException("invalid_executed");},(Runnable)closed::incrementAndGet);
            defClass.getMethod("handleFormResponse",form,String.class).invoke(definition,invalid,"99999");check(closed.get()==2,"invalid_no_action_"+name);
            Files.writeString(getDataFolder().toPath().resolve(name.toLowerCase(Locale.ROOT)+".json"),json.toString());
        }
    }
    @Override public boolean onCommand(CommandSender sender,Command command,String label,String[] args){
        try{
            if(!(sender instanceof ConsoleCommandSender||sender instanceof RemoteConsoleCommandSender)||args.length!=2)throw new IllegalArgumentException("console_only");
            Player p=Bukkit.getPlayerExact(args[1]);
            if(p==null||!p.getName().matches("ag_UiQA[12]")||!p.getUniqueId().equals(UUID.nameUUIDFromBytes(("OfflinePlayer:"+p.getName()).getBytes(java.nio.charset.StandardCharsets.UTF_8))))throw new IllegalArgumentException("synthetic_actor_only");
            getDataFolder().mkdirs();
            if(args[0].equals("read"))sender.sendMessage(snapshot(p));
            else if(args[0].equals("forms")){forms(p);sender.sendMessage("PLAYER_UI_FORMS passed=true checks="+checks+" realTouchDevice=false");}
            else throw new IllegalArgumentException("unknown_query");
        }catch(Exception failure){Throwable cause=failure instanceof InvocationTargetException?failure.getCause():failure;sender.sendMessage("PLAYER_UI_QA passed=false error="+cause.getClass().getSimpleName()+":"+cause.getMessage());getLogger().log(java.util.logging.Level.WARNING,"QA failure",failure);}
        return true;
    }
}
