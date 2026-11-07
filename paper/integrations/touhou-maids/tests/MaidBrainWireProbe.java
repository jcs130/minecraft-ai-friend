package local.tlmcompat.qa;

import com.github.tartaricacid.touhoulittlemaid.ai.manager.site.AvailableSites;
import com.github.tartaricacid.touhoulittlemaid.ai.service.SerializerRegister;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.openai.LLMOpenAISite;
import com.google.gson.*;
import io.netty.buffer.Unpooled;
import java.nio.file.*;
import java.util.UUID;
import net.minecraft.network.FriendlyByteBuf;
import org.bukkit.plugin.java.JavaPlugin;

/** Synthetic stage only. This probe never connects to a provider or changes an entity. */
public final class MaidBrainWireProbe extends JavaPlugin {
    @Override public void onEnable(){
        try{
            Path stage=Path.of(".").toRealPath();
            if(getServer().getPort()!=25938||!getServer().getIp().equals("127.0.0.1")||!Files.readString(stage.resolve(".maid-lifecycle-qa")).equals("FRESH_MAID_LIFECYCLE_QA_NO_PLAYER_DATA"))throw new IllegalStateException("Fresh loopback stage required");
            getCommand("brainqawire").setExecutor((sender,command,label,args)->{runProbe();sender.sendMessage("Original OpenAI wire probe written; inspect its bounded report.");return true;});
            getCommand("brainqaflip").setExecutor((sender,command,label,args)->{
                if(!(sender instanceof org.bukkit.command.ConsoleCommandSender)&&!(sender instanceof org.bukkit.command.RemoteConsoleCommandSender))return true;
                try{
                    JsonObject binding=JsonParser.parseString(Files.readString(stage.resolve("plugins/QiandengjiMaidBridge/brain-routing.json"))).getAsJsonObject();
                    var entity=org.bukkit.Bukkit.getEntity(UUID.fromString(binding.get("maidId").getAsString()));
                    var handle=((org.bukkit.craftbukkit.entity.CraftEntity)entity).getHandle();
                    if(!(handle instanceof com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid maid))throw new IllegalStateException("Synthetic maid missing");
                    // Same two fields as the original native owner menu; no NBT reload.
                    maid.getAiChatManager().llmSite="qa_brain_dsh";maid.getAiChatManager().llmModel="qwen3.7-plus";
                    sender.sendMessage("Synthetic native-menu selection changed without reloading entity history.");
                }catch(Exception error){sender.sendMessage("QA selection failed: "+error.getClass().getSimpleName());}
                return true;
            });
            getServer().getScheduler().runTaskLater(this,this::runProbe,40L);
        }catch(Exception error){getLogger().severe(error.getClass().getSimpleName());getServer().getPluginManager().disablePlugin(this);}
    }
    private void runProbe(){
        JsonObject report=new JsonObject();JsonArray checks=new JsonArray();boolean passed=true;
        for(String id:new String[]{"qa_brain_native","qa_brain_dsh","qa_brain_codex"})try{
            var site=AvailableSites.getLLMSite(id);boolean scoped=site!=null&&site.getClass().getName().endsWith("MaidBrainControl$HookedSite");
            FriendlyByteBuf buffer=new FriendlyByteBuf(Unpooled.buffer());
            try{
                SerializerRegister.getLLMSerializer("openai").writeToNetwork(site,buffer);
                var clientSite=new LLMOpenAISite.Serializer().fromNetwork(buffer);
                boolean privateKeyAbsent=clientSite.secretKey().isBlank()&&clientSite.headers().isEmpty();
                boolean ok=scoped&&site.getApiType().equals("openai")&&clientSite.id().equals(id)&&clientSite.models().equals(((LLMOpenAISite)site).models())&&privateKeyAbsent;
                JsonObject row=new JsonObject();row.addProperty("site",id);row.addProperty("guardedOnServer",scoped);row.addProperty("ordinaryNativeClientCanDecode",ok);row.addProperty("serverCredentialsAbsentFromClientWire",privateKeyAbsent);checks.add(row);passed&=ok;
            }finally{buffer.release();}
        }catch(Exception error){passed=false;JsonObject row=new JsonObject();row.addProperty("site",id);row.addProperty("errorType",error.getClass().getSimpleName());checks.add(row);}
        report.addProperty("passed",passed);report.add("checks",checks);report.addProperty("modelsCalled",false);report.addProperty("productionChanged",false);
        try{Files.writeString(Path.of("brain-wire-proof.json"),report.toString());}catch(Exception error){getLogger().severe("Wire proof write failed");}
    }
}
