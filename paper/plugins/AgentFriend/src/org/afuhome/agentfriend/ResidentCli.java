package org.afuhome.agentfriend;

import com.google.gson.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.entity.*;
import org.bukkit.inventory.*;

/** Ordinary authoring/photo services over a resident's own body. No connection, OP or console impersonation. */
public final class ResidentCli {
    private static final Map<UUID,Player> actors=new HashMap<>();
    private static final Map<UUID,UUID> requests=new HashMap<>();
    private static final Map<String,JsonObject> results=new HashMap<>();
    private static final Map<String,String> commands=new HashMap<>();
    private static String key(UUID id,UUID request){return id+"/"+request;}
    private static final Set<String> ARCHIVE=Set.of("status","list","mine","info","read","create","restore");
    private static final Set<String> PHOTO=Set.of("take","status","cancel","album","info","title","story","exhibit","withdraw");
    private static AgentFriendPlugin plugin(){return (AgentFriendPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend");}
    private static Object nativeCall(String name,Class<?>[] types,Object... args)throws ReflectiveOperationException {
        try{return Class.forName("local.qdj.maids.brain.ResidentBodyAccess").getMethod(name,types).invoke(null,args);}
        catch(InvocationTargetException e){if(e.getCause() instanceof RuntimeException r)throw r;throw e;}
    }
    public static boolean isResident(UUID id){return NativeResidentIdentities.all().containsKey(id);}
    static Entity actual(Player p){if(!isResident(p.getUniqueId()))return p;try{return (Entity)nativeCall("entity",new Class[]{UUID.class},p.getUniqueId());}catch(Exception e){throw new IllegalStateException("resident_unavailable",e);}}
    static boolean mana(Player p,double amount,boolean spend){try{return Boolean.TRUE.equals(nativeCall("mana",new Class[]{UUID.class,double.class,boolean.class},p.getUniqueId(),amount,spend));}catch(Exception e){return false;}}
    static Player find(UUID id){var player=Bukkit.getPlayer(id);if(player!=null)return player;if(!isResident(id))return null;
        try{nativeCall("entity",new Class[]{UUID.class},id);return actors.computeIfAbsent(id,ResidentCli::actor);}catch(Exception missing){return null;}}
    private static Player actor(UUID id){
        final Player[] self=new Player[1];
        PlayerInventory inventory=(PlayerInventory)Proxy.newProxyInstance(ResidentCli.class.getClassLoader(),new Class[]{PlayerInventory.class},(proxy,m,args)->{
            int size=(Integer)nativeCall("capacity",new Class[]{UUID.class},id);
            return switch(m.getName()){
                case "getSize"->size;case "getHolder"->self[0];case "getType"->org.bukkit.event.inventory.InventoryType.PLAYER;
                case "getItem"->nativeCall("item",new Class[]{UUID.class,int.class},id,(Integer)args[0]);
                case "setItem"->{nativeCall("item",new Class[]{UUID.class,int.class,Object.class},id,(Integer)args[0],args[1]);yield null;}
                case "getStorageContents","getContents"->{ItemStack[] items=new ItemStack[size];for(int i=0;i<size;i++)items[i]=(ItemStack)nativeCall("item",new Class[]{UUID.class,int.class},id,i);yield items;}
                case "firstEmpty"->{int slot=-1;for(int i=0;i<size;i++){var item=(ItemStack)nativeCall("item",new Class[]{UUID.class,int.class},id,i);if(item==null||item.getType().isAir()){slot=i;break;}}yield slot;}
                default->throw new UnsupportedOperationException("resident_inventory_method:"+m.getName());
            };
        });
        self[0]=(Player)Proxy.newProxyInstance(ResidentCli.class.getClassLoader(),new Class[]{Player.class},(proxy,m,args)->{
            if(m.getDeclaringClass()==Object.class)return switch(m.getName()){case "toString"->"ResidentActor("+id+")";case "hashCode"->id.hashCode();case "equals"->proxy==args[0];default->null;};
            if(m.getName().equals("getUniqueId"))return id;
            if(m.getName().equals("getInventory"))return inventory;
            if(m.getName().equals("sendPluginMessage")){capture(id,new String((byte[])args[2],java.nio.charset.StandardCharsets.UTF_8));return null;}
            if(m.getName().equals("sendMessage")||m.getName().equals("sendRawMessage")){for(Object arg:args)if(arg instanceof String text)capture(id,text);else if(arg instanceof String[] text)for(String line:text)capture(id,line);return null;}
            if(m.getName().equals("openBook")){var book=(org.bukkit.inventory.meta.BookMeta)((ItemStack)args[0]).getItemMeta();capture(id,"MC_RESIDENT_BOOK "+new Gson().toJson(Map.of("pages",book.getPages())));return null;}
            if(m.getName().equals("hasPermission"))return args[0] instanceof String permission&&permission.equals("imageframe.create");
            if(m.getName().equals("isOp")||m.getName().equals("isSneaking"))return false;
            if(m.getName().equals("isPermissionSet"))return false;
            if(m.getName().equals("getEffectivePermissions"))return Set.of();
            if(m.getName().equals("getGameMode"))return GameMode.SURVIVAL;
            if(m.getName().equals("getServer"))return Bukkit.getServer();
            var body=(LivingEntity)nativeCall("entity",new Class[]{UUID.class},id);
            if(m.getName().equals("isOnline"))return body.isValid()&&!body.isDead();
            if(m.getName().equals("getName")||m.getName().equals("getDisplayName"))return NativeResidentIdentities.all().get(id);
            if(m.getName().equals("getEyeLocation"))return body.getEyeLocation();
            if(m.getName().equals("updateInventory"))return null;
            if(m.getDeclaringClass().isInstance(body))return m.invoke(body,args);
            throw new UnsupportedOperationException("resident_player_method:"+m.getName());
        });return self[0];
    }
    static void capture(UUID id,String text){
        UUID request=requests.get(id);if(request==null)return;var row=results.get(key(id,request));if(row==null)return;
        var messages=row.getAsJsonArray("messages");if(messages.size()<16&&text.length()<=2048)messages.add(text);
        String raw=text.startsWith("MC_")&&text.indexOf(' ')>0?text.substring(text.indexOf(' ')+1):text;
        try{
            var value=JsonParser.parseString(raw).getAsJsonObject();String command=commands.getOrDefault(key(id,request),"");
            boolean terminal=false,success=false;
            if(command.startsWith("photo take")){
                String status=value.has("status")?value.get("status").getAsString():"";
                terminal=Set.of("success","denied","cancelled","stopped","expired","unknown").contains(status);success=status.equals("success");
            }else if(command.startsWith("archive ")||command.startsWith("photo ")){terminal=true;success=!value.has("errorCode")&&(!value.has("success")||value.get("success").getAsBoolean());}
            boolean unknown=value.has("status")&&value.get("status").getAsString().equals("unknown")||value.has("errorCode")&&value.get("errorCode").getAsString().contains("UNKNOWN");
            if(terminal){row.addProperty("status",unknown?"unknown":success?"completed":"blocked");row.addProperty("completed",success&&!unknown);row.addProperty("reason",unknown?"service_result_unknown_query_original_request":success?"service_receipt_received":"service_refused");row.add("serviceReceipt",value);}
        }catch(Exception notStructured){/* Human prose is evidence, never proof of success. */}
        persist(id,request,row);
    }
    private static Path file(UUID id,UUID request){return plugin().getDataFolder().toPath().resolve("resident-cli").resolve(id.toString()).resolve(request+".json");}
    private static void persist(UUID id,UUID request,JsonObject row){try{var file=file(id,request);Files.createDirectories(file.getParent());var tmp=Files.createTempFile(file.getParent(),"receipt-",".tmp");Files.writeString(tmp,row.toString());Files.move(tmp,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);}catch(Exception e){row.addProperty("status","unknown");row.addProperty("completed",false);row.addProperty("reason","receipt_storage_unavailable_no_replay");}}
    public static String query(UUID id,UUID request)throws Exception{
        if(!Bukkit.isPrimaryThread()||!isResident(id))throw new IllegalArgumentException("resident_identity_required");
        JsonObject row=results.get(key(id,request));
        if(row==null&&Files.exists(file(id,request))){row=JsonParser.parseString(Files.readString(file(id,request))).getAsJsonObject();if(row.get("status").getAsString().equals("accepted")){row.addProperty("status","unknown");row.addProperty("reason","interrupted_query_service_state_do_not_replay");}}
        return row==null?"{\"status\":\"not_found\",\"completed\":false}":row.toString();
    }
    public static String run(UUID id,UUID request,String command)throws Exception{
        if(!Bukkit.isPrimaryThread()||!isResident(id))throw new IllegalArgumentException("resident_identity_required");
        if(command==null||command.length()>3500||command.codePoints().anyMatch(Character::isISOControl))throw new IllegalArgumentException("cli_command_invalid");
        String prior=query(id,request);var previous=JsonParser.parseString(prior).getAsJsonObject();
        if(!previous.get("status").getAsString().equals("not_found")){
            if(!previous.get("command").getAsString().equals(command))throw new IllegalArgumentException("request_id_conflict");
            return prior;
        }
        UUID active=requests.get(id);
        if(active!=null&&Set.of("accepted","unknown").contains(JsonParser.parseString(query(id,active)).getAsJsonObject().get("status").getAsString()))throw new IllegalArgumentException("body_service_pending_query_original_request");
        String[] args=command.strip().split(" +");
        boolean supported=args.length>=2&&(args[0].equals("archive")&&ARCHIVE.contains(args[1])||args[0].equals("photo")&&PHOTO.contains(args[1]));
        if(!supported)throw new IllegalArgumentException("cli_actor_adapter_not_available_read_resident_actions");
        if(command.contains("--request-id"))throw new IllegalArgumentException("request_id_is_supplied_by_body_executor");
        var player=find(id);if(player==null)throw new IllegalArgumentException("resident_body_unavailable");
        var row=new JsonObject();row.addProperty("maidId",id.toString());row.addProperty("requestId",request.toString());row.addProperty("status","accepted");row.addProperty("completed",false);row.addProperty("reason","waiting_service_receipt");row.addProperty("command",command);row.add("messages",new JsonArray());
        results.put(key(id,request),row);requests.put(id,request);commands.put(key(id,request),command);persist(id,request,row);
        if(row.get("status").getAsString().equals("unknown"))return row.toString();
        if(args[0].equals("archive"))plugin().archives().command(player,(command+" --json"+(Set.of("create","restore").contains(args[1])?" --request-id "+request:"")).split(" +"));
        else plugin().residentPhoto(player,args);
        return row.toString();
    }
}
