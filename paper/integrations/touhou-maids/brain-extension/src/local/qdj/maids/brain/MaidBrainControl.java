package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.ai.agent.tool.*;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.LLMCallback;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.site.AvailableSites;
import com.github.tartaricacid.touhoulittlemaid.ai.service.*;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.LLMClient;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.LLMSite;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.openai.LLMOpenAISite;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.openai.request.ChatCompletion;
import com.github.tartaricacid.touhoulittlemaid.ai.service.function.schema.parameter.*;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.mojang.serialization.Codec;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.*;

/** Small common-side hook installed at the original TLM extension lifecycle. */
public final class MaidBrainControl {
    private record Handler(UUID lease,boolean active,Predicate<LLMCallback> verify,BiConsumer<LLMCallback,LLMCallback> carry){}
    private static final Map<UUID,Handler> handlers=new ConcurrentHashMap<>();
    private record SiteHandler(UUID lease,UUID maid,Function<LLMOpenAISite,LLMClient> factory){}
    private static final Map<String,SiteHandler> sites=new ConcurrentHashMap<>();
    private static final Handler CLOSED=new Handler(new UUID(0,0),false,callback->false,(before,after)->{});
    private MaidBrainControl(){}
    public static final class Registration implements AutoCloseable {
        private final UUID maid,lease;private final Set<String> siteIds;
        private Registration(UUID maid,UUID lease,Set<String> siteIds){this.maid=maid;this.lease=lease;this.siteIds=siteIds;}
        @Override public void close(){
            handlers.computeIfPresent(maid,(id,current)->current.lease.equals(lease)?CLOSED:current);
            for(String id:siteIds)sites.computeIfPresent(id,(key,current)->current.lease.equals(lease)?new SiteHandler(lease,maid,site->callback->callback.onFailure(null,new IllegalStateException("MAID_BRAIN_STOPPED"),503)):current);
        }
    }
    public static synchronized Registration bind(UUID maid,Set<String> siteIds,Function<LLMOpenAISite,LLMClient> factory,Predicate<LLMCallback> verify,BiConsumer<LLMCallback,LLMCallback> carry){
        if(ToolRegister.getAllTools().isEmpty()||ToolRegister.getAllTools().values().stream().anyMatch(tool->!(tool instanceof Guarded<?>)))throw new IllegalStateException("Original TLM tools were not wrapped at common setup");
        if(siteIds.isEmpty()||siteIds.stream().anyMatch(id->!(AvailableSites.getLLMSite(id) instanceof HookedSite)))throw new IllegalStateException("Original OpenAI sites were not wrapped at common setup");
        if(siteIds.stream().anyMatch(sites::containsKey))throw new IllegalStateException("This model site already belongs to a maid controller");
        UUID lease=UUID.randomUUID();Handler handler=new Handler(lease,true,verify,carry);
        handlers.compute(maid,(id,old)->{if(old!=null&&old.active)throw new IllegalStateException("This maid already has a brain controller");return handler;});
        for(String id:siteIds)sites.put(id,new SiteHandler(lease,maid,factory));
        return new Registration(maid,lease,Set.copyOf(siteIds));
    }
    public static boolean isRoutedSite(String id,UUID maid){SiteHandler hook=sites.get(id);return hook!=null&&hook.maid.equals(maid);}
    static void registerSites(SerializerRegister register){
        SerializableSite<LLMSite> original=SerializerRegister.getLLMSerializer("openai");
        register.register(ServiceType.LLM,"openai",new SerializableSite<LLMSite>(){
            @Override public Codec<LLMSite> codec(){return original.codec().xmap(site->site instanceof LLMOpenAISite openai?new HookedSite(openai):site,site->site instanceof HookedSite hooked?hooked.original:site);}
            @Override public LLMSite defaultSite(){return original.defaultSite();}
            @Override public void writeToNetwork(LLMSite site,net.minecraft.network.FriendlyByteBuf buffer){
                // Keep the ordinary OpenAI wire type without distributing a server key.
                if(site instanceof HookedSite hooked){LLMOpenAISite row=hooked.original;original.writeToNetwork(new LLMOpenAISite(row.id(),row.icon(),row.url(),row.enabled(),"",row.hasThinkingField(),Map.of(),row.modelEntries()),buffer);}
                else original.writeToNetwork(site,buffer);
            }
        });
    }
    private static final class HookedSite extends LLMOpenAISite {
        final LLMOpenAISite original;
        HookedSite(LLMOpenAISite original){super(original.id(),original.icon(),original.url(),original.enabled(),original.secretKey(),original.hasThinkingField(),original.headers(),original.modelEntries());this.original=original;}
        @Override public LLMClient client(){SiteHandler hook=sites.get(id());return hook==null?original.client():hook.factory.apply(this);}
    }
    static void register(ToolRegister register){
        for(ITool<?> tool:new ArrayList<>(ToolRegister.getAllTools().values()))register.register(wrap(tool));
    }
    private static <T> ITool<T> wrap(ITool<T> original){return new Guarded<>(original);}
    private static final class Guarded<T> implements ITool<T> {
        private final ITool<T> original;
        Guarded(ITool<T> original){this.original=original;}
        @Override public String id(){return original.id();}
        @Override public String summary(EntityMaid maid){return original.summary(maid);}
        @Override public Parameter parameters(ObjectParameter root,EntityMaid maid){return original.parameters(root,maid);}
        @Override public Codec<T> codec(){return original.codec();}
        @Override public String invocationSummary(T value){return original.invocationSummary(value);}
        @Override public net.minecraft.network.chat.Component invocationSummaryComponent(T value){return original.invocationSummaryComponent(value);}
        @Override public boolean trigger(EntityMaid maid,ChatCompletion completion){return original.trigger(maid,completion);}
        private Handler handler(LLMCallback callback){return handlers.get(callback.getMaid().getUUID());}
        private boolean valid(Handler handler,LLMCallback callback){return handler==null||handler.verify.test(callback);}
        private LLMCallback denied(String id,LLMCallback callback){return callback.addToolResult(id,"MAID_BRAIN_CHANGED: old action was not executed. Read current brain selection and original receipt; do not replay it.");}
        @Override public LLMCallback onCall(String id,T value,LLMCallback callback){
            Handler handler=handler(callback);if(!valid(handler,callback))return denied(id,callback);
            LLMCallback next=original.onCall(id,value,callback);if(handler!=null)handler.carry.accept(callback,next);return next;
        }
        @Override public CompletableFuture<LLMCallback> onCallAsync(String id,T value,LLMCallback callback,LLMClient client){
            CompletableFuture<LLMCallback> result=new CompletableFuture<>();
            callback.runOnServerThread(()->{
                Handler handler=handler(callback);if(!valid(handler,callback)){result.complete(denied(id,callback));return;}
                try{original.onCallAsync(id,value,callback,client).whenComplete((next,error)->{if(error!=null)result.completeExceptionally(error);else{if(handler!=null)handler.carry.accept(callback,next);result.complete(next);}});}
                catch(Throwable error){result.completeExceptionally(error);}
            });return result;
        }
    }
}
