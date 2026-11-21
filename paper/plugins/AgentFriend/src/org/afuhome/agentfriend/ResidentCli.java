package org.afuhome.agentfriend;

import com.google.gson.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.entity.*;
import org.bukkit.inventory.*;

/** Ordinary services over a resident's own body. No connection, OP or console impersonation. */
public final class ResidentCli {
    private static final Map<UUID,Player> actors=new HashMap<>();
    private static final Map<UUID,UUID> requests=new HashMap<>();
    private static final Map<String,JsonObject> results=new LinkedHashMap<>();
    private static final Map<String,String> commands=new HashMap<>();
    private static final Set<UUID> dispatching=new HashSet<>();
    private static String key(UUID id,UUID request){return id+"/"+request;}
    static UUID currentRequest(UUID id){return dispatching.contains(id)?requests.get(id):null;}
    private static final Set<String> ARCHIVE=Set.of("status","list","mine","info","read","create","restore");
    private static final Set<String> PHOTO=Set.of("take","status","cancel","album","info","title","story","exhibit","withdraw");
    private static boolean supported(String[] a){
        if(a.length==1&&a[0].equals("status"))return true;
        if(a.length<2)return false;
        return switch(a[0]){
            case "cast" -> a.length==2&&a[1].matches("[a-z0-9_]{1,48}");
            case "profession" -> a.length==2&&a[1].equals("list")||a.length==3&&Set.of("info","choose").contains(a[1]);
            case "skills" -> a.length==2&&Set.of("list","tree","points").contains(a[1])||a.length==3&&Set.of("info","learn","prepare").contains(a[1]);
            case "archive" -> ARCHIVE.contains(a[1]); case "photo" -> PHOTO.contains(a[1]);
            case "inventory" -> InventoryBatch.supports(a);
            case "tasks" -> Set.of("list","info","status").contains(a[1]);
            case "dungeon" -> Set.of("list","info","status","travel","start","join","resume","leave","claim").contains(a[1]);
            case "land" -> a.length==2&&a[1].equals("here")
                ||a[1].equals("list")&&(a.length==2||a.length==3&&a[2].matches("[1-9][0-9]{0,3}"))
                ||a.length==3&&Set.of("info","members").contains(a[1])
                ||a.length==4&&(Set.of("trust","untrust").contains(a[1])||a[1].equals("members")&&a[3].matches("[1-9][0-9]{0,3}"));
            case "guild" -> Set.of("join","board","status","accept","abandon","claim","verify").contains(a[1])
                && (a[1].equals("accept")?a.length==3&&a[2].matches("[a-z0-9_.:-]{1,100}")
                    :a[1].equals("board")?a.length==2||a.length==3&&a[2].matches("[1-9][0-9]{0,3}"):a.length==2);
            case "arena" -> a.length==2&&Set.of("start","leave","status","entrance","wallet").contains(a[1]) || a.length>=3&&(a[1].equals("recycle")&&Set.of("list","quote","sell","status").contains(a[2])
                ||a[1].equals("shop")&&Set.of("list","buy").contains(a[2])
                ||a[1].equals("stash")&&Set.of("list","inventory","summary","collect","take","putslot").contains(a[2]));
            default -> false;
        };
    }
    private static AgentFriendPlugin plugin(){return (AgentFriendPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend");}
    static Object nativeCall(String name,Class<?>[] types,Object... args)throws ReflectiveOperationException {
        try{return Class.forName("local.qdj.maids.brain.ResidentBodyAccess").getMethod(name,types).invoke(null,args);}
        catch(InvocationTargetException e){if(e.getCause() instanceof RuntimeException r)throw r;throw e;}
    }
    public static boolean isResident(UUID id){return NativeResidentIdentities.all().containsKey(id);}
    public static Player residentPlayer(UUID id){if(!isResident(id))throw new IllegalArgumentException("native_resident_required");return find(id);}
    /** Shared targeting gate, including authored dungeon membership; actual damage events still decide land permissions. */
    public static boolean mayTarget(UUID id,UUID targetId){
        var actor=find(id);var target=Bukkit.getEntity(targetId);
        if(actor==null||!isResident(id)||!(target instanceof LivingEntity living)||living.isDead()||living.isInvulnerable()
            ||target.hasMetadata("NPC")||target instanceof Player||isResident(targetId)||target instanceof Tameable
            ||!plugin().nativeRpgMayAct(actor))return false;
        if(target.getScoreboardTags().contains("afu_dungeon_mob")||target.getScoreboardTags().contains("afu_site_dungeon")
            ||target.getPersistentDataContainer().getKeys().stream().anyMatch(k->k.toString().equals("vortexrpg:dungeon_instance_id")))
            return CompanionTravelAccess.mayGuardDungeonTarget(actor,actual(actor),target);
        return true;
    }
    static Entity actual(Player p){if(!isResident(p.getUniqueId()))return p;try{return (Entity)nativeCall("entity",new Class[]{UUID.class},p.getUniqueId());}catch(Exception e){throw new IllegalStateException("resident_unavailable",e);}}
    static boolean mana(Player p,double amount,boolean spend){try{return Boolean.TRUE.equals(nativeCall("mana",new Class[]{UUID.class,double.class,boolean.class},p.getUniqueId(),amount,spend));}catch(Exception e){return false;}}
    static Player find(UUID id){var player=Bukkit.getPlayer(id);if(player!=null)return player;if(!isResident(id))return null;
        try{
            Object loaded=nativeCall("entity",new Class[]{UUID.class},id);
            if(!(loaded instanceof LivingEntity body)||!body.isValid()||body.isDead()||!body.hasAI())return null;
            return actors.computeIfAbsent(id,ResidentCli::actor);
        }catch(Exception missing){return null;}}
    static int storageSize(Player player){return isResident(player.getUniqueId())?player.getInventory().getSize():36;}
    static Player fromEntity(Entity entity){return entity==null?null:isResident(entity.getUniqueId())?find(entity.getUniqueId()):entity instanceof Player p?p:null;}
    static LivingEntity living(Player p){return (LivingEntity)actual(p);}
    static java.util.List<Player> online(){var result=new ArrayList<Player>(Bukkit.getOnlinePlayers());for(UUID id:NativeResidentIdentities.all().keySet()){var p=find(id);if(p!=null&&p.isOnline())result.add(p);}return result;}
    private static Player actor(UUID id){
        final Player[] self=new Player[1];
        PlayerInventory inventory=ResidentInventory.create(id,()->self[0]);
        self[0]=(Player)Proxy.newProxyInstance(ResidentCli.class.getClassLoader(),new Class[]{Player.class},(proxy,m,args)->{
            if(m.getDeclaringClass()==Object.class)return switch(m.getName()){case "toString"->"ResidentActor("+id+")";case "hashCode"->id.hashCode();case "equals"->proxy==args[0];default->null;};
            if(m.getName().equals("getUniqueId"))return id;
            if(m.getName().equals("getInventory"))return inventory;
            // The resident consumes private structured messages in-process, without a socket.
            if(m.getName().equals("getListeningPluginChannels"))return Bukkit.getMessenger().getOutgoingChannels(plugin());
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
            if(m.getName().equals("isOnline"))return body.isValid()&&!body.isDead()&&body.hasAI();
            if(m.getName().equals("getName")||m.getName().equals("getDisplayName"))return NativeResidentIdentities.all().get(id);
            if(m.getName().equals("getEyeLocation"))return body.getEyeLocation();
            if(m.getName().equals("hasLineOfSight")&&args[0]instanceof Entity target){var real=target instanceof Player p&&isResident(p.getUniqueId())?actual(p):target;return body.hasLineOfSight(real);}
            if(m.getName().equals("getFoodLevel"))return ((Number)nativeCall("hunger",new Class[]{UUID.class},id)).intValue();
            if(m.getName().equals("updateInventory")||m.getName().equals("closeInventory"))return null;
            if(m.getName().equals("saveData")){nativeCall("save",new Class[]{UUID.class},id);return null;}
            if(Set.of("sendTitle","resetTitle","sendActionBar","playSound","stopSound","sendExperienceChange").contains(m.getName()))return null;
            if(m.getName().equals("teleport")){
                var at=args[0]instanceof Location l?l:args[0]instanceof Entity e?e.getLocation():null;
                if(at==null||at.getWorld()==null||!ResidentTravelAccess.allowed(id,at.getWorld().getUID(),at.getX(),at.getY(),at.getZ()))return false;
                Object moved=m.invoke(body,args);if(Boolean.TRUE.equals(moved))nativeCall("arrived",new Class[]{UUID.class},id);return moved;
            }
            if(m.getDeclaringClass().isInstance(body))return m.invoke(body,args);
            throw new UnsupportedOperationException("resident_player_method:"+m.getName());
        });return self[0];
    }
    static void capture(UUID id,String text){
        String raw=text.startsWith("MC_")&&text.indexOf(' ')>0?text.substring(text.indexOf(' ')+1):text;
        boolean structured=raw.stripLeading().startsWith("{");
        // Formatting belongs to the game renderer, never to an identifier read by a model.
        // Preserve structured payloads (including authored book text) byte-for-byte.
        if(!structured)text=ChatColor.stripColor(text);
        UUID request=requests.get(id);var row=request==null?null:results.get(key(id,request));
        if(row==null||!dispatching.contains(id)&&!row.get("status").getAsString().equals("accepted")){
            // A later floor reward/chat notification must never rewrite a completed sale or photo receipt.
            if(text.length()<=2048)try{nativeCall("notice",new Class[]{UUID.class,String.class},id,text);}catch(Exception unavailable){plugin().getLogger().warning("Resident notice unavailable for "+id);}
            return;
        }
        var messages=row.getAsJsonArray("messages");
        if(!structured){
            if(messages.size()<16&&text.length()<=2048)messages.add(text);
            else {row.addProperty("messagesComplete",false);row.addProperty("omittedMessages",row.has("omittedMessages")?row.get("omittedMessages").getAsInt()+1:1);}
        }
        try{
            var value=JsonParser.parseString(raw).getAsJsonObject();String command=commands.getOrDefault(key(id,request),"");
            var receipts=row.getAsJsonArray("serviceReceipts");
            if(receipts==null){receipts=new JsonArray();row.add("serviceReceipts",receipts);}
            boolean duplicate=false;for(var existing:receipts)if(existing.equals(value)){duplicate=true;break;}
            if(!duplicate){
                int bytes=receipts.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length+raw.getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
                if(receipts.size()<64&&bytes<=65_536)receipts.add(value.deepCopy());
                else {row.addProperty("responseComplete",false);row.addProperty("partialReason","service_receipt_budget");row.addProperty("omittedReceipts",row.has("omittedReceipts")?row.get("omittedReceipts").getAsInt()+1:1);}
            }
            boolean terminal=false,success=false;
            if(command.startsWith("photo take")){
                String status=value.has("status")?value.get("status").getAsString():"";
                terminal=Set.of("success","denied","cancelled","stopped","expired","unknown").contains(status);success=status.equals("success");
            }else if(command.startsWith("inventory ")||command.startsWith("cast ")||command.startsWith("profession ")||command.startsWith("skills ")||command.startsWith("archive ")||command.startsWith("photo ")||command.startsWith("tasks ")||command.startsWith("arena ")||command.startsWith("dungeon ")||command.startsWith("land ")){
                terminal=true;success=!value.has("errorCode")&&(!value.has("success")||value.get("success").getAsBoolean());
                if(value.has("status")&&Set.of("denied","unavailable","error").contains(value.get("status").getAsString()))success=false;
            }
            boolean unchangedRefusal=value.has("success")&&!value.get("success").getAsBoolean()&&value.has("changed")&&!value.get("changed").getAsBoolean();
            boolean unknown=value.has("outcomeUnknown")&&value.get("outcomeUnknown").getAsBoolean()||value.has("status")&&value.get("status").getAsString().equals("unknown")||!unchangedRefusal&&value.has("errorCode")&&value.get("errorCode").getAsString().contains("UNKNOWN");
            if(value.has("pending")&&value.get("pending").getAsBoolean()&&value.has("reason")&&Set.of("recycle_pending","recycle_unverified","money_pending","money_unverified").contains(value.get("reason").getAsString()))unknown=true;
            if(terminal){row.addProperty("status",unknown?"unknown":success?"completed":"blocked");row.addProperty("completed",success&&!unknown);row.addProperty("reason",unknown?"service_result_unknown_query_original_request":success?"service_receipt_received":"service_refused");row.add("serviceReceipt",value);}
        }catch(Exception notStructured){/* Human prose is evidence, never proof of success. */}
        persist(id,request,row);
    }
    private static void finish(UUID id,UUID request,JsonObject evidence){
        var row=results.get(key(id,request));if(row==null)return;
        boolean success=evidence.has("success")&&evidence.get("success").getAsBoolean();
        if(!success&&Set.of("guild claim","guild verify").contains(commands.getOrDefault(key(id,request),""))&&row.has("serviceReceipts")){
            for(var raw:row.getAsJsonArray("serviceReceipts")){
                var detail=raw.getAsJsonObject();
                if(detail.has("type")&&detail.get("type").getAsString().equals("MC_MARKET_VERIFY")
                        &&detail.has("reason")&&Set.of("verification_throttled","verification_in_progress").contains(detail.get("reason").getAsString())){
                    for(String field:List.of("reason","retryable","retryAfterMs","nextSafeRead","changed"))
                        if(detail.has(field))evidence.add(field,detail.get(field).deepCopy());
                    evidence.addProperty("retryRequiresNewRequestId",true);
                }
            }
        }
        row.addProperty("status",success?"completed":"blocked");row.addProperty("completed",success);
        row.addProperty("reason",evidence.get("reason").getAsString());row.add("serviceReceipt",evidence);
        for(String field:List.of("retryable","retryAfterMs","nextSafeRead"))if(evidence.has(field))row.add(field,evidence.get(field).deepCopy());
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
    public static void acknowledgeUnknown(UUID id,UUID request,String note)throws Exception {
        if(!Bukkit.isPrimaryThread()||!isResident(id))throw new IllegalArgumentException("resident_identity_required");
        var row=JsonParser.parseString(query(id,request)).getAsJsonObject();
        if(row.get("status").getAsString().equals("not_found"))return; // Native failure before service dispatch.
        if(!Set.of("accepted","unknown").contains(row.get("status").getAsString()))return;
        if(note==null||note.strip().length()<8||note.length()>300||note.codePoints().anyMatch(Character::isISOControl))throw new IllegalArgumentException("inspection_note_required");
        var player=find(id);if(player==null)throw new IllegalArgumentException("resident_body_unavailable");
        var review=new JsonObject();review.addProperty("requestId",request.toString());review.addProperty("actorId",id.toString());
        review.addProperty("originalCompleted",false);review.addProperty("originalOutcome","unknown");review.addProperty("note",note);review.addProperty("observedAt",java.time.Instant.now().toString());
        review.add("inventory",ResidentStash.run(plugin(),player,new String[]{"arena","stash","inventory"}));
        review.addProperty("command",row.get("command").getAsString());
        var target=file(id,request).resolveSibling(request+".reconciliation.json");var temp=Files.createTempFile(target.getParent(),"review-",".tmp");
        Files.writeString(temp,review.toString());Files.move(temp,target,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
        // Original result stays unknown and an identical request never executes again.
    }
    private static boolean reconciled(UUID id,UUID request)throws Exception {
        var path=file(id,request).resolveSibling(request+".reconciliation.json");if(!Files.exists(path))return false;
        var row=JsonParser.parseString(Files.readString(path)).getAsJsonObject();return id.toString().equals(row.get("actorId").getAsString())&&request.toString().equals(row.get("requestId").getAsString())&&!row.get("originalCompleted").getAsBoolean();
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
        var activeFile=file(id,request).getParent().resolve("active.json");
        if(active==null&&Files.exists(activeFile))active=UUID.fromString(JsonParser.parseString(Files.readString(activeFile)).getAsJsonObject().get("requestId").getAsString());
        if(active!=null&&Set.of("accepted","unknown").contains(JsonParser.parseString(query(id,active)).getAsJsonObject().get("status").getAsString())&&!reconciled(id,active))throw new IllegalArgumentException("body_service_pending_query_original_request");
        String[] args=command.strip().split(" +");
        if(!supported(args))throw new IllegalArgumentException("cli_actor_adapter_not_available_read_resident_actions");
        if(command.contains("--request-id"))throw new IllegalArgumentException("request_id_is_supplied_by_body_executor");
        var player=find(id);if(player==null)throw new IllegalArgumentException("resident_body_unavailable");
        var row=new JsonObject();row.addProperty("maidId",id.toString());row.addProperty("requestId",request.toString());row.addProperty("status","accepted");row.addProperty("completed",false);row.addProperty("reason","waiting_service_receipt");row.addProperty("command",command);row.add("messages",new JsonArray());row.addProperty("responseComplete",true);
        var contract=JsonParser.parseString((String)nativeCall("cliContract",new Class[]{String.class},command)).getAsJsonObject();
        if(!contract.has("operationEffect")||contract.get("operationEffect").getAsString().equals("unknown"))throw new IllegalArgumentException("cli_effect_contract_unavailable_no_dispatch");
        for(var field:contract.entrySet())row.add(field.getKey(),field.getValue());
        if(results.size()>=256){var iterator=results.entrySet().iterator();while(results.size()>=256&&iterator.hasNext()){var old=iterator.next();if(!Set.of("accepted","unknown").contains(old.getValue().get("status").getAsString())){commands.remove(old.getKey());iterator.remove();}}}
        results.put(key(id,request),row);requests.put(id,request);commands.put(key(id,request),command);persist(id,request,row);
        if(row.get("status").getAsString().equals("unknown"))return row.toString();
        try{var fence=new JsonObject();fence.addProperty("requestId",request.toString());var temp=Files.createTempFile(activeFile.getParent(),"active-",".tmp");Files.writeString(temp,fence.toString());Files.move(temp,activeFile,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);}
        catch(Exception unavailable){row.addProperty("status","unknown");row.addProperty("reason","active_fence_unavailable_no_dispatch");persist(id,request,row);return row.toString();}
        dispatching.add(id);
        try{
            if(plugin().trialRescue()!=null&&plugin().trialRescue().blockCommand(player,args)){
                var denied=new JsonObject();denied.addProperty("success",false);denied.addProperty("reason","trial_downed_read_status_wait_for_rescue");finish(id,request,denied);return row.toString();
            }
            switch(args[0]){
                case "inventory" -> plugin().inventoryBatch(player,args);
                case "cast","profession","skills" -> {
                    var rpg=Bukkit.getPluginManager().getPlugin("QiandengjiRpg");if(rpg==null||!rpg.isEnabled())throw new IllegalStateException("native_rpg_unavailable");
                    ((org.bukkit.command.CommandExecutor)rpg).onCommand(player,((org.bukkit.plugin.java.JavaPlugin)rpg).getCommand("qdrpg"),"qdrpg",(command+" --json").split(" +"));
                }
                case "status" -> {var observed=JsonParser.parseString((String)nativeCall("status",new Class[]{UUID.class},id)).getAsJsonObject();observed.addProperty("success",true);observed.addProperty("queryOnly",true);observed.addProperty("reason","own_native_body_observed");finish(id,request,observed);}
                case "archive" -> plugin().archives().command(player,(command+" --json"+(Set.of("create","restore").contains(args[1])?" --request-id "+request:"")).split(" +"));
                case "photo" -> plugin().residentPhoto(player,args);
                case "guild" -> plugin().guild().residentCommand(player,args,evidence->finish(id,request,evidence));
                case "tasks" -> plugin().taskMarket().routes().command(player,(command+" --json").split(" +"));
                case "dungeon" -> plugin().siteDungeons().command(player,(command+" --json").split(" +"));
                case "land" -> plugin().lands().command(player,args);
                case "arena" -> {if(args[1].equals("stash")){finish(id,request,ResidentStash.run(plugin(),player,args));break;}
                    plugin().dungeon().command(player,args[1].equals("status")||args[1].equals("entrance")?(command+" --json").split(" +"):args);
                    if(Set.of("start","leave").contains(args[1])){var result=new JsonObject();boolean joined=plugin().dungeon().isParticipant(player);result.addProperty("success",args[1].equals("start")?joined:!joined);result.addProperty("participant",joined);result.addProperty("reason",args[1].equals("start")?(joined?"participant_enrolled":"enrollment_conditions_not_met"):(joined?"still_participating":"participant_left"));finish(id,request,result);}}
            }
        }catch(RuntimeException failure){
            // A service can fail after writing. Preserve the original request; never replay it.
            row.addProperty("status","unknown");row.addProperty("completed",false);row.addProperty("reason","service_exception_query_original_request");
            row.addProperty("failureType",failure.getClass().getSimpleName());persist(id,request,row);
            plugin().getLogger().log(java.util.logging.Level.WARNING,"Resident CLI failed for "+id+" request "+request,failure);
        }finally{
            dispatching.remove(id);
        }
        return row.toString();
    }
}
