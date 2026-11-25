package org.afuhome.agentfriend;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.plugin.Plugin;

/** Original legacy points are frozen once, then credited by the original native UUID/snapshot API.
 * Queries never prepare, grant or confirm. No offline/fake Player is manufactured.
 */
final class LegacyPointTransfers implements Listener {
    static final String ROOT="legacyPointTransfersV1", VERSION="legacy-points-v1";
    private final AgentFriendPlugin plugin;
    private final ProfessionLedger ledger;
    // A transfer operation journal, not another spendable balance or task/progression ledger.
    private final ProfessionLedger journal;
    private final Set<UUID> running=new HashSet<>();
    private boolean enabled;
    LegacyPointTransfers(AgentFriendPlugin plugin) {
        this.plugin=plugin;this.ledger=plugin.professions().ledger;
        journal=new ProfessionLedger(plugin.getDataFolder().toPath().resolve("legacy-point-transfers.json"));
    }
    private static String hash(String value) {
        try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));}
        catch(java.security.NoSuchAlgorithmException impossible){throw new AssertionError(impossible);}
    }
    static String transferId(UUID actor,String sourceHash) {return VERSION+":"+hash(VERSION+"\n"+actor+"\n"+sourceHash);}
    private JsonObject book() {JsonObject data=journal.data();return data.has(ROOT)?data.getAsJsonObject(ROOT):new JsonObject();}
    private JsonObject record(UUID actor) {
        JsonObject book=book();if(!book.has("records")||!book.get("records").isJsonObject()||!book.getAsJsonObject("records").has(actor.toString()))return null;
        try {
            JsonObject row=book.getAsJsonObject("records").getAsJsonObject(actor.toString()).deepCopy();
            if(TaskJournalModel.text(row,"state","").equals("rejected"))return row;
            int earned=row.get("earned").getAsBigDecimal().intValueExact(),spent=row.get("spent").getAsBigDecimal().intValueExact();
            String sourceHash=row.get("sourceHash").getAsString();
            if(earned<0||spent<0||!sourceHash.matches("[0-9a-f]{64}")||row.get("amount").getAsLong()!=Math.max((long)earned-spent,0)
                    ||!row.get("transferId").getAsString().equals(transferId(actor,sourceHash)))throw new IllegalArgumentException("source_receipt_invalid");
            return row;
        } catch(RuntimeException invalid) {JsonObject rejected=new JsonObject();rejected.addProperty("state","rejected");rejected.addProperty("reason","source_record_invalid");return rejected;}
    }
    static JsonObject freeze(JsonObject players,long now) {
        JsonObject book=new JsonObject(),records=new JsonObject();book.addProperty("version",VERSION);book.addProperty("ratio","1:1");book.addProperty("frozenAt",now);
        for(var entry:players.entrySet()) {
            UUID actor=UUID.fromString(entry.getKey());JsonObject profile=entry.getValue().getAsJsonObject();
            if(!profile.has("points")||!profile.get("points").isJsonObject())continue;
            JsonObject points=profile.getAsJsonObject("points");
            if(!points.has("earned")||!points.has("spent"))continue;
            JsonObject row=new JsonObject();long earned,spent;
            try {earned=points.get("earned").getAsBigDecimal().longValueExact();spent=points.get("spent").getAsBigDecimal().longValueExact();}
            catch(RuntimeException invalid){row.addProperty("state","rejected");row.addProperty("reason","invalid_legacy_points");records.add(actor.toString(),row);continue;}
            if(earned<0||spent<0||earned>Integer.MAX_VALUE||spent>Integer.MAX_VALUE){row.addProperty("state","rejected");row.addProperty("reason","invalid_legacy_points");records.add(actor.toString(),row);continue;}
            JsonObject original=profile.deepCopy();original.remove("pointMigration");original.remove("legacyPointTransfer");
            String sourceHash=hash(original.toString());
            row.addProperty("earned",earned);row.addProperty("spent",spent);row.addProperty("amount",Math.max(earned-spent,0));
            row.addProperty("sourceHash",sourceHash);row.addProperty("transferId",transferId(actor,sourceHash));row.addProperty("state","eligible");records.add(actor.toString(),row);
        }
        book.add("records",records);return book;
    }
    static boolean freezeSource(ProfessionLedger source,ProfessionLedger target) {
        if(!source.ready()||!target.ready())return false;
        if(target.data().has(ROOT))return true;
        JsonObject frozen=freeze(source.data().getAsJsonObject("players"),System.currentTimeMillis());
        return target.write(data->{if(!data.has(ROOT))data.add(ROOT,frozen.deepCopy());});
    }
    void start() {
        if(!plugin.nativeRpg().selected()||!ledger.ready()||!journal.ready())return;
        // Legacy skills remain read-only. Durable transfer intent is isolated from that source file.
        try {if(!freezeSource(ledger,journal)){plugin.getLogger().warning("Legacy point roster freeze unconfirmed; no native credit dispatched");return;}}
        catch(RuntimeException malformed){plugin.getLogger().warning("Legacy point source malformed; original records preserved, no native credit dispatched");return;}
        JsonObject savedBook=book();
        if(!VERSION.equals(TaskJournalModel.text(savedBook,"version",""))||!"1:1".equals(TaskJournalModel.text(savedBook,"ratio",""))||!savedBook.has("records")) {
            plugin.getLogger().warning("Legacy point roster version invalid; no native credit dispatched");return;
        }
        enabled=true;Bukkit.getPluginManager().registerEvents(this,plugin);
        for(Player p:Bukkit.getOnlinePlayers())schedule(p,0);
    }
    @EventHandler(priority=EventPriority.MONITOR) public void joined(PlayerJoinEvent event) {schedule(event.getPlayer(),0);}
    private void schedule(Player player,int attempt) {
        Bukkit.getScheduler().runTaskLater(plugin,()->{
            if(!enabled||!player.isOnline()||Bukkit.getPlayer(player.getUniqueId())!=player||record(player.getUniqueId())==null)return;
            JsonObject original=record(player.getUniqueId());
            if(Set.of("confirmed","rejected").contains(TaskJournalModel.text(original,"state","")))return;
            JsonObject nativeState=plugin.nativeRpg().professionOverview(player);
            if(!TaskJournalModel.flag(nativeState,"available")||!TaskJournalModel.flag(nativeState,"classSelected")||!plugin.nativeRpgMayAct(player)) {
                if(attempt<12)schedule(player,attempt+1);return;
            }
            migrate(player,false);
        },attempt==0?20L:100L);
    }
    JsonObject state(Player player) {
        JsonObject out=new JsonObject();out.addProperty("queryOnly",true);out.addProperty("ratio","1:1");out.addProperty("available",enabled&&ledger.ready()&&journal.ready());
        JsonObject row=record(player.getUniqueId());out.addProperty("eligible",row!=null);
        if(row==null){out.addProperty("state","not_legacy");out.addProperty("nextCommand","/mycli profession");return out;}
        for(String key:List.of("state","reason","amount","transferId","targetConfirmed","confirmedAt"))if(row.has(key))out.add(key,row.get(key).deepCopy());
        out.addProperty("sourcePreserved",true);out.addProperty("nextCommand",TaskJournalModel.text(row,"state","").equals("confirmed")?"/mycli profession":"/mycli profession migrate");return out;
    }
    private Plugin nativeBridge() {
        Plugin bridge=Bukkit.getPluginManager().getPlugin("QiandengjiRpg");
        if(bridge==null||!bridge.isEnabled())throw new IllegalStateException("native_bridge_unavailable");return bridge;
    }
    private boolean saveState(UUID actor,JsonObject original,String state,JsonObject confirmation) {
        return journal.write(data->{
            JsonObject row=data.getAsJsonObject(ROOT).getAsJsonObject("records").getAsJsonObject(actor.toString());
            if(!row.get("transferId").equals(original.get("transferId"))||!row.get("sourceHash").equals(original.get("sourceHash")))throw new IllegalStateException("source_intent_changed");
            row.addProperty("state",state);
            if(confirmation!=null){row.add("nativeReceipt",confirmation.deepCopy());row.addProperty("targetConfirmed",confirmation.get("confirmed").getAsBoolean());if(state.equals("confirmed"))row.addProperty("confirmedAt",System.currentTimeMillis());}
        });
    }
    static boolean confirmation(JsonObject source,JsonObject result) {
        if(!TaskJournalModel.flag(result,"confirmed"))return false;
        for(String key:List.of("earned","spent","amount","sourceHash","transferId"))if(!Objects.equals(source.get(key),result.get(key)))return false;
        return VERSION.equals(TaskJournalModel.text(result,"version",""))&&"1:1".equals(TaskJournalModel.text(result,"ratio",""));
    }
    @SuppressWarnings("unchecked")
    void migrate(Player player,boolean json) {
        UUID actor=player.getUniqueId();JsonObject source=record(actor);
        if(!enabled||source==null||source.get("state").getAsString().equals("rejected")||running.contains(actor)) {reply(player,"source_not_ready_or_pending",false,json);return;}
        if(source.get("state").getAsString().equals("confirmed")){reply(player,"already_confirmed",true,json);return;}
        if(Bukkit.getPlayer(actor)!=player||!plugin.nativeRpgMayAct(player)){reply(player,"original_online_actor_required",false,json);return;}
        JsonObject current=plugin.nativeRpg().professionOverview(player);
        if(!TaskJournalModel.flag(current,"available")||!TaskJournalModel.flag(current,"classSelected")){reply(player,"profile_or_class_required",false,json);return;}
        try {
            Plugin bridge=nativeBridge();
            var idMethod=bridge.getClass().getMethod("legacyPointsTransferId",Player.class,String.class);
            var method=bridge.getClass().getMethod("migrateLegacyPoints",Player.class,int.class,int.class,String.class,String.class);
            String actual=(String)idMethod.invoke(bridge,player,source.get("sourceHash").getAsString());
            if(!actual.equals(source.get("transferId").getAsString()))throw new IllegalStateException("native_transfer_contract_mismatch");
            if(!source.get("state").getAsString().equals("intent")&&!saveState(actor,source,"intent",null)){reply(player,"source_intent_unconfirmed",false,json);return;}
            running.add(actor);
            CompletableFuture<JsonObject> future=(CompletableFuture<JsonObject>)method.invoke(bridge,player,source.get("earned").getAsInt(),source.get("spent").getAsInt(),source.get("sourceHash").getAsString(),actual);
            future.whenComplete((result,error)->{
                Runnable finish=()->{
                    running.remove(actor);
                    if(!enabled)return;
                    boolean target=error==null&&result!=null&&confirmation(source,result);
                    boolean complete=target&&saveState(actor,source,"confirmed",result);
                    String reason=complete?"confirmed":target?"target_confirmed_source_pending":error!=null?"native_save_unknown":result==null?"native_reply_unknown":TaskJournalModel.text(result,"reason","native_save_unknown");
                    if(player.isOnline())reply(player,reason,complete,json);
                };
                if(Bukkit.isPrimaryThread())finish.run();else if(plugin.isEnabled())Bukkit.getScheduler().runTask(plugin,finish);
            });
        } catch(ReflectiveOperationException|RuntimeException error) {
            running.remove(actor);reply(player,"migration_dispatch_or_save_unconfirmed",false,json);
        }
    }
    private void reply(Player p,String reason,boolean confirmed,boolean json) {
        JsonObject out=state(p);out.addProperty("reason",reason);out.addProperty("confirmed",confirmed);out.addProperty("pending",!confirmed);out.addProperty("readOnly",false);
        if(json){plugin.communication().stamp(p,out);p.sendMessage("MC_POINT_MIGRATION "+out);return;}
        p.sendMessage(confirmed?"§a旧未花技能点已按1:1迁入本人Vortex学习点；原余额和技能历史保留，不会重复发点。":"§e旧点数迁移尚未确认："+reason+"；原余额保留。查询 /mycli profession，按原迁移编号对账，不重复发放。");
    }
    void shutdown(){enabled=false;running.clear();}
}
