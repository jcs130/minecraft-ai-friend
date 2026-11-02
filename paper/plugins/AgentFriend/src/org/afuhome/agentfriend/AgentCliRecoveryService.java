package org.afuhome.agentfriend;

import com.google.gson.*;
import java.net.URI;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import org.bukkit.entity.Player;

/** Private advice only. Optional vector lookup has one bounded background worker and no action dispatcher. */
final class AgentCliRecoveryService implements AutoCloseable {
    private final AgentFriendPlugin plugin;
    private final List<AgentCliRecovery.Card> baseCards;
    private List<AgentCliRecovery.Card> cards;
    private long checkedCards;
    private final ConcurrentHashMap<UUID,Long> requests=new ConcurrentHashMap<>();
    private final AtomicLong serial=new AtomicLong();
    private final LinkedHashMap<UUID,Long> lastLookup=new LinkedHashMap<>();
    private final CommandEmbeddingIndex embeddings;
    private final ThreadPoolExecutor worker;
    private volatile boolean closed;
    private volatile String semanticState="disabled";
    AgentCliRecoveryService(AgentFriendPlugin plugin){
        this.plugin=plugin;baseCards=AgentCliCatalog.recoveryCards(plugin.nativeRpg().selected());cards=baseCards;
        AgentCliRecovery.warm(cards);
        CommandEmbeddingIndex index=null;ThreadPoolExecutor executor=null;
        if(plugin.getConfig().getBoolean("cli-recovery.embeddings.enabled",false)){
            try{
                String env=plugin.getConfig().getString("cli-recovery.embeddings.api-key-env","");
                if(!env.matches("[A-Z0-9_]{0,80}"))throw new IllegalArgumentException();
                if(!env.isEmpty()&&(System.getenv(env)==null||System.getenv(env).isBlank()))throw new IllegalArgumentException();
                index=new CommandEmbeddingIndex(URI.create(plugin.getConfig().getString("cli-recovery.embeddings.endpoint","")),plugin.getConfig().getString("cli-recovery.embeddings.model",""),env.isEmpty()?"":System.getenv(env),plugin.getConfig().getInt("cli-recovery.embeddings.timeout-ms",1500));
                executor=new ThreadPoolExecutor(1,1,10,TimeUnit.SECONDS,new ArrayBlockingQueue<>(4),task->{Thread t=new Thread(task,"mycli-command-advice");t.setDaemon(true);return t;},new ThreadPoolExecutor.AbortPolicy());
                executor.allowCoreThreadTimeOut(true);semanticState="not_warmed";
            }catch(RuntimeException invalid){if(index!=null)index.close();index=null;semanticState="configuration_unavailable";plugin.getLogger().warning("CLI向量建议配置无效，保留本地目录建议；未启用额外模型服务。");}
        }
        embeddings=index;worker=executor;
    }
    void observe(Player player){
        if(requests.size()>128)requests.clear();requests.put(player.getUniqueId(),serial.incrementAndGet());
    }
    void forget(Player player){requests.remove(player.getUniqueId());lastLookup.remove(player.getUniqueId());}
    private List<AgentCliRecovery.Card> currentCards(){
        long now=System.currentTimeMillis();if(now-checkedCards<1000)return cards;
        var entries=new LinkedHashMap<String,AgentCliRecovery.Card>();for(var card:baseCards)entries.put(card.id(),card);
        for(var card:plugin.nativeRpg().adviceCards())if(entries.size()<512)entries.putIfAbsent(card.id(),card);
        cards=List.copyOf(entries.values());checkedCards=now;AgentCliRecovery.warm(cards);return cards;
    }
    private AgentCliRecovery.Context context(Player player){
        Set<String> online=new HashSet<>();
        for(Player other:plugin.getServer().getOnlinePlayers())if(player.canSee(other))online.add(other.getName());
        return new AgentCliRecovery.Context(plugin.siteDungeons().configuredSiteIds(),online);
    }
    void reject(Player player,String[] raw,String code,String message){
        List<AgentCliRecovery.Card> cards=currentCards();
        var context=context(player);var matches=AgentCliRecovery.suggest(raw,cards,context);
        var out=AgentCliRecovery.payload(matches,cards,code,message);out.addProperty("semanticLookup",semanticState);
        out.addProperty("scope","self");out.addProperty("playerUuid",player.getUniqueId().toString());
        plugin.communication().stamp(player,out);
        if(Arrays.asList(raw).contains("--json"))player.sendMessage("MC_CLI_ERROR "+out);
        else AgentCliRecovery.text(out).forEach(player::sendMessage);
        supplement(player,raw,context,matches,cards);
    }
    boolean rejectMisplacedCast(Player player,String[] raw){
        if(AgentCliRecovery.misplacedCast(raw,currentCards(),context(player)).isEmpty())return false;
        reject(player,raw,"COMMAND_ROUTE_MISMATCH","这项操作使用专用命令入口，请勿放进cast施法参数；按下面用法发送聊天命令");
        return true;
    }
    void enrich(Player player,String[] raw,JsonObject out){
        List<AgentCliRecovery.Card> cards=currentCards();
        var context=context(player);var matches=AgentCliRecovery.suggest(raw,cards,context);
        String code=out.has("reason")?out.get("reason").getAsString():"INVALID_ARGUMENT";
        JsonObject advice=AgentCliRecovery.payload(matches,cards,code,"参数或入口不匹配");
        for(String key:List.of("suggestions","catalogRevision","autoExecute","retryPolicy"))out.add(key,advice.get(key));
        out.addProperty("semanticLookup",semanticState);
        out.addProperty("scope","self");out.addProperty("playerUuid",player.getUniqueId().toString());
        if(!out.has("nextCommand")||!matches.isEmpty()&&matches.getFirst().method().startsWith("confirmed_"))out.add("nextCommand",advice.get("nextCommand"));
        supplement(player,raw,context,matches,cards);
    }
    void plain(JsonObject out,Player player){
        var suggestions=out.getAsJsonArray("suggestions");
        if(suggestions!=null&&!suggestions.isEmpty()){
            var first=suggestions.get(0).getAsJsonObject();player.sendMessage("建议用法："+first.get("usage").getAsString()+"；"+first.get("summary").getAsString()+"；条件："+first.get("requirements").getAsString());
        }
        player.sendMessage("下一步："+out.get("nextCommand").getAsString()+"；请核对后自行执行。");
    }
    private void supplement(Player player,String[] raw,AgentCliRecovery.Context context,List<AgentCliRecovery.Match> local,List<AgentCliRecovery.Card> cards){
        if(embeddings==null||closed||AgentCliRecovery.semanticQuery(raw,context).isEmpty()||!local.isEmpty()&&(local.getFirst().method().startsWith("confirmed_")||local.getFirst().method().equals("misplaced_cast_prefix")))return;
        UUID id=player.getUniqueId();long now=System.currentTimeMillis();
        if(now-lastLookup.getOrDefault(id,0L)<10_000)return;
        while(lastLookup.size()>=128)lastLookup.remove(lastLookup.keySet().iterator().next());lastLookup.put(id,now);
        long request=requests.getOrDefault(id,0L);String[] input=raw.clone();
        try{worker.execute(()->{
            try{
                if(closed||requests.getOrDefault(id,-1L)!=request)return;
                semanticState="warming";var matches=embeddings.lookup(input,cards,context);semanticState="ready";
                if(matches.isEmpty()||!local.isEmpty()&&matches.getFirst().card().id().equals(local.getFirst().card().id())||closed||requests.getOrDefault(id,-1L)!=request)return;
                var out=AgentCliRecovery.payload(matches,cards,"COMMAND_SUGGESTION","语义检索找到了当前目录中的相近用法，请核对目标和条件");out.addProperty("semanticLookup","ready");
                out.addProperty("scope","self");out.addProperty("playerUuid",id.toString());
                if(!closed)plugin.getServer().getScheduler().runTask(plugin,()->{
                    if(closed||!player.isOnline()||requests.getOrDefault(id,-1L)!=request||!AgentCliRecovery.revision(cards).equals(AgentCliRecovery.revision(currentCards())))return;
                    plugin.communication().stamp(player,out);
                    if(Arrays.asList(input).contains("--json"))player.sendMessage("MC_CLI_ERROR "+out);else AgentCliRecovery.text(out).forEach(player::sendMessage);
                });
            }catch(Exception unavailable){semanticState="unavailable_local_advice_preserved";}
        });}catch(RejectedExecutionException busy){semanticState="busy_local_advice_preserved";}
    }
    @Override public void close(){closed=true;if(worker!=null)worker.shutdownNow();if(embeddings!=null)embeddings.close();requests.clear();lastLookup.clear();}
}
